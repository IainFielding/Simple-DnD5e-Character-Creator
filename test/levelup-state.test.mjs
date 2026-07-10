import { describe, expect, it } from "vitest";
import { LevelUpState, atLevel, recordLevel } from "../scripts/levelup/levelup-state.mjs";
import { buildSteps } from "../scripts/levelup/registry.mjs";

/**
 * The level-up session state: which screens exist ({@link LevelUpState#gainedLevels} and the
 * {@link atLevel}/{@link recordLevel} grouping the templates address records through), and the
 * two flags the close-confirmation UX hangs off ({@link LevelUpState#hasPlayerInput},
 * {@link LevelUpState#hasStagedSpells}). The driver is stubbed: state only ever forwards to the
 * driver's decision arrays and per-record state readers, so the stub returns whatever shape a
 * test paints onto its records via `_`-prefixed fields.
 */

const CLASS_ITEM = { id: "clsFighter000000", name: "Fighter", type: "class" };

/** A driver stub exposing the decision arrays and per-record state readers the state forwards to. */
function makeDriver({ steps, hp = [], asi = [], choices = [], traits = [], subclasses = [], grants = [] } = {}) {
  return {
    steps: steps ?? [
      { type: "forward", class: { item: CLASS_ITEM, level: 4 }, level: 4 },
      { type: "forward", automatic: true, level: 4 }
    ],
    hpSteps: hp,
    asiSteps: asi,
    choiceSteps: choices,
    traitSteps: traits,
    subclassSteps: subclasses,
    grantSteps: grants,
    subclassState: r => ({ chosen: !!r._chosen, name: r._name ?? "", img: "", uuid: r._uuid ?? null }),
    traitState: r => ({ chosen: new Set(r._chosen ?? []) }),
    choiceState: r => ({ selected: new Set(r._selected ?? []), replacing: r._replacing ?? null }),
    asiState: r => ({ type: r._type ?? "asi", assigned: r._assigned ?? 0 })
  };
}

/**
 * An actor stub: the character level the constructor reads, plus (optionally) owned class
 * items behind a Collection-ish `items` (`get` by id + `filter`), which the multiclass
 * getters consult.
 */
function makeActor(level = 3, classes = []) {
  const items = new Map(classes.map(c => [c.id, c]));
  items.filter = fn => [...items.values()].filter(fn);
  return { system: { details: { level } }, items };
}

function makeState(driverOptions = {}, actorLevel = 3, classes = []) {
  return new LevelUpState(makeActor(actorLevel, classes), makeDriver(driverOptions));
}

/* -------------------------------------------- */
/*  Construction & record grouping              */
/* -------------------------------------------- */

describe("LevelUpState construction", () => {
  it("captures the class item and the from → to levels off the driver's steps", () => {
    const state = makeState();
    expect(state.classItem).toBe(CLASS_ITEM);
    expect(state.fromLevel).toBe(3);
    expect(state.toLevel).toBe(4);
  });

  it("reads the target of a multi-level jump from the highest step level", () => {
    const state = makeState({
      steps: [
        { type: "forward", class: { item: CLASS_ITEM, level: 4 }, level: 4 },
        { type: "forward", class: { item: CLASS_ITEM, level: 5 }, level: 5 },
        { type: "forward", automatic: true, level: 5 }
      ]
    });
    expect(state.fromLevel).toBe(3);
    expect(state.toLevel).toBe(5);
  });
});

describe("class-choice phase (chooseClass session, no driver yet)", () => {
  it("opens targeting the next character level with empty decisions and no player input", () => {
    const state = new LevelUpState(makeActor(3), null, { chooseClass: true });
    expect(state.needsClassChoice).toBe(true);
    expect(state.driver).toBe(null);
    expect(state.fromLevel).toBe(3);
    expect(state.toLevel).toBe(4);
    expect(state.gainedLevels()).toEqual([]);
    expect(state.hasPlayerInput()).toBe(false);
  });

  it("adoptDriver installs the class and target level exactly like the constructor's driver path", () => {
    const state = new LevelUpState(makeActor(3), null, { chooseClass: true });
    state.adoptDriver(makeDriver());
    expect(state.classItem).toBe(CLASS_ITEM);
    expect(state.toLevel).toBe(4);
  });

  it("clearDriver resets the session and drops everything staged against the old class", () => {
    const state = new LevelUpState(makeActor(3), null, { chooseClass: true });
    state.adoptDriver(makeDriver());
    state.selectedCantrips.push({ name: "Light" });
    state.swapSpell = { id: "oldSpell00000000", name: "Jump" };
    state.collapsedBlocks.add("4:hp");

    state.clearDriver();
    expect(state.driver).toBe(null);
    expect(state.classItem).toBe(null);
    expect(state.toLevel).toBe(4);                 // back to fromLevel + 1
    expect(state.selectedCantrips).toEqual([]);
    expect(state.swapSpell).toBe(null);
    expect(state.collapsedBlocks.size).toBe(0);
    expect(state.hasPlayerInput()).toBe(false);
  });

  it("buildSteps offers only the Class step until a driver is adopted, then the full rail", () => {
    const state = new LevelUpState(makeActor(3), null, { chooseClass: true });
    expect(buildSteps(state).map(s => s.id)).toEqual(["class"]);

    state.adoptDriver(makeDriver({ hp: [{ level: 4 }] }));
    state.hasSpellStep = () => false;              // the driver stub has no clone to plan from
    expect(buildSteps(state).map(s => s.id)).toEqual(["class", "level-4", "review"]);
  });

  it("a session claimed from a ready-built manager never grows a Class step", () => {
    const state = makeState({ hp: [{ level: 4 }] }, 3, [CLASS_ITEM]);
    state.hasSpellStep = () => false;
    expect(buildSteps(state).map(s => s.id)).toEqual(["level-4", "review"]);
  });
});

describe("multiclass flags", () => {
  const OTHER_CLASS = { id: "clsWizard0000000", name: "Wizard", type: "class" };

  it("levelling the character's only class is neither new nor multiclassed", () => {
    const state = makeState({}, 3, [CLASS_ITEM]);
    expect(state.isNewClass).toBe(false);
    expect(state.isMulticlassed).toBe(false);
  });

  it("a class missing from the real actor is a new class (multiclass in progress)", () => {
    // The forNewItem manager put the class on the clone only; the actor has a different class.
    const state = makeState({}, 3, [OTHER_CLASS]);
    expect(state.isNewClass).toBe(true);
    expect(state.isMulticlassed).toBe(true);
  });

  it("an already-multiclassed character levelling one owned class is multiclassed but not new", () => {
    const state = makeState({}, 5, [CLASS_ITEM, OTHER_CLASS]);
    expect(state.isNewClass).toBe(false);
    expect(state.isMulticlassed).toBe(true);
  });
});

describe("recordLevel / atLevel", () => {
  it("prefers a record's screenLevel over its own level", () => {
    expect(recordLevel({ level: 4 })).toBe(4);
    // A feat's synthesised sub-choice comes off a level-0 flow but belongs on the ASI's screen.
    expect(recordLevel({ level: 0, screenLevel: 4 })).toBe(4);
  });

  it("filters records to one screen, preserving their original order", () => {
    const a = { level: 4, name: "a" };
    const b = { level: 5, name: "b" };
    const c = { level: 0, screenLevel: 4, name: "c" };
    expect(atLevel([a, b, c], 4)).toEqual([a, c]);
    expect(atLevel([a, b, c], 5)).toEqual([b]);
    expect(atLevel([a, b, c], 6)).toEqual([]);
  });
});

describe("gainedLevels", () => {
  it("unions the levels across every decision array, ascending", () => {
    const state = makeState({
      hp: [{ level: 4 }, { level: 5 }],
      asi: [{ level: 4 }],
      subclasses: [{ level: 3, screenLevel: 3 }],
      traits: [{ level: 5 }]
    });
    expect(state.gainedLevels()).toEqual([3, 4, 5]);
  });

  it("folds a synthesised level-0 decision onto its screen level instead of adding a screen", () => {
    const state = makeState({
      hp: [{ level: 4 }],
      choices: [{ level: 0, screenLevel: 4 }]
    });
    expect(state.gainedLevels()).toEqual([4]);
  });
});

/* -------------------------------------------- */
/*  Close-confirmation flags                    */
/* -------------------------------------------- */

describe("hasStagedSpells", () => {
  it("is false on a fresh session", () => {
    expect(makeState().hasStagedSpells()).toBe(false);
  });

  it("is true with a staged pick or with only a swap marked", () => {
    const withPick = makeState();
    withPick.selectedCantrips.push({ uuid: "Compendium.x.Item.light", name: "Light" });
    expect(withPick.hasStagedSpells()).toBe(true);

    const withSwap = makeState();
    withSwap.swapSpell = { id: "oldSpell00000000", name: "Jump" };
    expect(withSwap.hasStagedSpells()).toBe(true);
  });
});

describe("hasPlayerInput", () => {
  it("is false while every decision still sits at its pre-seeded default", () => {
    const state = makeState({
      hp: [{ level: 4, mode: "avg" }],
      asi: [{ level: 4 }],                    // type "asi", nothing assigned
      choices: [{ level: 4 }],                // nothing selected
      traits: [{ level: 4 }],                 // nothing chosen
      subclasses: [{ level: 3 }]              // not picked
    });
    expect(state.hasPlayerInput()).toBe(false);
  });

  it("turns true for each kind of input the player can make", () => {
    const inputs = [
      { hp: [{ level: 4, mode: "roll" }] },
      { hp: [{ level: 4, mode: "max" }] },
      { subclasses: [{ level: 3, _chosen: true }] },
      { traits: [{ level: 4, _chosen: ["weapon:sim:club"] }] },
      { choices: [{ level: 4, _selected: ["Compendium.x.Item.a"] }] },
      { choices: [{ level: 4, _replacing: "oldPickId0000000" }] },
      { asi: [{ level: 4, _assigned: 2 }] },
      { asi: [{ level: 4, _type: "feat" }] }
    ];
    for ( const decisions of inputs ) {
      const state = makeState(decisions);
      expect(state.hasPlayerInput(), JSON.stringify(decisions)).toBe(true);
    }
  });

  it("counts staged spell picks as player input", () => {
    const state = makeState({ hp: [{ level: 4, mode: "avg" }] });
    state.selectedSpells.push({ uuid: "Compendium.x.Item.shield", name: "Shield" });
    expect(state.hasPlayerInput()).toBe(true);
  });
});
