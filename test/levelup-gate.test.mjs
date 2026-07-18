import { describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

/**
 * The claim gate — `LevelUpDriver.canDrive` / `isStepSupported` — decides whether the module
 * hijacks a level-up (suppressing the native UI) or leaves it to the system. A false positive
 * here means driving a flow the wizard can't present (bad writes to a real actor); a false
 * negative means the takeover silently stops working. Step shapes mirror what the native
 * `AdvancementManager.createLevelChangeSteps` builds (see dnd5e 5.3.3, advancement-manager.mjs):
 * `{ type, automatic?, level: characterLevel, class: { item, level: classLevel }, flow }`, with
 * `flow` carrying the advancement instance. Advancement `configuration` shapes are the *prepared*
 * ones the live manager holds (e.g. Size's `sizes` is a Set, not the raw array).
 */

/** The class item being levelled, present on the actor by default. */
const CLASS_ID = "clsFighter000000";

/** A forward step carrying one advancement flow at the given levels. */
function step(advType, { level = 4, cfg = {}, withClass = true, automatic = false, type = "forward" } = {}) {
  const s = { type, automatic, level };
  if ( withClass ) s.class = { item: { id: CLASS_ID }, level };
  if ( advType ) s.flow = { advancement: { type: advType, configuration: cfg }, level };
  return s;
}

/** The trailing marker step the native manager appends (no flow; nothing to render). */
function marker(level = 4) {
  return { type: "forward", automatic: true, level, class: { item: { id: CLASS_ID }, level } };
}

/**
 * A manager-shaped stub: steps, the real actor the gate checks the class against, and the
 * working clone — which always carries the class (the native manager put it there, whether
 * the class came from the actor or a `forNewItem` multiclass drop).
 */
function makeManager(steps, { actorLevel = 3, classOnActor = true } = {}) {
  const items = new Map();
  if ( classOnActor ) items.set(CLASS_ID, { id: CLASS_ID, type: "class" });
  const cloneItems = new Map([[CLASS_ID, { id: CLASS_ID, type: "class" }]]);
  return {
    steps,
    actor: { system: { details: { level: actorLevel } }, items },
    clone: { items: cloneItems }
  };
}

/* -------------------------------------------- */
/*  isStepSupported                              */
/* -------------------------------------------- */

describe("LevelUpDriver.isStepSupported", () => {
  it("supports every advancement type the wizard presents or auto-applies", () => {
    for ( const type of ["HitPoints", "ItemChoice", "AbilityScoreImprovement", "Subclass", "ScaleValue", "Trait"] ) {
      expect(LevelUpDriver.isStepSupported(step(type))).toBe(true);
    }
  });

  it("treats a marker step with no flow as inert", () => {
    expect(LevelUpDriver.isStepSupported(marker())).toBe(true);
  });

  it("supports a structurally-forced Size (one option) but not a real size choice", () => {
    expect(LevelUpDriver.isStepSupported(step("Size", { cfg: { sizes: new Set(["med"]) } }))).toBe(true);
    expect(LevelUpDriver.isStepSupported(step("Size", { cfg: { sizes: new Set(["sm", "med"]) } }))).toBe(false);
  });

  it("supports a plain ItemGrant but not an optional one", () => {
    const items = [{ uuid: "Compendium.x.Item.a", optional: false }];
    expect(LevelUpDriver.isStepSupported(step("ItemGrant", { cfg: { items, optional: false } }))).toBe(true);
    expect(LevelUpDriver.isStepSupported(step("ItemGrant", { cfg: { items, optional: true } }))).toBe(false);
  });

  it("rejects an ItemGrant whose individual items are optional", () => {
    const items = [
      { uuid: "Compendium.x.Item.a", optional: false },
      { uuid: "Compendium.x.Item.b", optional: true }
    ];
    expect(LevelUpDriver.isStepSupported(step("ItemGrant", { cfg: { items, optional: false } }))).toBe(false);
  });

  it("rejects an advancement type it has never seen", () => {
    expect(LevelUpDriver.isStepSupported(step("SomeFutureAdvancement"))).toBe(false);
  });
});

/* -------------------------------------------- */
/*  canDrive                                     */
/* -------------------------------------------- */

describe("LevelUpDriver.canDrive", () => {
  it("claims a plain single-level increase (HP + grants + traits + scale)", () => {
    const manager = makeManager([
      step("HitPoints"),
      step("ItemGrant", { cfg: { items: [{ uuid: "Compendium.x.Item.a", optional: false }], optional: false } }),
      step("Trait"),
      step("ScaleValue"),
      marker()
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(true);
  });

  it("claims a level carrying the decisions the wizard re-skins (ASI, subclass, choices)", () => {
    const manager = makeManager([
      step("HitPoints"),
      step("AbilityScoreImprovement"),
      step("Subclass", { level: 3 }),
      step("ItemChoice"),
      marker()
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(true);
  });

  it("rejects an empty manager", () => {
    expect(LevelUpDriver.canDrive(makeManager([]))).toBe(false);
    expect(LevelUpDriver.canDrive(null)).toBe(false);
  });

  it("rejects a level-down (any reverse step)", () => {
    const manager = makeManager([
      { ...step("HitPoints"), type: "reverse" },
      marker()
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("rejects a flow that deletes an item", () => {
    const manager = makeManager([
      step("HitPoints"),
      { type: "delete", item: { id: CLASS_ID }, automatic: true }
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("rejects a brand-new class drop (class item not on the real actor) by default", () => {
    const manager = makeManager([step("HitPoints"), marker()], { classOnActor: false });
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("claims a brand-new class drop when allowNewClass opts in (multiclass setting)", () => {
    // A forNewItem multiclass manager: the class lives on the clone, not the actor, and the
    // steps raise the character level exactly like a same-class level-up.
    const manager = makeManager([step("HitPoints"), step("Trait"), marker()], { classOnActor: false });
    expect(LevelUpDriver.canDrive(manager, { allowNewClass: true })).toBe(true);
  });

  it("still requires the new class to be on the clone even with allowNewClass", () => {
    const manager = makeManager([step("HitPoints"), marker()], { classOnActor: false });
    manager.clone.items.clear();
    expect(LevelUpDriver.canDrive(manager, { allowNewClass: true })).toBe(false);
  });

  it("still rejects unsupported steps and level-downs with allowNewClass", () => {
    const unsupported = makeManager([
      step("HitPoints"),
      step("SomeFutureAdvancement"),
      marker()
    ], { classOnActor: false });
    expect(LevelUpDriver.canDrive(unsupported, { allowNewClass: true })).toBe(false);

    const levelDown = makeManager([
      { ...step("HitPoints"), type: "reverse" },
      marker()
    ], { classOnActor: false });
    expect(LevelUpDriver.canDrive(levelDown, { allowNewClass: true })).toBe(false);
  });

  it("rejects a manager that never raises the character level", () => {
    // A modify-choices flow re-runs steps at or below the current level; nothing goes up.
    const manager = makeManager([step("ItemChoice", { level: 3 })], { actorLevel: 3 });
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("rejects the whole level-up when any renderable step is unsupported", () => {
    const manager = makeManager([
      step("HitPoints"),
      step("ItemGrant", { cfg: { items: [{ uuid: "Compendium.x.Item.a", optional: true }], optional: false } }),
      marker()
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(false);
  });

  it("lets an automatic flag excuse a step the wizard couldn't present", () => {
    const manager = makeManager([
      step("HitPoints"),
      step("SomeFutureAdvancement", { automatic: true }),
      marker()
    ]);
    expect(LevelUpDriver.canDrive(manager)).toBe(true);
  });
});
