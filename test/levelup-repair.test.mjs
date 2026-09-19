import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unresolvedByLevel, unresolvedAdvancements } from "../scripts/data/advancement-util.mjs";
import {
  repairItems, grantLevel, repairTargets, canRepair, buildRepairManager, foldToLevel, repairOptions,
  launchRepair, promptRepair
} from "../scripts/levelup/repair.mjs";
import { LevelUpState } from "../scripts/levelup/levelup-state.mjs";
import { onGetHeaderControls } from "../scripts/levelup/intercept.mjs";
import { SETTINGS } from "../scripts/config.mjs";

/**
 * "Repair this level" — finish the decisions an already-applied level left unanswered, through the
 * ordinary level-up shell. dnd5e never blocks Next on an unmade choice, so a character can carry a
 * never-picked Fighting Style or an unspent ASI with nothing on the sheet to say so.
 *
 * The contract pinned here:
 *  - detection is per *level* (a multi-tier choice reports each short tier on its own), and covers
 *    the class, its subclass and features linked to either, hit points included;
 *  - the repair manager holds forward steps for exactly the unanswered advancements, nothing
 *    reversed — so a decision the player made can never be lost;
 *  - the session posts no level-up card, shows no spell step unless the repair adds spellcasting,
 *    and is offered only while something is actually unanswered.
 */

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

/** ItemChoice stub: dnd5e marks it multi-level, which is how its `value.added` is keyed. */
class ItemChoiceStub {
  static metadata = { multiLevel: true };
  constructor(data) { Object.assign(this, { type: "ItemChoice" }, data); }
}

const adv = (type, data) => (type === "ItemChoice" ? new ItemChoiceStub(data) : { type, ...data });

function items(list) {
  const m = new Map(list.map(i => [i.id, i]));
  const arr = [...m.values()];
  return Object.assign(arr, { get: id => m.get(id) });
}

/** A level-`level` Fighter whose decisions are answered or not as each test needs. */
function fighter({ level = 4, hp = { 1: "max", 2: "avg", 3: "avg", 4: "avg" }, style = true, skills = true,
  asi = true, subclass = true } = {}) {
  const advs = {
    hp: adv("HitPoints", { _id: "advHP", title: "Hit Points", value: hp }),
    skills: adv("Trait", { _id: "advSkills", title: "Skill Proficiencies", level: 1,
      configuration: { choices: [{ count: 2 }] }, value: { chosen: skills ? ["skills:ath", "skills:per"] : [] } }),
    style: adv("ItemChoice", { _id: "advStyle", title: "Fighting Style",
      configuration: { choices: { 1: { count: 1 } } },
      value: { added: style ? { 1: { featStyle: "Compendium.x.Item.archery" } } : {} } }),
    sub: adv("Subclass", { _id: "advSub", title: "Martial Archetype", level: 3,
      value: subclass ? { uuid: "Compendium.x.Item.champion" } : {} }),
    asi: adv("AbilityScoreImprovement", { _id: "advAsi", title: "Ability Score Improvement", level: 4,
      configuration: { points: 2 }, value: asi ? { type: "asi", assignments: { str: 2 } } : { type: "asi" } })
  };
  return {
    id: "clsFighter000000", type: "class", name: "Fighter", identifier: "fighter",
    system: { levels: level, identifier: "fighter" },
    advancement: { byId: Object.fromEntries(Object.values(advs).map(a => [a._id, a])) },
    advs
  };
}

function character(itemList, { isOwner = true } = {}) {
  return { type: "character", isOwner, items: items(itemList), system: { details: { level: 4 } } };
}

/* -------------------------------------------- */
/*  Detection                                   */
/* -------------------------------------------- */

describe("unresolvedByLevel", () => {
  it("reports nothing for a fully answered class", () => {
    expect(unresolvedByLevel(fighter(), 4)).toEqual([]);
  });

  it("names the level each gap is owed at", () => {
    const f = fighter({ style: false, asi: false, subclass: false });
    expect(unresolvedByLevel(f, 4).map(e => [e.title, e.level])).toEqual([
      ["Fighting Style", 1], ["Martial Archetype", 3], ["Ability Score Improvement", 4]
    ]);
  });

  it("reports each short tier of a multi-tier choice separately", () => {
    const metamagic = new ItemChoiceStub({ _id: "advMeta", title: "Metamagic",
      configuration: { choices: { 2: { count: 2 }, 10: { count: 1 }, 17: { count: 1 } } },
      value: { added: { 2: { a: "x", b: "y" } } } });
    const item = { type: "class", advancement: { byId: { advMeta: metamagic } } };
    expect(unresolvedByLevel(item, 12).map(e => e.level)).toEqual([10]);
    expect(unresolvedByLevel(item, 20).map(e => e.level)).toEqual([10, 17]);
  });

  it("reports a class level whose hit points were never taken", () => {
    const f = fighter({ hp: { 1: "max", 2: "avg", 4: "avg" } });
    expect(unresolvedByLevel(f, 4).map(e => [e.type, e.level])).toEqual([["HitPoints", 3]]);
  });

  it("leaves hit points out on request, and never reports them for a non-class item", () => {
    const f = fighter({ hp: { 1: "max" } });
    expect(unresolvedByLevel(f, 4, { hitPoints: false })).toEqual([]);
    expect(unresolvedByLevel({ ...f, type: "subclass" }, 4)).toEqual([]);
  });

  it("does not report a decision above the item's level", () => {
    expect(unresolvedByLevel(fighter({ level: 3, asi: false }), 3)).toEqual([]);
  });

  it("keeps unresolvedAdvancements to one flag per advancement, without hit points", () => {
    const metamagic = new ItemChoiceStub({ _id: "advMeta", title: "Metamagic",
      configuration: { choices: { 2: { count: 1 }, 10: { count: 1 } } }, value: { added: {} } });
    const hp = { _id: "advHP", type: "HitPoints", value: {} };
    const item = { type: "class", advancement: { byId: { advMeta: metamagic, advHP: hp } } };
    expect(unresolvedAdvancements(item, 12)).toEqual([{ id: "advMeta", type: "ItemChoice", title: "Metamagic" }]);
  });
});

/* -------------------------------------------- */
/*  Which items a class owns                    */
/* -------------------------------------------- */

describe("repairItems", () => {
  it("takes the class, its subclass and features linked to either — and nothing else", () => {
    const cls = fighter();
    const sub = { id: "subChampion00000", type: "subclass", system: { classIdentifier: "fighter" } };
    const classFeature = { id: "featSecondWind00", type: "feat", system: { advancementRootItem: cls } };
    const subFeature = { id: "featSavant000000", type: "feat", system: { advancementRootItem: sub } };
    const unlinked = { id: "featUnlinked0000", type: "feat",
      system: { advancementRootItem: cls, advancementClassLinked: false } };
    const background = { id: "bgSage0000000000", type: "background", system: {} };
    const actor = character([cls, sub, classFeature, subFeature, unlinked, background]);
    expect(repairItems(actor, cls).map(i => i.id)).toEqual(
      ["clsFighter000000", "subChampion00000", "featSecondWind00", "featSavant000000"]);
  });
});

describe("grantLevel", () => {
  it("reads the level a multi-level choice granted the item at", () => {
    const cls = fighter();
    cls.advs.style.value.added = { 3: { featPicked000000: "Compendium.x.Item.p" } };
    const picked = { id: "featPicked000000", flags: { dnd5e: { advancementOrigin: `${cls.id}.advStyle` } } };
    expect(grantLevel(character([cls, picked]), picked)).toBe(3);
  });

  it("reads a single-level grant's own level", () => {
    const grant = { _id: "advGrant", type: "ItemGrant", level: 6, value: { added: { featAura00000000: "u" } } };
    const cls = { id: "clsPaladin000000", type: "class", advancement: { byId: { advGrant: grant } } };
    const aura = { id: "featAura00000000", flags: { dnd5e: { advancementOrigin: "clsPaladin000000.advGrant" } } };
    expect(grantLevel(character([cls, aura]), aura)).toBe(6);
  });

  it("is null for an item with no grant record", () => {
    expect(grantLevel(character([]), { id: "x", flags: {} })).toBeNull();
  });
});

/* -------------------------------------------- */
/*  Targets                                     */
/* -------------------------------------------- */

describe("repairTargets", () => {
  it("is empty for a complete character, and for anything that is not a character", () => {
    expect(repairTargets(character([fighter()]))).toEqual([]);
    expect(repairTargets({ type: "npc", items: items([fighter({ style: false })]) })).toEqual([]);
    expect(repairTargets(null)).toEqual([]);
  });

  it("groups a class's gaps by level, in level order", () => {
    const [target] = repairTargets(character([fighter({ style: false, skills: false, asi: false })]));
    expect(target.classItem.id).toBe("clsFighter000000");
    expect(target.levels.map(g => [g.level, g.titles])).toEqual([
      [1, ["Skill Proficiencies", "Fighting Style"]], [4, ["Ability Score Improvement"]]
    ]);
  });

  it("files a granted feature's level-0 choice under the level the feature arrived at", () => {
    const cls = fighter();
    // A level-3 feature pick, answered, that granted the feature carrying the unanswered choice.
    cls.advancement.byId.advFeature = new ItemChoiceStub({ _id: "advFeature", title: "Feature",
      configuration: { choices: { 3: { count: 1 } } },
      value: { added: { 3: { featSavant000000: "Compendium.x.Item.savant" } } } });
    const choice = new ItemChoiceStub({ _id: "advPick", title: "Savant Spells",
      configuration: { choices: { 0: { count: 2 } } }, value: { added: {} } });
    const savant = { id: "featSavant000000", type: "feat",
      system: { advancementRootItem: cls },
      flags: { dnd5e: { advancementOrigin: `${cls.id}.advFeature` } },
      advancement: { byId: { advPick: choice } } };
    const [target] = repairTargets(character([cls, savant]));
    expect(target.levels).toHaveLength(1);
    expect(target.levels[0].level).toBe(3);
    expect(target.levels[0].entries[0]).toMatchObject({ itemId: "featSavant000000", id: "advPick", level: 0 });
  });

  it("labels one option per class level for the prompt", () => {
    const opts = repairOptions(character([fighter({ style: false, asi: false })]));
    expect(opts.map(o => [o.classId, o.level])).toEqual([["clsFighter000000", 1], ["clsFighter000000", 4]]);
    expect(typeof opts[0].label).toBe("string");
  });
});

describe("canRepair", () => {
  it("offers a repair only to an owner, and only while something is unanswered", () => {
    expect(canRepair(character([fighter({ style: false })]))).toBe(true);
    expect(canRepair(character([fighter()]))).toBe(false);
    expect(canRepair(character([fighter({ style: false })], { isOwner: false }))).toBe(false);
  });

  it("is offered at the level cap, where Level Up is not", () => {
    const actor = character([fighter({ level: 4, asi: false })]);
    actor.system.details.level = 20;
    expect(canRepair(actor)).toBe(true);
  });
});

/* -------------------------------------------- */
/*  The repair manager                          */
/* -------------------------------------------- */

/** A stand-in AdvancementManager whose clone is the actor's own items, and a flow per level. */
function installManager() {
  const flowsAsked = [];
  class FakeManager {
    constructor(actor) {
      this.actor = actor;
      this.clone = { items: actor.items };
      this.steps = [];
    }
    static flowsForLevel(item, level) {
      flowsAsked.push([item.id, level]);
      return Object.values(item.advancement?.byId ?? {})
        .filter(a => (a.type === "HitPoints") || (a.level === level) || (String(level) in (a.configuration?.choices ?? {})))
        .map(a => ({ advancement: a, level, item }));
    }
  }
  globalThis.dnd5e.applications = { advancement: { AdvancementManager: FakeManager } };
  return flowsAsked;
}

describe("buildRepairManager", () => {
  afterEach(() => { delete globalThis.dnd5e.applications; });

  it("holds forward steps for exactly the level's unanswered advancements, and reverses nothing", () => {
    installManager();
    const actor = character([fighter({ style: false, skills: false, asi: false })]);
    const manager = buildRepairManager(actor, "clsFighter000000", 1);
    expect(manager.steps.map(s => [s.type, s.flow.advancement._id, s.flow.level]))
      .toEqual([["forward", "advSkills", 1], ["forward", "advStyle", 1]]);
    expect(manager.steps.every(s => !s.automatic)).toBe(true);
  });

  it("carries the class at its current level, so a late subclass reaches its later features", () => {
    installManager();
    const actor = character([fighter({ level: 7, subclass: false,
      hp: { 1: "max", 2: "avg", 3: "avg", 4: "avg", 5: "avg", 6: "avg", 7: "avg" } })]);
    const [step] = buildRepairManager(actor, "clsFighter000000", 3).steps;
    expect(step.flow.advancement._id).toBe("advSub");
    expect(step.class).toMatchObject({ level: 7 });
    expect(step.class.item.id).toBe("clsFighter000000");
  });

  it("repairs a missing hit-point level on its own", () => {
    installManager();
    const actor = character([fighter({ hp: { 1: "max", 2: "avg", 4: "avg" } })]);
    const steps = buildRepairManager(actor, "clsFighter000000", 3).steps;
    expect(steps.map(s => [s.flow.advancement._id, s.flow.level])).toEqual([["advHP", 3]]);
  });

  it("is empty for a level with nothing to repair, or a class the actor doesn't have", () => {
    installManager();
    const actor = character([fighter({ style: false })]);
    expect(buildRepairManager(actor, "clsFighter000000", 4).steps).toEqual([]);
    expect(buildRepairManager(actor, "clsNotHere000000", 1).steps).toEqual([]);
  });
});

describe("foldToLevel", () => {
  it("puts every decision a repair surfaced on the one screen it repairs", () => {
    const driver = { hpSteps: [{ level: 3 }], choiceSteps: [{ level: 0 }, { level: 3, screenLevel: 6 }], nativeSteps: [{ level: 0 }] };
    foldToLevel(driver, 3);
    expect([...driver.hpSteps, ...driver.choiceSteps, ...driver.nativeSteps].map(r => r.screenLevel)).toEqual([3, 3, 3, 3]);
  });
});

describe("launchRepair and promptRepair", () => {
  let info;
  beforeEach(() => {
    info = vi.fn();
    globalThis.ui = { notifications: { info, error: vi.fn(), warn: vi.fn() } };
    installManager();
  });
  afterEach(() => { delete globalThis.dnd5e.applications; });

  it("says so and opens nothing when the level has nothing left to repair", async () => {
    expect(await launchRepair(character([fighter()]), "clsFighter000000", 1)).toBeNull();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("says so when the character has nothing to repair at all", async () => {
    expect(await promptRepair(character([fighter()]))).toBeNull();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------- */
/*  The session                                 */
/* -------------------------------------------- */

describe("a repair session", () => {
  const driverFor = actor => ({
    steps: [{ type: "forward", class: { item: actor.items[0], level: 4 } }],
    clone: actor, hpSteps: [], choiceSteps: [], asiSteps: [], traitSteps: [], subclassSteps: [],
    grantSteps: [], optionalGrantSteps: [], sizeSteps: [], nativeSteps: []
  });

  it("posts no level-up card and does not claim to reach a new level", () => {
    const actor = character([fighter({ style: false })]);
    const state = new LevelUpState(actor, driverFor(actor), { repairLevel: 1 });
    expect(state.repairLevel).toBe(1);
    expect(state.announce).toBe("none");
    expect(state.toLevel).toBe(state.fromLevel);
  });

  it("an ordinary level-up still announces itself", () => {
    const actor = character([fighter()]);
    expect(new LevelUpState(actor, driverFor(actor)).announce).toBe("levelup");
  });

  it("shows no spell step unless the repair makes the class a caster", () => {
    const actor = character([fighter({ style: false })]);
    const state = new LevelUpState(actor, driverFor(actor), { repairLevel: 1 });
    expect(state.repairAddsSpellcasting()).toBe(false);
    expect(state.hasSpellStep()).toBe(false);
  });
});

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

describe("the repair header control", () => {
  beforeEach(() => {
    game.settings.set(null, SETTINGS.headerMenu, true);
    game.settings.set(null, SETTINGS.mode, "creation-levelup");
  });

  const repairControls = actor => {
    const controls = [];
    onGetHeaderControls({ actor }, controls);
    return controls.filter(c => c.action === "sogromRepairLevel");
  };

  it("is offered while a level has an unanswered choice", () => {
    const controls = repairControls(character([fighter({ style: false })]));
    expect(controls).toHaveLength(1);
    expect(typeof controls[0].onClick).toBe("function");
  });

  it("is absent when nothing is unanswered, and never doubles up", () => {
    expect(repairControls(character([fighter()]))).toHaveLength(0);
    const actor = character([fighter({ style: false })]);
    const controls = [];
    onGetHeaderControls({ actor }, controls);
    onGetHeaderControls({ actor }, controls);
    expect(controls.filter(c => c.action === "sogromRepairLevel")).toHaveLength(1);
  });

  it("follows the same switches as Level Up", () => {
    game.settings.set(null, SETTINGS.mode, "creation");
    expect(repairControls(character([fighter({ style: false })]))).toHaveLength(0);
  });
});
