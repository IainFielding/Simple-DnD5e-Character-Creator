import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canAddLevel, capSummary, fitsCaps, ladderCaps, trimToCaps } from "../scripts/data/spell-level-caps.mjs";
import { computeSpellPlan, lvlSpellsStep, spellChanges } from "../scripts/levelup/steps/lvl-spells-step.mjs";

/**
 * A jump of several levels asks for every level's spells on one screen. Each pick is capped at the
 * spell level the class could cast at the level it comes from, so a Sorcerer going 1 → 9 ends with
 * one 5th-level spell at most, not eight, and a Wizard's book gets two spells a level at each
 * level's slots rather than sixteen 5th-level ones.
 */

/* -------------------------------------------- */
/*  The arithmetic                               */
/* -------------------------------------------- */

describe("spell-level caps", () => {
  it("ladders one cap per pick at the level it comes from", () => {
    const caps = ladderCaps({
      from: 1, to: 5, total: 4,
      countAt: l => [0, 2, 3, 4, 5, 6][l],
      capAt: l => Math.ceil(l / 2)
    });
    expect(caps).toEqual([3, 2, 2, 1]);
  });

  it("caps picks owed from earlier levels at the level being left", () => {
    // Two picks were left unchosen at level 3; the ladder itself owes two more.
    const caps = ladderCaps({ from: 3, to: 5, total: 4, countAt: l => l, capAt: l => Math.ceil(l / 2) });
    expect(caps).toEqual([3, 2, 2, 2]);
  });

  it("keeps the highest caps when the offer is smaller than the ladder", () => {
    const caps = ladderCaps({ from: 1, to: 5, total: 2, countAt: l => l, capAt: l => Math.ceil(l / 2) });
    expect(caps).toEqual([3, 2]);
  });

  it("gives nothing to a level before the class casts", () => {
    // A 2014 Paladin casts from 2nd level; its 1st level adds no spell and no cap.
    const caps = ladderCaps({ from: 0, to: 3, total: 3, countAt: l => [0, 0, 2, 3][l], capAt: l => (l < 2 ? 0 : 1) });
    expect(caps).toEqual([1, 1, 1]);
  });

  it("fits picks against caps highest first", () => {
    expect(fitsCaps([5, 1], [5, 4])).toBe(true);
    expect(fitsCaps([5, 5], [5, 4])).toBe(false);
    expect(fitsCaps([4, 4, 1], [5, 4, 1])).toBe(true);
    expect(fitsCaps([1, 1, 1], [5, 4])).toBe(false);
    expect(canAddLevel([5], 4, [5, 4, 1])).toBe(true);
    expect(canAddLevel([5, 4], 2, [5, 4, 1])).toBe(false);
  });

  it("drops the highest picks until the rest fit", () => {
    const picks = [{ level: 1 }, { level: 4 }, { level: 3 }];
    expect(trimToCaps(picks, [3, 2]).map(p => p.level)).toEqual([1, 3]);
    expect(trimToCaps([{ level: 3 }, { level: 3 }], [3, 2]).map(p => p.level)).toEqual([3]);
  });

  it("seats picks in the lowest cap that holds them for the chips", () => {
    // A 1st-level pick fills the 1st-level cap, leaving the 5th free for something that needs it.
    // Lowest first, as the magic shop lists its rarities.
    expect(capSummary([1], [5, 1])).toEqual([
      { level: 1, used: 1, allowed: 1, full: true },
      { level: 5, used: 0, allowed: 1, full: false }
    ]);
    expect(capSummary([3, 3], [4, 4, 2])).toEqual([
      { level: 2, used: 0, allowed: 1, full: false },
      { level: 4, used: 2, allowed: 2, full: true }
    ]);
  });
});

/* -------------------------------------------- */
/*  The plan                                     */
/* -------------------------------------------- */

/**
 * dnd5e's own slot arithmetic, ported verbatim from 5.3.3 so every cap below comes out of the same
 * calculation the system runs: `config.mjs`'s `SPELL_SLOT_TABLE`, `pactCastingProgression` and the
 * full/half/third divisors; `spellcasting-model.mjs`'s shared `computeProgression` and both
 * `calculateSlots` (multi-level and single-level); and `Actor5e.computeClassProgression`, less its
 * hook and deprecation shims. The half and third rows are where a shortcut would go wrong: a lone
 * third-caster rounds *up*, so an Eldritch Knight has 2nd-level spells at 7, not 9.
 */
const SPELL_SLOT_TABLE = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]
];
const PACT_TABLE = {
  1: { slots: 1, level: 1 }, 2: { slots: 2, level: 1 }, 3: { slots: 2, level: 2 }, 5: { slots: 2, level: 3 },
  7: { slots: 2, level: 4 }, 9: { slots: 2, level: 5 }, 11: { slots: 3, level: 5 }, 17: { slots: 4, level: 5 }
};

/** SlotSpellcastingModel#computeProgression, shared by both methods. */
function computeProgression(progression, actor, cls, spellcasting, count) {
  const prog = this.progression?.[spellcasting?.progression];
  if ( !prog ) return;
  const rounding = prog.roundUp ? Math.ceil : Math.floor;
  progression[this.key] += rounding(spellcasting.levels / (prog.divisor ?? 1));
  // Single-classed, non-full progression rounds up, rather than down.
  if ( (count === 1) && (prog.divisor > 1) && progression[this.key] ) {
    progression[this.key] = Math.ceil(spellcasting.levels / prog.divisor);
  }
}

const SPELLCASTING = {
  spell: {
    key: "spell", slots: true, computeProgression,
    progression: {
      full: { divisor: 1 }, half: { divisor: 2, roundUp: true }, third: { divisor: 3 },
      artificer: { divisor: 2, roundUp: true }
    },
    // MultiLevelSpellcastingModel#calculateSlots
    calculateSlots(level) {
      const slots = SPELL_SLOT_TABLE[Math.min(level, SPELL_SLOT_TABLE.length) - 1] ?? [];
      return Object.fromEntries(slots.map((n, i) => [i + 1, n]));
    }
  },
  pact: {
    key: "pact", slots: true, computeProgression,
    progression: { pact: { divisor: 1 } },
    // SingleLevelSpellcastingModel#calculateSlots
    calculateSlots(level) {
      const [, slots] = Object.entries(PACT_TABLE).reverse().find(([l]) => Number(l) <= level) ?? [];
      const available = {};
      if ( slots ) available[slots.level] = slots.slots;
      return available;
    }
  }
};

/** Actor5e.computeClassProgression */
function computeClassProgression(progression, cls, { actor, spellcasting, count = 1 } = {}) {
  spellcasting ??= cls.spellcasting;
  const model = CONFIG.DND5E.spellcasting[cls.spellcasting.type];
  if ( !model?.slots ) return;
  model.computeProgression(progression, actor, cls, spellcasting, count);
}

/**
 * The actor's derived `system.spells` for a lone caster: what dnd5e's `prepareSlots` would leave,
 * reduced to the `max` (and a pact slot's `level`) the plan reads.
 */
function derivedSlots(type, progression, levels) {
  const model = SPELLCASTING[type];
  const tally = { [model.key]: 0 };
  model.computeProgression(tally, null, null, { progression, levels }, 1);
  const slots = model.calculateSlots(tally[model.key]);
  if ( type === "pact" ) {
    const [level, max] = Object.entries(slots)[0] ?? [0, 0];
    return { pact: { max, level: Number(level) } };
  }
  return Object.fromEntries(Object.entries(slots).map(([l, max]) => [`spell${l}`, { max }]));
}

/** A ScaleValue advancement with the given title and sparse `{level: value}` table. */
function scale(title, table) {
  const entries = Object.fromEntries(Object.entries(table).map(([l, v]) => [l, { value: v }]));
  return { type: "ScaleValue", title, configuration: { identifier: "", scale: entries }, value: {} };
}

/**
 * A lone caster at `levels`, as the level-up's clone holds it: its slots derived for the final
 * level, and `spellcasting` standing in for the Item5e getter that answers for earlier ones.
 */
function caster({
  identifier, rules = "2014", levels, type = "spell", progression = "full",
  preparedMax = 0, preparedValue = 0, advancement
}) {
  const cls = {
    id: `${identifier}0000000000`.slice(0, 16), type: "class", name: identifier,
    spellcasting: { type, progression, levels },
    system: {
      identifier, levels, source: { rules },
      spellcasting: { type, progression, ability: "cha", preparation: { max: preparedMax, value: preparedValue } },
      advancement
    }
  };
  const spells = derivedSlots(type, progression, levels);
  return { cls, actor: { items: [cls], system: { details: { level: levels }, spells } } };
}

/**
 * A third-caster subclass (Eldritch Knight, Arcane Trickster) on its base class. The magic lives on
 * the subclass, whose scales are keyed by the *class* level; the class's `spellcasting` getter
 * prefers the subclass's, which is how dnd5e measures it as a third-caster.
 */
function thirdCaster({ classIdentifier, identifier, rules, levels, preparedMax, preparedValue, advancement }) {
  const cls = {
    id: `${classIdentifier}0000000000`.slice(0, 16), type: "class", name: classIdentifier,
    spellcasting: { type: "spell", progression: "third", levels },
    system: {
      identifier: classIdentifier, levels, source: { rules }, spellcasting: { progression: "none" }, advancement: []
    }
  };
  const sub = {
    id: `${identifier}0000000000`.slice(0, 16), type: "subclass", name: identifier,
    system: {
      identifier, classIdentifier, source: { rules },
      spellcasting: {
        type: "spell", progression: "third", ability: "int", preparation: { max: preparedMax, value: preparedValue }
      },
      advancement
    }
  };
  const spells = derivedSlots("spell", "third", levels);
  return { cls, actor: { items: [cls, sub], system: { details: { level: levels }, spells } } };
}

/** The book a Wizard starts with: six 1st-level spells of its own. */
const startingBook = () => Array.from({ length: 6 }, (_, i) => ({
  type: "spell", id: `book${i}`, system: { level: 1, sourceItem: "class:wizard", prepared: 1 }
}));

const SORCERER_2014_KNOWN = {
  1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12, 13: 13, 15: 14, 17: 15
};
const SORCERER_2024_PREPARED = {
  1: 2, 2: 4, 3: 6, 4: 7, 5: 9, 6: 10, 7: 11, 8: 12, 9: 14, 10: 15, 11: 16, 13: 17, 15: 18, 17: 19, 18: 20,
  19: 21, 20: 22
};
const RANGER_2014_KNOWN = { 2: 2, 3: 3, 5: 4, 7: 5, 9: 6, 11: 7, 13: 8, 15: 9, 17: 10, 19: 11 };
const WARLOCK_2024_PREPARED = {
  1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 11: 11, 13: 12, 15: 13, 17: 14, 19: 15
};
const THIRD_CASTER_SPELLS = { 3: 3, 4: 4, 7: 5, 8: 6, 10: 7, 11: 8, 13: 9, 14: 10, 16: 11, 19: 12, 20: 13 };

describe("computeSpellPlan across a jump of several levels", () => {
  let saved;
  beforeEach(() => {
    saved = {
      spellcasting: CONFIG.DND5E.spellcasting, spellProgression: CONFIG.DND5E.spellProgression, Actor: CONFIG.Actor
    };
    CONFIG.DND5E.spellcasting = SPELLCASTING;
    // What routes a Warlock's picks to Pact Magic slots ({@link spellMethodFor}).
    CONFIG.DND5E.spellProgression = { pact: { type: "pact" } };
    CONFIG.Actor = { documentClass: { computeClassProgression } };
  });
  afterEach(() => {
    CONFIG.DND5E.spellcasting = saved.spellcasting;
    CONFIG.DND5E.spellProgression = saved.spellProgression;
    if ( saved.Actor === undefined ) delete CONFIG.Actor;
    else CONFIG.Actor = saved.Actor;
  });

  describe("Sorcerer", () => {
    it("caps a 2014 Sorcerer's eight new spells at the level each is learned", () => {
      const { cls, actor } = caster({
        identifier: "sorcerer", levels: 9, preparedValue: 2,
        advancement: [scale("Cantrips Known", { 1: 4, 4: 5 }), scale("Spells Known", SORCERER_2014_KNOWN)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.maxSpellLevel).toBe(5);
      expect(plan.addSpells).toBe(8);
      expect(plan.spellCaps).toEqual([5, 4, 4, 3, 3, 2, 2, 1]);
      // One replacement per level gained, each at that level's slots too.
      expect(plan.swapLimit).toBe(8);
      expect(plan.swapCaps).toEqual([5, 4, 4, 3, 3, 2, 2, 1]);
    });

    it("caps a 2024 Sorcerer's prepared list, two at a time where the table jumps by two", () => {
      const { cls, actor } = caster({
        identifier: "sorcerer", rules: "2024", levels: 5, preparedMax: 9, preparedValue: 2,
        advancement: [scale("Max Prepared Spells", SORCERER_2024_PREPARED)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.addSpells).toBe(7);
      expect(plan.spellCaps).toEqual([3, 3, 2, 2, 2, 1, 1]);
    });

    it("caps a single level at that level, and nothing without the starting level", () => {
      const { cls, actor } = caster({
        identifier: "sorcerer", levels: 5, preparedValue: 5,
        advancement: [scale("Spells Known", SORCERER_2014_KNOWN)]
      });
      expect(computeSpellPlan(actor, cls, { fromClassLevel: 4 }).spellCaps).toEqual([3]);
      expect(computeSpellPlan(actor, cls).spellCaps).toBeNull();
      expect(computeSpellPlan(actor, cls).swapLimit).toBe(1);
    });
  });

  describe("Wizard", () => {
    it("gives the book two spells a level at each level's slots", () => {
      const { cls, actor } = caster({
        identifier: "wizard", rules: "2024", levels: 5, preparedMax: 9, preparedValue: 4,
        advancement: [scale("Max Prepared Spells", { 1: 4, 5: 9 })]
      });
      actor.items.push(...startingBook());
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.addBook).toBe(8);
      expect(plan.bookCaps).toEqual([3, 3, 2, 2, 2, 2, 1, 1]);
      // Preparing from the book is not level-bound: it happens every long rest.
      expect(plan.spellCaps).toBeNull();
    });

    it("ladders a 1 → 20 book through every spell level, 9th only from 17th", () => {
      const { cls, actor } = caster({
        identifier: "wizard", rules: "2024", levels: 20, preparedMax: 25, preparedValue: 4,
        advancement: [scale("Max Prepared Spells", { 1: 4, 20: 25 })]
      });
      actor.items.push(...startingBook());
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.maxSpellLevel).toBe(9);
      expect(plan.addBook).toBe(38);
      const count = l => plan.bookCaps.filter(c => c === l).length;
      expect([9, 8, 7, 6, 5, 4, 3, 2, 1].map(count)).toEqual([8, 4, 4, 4, 4, 4, 4, 4, 2]);
    });

    it("counts the 2014 Wizard's book the same way", () => {
      const { cls, actor } = caster({
        identifier: "wizard", levels: 3, preparedMax: 6, preparedValue: 4, advancement: []
      });
      actor.items.push(...startingBook());
      expect(computeSpellPlan(actor, cls, { fromClassLevel: 1 }).bookCaps).toEqual([2, 2, 1, 1]);
    });
  });

  describe("Warlock (Pact Magic)", () => {
    it("caps each pick at that level's pact slot level, not the final one", () => {
      // 1 → 11: nine new spells (none at 10th level), pact slots climbing 1st → 5th on the way.
      const { cls, actor } = caster({
        identifier: "warlock", rules: "2024", levels: 11, type: "pact", progression: "pact",
        preparedMax: 11, preparedValue: 2,
        advancement: [
          scale("Cantrips Known", { 1: 2, 4: 3, 10: 4 }), scale("Max Prepared Spells", WARLOCK_2024_PREPARED)
        ]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.method).toBe("pact");
      expect(plan.maxSpellLevel).toBe(5);
      expect(plan.addSpells).toBe(9);
      expect(plan.spellCaps).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1]);
      // A replacement at 10th level is a 5th-level one too: ten swaps, one per level gained.
      expect(plan.swapLimit).toBe(10);
      expect(plan.swapCaps).toEqual([5, 5, 5, 4, 4, 3, 3, 2, 2, 1]);
    });

    it("caps a single level at that level's slot", () => {
      const { cls, actor } = caster({
        identifier: "warlock", rules: "2024", levels: 5, type: "pact", progression: "pact",
        preparedMax: 6, preparedValue: 5, advancement: [scale("Max Prepared Spells", WARLOCK_2024_PREPARED)]
      });
      expect(computeSpellPlan(actor, cls, { fromClassLevel: 4 }).spellCaps).toEqual([3]);
    });
  });

  describe("Ranger (2014, half-caster)", () => {
    it("rounds a lone half-caster up, and learns nothing at 1st level", () => {
      const { cls, actor } = caster({
        identifier: "ranger", levels: 9, progression: "half", advancement: [scale("Spells Known", RANGER_2014_KNOWN)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.maxSpellLevel).toBe(3);
      expect(plan.spellCaps).toEqual([3, 2, 2, 1, 1, 1]);
    });
  });

  describe("Eldritch Knight and Arcane Trickster (third-casters)", () => {
    it("caps a 2014 Eldritch Knight's 3 → 13 picks, 3rd-level spells only from 13th", () => {
      const { cls, actor } = thirdCaster({
        classIdentifier: "fighter", identifier: "eldritch-knight", rules: "2014", levels: 13,
        preparedMax: 0, preparedValue: 3, advancement: [scale("Spells Known", THIRD_CASTER_SPELLS)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 3 });
      expect(plan.listType).toBe("subclass");
      expect(plan.maxSpellLevel).toBe(3);
      expect(plan.spellCaps).toEqual([3, 2, 2, 2, 2, 1]);
    });

    it("gives an Eldritch Knight built 1 → 7 no picks and no swaps before it casts", () => {
      const { cls, actor } = thirdCaster({
        classIdentifier: "fighter", identifier: "eldritch-knight", rules: "2024", levels: 7,
        preparedMax: 5, preparedValue: 0, advancement: [scale("Max Prepared Spells", THIRD_CASTER_SPELLS)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.spellCaps).toEqual([2, 1, 1, 1, 1]);
      // Six levels gained, but only 3rd to 7th could cast, so five replacements at most, and only
      // the one from 7th level reaches 2nd-level spells.
      expect(plan.swapCaps).toEqual([2, 1, 1, 1, 1]);
      expect(plan.swapLimit).toBe(5);
    });

    it("caps a 2024 Arcane Trickster's 3 → 20 picks, 4th-level spells only from 19th", () => {
      const { cls, actor } = thirdCaster({
        classIdentifier: "rogue", identifier: "arcane-trickster", rules: "2024", levels: 20,
        preparedMax: 13, preparedValue: 3, advancement: [scale("Max Prepared Spells", THIRD_CASTER_SPELLS)]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 3 });
      expect(plan.maxSpellLevel).toBe(4);
      expect(plan.addSpells).toBe(10);
      expect(plan.spellCaps).toEqual([4, 4, 3, 3, 3, 2, 2, 2, 2, 1]);
    });
  });

  describe("classes that re-prepare on a long rest", () => {
    it("leaves a Cleric's list bound only by its final slots", () => {
      const { cls, actor } = caster({
        identifier: "cleric", rules: "2024", levels: 9, preparedMax: 14, preparedValue: 4,
        advancement: [scale("Max Prepared Spells", { 1: 4, 9: 14 })]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.spellCaps).toBeNull();
      expect(plan.maxSpellLevel).toBe(5);
    });

    it("leaves a 2024 Paladin unbound too: it changes a spell on a long rest", () => {
      const { cls, actor } = caster({
        identifier: "paladin", rules: "2024", levels: 5, progression: "half", preparedMax: 6, preparedValue: 2,
        advancement: [scale("Max Prepared Spells", { 1: 2, 5: 6 })]
      });
      const plan = computeSpellPlan(actor, cls, { fromClassLevel: 1 });
      expect(plan.spellCaps).toBeNull();
      expect(plan.swapLimit).toBe(4);
    });
  });
});

/* -------------------------------------------- */
/*  The step                                     */
/* -------------------------------------------- */

describe("picking against the caps", () => {
  /** A plan-only state for a 2014 Sorcerer 1 → 5: four picks capped 3, 2, 2, 1. */
  function capState() {
    return {
      selectedCantrips: [], selectedSpells: [], swapCantrip: null, swapSpells: [],
      spellPlan: () => ({
        addSpells: 4, addCantrips: 0, canSwapSpell: true, canSwapCantrip: false,
        spellSwaps: "one", swapLimit: 4, spellCaps: [3, 2, 2, 1], swapCaps: [3, 2, 2, 1]
      })
    };
  }
  const pick = (state, uuid, level) => lvlSpellsStep.handle("pick-spell", { dataset: { uuid, level: String(level) } }, { state });
  const mark = (state, id) => lvlSpellsStep.handle("swap-spell", { dataset: { id, name: id, level: "1" } }, { state });

  beforeEach(() => {
    globalThis.fromUuid = async uuid => ({ id: uuid, name: uuid, img: "", system: { level: Number(uuid.slice(-1)) } });
  });
  afterEach(() => { delete globalThis.fromUuid; });

  it("refuses a second 3rd-level spell when only one pick reaches 3rd", async () => {
    const state = capState();
    await pick(state, "fireball3", 3);
    await pick(state, "haste3", 3);
    expect(state.selectedSpells.map(s => s.uuid)).toEqual(["fireball3"]);
    await pick(state, "web2", 2);
    expect(state.selectedSpells).toHaveLength(2);
  });

  it("lets a marked swap carry a cap of its own, and takes it back when unmarked", async () => {
    const state = capState();
    await pick(state, "fireball3", 3);
    await mark(state, "shield");
    await pick(state, "haste3", 3);
    expect(state.selectedSpells.map(s => s.uuid)).toEqual(["fireball3", "haste3"]);
    await mark(state, "shield");
    expect(state.selectedSpells.map(s => s.uuid)).toEqual(["fireball3"]);
  });

  it("marks one spell per level gained before moving the oldest mark", async () => {
    const state = capState();
    state.spellPlan = () => ({ ...capState().spellPlan(), swapLimit: 2 });
    await mark(state, "a");
    await mark(state, "b");
    await mark(state, "c");
    expect(state.swapSpells.map(m => m.id)).toEqual(["b", "c"]);
    state.selectedSpells = [{ uuid: "x" }, { uuid: "y" }, { uuid: "z" }, { uuid: "w" }, { uuid: "v" }];
    expect(spellChanges(state).deleteIds).toEqual(["b"]);
  });
});

describe("the spell page under caps", () => {
  const row = (name, level) => ({
    uuid: `Compendium.x.Item.${name}`, name, img: "", level, identifier: name, school: "Evocation", propertyKeys: ""
  });
  const spells = {
    forClassAtLevel: async () => ({ byLevel: { 0: [], 1: [row("shield", 1)], 2: [row("web", 2), row("blur", 2)] } }),
    description: async () => "",
    sourceBook: async () => ""
  };

  it("greys out a spell no free pick can reach, says why, and shows the chips", async () => {
    const state = {
      actor: { items: [] }, spellSource: { items: [] }, classItem: { name: "Sorcerer" },
      spellTab: "spells", focusedSpellUuid: "Compendium.x.Item.blur",
      selectedCantrips: [], selectedSpells: [{ uuid: "Compendium.x.Item.web", name: "web", level: 2 }],
      swapCantrip: null, swapSpells: [], spellListOverride: "",
      spellPlan: () => ({
        isSpellcaster: true, sourceTag: "class:sorcerer", castUuid: "Compendium.x.Item.sor", listType: "class",
        maxSpellLevel: 2, addCantrips: 0, addSpells: 2, canSwapCantrip: false, canSwapSpell: false,
        releasedCantrips: 0, releasedSpells: 0, spellCaps: [2, 1], swapCaps: []
      })
    };
    const ctx = await lvlSpellsStep.context({ state, spells });
    const byName = Object.fromEntries(ctx.list.map(r => [r.name, r]));
    expect(byName.blur.disabled).toBe(true);
    expect(byName.blur.capped).toBe(true);
    expect(byName.shield.disabled).toBe(false);
    expect(ctx.focused.note).toContain("levelup.step.spells.capNote");
    expect(ctx.levelCaps.map(c => [c.level, c.used, c.allowed])).toEqual([[1, 0, 1], [2, 1, 1]]);
  });
});
