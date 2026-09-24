import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { CreatorState } from "../scripts/state/creator-state.mjs";
import {
  abilitiesContext, abilitiesComplete, applySuggestion, suggestPointBuy
} from "../scripts/steps/abilities-step.mjs";
import { classGuide, CLASS_GUIDE } from "../scripts/data/class-guide.mjs";
import { QUICK_BUILD } from "../scripts/data/quick-build-data.mjs";

/**
 * The ability panel's "Suggest for <class>" button, and the class guide shown on class cards.
 *
 * The suggestion reuses the Quick Build priorities, so the property that matters is that it lands
 * on the same scores Quick Build would — the standard array in priority order — whatever method the
 * player is using, and leaves a complete set of scores behind.
 */
beforeEach(() => installFoundryShims());

const WIZARD = ["int", "con", "dex", "wis", "cha", "str"];
const cost = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const spent = scores => Object.values(scores).reduce((sum, v) => sum + cost[v], 0);

describe("suggestPointBuy", () => {
  // The standard array costs exactly the PHB's 27 points, so the default budget reproduces it.
  it("lands on the standard array in priority order at the default budget", () => {
    expect(suggestPointBuy(WIZARD, 27)).toEqual({ int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 });
  });

  // A tight budget keeps the class's main ability high rather than flattening every score.
  it("spends a smaller budget from the top of the priorities down", () => {
    const scores = suggestPointBuy(WIZARD, 20);
    expect(scores).toEqual({ int: 15, con: 14, dex: 12, wis: 8, cha: 8, str: 8 });
    expect(spent(scores)).toBe(20);
  });

  it("keeps climbing in priority order with a generous budget, up to the cap", () => {
    const scores = suggestPointBuy(WIZARD, 32);
    expect(scores).toEqual({ int: 15, con: 15, dex: 14, wis: 13, cha: 10, str: 8 });
    expect(spent(scores)).toBe(32);
  });

  it("never spends more than the budget, and never passes 15", () => {
    for ( const budget of [0, 1, 5, 13, 26, 27, 28, 40, 54, 100] ) {
      const scores = suggestPointBuy(WIZARD, budget);
      expect(spent(scores)).toBeLessThanOrEqual(budget);
      expect(Math.max(...Object.values(scores))).toBeLessThanOrEqual(15);
    }
  });
});

describe("applySuggestion", () => {
  it("fills point buy and leaves the budget exactly spent", () => {
    const state = new CreatorState(null);
    state.abilityMethod = "point-buy";
    expect(applySuggestion(state, WIZARD)).toBe(true);
    expect(state.pointBuy.int).toBe(15);
    expect(abilitiesComplete(state)).toBe(true);
  });

  it("assigns the standard array in priority order", () => {
    const state = new CreatorState(null);
    state.abilityMethod = "standard-array";
    applySuggestion(state, WIZARD);
    expect(state.resolvedScores()).toMatchObject({ int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 });
    expect(abilitiesComplete(state)).toBe(true);
  });

  it("arranges a rolled pool, highest roll to the top priority", () => {
    const state = new CreatorState(null);
    state.abilityMethod = "roll";
    state.rolledPool = [17, 14, 12, 11, 9, 7];
    applySuggestion(state, WIZARD);
    expect(state.resolvedScores()).toMatchObject({ int: 17, con: 14, dex: 12, wis: 11, cha: 9, str: 7 });
  });

  it("does nothing before a roll, or for manual entry", () => {
    const rolled = new CreatorState(null);
    rolled.abilityMethod = "roll";
    rolled.rolledPool = [];
    expect(applySuggestion(rolled, WIZARD)).toBe(false);

    const manual = new CreatorState(null);
    game.settings.set("sogrom-dnd5e-character-creator", "allowManualAbilities", true);
    manual.abilityMethod = "manual";
    expect(applySuggestion(manual, WIZARD)).toBe(false);
  });

  // Every class the Quick Build table knows yields a complete standard-array build.
  it("completes the standard array for every Quick Build profile", () => {
    for ( const [id, profile] of Object.entries(QUICK_BUILD) ) {
      const state = new CreatorState(null);
      state.abilityMethod = "standard-array";
      applySuggestion(state, profile.abilities);
      expect(abilitiesComplete(state), id).toBe(true);
    }
  });
});

describe("the Suggest button's context", () => {
  const suggest = { className: "Wizard", order: WIZARD };

  it("is absent with no class chosen", () => {
    expect(abilitiesContext(new CreatorState(null)).suggest).toBeNull();
  });

  it("names the class, and carries the order as a tooltip when it is known", () => {
    const ctx = abilitiesContext(new CreatorState(null), { suggest });
    expect(ctx.suggest.label).toContain("Wizard");
    expect(ctx.suggest.hint).toContain("step.abilities.suggestHint");
    const bare = abilitiesContext(new CreatorState(null), { suggest: { className: "Homebrew", order: null } });
    expect(bare.suggest.hint).toBe("");
  });

  it("is absent before a roll", () => {
    const state = new CreatorState(null);
    state.abilityMethod = "roll";
    state.rolledPool = [];
    expect(abilitiesContext(state, { suggest }).suggest).toBeNull();
  });
});

describe("classGuide", () => {
  // The 2024 PHB's "Class Overview" table, verbatim — plus the Artificer, which the PHB doesn't
  // rate and the module rates high.
  it("carries the PHB's complexity ratings", () => {
    const ratings = Object.fromEntries(Object.entries(CLASS_GUIDE).map(([id, g]) => [id, g.complexity]));
    expect(ratings).toEqual({
      artificer: "high", barbarian: "average", bard: "high", cleric: "average", druid: "high",
      fighter: "low", monk: "high", paladin: "average", ranger: "average", rogue: "low",
      sorcerer: "high", warlock: "high", wizard: "average"
    });
  });

  it("fills pips up to the rating", () => {
    expect(classGuide("fighter").pips.map(p => p.on)).toEqual([true, false, false]);
    expect(classGuide("wizard").pips.map(p => p.on)).toEqual([true, true, false]);
    expect(classGuide("bard").pips.map(p => p.on)).toEqual([true, true, true]);
  });

  it("has nothing to say about a class it doesn't know", () => {
    expect(classGuide("blood-hunter")).toBeNull();
    expect(classGuide("")).toBeNull();
  });

  it("covers every class the Quick Build table covers", () => {
    for ( const id of Object.keys(QUICK_BUILD) ) expect(classGuide(id), id).not.toBeNull();
  });
});
