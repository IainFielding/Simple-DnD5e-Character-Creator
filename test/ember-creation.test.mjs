import { beforeEach, describe, expect, it } from "vitest";
import { isEmberCreationManager, foldOriginScreens, emberEquipmentStep } from "../scripts/levelup/ember-creation.mjs";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

/**
 * The Ember hand-off: Ember's character builder assigns the ancestry, background and class, then
 * renders a hand-built AdvancementManager to ask the level-1 advancement questions — which is where
 * our takeover hook fires. These tests pin the two halves of the claim (recognising *only* that
 * hand-off, and the gate accepting its step set) plus the screen folding, because getting either
 * wrong is invisible until a real Ember character is being created: a false positive drives a flow
 * we can't finish and strands Ember's builder, a false negative silently reverts to Ember's
 * unguided hand-off.
 *
 * Manager shape mirrors `EmberCharacterCreationSheet#createAdvancementManager` (ember 0.6.0,
 * scripts/ember.mjs): the ancestry, the synthesised culture+path background, the class at level 0
 * and the attunement feature are staged on `manager.clone` only, never on the actor.
 */

const CLASS_ID = "clsEmberCls00000";
const BACKGROUND_ID = "bgEmberOrigin000";
const ANCESTRY_ID = "raceEmberAnc0000";

/** A Foundry Collection-alike: a Map with the array-ish helpers the source code uses. */
function collection(docs) {
  const map = new Map(docs.map(d => [d.id, d]));
  map.find = fn => [...map.values()].find(fn);
  map.some = fn => [...map.values()].some(fn);
  map.filter = fn => [...map.values()].filter(fn);
  return map;
}

/**
 * A manager stub in Ember's hand-off shape. Overrides let each test break exactly one part of the
 * fingerprint.
 */
function makeManager({
  actorItems = [], type = "character", isOwner = true,
  background = { id: BACKGROUND_ID, type: "background", system: { identifier: "emberBackground" }, flags: {} },
  cloneItems = null
} = {}) {
  const staged = cloneItems ?? [
    { id: ANCESTRY_ID, type: "race" },
    { id: CLASS_ID, type: "class" },
    ...(background ? [background] : [])
  ];
  return {
    steps: [],
    actor: { type, isOwner, system: { details: { level: 0 } }, items: collection(actorItems) },
    clone: { items: collection(staged) }
  };
}

/** Ember is only ever claimed while its module is active. */
beforeEach(() => {
  game.modules = { get: id => (id === "ember" ? { active: true } : null) };
});

/* -------------------------------------------- */
/*  Detection                                   */
/* -------------------------------------------- */

describe("isEmberCreationManager", () => {
  it("claims a manager whose clone carries Ember's staged class and background", () => {
    expect(isEmberCreationManager(makeManager())).toBe(true);
  });

  it("recognises the background by Ember's flags when the identifier differs", () => {
    const background = { id: BACKGROUND_ID, type: "background", system: {}, flags: { ember: { culture: "c", path: "p" } } };
    expect(isEmberCreationManager(makeManager({ background }))).toBe(true);
  });

  it("stands down when Ember is not active", () => {
    game.modules = { get: () => null };
    expect(isEmberCreationManager(makeManager())).toBe(false);
  });

  it("stands down for an ordinary level-up — the actor already has a class", () => {
    const actorItems = [{ id: CLASS_ID, type: "class" }];
    expect(isEmberCreationManager(makeManager({ actorItems }))).toBe(false);
  });

  it("stands down when the staged background isn't one Ember built", () => {
    const background = { id: BACKGROUND_ID, type: "background", system: { identifier: "acolyte" }, flags: {} };
    expect(isEmberCreationManager(makeManager({ background }))).toBe(false);
  });

  it("stands down with no background staged at all", () => {
    expect(isEmberCreationManager(makeManager({ background: null }))).toBe(false);
  });

  it("stands down without a staged class", () => {
    const cloneItems = [{ id: ANCESTRY_ID, type: "race" }];
    expect(isEmberCreationManager(makeManager({ cloneItems }))).toBe(false);
  });

  it("stands down on an actor the user doesn't own, or one that isn't a character", () => {
    expect(isEmberCreationManager(makeManager({ isOwner: false }))).toBe(false);
    expect(isEmberCreationManager(makeManager({ type: "npc" }))).toBe(false);
  });

  it("stands down on a malformed manager rather than throwing", () => {
    expect(isEmberCreationManager(null)).toBe(false);
    expect(isEmberCreationManager({})).toBe(false);
  });
});

/* -------------------------------------------- */
/*  Claim gate                                  */
/* -------------------------------------------- */

describe("the claim gate on Ember's step set", () => {
  /** The steps Ember pushes: the class's level 0→1 change plus level-0/1 flows for the rest. */
  function emberSteps() {
    const cls = { item: { id: CLASS_ID }, level: 1 };
    const flow = (type, level, cfg = {}) => ({ advancement: { type, configuration: cfg, item: {} }, level });
    return [
      { type: "forward", level: 0, flow: flow("Trait", 0) },                              // ancestry traits
      { type: "forward", level: 0, flow: flow("Size", 0, { sizes: new Set(["med"]) }) },  // fixed size
      { type: "forward", level: 0, flow: flow("EmberKnowledge", 0, { grants: ["gods"] }) },
      { type: "forward", level: 1, class: cls, flow: flow("HitPoints", 1) },
      { type: "forward", level: 1, class: cls, flow: flow("ItemChoice", 1) },
      { type: "forward", automatic: true, level: 1, class: cls }
    ];
  }

  function managerWithSteps(steps) {
    const manager = makeManager();
    manager.steps = steps;
    return manager;
  }

  it("supports Ember's own knowledge advancement (a pure grant, no screen of its own)", () => {
    const step = { type: "forward", level: 0, flow: { advancement: { type: "EmberKnowledge", configuration: { grants: ["gods"] } } } };
    expect(LevelUpDriver.isStepSupported(step)).toBe(true);
  });

  it("drives the hand-off — the class is staged on the clone, so it needs allowNewClass", () => {
    const manager = managerWithSteps(emberSteps());
    expect(LevelUpDriver.canDrive(manager, { allowNewClass: true })).toBe(true);
    // Without that option the clone-only class reads as an unclaimable multiclass.
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("stands down when the hand-off carries a choice the wizard can't present", () => {
    const steps = emberSteps();
    steps.push({ type: "forward", level: 0, flow: { advancement: { type: "SomethingNew", configuration: {} }, level: 0 } });
    expect(LevelUpDriver.canDrive(managerWithSteps(steps), { allowNewClass: true })).toBe(false);
  });
});

/* -------------------------------------------- */
/*  Screens                                     */
/* -------------------------------------------- */

describe("foldOriginScreens", () => {
  /** A driver-alike holding one decision per array, at the levels Ember's flows come off. */
  function makeDriver() {
    const record = (level, screenLevel = level) => ({ level, screenLevel });
    return {
      hpSteps: [record(1)],
      asiSteps: [record(0)],
      choiceSteps: [record(0), record(1)],
      traitSteps: [record(0)],
      subclassSteps: [],
      grantSteps: [record(0)],
      sizeSteps: [record(0)]
    };
  }

  it("moves every origin decision onto the level-1 screen", () => {
    const driver = makeDriver();
    foldOriginScreens(driver);
    const all = [...driver.hpSteps, ...driver.asiSteps, ...driver.choiceSteps,
      ...driver.traitSteps, ...driver.grantSteps, ...driver.sizeSteps];
    expect(all.every(r => r.screenLevel === 1)).toBe(true);
  });

  it("leaves each decision's own level alone — that's what apply/reverse is keyed by", () => {
    const driver = makeDriver();
    foldOriginScreens(driver);
    expect(driver.asiSteps[0].level).toBe(0);
    expect(driver.traitSteps[0].level).toBe(0);
    expect(driver.hpSteps[0].level).toBe(1);
  });

  it("never lowers a screen level a later decision already earned", () => {
    const driver = { hpSteps: [{ level: 1, screenLevel: 3 }], asiSteps: [], choiceSteps: [], traitSteps: [], subclassSteps: [], grantSteps: [], sizeSteps: [] };
    foldOriginScreens(driver);
    expect(driver.hpSteps[0].screenLevel).toBe(3);
  });

  it("copes with a record that never carried a screen level", () => {
    const driver = { hpSteps: [{ level: 0 }], asiSteps: [], choiceSteps: [], traitSteps: [], subclassSteps: [], grantSteps: [], sizeSteps: [] };
    foldOriginScreens(driver);
    expect(driver.hpSteps[0].screenLevel).toBe(1);
  });
});

/* -------------------------------------------- */
/*  Level-1 hit points                          */
/* -------------------------------------------- */

/**
 * A creation-shaped walk is the only way a *level-1* hit-point flow reaches the driver, and by rule
 * that level takes the maximum with nothing to choose. Offering the roll there would both contradict
 * the system (whose own flow applies it automatically) and quietly default a brand-new Ember
 * character to average hit points.
 */
describe("the driver's walk over a creation-shaped hit-point flow", () => {
  /** An items store with the handful of Collection methods the walk touches. */
  function makeItems(initial = []) {
    const m = new Map(initial.map(i => [i.id, i]));
    return {
      get: id => m.get(id), set: item => m.set(item.id, item), delete: id => m.delete(id),
      map: fn => [...m.values()].map(fn), filter: fn => [...m.values()].filter(fn),
      has: id => m.has(id), [Symbol.iterator]: () => m.values()
    };
  }

  /** Drive one HitPoints flow at the given class level and report what the driver did with it. */
  async function walkHitPoints({ level, isOriginalClass }) {
    const classItem = { id: CLASS_ID, type: "class", isOriginalClass, updateSource() {} };
    const applied = [];
    const advancement = {
      type: "HitPoints", item: classItem, average: 5, hitDie: "d8", configuration: {},
      async apply(lvl, data) { applied.push({ lvl, data }); }
    };
    const flow = { advancement, level, getAutomaticApplicationValue: async () => false };
    const manager = {
      constructor: { flowsForLevel: () => [] },
      actor: { system: { details: { level: level - 1 } }, items: makeItems() },
      clone: { items: makeItems([classItem]), reset() {} },
      steps: [{ type: "forward", level, class: { item: classItem, level }, flow }]
    };
    const driver = new LevelUpDriver(manager);
    await driver.prepare();
    return { driver, applied };
  }

  it("applies maximum hit points with no decision at the original class's first level", async () => {
    const { driver, applied } = await walkHitPoints({ level: 1, isOriginalClass: true });
    expect(driver.hpSteps).toHaveLength(0);
    expect(applied).toEqual([{ lvl: 1, data: { 1: "max" } }]);
  });

  it("still asks at a multiclass's first level", async () => {
    const { driver, applied } = await walkHitPoints({ level: 1, isOriginalClass: false });
    expect(driver.hpSteps).toHaveLength(1);
    expect(applied[0].data).toEqual({ 1: "avg" });
  });

  it("still asks at every later level", async () => {
    const { driver } = await walkHitPoints({ level: 2, isOriginalClass: true });
    expect(driver.hpSteps).toHaveLength(1);
    expect(driver.hpSteps[0].mode).toBe("avg");
  });
});

/* -------------------------------------------- */
/*  Equipment step                              */
/* -------------------------------------------- */

describe("emberEquipmentStep", () => {
  it("never blocks Apply — there is always a default loadout", () => {
    expect(emberEquipmentStep.isComplete({})).toBe(true);
  });

  it("keeps the creation step's identity, so its template and handlers are reused as-is", () => {
    expect(emberEquipmentStep.id).toBe("equipment");
    expect(emberEquipmentStep.template).toBe("steps/equipment");
    expect(typeof emberEquipmentStep.context).toBe("function");
    expect(typeof emberEquipmentStep.handle).toBe("function");
  });
});
