import { describe, expect, it } from "vitest";
import { LevelUpState, atLevel, recordLevel } from "../scripts/levelup/levelup-state.mjs";

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

/** An actor stub carrying only the character level the constructor reads. */
function makeActor(level = 3) {
  return { system: { details: { level } } };
}

function makeState(driverOptions = {}, actorLevel = 3) {
  return new LevelUpState(makeActor(actorLevel), makeDriver(driverOptions));
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
