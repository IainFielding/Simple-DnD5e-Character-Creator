import { ABILITIES, abilityRollFormula, pointBuyBudget, t } from "../config.mjs";

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
 * Ability score determination — its own step (deliberately separate from class).
 * Supports the three standard methods; each keeps the others' working values, so
 * a player can flip between them without losing progress.
 */
export const abilitiesStep = {
  id: "abilities",
  icon: "fa-solid fa-dice-d20",
  labelKey: "step.abilities.label",
  template: "steps/abilities",

  isComplete(state) {
    if ( state.abilityMethod === "point-buy" ) return pointsRemaining(state) === 0;
    const pool = state.abilityPool() ?? [];
    if ( !pool.length ) return false;
    return ABILITIES.every(k => state.assignment[k] != null);
  },

  summary(state) {
    const scores = state.resolvedScores();
    return ABILITIES.map(k => scores[k]).join(" / ");
  },

  async handle(action, el, { state }) {
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
  },

  async context({ state }) {
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
};

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
  const results = [];
  for ( let i = 0; i < 6; i++ ) {
    const roll = await new Roll(formula).evaluate();
    results.push(roll.total);
  }
  return results.sort((a, b) => b - a);
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

  return { rows, hasPool, poolValues: pool };
}
