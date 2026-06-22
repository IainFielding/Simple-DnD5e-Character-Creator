import { ABILITIES, MODULE_ID, abilityRollFormula, pointBuyBudget, t } from "../config.mjs";

/** PHB point-buy price of each reachable score. */
const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const PB_MIN = 8;
const PB_MAX = 15;

const formatMod = score => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const abilityLabel = key => CONFIG.DND5E?.abilities?.[key]?.label ?? key.toUpperCase();
const abilityAbbr = key => CONFIG.DND5E?.abilities?.[key]?.abbreviation ?? key.slice(0, 3).toUpperCase();

/**
 * Ability score determination. This lives as a self-contained panel — context,
 * event handling, and completion — rather than a top-level step, so it can be
 * composed into the Class step (which renders abilities alongside the class grid)
 * without either side knowing about the other's layout.
 *
 * Supports the three standard methods; each keeps the others' working values, so
 * a player can flip between them without losing progress.
 */

/** True once the chosen method has produced a complete, valid set of scores. */
export function abilitiesComplete(state) {
  if ( state.abilityMethod === "point-buy" ) return pointsRemaining(state) === 0;
  const pool = state.abilityPool() ?? [];
  if ( !pool.length ) return false;
  return ABILITIES.every(k => state.assignment[k] != null);
}

/** Compact "15 / 14 / …" line for the rail. */
export function abilitiesSummary(state) {
  const scores = state.resolvedScores();
  return ABILITIES.map(k => scores[k]).join(" / ");
}

/** Apply one ability-panel action to the state. Returns nothing; caller re-renders. */
export async function abilitiesHandle(action, el, state) {
  const ability = el?.dataset?.ability;
  switch ( action ) {
    case "ability-method":
      state.abilityMethod = el.dataset.method;
      break;
    case "ability-inc":
      if ( canIncrease(state, ability) ) state.pointBuy[ability] += 1;
      break;
    case "ability-dec":
      if ( state.pointBuy[ability] > PB_MIN ) state.pointBuy[ability] -= 1;
      break;
    case "ability-roll":
      state.rolledPool = await rollPool();
      state.assignment = blankAssignment();
      break;
    case "ability-assign":
      assignSlot(state, ability, el.value === "" ? null : Number(el.value));
      break;
    case "ability-reset":
      if ( state.abilityMethod === "point-buy" ) resetPointBuy(state);
      else state.assignment = blankAssignment();
      break;
  }
}

/** Template context for the ability panel (nested under `abilities` by the Class step). */
export function abilitiesContext(state) {
  const method = state.abilityMethod;
  return {
    method,
    isPointBuy: method === "point-buy",
    isArray: method === "standard-array",
    isRoll: method === "roll",
    rollFormula: abilityRollFormula(),
    methods: [
      { id: "point-buy", label: t("step.abilities.pointBuy"), active: method === "point-buy" },
      { id: "standard-array", label: t("step.abilities.standardArray"), active: method === "standard-array" },
      { id: "roll", label: t("step.abilities.roll"), active: method === "roll" }
    ],
    ...(method === "point-buy" ? pointBuyContext(state) : poolContext(state))
  };
}

/** Actions this panel owns, so the Class step can route only its own clicks here. */
export const ABILITY_ACTIONS = new Set([
  "ability-method", "ability-inc", "ability-dec", "ability-roll", "ability-assign", "ability-reset"
]);

/* -------------------------------------------- */
/*  Point-buy                                   */
/* -------------------------------------------- */

function pointsSpent(state) {
  return ABILITIES.reduce((sum, k) => sum + (POINT_BUY_COST[state.pointBuy[k]] ?? 0), 0);
}

function pointsRemaining(state) {
  return pointBuyBudget() - pointsSpent(state);
}

function canIncrease(state, ability) {
  const value = state.pointBuy[ability];
  if ( value >= PB_MAX ) return false;
  const step = (POINT_BUY_COST[value + 1] ?? Infinity) - (POINT_BUY_COST[value] ?? 0);
  return step <= pointsRemaining(state);
}

function resetPointBuy(state) {
  for ( const k of ABILITIES ) state.pointBuy[k] = PB_MIN;
}

function pointBuyContext(state) {
  const remaining = pointsRemaining(state);
  const rows = ABILITIES.map(key => {
    const value = state.pointBuy[key];
    return {
      key, label: abilityLabel(key), abbr: abilityAbbr(key),
      value, modifier: formatMod(value),
      canInc: canIncrease(state, key),
      canDec: value > PB_MIN
    };
  });
  return { rows, budget: pointBuyBudget(), spent: pointsSpent(state), remaining };
}

/* -------------------------------------------- */
/*  Standard array / roll                       */
/* -------------------------------------------- */

function blankAssignment() {
  return { str: null, dex: null, con: null, int: null, wis: null, cha: null };
}

/**
 * Assign a pool slot to an ability. Each pool value may be used once, so if the
 * slot was already held by another ability that ability is cleared (a swap).
 */
function assignSlot(state, ability, index) {
  if ( !ability ) return;
  if ( index != null ) {
    for ( const key of ABILITIES ) {
      if ( key !== ability && state.assignment[key] === index ) state.assignment[key] = null;
    }
  }
  state.assignment[ability] = index;
}

async function rollPool() {
  const formula = abilityRollFormula();
  const rolls = [];
  for ( let i = 0; i < 6; i++ ) rolls.push(await new Roll(formula).evaluate());

  // Capture the scores up front: the pool is highest-first (like the standard array)
  // and must survive even if the cosmetic animation below fails or is absent.
  const totals = rolls.map(r => r.total).sort((a, b) => b - a);

  // Animate via Dice So Nice when installed — a single synchronised throw of all six
  // dice. Purely cosmetic, so any failure is logged and ignored, never propagated.
  await showRolledDice(rolls);
  return totals;
}

async function showRolledDice(rolls) {
  if ( !game.dice3d ) return;
  try {
    await Promise.all(rolls.map(roll => game.dice3d.showForRoll(roll, game.user, true)));
  } catch ( err ) {
    console.warn(`${MODULE_ID} | dice animation failed`, err);
  }
}

function poolContext(state) {
  const pool = state.abilityPool() ?? [];
  const hasPool = pool.length > 0;
  const used = new Set(ABILITIES.map(k => state.assignment[k]).filter(v => v != null));

  const rows = ABILITIES.map(key => {
    const chosen = state.assignment[key];
    const score = (chosen != null && pool[chosen] != null) ? pool[chosen] : null;
    const options = pool.map((value, index) => ({
      index, value,
      selected: chosen === index,
      // A slot taken by another ability is disabled in this row's dropdown.
      disabled: chosen !== index && used.has(index)
    }));
    return {
      key, label: abilityLabel(key), abbr: abilityAbbr(key),
      score, modifier: score == null ? "" : formatMod(score),
      assigned: score != null,
      options
    };
  });

  // The pool shown as a strip up top — each value flagged once it's been assigned.
  const poolChips = pool.map((value, index) => ({ value, used: used.has(index) }));

  return { rows, hasPool, pool: poolChips };
}
