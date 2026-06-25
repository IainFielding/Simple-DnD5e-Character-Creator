/**
 * Shared constants and small runtime helpers for the Character Creator.
 *
 * Kept deliberately free of Application/DOM concerns so every layer (state, data,
 * steps, build) can import from here without pulling in the UI.
 */

export const MODULE_ID = "sogrom-dnd5e-character-creator";

/** Ability keys in canonical display order. */
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/** Settings keys, centralised so registration and reads never drift. */
export const SETTINGS = {
  launchButton: "showLaunchButton",
  contextMenu: "showContextMenu",
  pointBuyBudget: "pointBuyBudget",
  rollFormula: "abilityRollFormula",
  displayMode: "displayMode"
};

export const DEFAULTS = {
  pointBuyBudget: 27,
  rollFormula: "4d6kh3",
  displayMode: "fullscreen"
};

/**
 * Fallback counts of cantrips / level-1 spells known at level 1, keyed by class
 * identifier. Consulted only when a class carries no matching ScaleValue advancement
 * to read the figure from — see {@link module:data/spell-source}.
 */
export const DEFAULT_CANTRIPS = {
  artificer: 2, bard: 2, cleric: 3, druid: 2,
  ranger: 0, sorcerer: 4, warlock: 2, wizard: 3
};
export const DEFAULT_LEVEL1_SPELLS = {
  artificer: 2, bard: 2, cleric: 3, druid: 3,
  ranger: 0, sorcerer: 2, warlock: 2, wizard: 6
};

/**
 * Localise a module-scoped key. Call only after i18n is ready (never in static
 * field initialisers). Pass `data` to interpolate `{token}` placeholders.
 * @param {string} key            Key relative to the module namespace.
 * @param {object} [data]         Optional interpolation data.
 * @returns {string}
 */
export function t(key, data) {
  const full = `${MODULE_ID}.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Path to a template file shipped by this module. */
export function tpl(relative) {
  return `modules/${MODULE_ID}/templates/${relative}`;
}

/** Resolved point-buy budget, falling back to the default for invalid settings. */
export function pointBuyBudget() {
  const raw = Number(game.settings.get(MODULE_ID, SETTINGS.pointBuyBudget));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULTS.pointBuyBudget;
}

/** Resolved (and validated) ability-roll formula. */
export function abilityRollFormula() {
  const raw = String(game.settings.get(MODULE_ID, SETTINGS.rollFormula) ?? "").trim();
  return raw && Roll.validate(raw) ? raw : DEFAULTS.rollFormula;
}

/** Console logger namespaced to the module. */
export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}
