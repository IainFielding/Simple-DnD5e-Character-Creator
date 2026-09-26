import { afterEach, describe, expect, it } from "vitest";
import { bookPrepared, computeSpellPlan, lvlSpellsStep, preparedChangeNames, spellChanges }
  from "../scripts/levelup/steps/lvl-spells-step.mjs";
import { wizard } from "./fixtures/dnd5e-5.3.3.mjs";

/**
 * A Wizard's level-up with its spellbook: the Spellbook tab (new spells for the book, auto-filling
 * the prepared limit), the Prepare tab (the whole book, to choose what is prepared), the wizard
 * built before the book was modelled (short book, or over its prepared limit), and what Apply
 * writes. Plus the Cleric's any-number swap, which shares the swap machinery.
 */

const M = "sogrom-dnd5e-character-creator";

/** A wizard spell item on the sheet. */
function spell(id, { level = 1, prepared = 1, sourceItem = "class:wizard" } = {}) {
  return {
    id, type: "spell", name: id, img: "", uuid: `Actor.a.Item.${id}`,
    _stats: { compendiumSource: `Compendium.dnd5e.spells.Item.${id}` },
    system: { level, prepared, sourceItem, identifier: id, school: "evo", properties: [] }
  };
}

/**
 * A levelled wizard, with the derived numbers dnd5e would compute: `preparation.max` from the
 * class's scale at that level, `.value` the number of `prepared: 1` spells.
 */
function wizardAt(classLevel, { preparedMax, book = [], slots = { spell1: 4, spell2: 3, spell3: 2 } } = {}) {
  const cls = structuredClone(wizard);
  cls.id = cls._id;
  cls.system.levels = classLevel;
  // dnd5e counts only leveled spells prepared the ordinary way (SpellData#countsPrepared).
  const preparedValue = book.filter(s => (s.system.level > 0) && (s.system.prepared === 1)).length;
  cls.system.spellcasting.preparation = { max: preparedMax, value: preparedValue };
  const spells = Object.fromEntries(Object.entries(slots).map(([k, max]) => [k, { max }]));
  const actor = { items: [cls, ...book], system: { details: { level: classLevel }, spells } };
  actor.items.get = id => actor.items.find(i => i.id === id);
  return { cls, actor };
}

/** A level-up state over that wizard, as the step reads it. */
function stateFor({ cls, actor }, over = {}) {
  const state = {
    actor, spellSource: actor, classItem: cls,
    spellTab: "", focusedSpellUuid: null, spellListOverride: "",
    selectedCantrips: [], selectedSpells: [],
    swapCantrip: null, swapSpells: [], preparedChanges: {},
    featSpells: [], featSpellSwaps: {},
    ...over
  };
  state.spellPlan = () => computeSpellPlan(actor, cls);
  return state;
}

/** A spell pool with a few new wizard spells up to 3rd level. */
const POOL = [
  { uuid: "Compendium.dnd5e.spells.Item.fireball", name: "Fireball", img: "", level: 3, identifier: "fireball", school: "Evocation", propertyKeys: "" },
  { uuid: "Compendium.dnd5e.spells.Item.fly", name: "Fly", img: "", level: 3, identifier: "fly", school: "Transmutation", propertyKeys: "" },
  { uuid: "Compendium.dnd5e.spells.Item.web", name: "Web", img: "", level: 2, identifier: "web", school: "Conjuration", propertyKeys: "" }
];
const spells = {
  forClassAtLevel: async () => ({ byLevel: { 0: [], 2: [POOL[2]], 3: [POOL[0], POOL[1]] } }),
  description: async () => "",
  sourceBook: async () => ""
};

/** A 4 → 5 wizard: twelve spells in the book (6 + 2×3), seven prepared, limit now nine. */
function levelFive() {
  const book = [
    ...["alarm", "detect", "feather", "familiar", "grease"].map(id => spell(id, { prepared: 0 })),
    ...["armor", "missile", "shield", "sleep", "misty", "blur", "ray"].map(id => spell(id, { prepared: 1 }))
  ];
  book[10].system.level = 2;   // blur
  book[9].system.level = 2;    // misty
  return wizardAt(5, { preparedMax: 9, book });
}

afterEach(() => { globalThis.fromUuid = async () => null; });

/* -------------------------------------------- */

describe("computeSpellPlan for a Wizard", () => {
  it("owes two book spells a level, separately from the prepared budget", () => {
    const plan = computeSpellPlan(levelFive().actor, levelFive().cls);
    expect(plan.bookRule).toEqual({ start: 6, perLevel: 2 });
    expect(plan.addBook).toBe(2);
    expect(plan.bookCatchUp).toBe(0);
    expect(plan.addSpells).toBe(2);        // 9 − 7: the prepared budget
    expect(plan.overPrepared).toBe(0);
    expect(plan.hasDelta).toBe(true);
  });

  it("owes a short book the whole gap, and says how much of it is catch-up", () => {
    // Level 5 with an eight-spell book, built before the book was modelled: target 14.
    const book = Array.from({ length: 8 }, (_, i) => spell(`s${i}`, { prepared: 1 }));
    const { actor, cls } = wizardAt(5, { preparedMax: 9, book });
    const plan = computeSpellPlan(actor, cls);
    expect(plan.addBook).toBe(6);
    expect(plan.bookCatchUp).toBe(4);
  });

  it("opens the step for a wizard over its prepared limit, even with nothing else to do", () => {
    // Level 2 (book of 8, full), but six prepared against a limit of five.
    const book = [
      ...Array.from({ length: 6 }, (_, i) => spell(`p${i}`, { prepared: 1 })),
      spell("b0", { prepared: 0 }), spell("b1", { prepared: 0 })
    ];
    const { actor, cls } = wizardAt(2, { preparedMax: 5, book, slots: { spell1: 3 } });
    const plan = computeSpellPlan(actor, cls);
    expect(plan.addBook).toBe(0);
    expect(plan.overPrepared).toBe(1);
    expect(plan.hasDelta).toBe(true);
  });
});

describe("spells copied into the book in play", () => {
  it("don't reduce the free picks once the class records its ledger", () => {
    const wiz = levelFive();
    wiz.cls.flags = { "sogrom-dnd5e-character-creator": { spellbookFree: 12 } };
    // Five spells copied from scrolls, tagged to the Wizard by dnd5e like any other.
    wiz.actor.items.push(...["c1", "c2", "c3", "c4", "c5"].map(id => spell(id, { prepared: 0 })));
    const plan = computeSpellPlan(wiz.actor, wiz.cls);
    expect(plan.addBook).toBe(2);
    expect(plan.bookCatchUp).toBe(0);
  });

  it("records this level's picks on the class when applied", () => {
    const wiz = levelFive();
    wiz.cls.flags = { "sogrom-dnd5e-character-creator": { spellbookFree: 12 } };
    const state = stateFor(wiz, {
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3 }, { uuid: POOL[1].uuid, name: "Fly", level: 3 }]
    });
    expect(spellChanges(state).bookLedger).toEqual({
      _id: wiz.cls.id, "flags.sogrom-dnd5e-character-creator.spellbookFree": 14
    });
  });
});

describe("the Spellbook tab", () => {
  it("comes after Cantrips when there are cantrips to learn, and opens first when there aren't", async () => {
    // levelFive knows no cantrips, so it is owed some: Cantrips leads and the step opens there.
    const withCantrips = await lvlSpellsStep.context({ state: stateFor(levelFive()), spells });
    expect(withCantrips.isCantripsTab).toBe(true);
    expect(withCantrips.hasBook).toBe(true);

    const known = levelFive();
    known.actor.items.push(...["c0", "c1", "c2", "c3"].map(id => spell(id, { level: 0 })));
    const noCantrips = await lvlSpellsStep.context({ state: stateFor(known), spells });
    expect(noCantrips.isBookTab).toBe(true);
  });

  it("lists new spells only, and flags each pick by whether it was prepared", async () => {
    const wiz = levelFive();
    const state = stateFor(wiz, {
      spellTab: "book",
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3, prepared: true }]
    });
    const ctx = await lvlSpellsStep.context({ state, spells });
    expect(ctx.isBookTab).toBe(true);
    expect(ctx.hasSpells).toBe(false);     // no ordinary Spells tab for a book caster
    expect(ctx.addBook).toBe(2);
    const fireball = ctx.list.find(s => s.name === "Fireball");
    expect(fireball.active).toBe(true);
    expect(fireball.ownedTag).toBe(`${M}.levelup.step.spells.flagPrepared`);
    // Nothing already owned is offered, and no swap rows appear.
    expect(ctx.list.some(s => s.owned)).toBe(false);
  });

  it("prepares new picks while the limit has room, then writes the rest in unprepared", async () => {
    const wiz = levelFive();
    // Seven prepared of nine: room for two. Pre-fill one prepared change to leave room for one.
    const state = stateFor(wiz, { preparedChanges: { alarm: 1 } });
    globalThis.fromUuid = async uuid => {
      const entry = POOL.find(p => p.uuid === uuid);
      return entry ? { id: entry.identifier, name: entry.name, img: "", system: { level: entry.level } } : null;
    };
    await lvlSpellsStep.handle("pick-spell", { dataset: { uuid: POOL[0].uuid, level: "3" } }, { state });
    await lvlSpellsStep.handle("pick-spell", { dataset: { uuid: POOL[1].uuid, level: "3" } }, { state });
    expect(state.selectedSpells.map(s => s.prepared)).toEqual([true, false]);
    // The third is refused: two free book spells this level.
    await lvlSpellsStep.handle("pick-spell", { dataset: { uuid: POOL[2].uuid, level: "2" } }, { state });
    expect(state.selectedSpells).toHaveLength(2);
  });

  it("explains catch-up picks", async () => {
    const book = Array.from({ length: 8 }, (_, i) => spell(`s${i}`, { prepared: 1 }));
    const state = stateFor(wizardAt(5, { preparedMax: 9, book }), { spellTab: "book" });
    const ctx = await lvlSpellsStep.context({ state, spells });
    expect(ctx.bookCatchUpHint).toBe(`${M}.levelup.step.spells.bookCatchUp:{"count":4}`);
  });
});

describe("the Prepare tab", () => {
  it("lists the whole book with its state, and new picks as New", async () => {
    const wiz = levelFive();
    const state = stateFor(wiz, {
      spellTab: "prepare",
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3, prepared: false }]
    });
    const ctx = await lvlSpellsStep.context({ state, spells });
    expect(ctx.isPrepareTab).toBe(true);
    expect(ctx.list).toHaveLength(13);
    const alarm = ctx.list.find(s => s.name === "alarm");
    expect(alarm.active).toBe(false);
    expect(alarm.ownedTag).toBe(`${M}.levelup.step.spells.flagBook`);
    const shield = ctx.list.find(s => s.name === "shield");
    expect(shield.active).toBe(true);
    expect(shield.ownedTag).toBe(`${M}.levelup.step.spells.flagPrepared`);
    const fireball = ctx.list.find(s => s.name === "Fireball");
    expect(fireball.ownedTag).toBe(`${M}.levelup.step.spells.flagNew`);
    expect(fireball.isNewPick).toBe(true);
    expect(ctx.preparedCount).toBe(7);
    expect(ctx.preparedCap).toBe(9);
  });

  it("shows an always-prepared spell locked, and doesn't count it", async () => {
    const wiz = levelFive();
    wiz.actor.items.push(spell("mastery", { prepared: 2 }));
    const state = stateFor(wiz, { spellTab: "prepare", focusedSpellUuid: "Compendium.dnd5e.spells.Item.mastery" });
    const ctx = await lvlSpellsStep.context({ state, spells });
    expect(ctx.focused.locked).toBe(true);
    expect(ctx.focused.ownedTag).toBe(`${M}.levelup.step.spells.flagAlways`);
    expect(ctx.focused.note).toBe(`${M}.levelup.step.spells.alwaysNote`);
    expect(ctx.preparedCount).toBe(7);
    // And toggling it does nothing.
    await lvlSpellsStep.handle("toggle-prepared", { dataset: { id: "mastery" } }, { state });
    expect(state.preparedChanges).toEqual({});
  });

  it("stages owned changes, drops one that returns to the sheet's state, and refuses past the limit", async () => {
    const state = stateFor(levelFive());
    const toggle = id => lvlSpellsStep.handle("toggle-prepared", { dataset: { id } }, { state });
    await toggle("alarm");            // 8 of 9
    await toggle("detect");           // 9 of 9
    await toggle("feather");          // refused: full
    expect(state.preparedChanges).toEqual({ alarm: 1, detect: 1 });
    await toggle("shield");           // unprepare one: 8 of 9
    await toggle("feather");          // now fits
    expect(state.preparedChanges).toEqual({ alarm: 1, detect: 1, shield: 0, feather: 1 });
    await toggle("alarm");            // back to how the sheet has it: no change to stage
    expect(state.preparedChanges).not.toHaveProperty("alarm");
    expect(bookPrepared(state, state.spellPlan()).count).toBe(8);
  });

  it("toggles a new pick's own flag", async () => {
    const state = stateFor(levelFive(), {
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3, prepared: false }]
    });
    await lvlSpellsStep.handle("toggle-prepared", { dataset: { uuid: POOL[0].uuid } }, { state });
    expect(state.selectedSpells[0].prepared).toBe(true);
  });

  it("warns a wizard over its limit", async () => {
    const book = [
      ...Array.from({ length: 6 }, (_, i) => spell(`p${i}`, { prepared: 1 })),
      spell("b0", { prepared: 0 }), spell("b1", { prepared: 0 }),
      // Its cantrips are all known, so Prepare is the only tab left.
      ...["c0", "c1", "c2"].map(id => spell(id, { level: 0 }))
    ];
    const state = stateFor(wizardAt(2, { preparedMax: 5, book, slots: { spell1: 3 } }));
    const ctx = await lvlSpellsStep.context({ state, spells });
    expect(ctx.isPrepareTab).toBe(true);    // the only tab it has
    expect(ctx.overPreparedHint).toBe(`${M}.levelup.step.spells.overPrepared:{"count":1}`);
    expect(ctx.list.find(s => s.name === "b0").disabled).toBe(true);
  });
});

describe("spells the character already has from elsewhere", () => {
  /** levelFive plus a feat that grants an always-prepared spell and a species cantrip. */
  function withGrants() {
    const wiz = levelFive();
    const feat = { id: "feytouched000000", type: "feat", name: "Fey Touched", system: { identifier: "fey-touched", type: { value: "feat" } } };
    const misty = spell("mistyfey", { level: 2, prepared: 2, sourceItem: "feat:fey-touched" });
    misty.name = "Misty Step (Fey)";
    misty.flags = { dnd5e: { advancementOrigin: "feytouched000000.adv1" } };
    const elf = { id: "highelf000000000", type: "race", name: "High Elf", system: { identifier: "high-elf" } };
    const cantrip = spell("prestidigitation", { level: 0, prepared: 1, sourceItem: "race:high-elf" });
    wiz.actor.items.push(feat, misty, elf, cantrip);
    return wiz;
  }

  it("shows an always-prepared feat spell on the Prepare tab, locked, named, and not counted", async () => {
    const state = stateFor(withGrants(), { spellTab: "prepare", focusedSpellUuid: "Compendium.dnd5e.spells.Item.mistyfey" });
    const ctx = await lvlSpellsStep.context({ state, spells });
    const row = ctx.list.find(s => s.name === "Misty Step (Fey)");
    expect(row.granted).toBe(true);
    expect(row.ownedTag).toBe(`${M}.levelup.step.spells.flagAlways`);
    expect(row.ownedTip).toBe(`${M}.levelup.step.spells.grantedTipAlways:{"source":"Fey Touched"}`);
    expect(ctx.focused.prepareMode).toBe(false);
    expect(ctx.focused.note).toBe(`${M}.levelup.step.spells.grantedNote:{"source":"Fey Touched"}`);
    expect(ctx.preparedCount).toBe(7);
    // It sits among the book by level: after the 1st-level spells, with the 2nd.
    const names = ctx.list.map(s => s.name);
    expect(names.indexOf("Misty Step (Fey)")).toBeGreaterThan(names.indexOf("shield"));
  });

  it("leads the Spellbook tab with the leveled grants and the Cantrips tab with the cantrip grants", async () => {
    const book = await lvlSpellsStep.context({ state: stateFor(withGrants(), { spellTab: "book" }), spells });
    expect(book.list[0].name).toBe("Misty Step (Fey)");
    expect(book.list.some(s => s.name === "prestidigitation")).toBe(false);

    const cantrips = await lvlSpellsStep.context({ state: stateFor(withGrants(), { spellTab: "cantrips" }), spells });
    expect(cantrips.list[0].name).toBe("prestidigitation");
    expect(cantrips.list[0].ownedTag).toBe(`${M}.levelup.step.spells.flagGranted`);
    expect(cantrips.list[0].ownedTip).toBe(`${M}.levelup.step.spells.grantedTip:{"source":"High Elf"}`);
  });

  it("can't be prepared or unprepared", async () => {
    const state = stateFor(withGrants());
    await lvlSpellsStep.handle("toggle-prepared", { dataset: { id: "mistyfey" } }, { state });
    expect(state.preparedChanges).toEqual({});
  });
});

describe("what Apply writes for a Wizard", () => {
  it("creates new picks with their prepared flag and updates the Prepare tab's changes", () => {
    const state = stateFor(levelFive(), {
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3, prepared: false }],
      preparedChanges: { alarm: 1, shield: 0 }
    });
    const { create, deleteIds, prepareUpdates } = spellChanges(state);
    expect(create[0].prepared).toBe(false);
    expect(deleteIds).toEqual([]);
    expect(prepareUpdates).toEqual([
      { _id: "alarm", "system.prepared": 1 },
      { _id: "shield", "system.prepared": 0 }
    ]);
  });

  it("names the changes for the Review screen and the chat card", () => {
    const state = stateFor(levelFive(), {
      selectedSpells: [{ uuid: POOL[0].uuid, name: "Fireball", level: 3, prepared: false }],
      preparedChanges: { alarm: 1, shield: 0 }
    });
    expect(preparedChangeNames(state)).toEqual({
      nowPrepared: ["alarm"], noLongerPrepared: ["shield"], bookOnly: ["Fireball"]
    });
  });
});

describe("the known-spells list", () => {
  it("marks book-only spells so they show faded", async () => {
    const state = stateFor(levelFive());
    const ctx = await lvlSpellsStep.context({ state, spells });
    const chips = ctx.knownGroups.flatMap(g => g.spells);
    expect(chips.find(c => c.name === "alarm").unprepared).toBe(true);
    expect(chips.find(c => c.name === "shield").unprepared).toBe(false);
  });
});

/* -------------------------------------------- */
/*  Any-number swaps (Cleric, Druid)             */
/* -------------------------------------------- */

describe("marking prepared spells for replacement", () => {
  /** A plan-only state: the swap handlers read nothing else. */
  function swapState(spellSwaps) {
    return {
      selectedCantrips: [], selectedSpells: [], swapCantrip: null, swapSpells: [],
      spellPlan: () => ({ addSpells: 1, addCantrips: 0, canSwapSpell: true, canSwapCantrip: false, spellSwaps })
    };
  }
  const mark = (state, id) => lvlSpellsStep.handle("swap-spell", { dataset: { id, name: id, level: "1" } }, { state });

  it("lets a Cleric mark several, each freeing a pick", async () => {
    const state = swapState("any");
    await mark(state, "bless");
    await mark(state, "bane");
    expect(state.swapSpells.map(m => m.id)).toEqual(["bless", "bane"]);
    // Three picks: one for the level and one for each mark, so both marks are used.
    state.selectedSpells = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    expect(spellChanges(state).deleteIds).toEqual(["bless", "bane"]);
  });

  it("moves the single mark for a class that replaces one", async () => {
    const state = swapState("one");
    await mark(state, "bless");
    await mark(state, "bane");
    expect(state.swapSpells.map(m => m.id)).toEqual(["bane"]);
  });

  it("gives back a mark's pick when it is unmarked", async () => {
    const state = swapState("any");
    await mark(state, "bless");
    await mark(state, "bane");
    state.selectedSpells = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    await mark(state, "bane");
    expect(state.swapSpells.map(m => m.id)).toEqual(["bless"]);
    expect(state.selectedSpells).toHaveLength(2);
  });
});
