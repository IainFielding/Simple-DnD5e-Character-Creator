import { describe, it, expect, beforeEach } from "vitest";
import {
  abilitiesComplete, abilitiesContext, abilitiesHandle, assignSlot
} from "../scripts/steps/abilities-step.mjs";
import { ABILITIES } from "../scripts/config.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

// The point-buy budget and labels come from settings/CONFIG; reset them before each test so a
// `game.settings.set` in one case can't leak into the next.
beforeEach(() => installFoundryShims());

const blankAssignment = () => ({ str: null, dex: null, con: null, int: null, wis: null, cha: null });
const flat = value => Object.fromEntries(ABILITIES.map(k => [k, value]));

/** A point-buy state with the given per-ability scores (defaults all to 8, the floor). */
function pointBuyState(scores = {}) {
  return { abilityMethod: "point-buy", pointBuy: { ...flat(8), ...scores } };
}

describe("point-buy math", () => {
  it("starts with the full budget unspent and nothing raisable downward", () => {
    const ctx = abilitiesContext(pointBuyState());
    expect(ctx.budget).toBe(27);
    expect(ctx.spent).toBe(0);
    expect(ctx.remaining).toBe(27);
    expect(ctx.rows.every(r => r.canInc)).toBe(true);   // 8 -> 9 costs 1, affordable
    expect(ctx.rows.every(r => r.canDec)).toBe(false);  // already at the floor
    expect(abilitiesComplete(pointBuyState())).toBe(false);
  });

  it("charges the PHB escalating cost and completes when the budget is exactly spent", () => {
    // Three 15s (9 points each) is exactly the 27-point budget.
    const state = pointBuyState({ str: 15, dex: 15, con: 15 });
    const ctx = abilitiesContext(state);
    expect(ctx.spent).toBe(27);
    expect(ctx.remaining).toBe(0);
    expect(abilitiesComplete(state)).toBe(true);

    const str = ctx.rows.find(r => r.key === "str");
    expect(str.canInc).toBe(false);   // 15 is the cap
    expect(str.canDec).toBe(true);
    // With 0 points left, an 8 can't afford the +1 step.
    expect(ctx.rows.find(r => r.key === "int").canInc).toBe(false);
  });

  it("blocks an increase whose step cost exceeds the remaining points", () => {
    // 13 -> 14 jumps from 5 to 7 (a 2-point step). Leave exactly 1 point free elsewhere.
    // Spend 26 of 27 so 1 remains: 14(7)+13(5)+13(5)+11(3)+11(3)+11(3) = 26.
    const state = pointBuyState({ str: 14, dex: 13, con: 13, int: 11, wis: 11, cha: 11 });
    const ctx = abilitiesContext(state);
    expect(ctx.remaining).toBe(1);
    // dex is 13: the +1 to 14 costs 2, more than the 1 remaining -> not allowed.
    expect(ctx.rows.find(r => r.key === "dex").canInc).toBe(false);
    // int is 11: the +1 to 12 costs 1, affordable.
    expect(ctx.rows.find(r => r.key === "int").canInc).toBe(true);
  });

  it("honours a GM-overridden point-buy budget", () => {
    game.settings.set(null, "pointBuyBudget", 30);
    expect(abilitiesContext(pointBuyState()).remaining).toBe(30);
  });

  it("increments and decrements through the handler only within the rules", async () => {
    const state = pointBuyState();
    await abilitiesHandle("ability-inc", { dataset: { ability: "str" } }, state);
    expect(state.pointBuy.str).toBe(9);
    // Can't go below the floor of 8.
    await abilitiesHandle("ability-dec", { dataset: { ability: "dex" } }, state);
    expect(state.pointBuy.dex).toBe(8);
    // Reset returns every score to the floor.
    await abilitiesHandle("ability-reset", { dataset: {} }, state);
    expect(state.pointBuy).toEqual(flat(8));
  });
});

describe("assignSlot swapping (standard array / roll)", () => {
  it("assigns a pool index to an ability", () => {
    const state = { assignment: blankAssignment() };
    assignSlot(state, "str", 0);
    expect(state.assignment.str).toBe(0);
  });

  it("swaps the two abilities when a taken value is reassigned", () => {
    // Pool [15,14,13,12,10,8]; str holds 15 (idx 0), dex holds 14 (idx 1).
    const state = { assignment: { ...blankAssignment(), str: 0, dex: 1 } };
    // Give str dex's value (idx 1): dex must inherit str's old value (idx 0), not go empty.
    assignSlot(state, "str", 1);
    expect(state.assignment.str).toBe(1);
    expect(state.assignment.dex).toBe(0);
  });

  it("leaves the other ability unassigned when the mover held nothing", () => {
    const state = { assignment: { ...blankAssignment(), dex: 2 } };
    // str (empty) takes dex's value; dex inherits str's previous (null) -> becomes unassigned.
    assignSlot(state, "str", 2);
    expect(state.assignment.str).toBe(2);
    expect(state.assignment.dex).toBe(null);
  });

  it("clears an ability when assigned a null index", () => {
    const state = { assignment: { ...blankAssignment(), str: 0 } };
    assignSlot(state, "str", null);
    expect(state.assignment.str).toBe(null);
  });

  it("no-ops without an ability", () => {
    const state = { assignment: blankAssignment() };
    assignSlot(state, null, 0);
    expect(state.assignment).toEqual(blankAssignment());
  });
});

describe("abilitiesComplete for pool methods", () => {
  const pool = [15, 14, 13, 12, 10, 8];
  const state = over => ({ abilityMethod: "standard-array", abilityPool: () => pool, assignment: { ...blankAssignment(), ...over } });

  it("is incomplete until every ability has a value", () => {
    expect(abilitiesComplete(state({ str: 0, dex: 1, con: 2 }))).toBe(false);
  });

  it("is complete once all six are assigned", () => {
    expect(abilitiesComplete(state({ str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 }))).toBe(true);
  });

  it("is incomplete with an empty pool", () => {
    expect(abilitiesComplete({ abilityMethod: "roll", abilityPool: () => [], assignment: blankAssignment() })).toBe(false);
  });
});
