/**
 * Shared constants and small runtime helpers for the Character Creator.
 *
 * Kept deliberately free of Application/DOM concerns so every layer (state, data,
 * steps, build) can import from here without pulling in the UI.
 *
 * For a junior dev: this is the "grab bag" module every other file imports from.
 * If you need a constant or a tiny helper that has nothing to do with the UI, it
 * probably lives here. Nothing in this file touches the DOM or a Foundry Application.
 */

// The module's unique id. Must match the "id" field in module.json. Foundry uses it
// to namespace our settings, templates, and localisation keys so they never collide
// with another module's.
export const MODULE_ID = "sogrom-dnd5e-character-creator";

/** Ability keys in canonical display order. */
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * The D&D ability modifier for a score: (score - 10) / 2, rounded down, rendered with an
 * explicit + or - sign (e.g. 16 → "+3", 8 → "-1").
 * @param {number} score
 * @returns {string}
 */
export function formatMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

// The string keys for every world setting this module registers with Foundry.
// Centralising them here means the code that *registers* a setting and the code that
// *reads* it always use the exact same key — no risk of a typo silently reading `undefined`.
export const SETTINGS = {
  launchButton: "showLaunchButton",
  contextMenu: "showContextMenu",
  pointBuyBudget: "pointBuyBudget",
  rollFormula: "abilityRollFormula",
  displayMode: "displayMode",
  mode: "mode",
  levelUpButton: "showLevelUpButton",
  levelUpHpMode: "levelUpHpMode",
  levelUpHpRollToChat: "levelUpHpRollToChat"
};

// The fallback value for each setting, used when the world hasn't overridden it (and as
// the `default` we hand to Foundry at registration time).
export const DEFAULTS = {
  pointBuyBudget: 27,
  rollFormula: "4d6kh3",
  displayMode: "fullscreen",
  mode: "creation-levelup",
  levelUpButton: false,
  levelUpHpMode: "choice",
  levelUpHpRollToChat: false
};

/**
 * The valid values of the module `mode` setting:
 *  - `"creation"`         — the module only owns character creation; levelling stays native.
 *  - `"creation-levelup"` — creation plus the level-up takeover (the default).
 *  - `"levelup"`          — level-up only; every creation entry point (launch button,
 *                           context menu) is hidden and the native creation flow is untouched.
 */
export const MODES = ["creation", "creation-levelup", "levelup"];

/**
 * The valid values of the level-up hit-point mode setting, from most to least permissive:
 *  - `"choice"`       — average, roll, max, or a manually-typed value (the module's original behaviour).
 *  - `"average-roll"` — average or roll only (the 2024 rules as written); no max, no manual entry.
 *  - `"average"`      — average only; the buttons collapse to a single pre-made decision.
 */
export const HP_MODES = ["choice", "average-roll", "average"];

/**
 * How much freedom players get on the level-up hit-point decision, per the world setting.
 * Guards against an unknown stored value by falling back to the default.
 * @returns {"choice"|"average-roll"|"average"}
 */
export function levelUpHpMode() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.levelUpHpMode);
  return HP_MODES.includes(raw) ? raw : DEFAULTS.levelUpHpMode;
}

/**
 * Whether a level-up hit-die roll should also post the system's roll card to chat, so the
 * table can see the result — off by default to keep the wizard quiet.
 * @returns {boolean}
 */
export function levelUpHpRollToChat() {
  return !!game.settings.get(MODULE_ID, SETTINGS.levelUpHpRollToChat);
}

/**
 * The module's effective mode. Normally this is the `mode` world setting (guarded against an
 * unknown stored value). When the Ember module is active it is always `"levelup"`: Ember ships
 * its own character creation, so ours stands down and only the level-up takeover runs —
 * regardless of what the setting stored before Ember was enabled.
 * @returns {"creation"|"creation-levelup"|"levelup"}
 */
export function moduleMode() {
  if ( emberActive() ) return "levelup";
  const raw = game.settings.get(MODULE_ID, SETTINGS.mode);
  return MODES.includes(raw) ? raw : DEFAULTS.mode;
}

/**
 * Whether the module owns character creation (the launch button, the actor context menu and
 * the creator window itself). Off in `"levelup"` mode — and therefore always off while Ember
 * is active, since Ember owns creation.
 * @returns {boolean}
 */
export function creationEnabled() {
  return moduleMode() !== "levelup";
}

/**
 * Whether the module owns the level-up experience, per the effective {@link moduleMode}.
 * `"creation-levelup"` and `"levelup"` opt the table into the level-up takeover (§5 of the
 * level-up plan); `"creation"` leaves the actor sheet and the native advancement flow
 * untouched. Both level-up trigger paths are gated on this.
 * @returns {boolean}
 */
export function levelUpEnabled() {
  return moduleMode() !== "creation";
}

/**
 * Whether the Ember module is active in this world. Ember brings its own character creator,
 * so we cede creation to it ({@link moduleMode} pins to `"levelup"`) and re-skin our level-up
 * window to match its look (the `sogrom-ember` class, see styles/ember-skin.css).
 * @returns {boolean}
 */
export function emberActive() {
  return !!game.modules.get("ember")?.active;
}

/**
 * Whether the Hero Mancer module is active. It occupies the same level-up/multiclass space
 * but replaces dnd5e's advancement engine rather than wrapping it, so we stand down entirely
 * when it is present (§6) to avoid duplicate buttons and a disabled native engine.
 * @returns {boolean}
 */
export function heroMancerActive() {
  return !!game.modules.get("hero-mancer")?.active;
}

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
 * Turn a translation key into the text the player sees, in their configured language.
 * We prefix the key with the module id so it resolves against *our* entries in lang/en.json
 * (e.g. t("step.class.label") reads "sogrom-dnd5e-character-creator.step.class.label").
 *
 * Call only after i18n is ready (never in static field initialisers), because `game.i18n`
 * isn't populated until Foundry's setup phase. Pass `data` to fill `{token}` placeholders.
 * @param {string} key            Key relative to the module namespace.
 * @param {object} [data]         Optional interpolation data.
 * @returns {string}
 */
export function t(key, data) {
  const full = `${MODULE_ID}.${key}`;
  // `format` fills in {placeholders}; `localize` is the plain lookup with none.
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

/** Build the full path to one of this module's template files (e.g. tpl("stage.hbs")). */
export function tpl(relative) {
  return `modules/${MODULE_ID}/templates/${relative}`;
}

/** Read the point-buy budget setting, guarding against a GM entering a bad value (0, text, etc.). */
export function pointBuyBudget() {
  const raw = Number(game.settings.get(MODULE_ID, SETTINGS.pointBuyBudget));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULTS.pointBuyBudget;
}

/** Read the ability-roll formula setting; fall back to the default if it isn't valid dice syntax. */
export function abilityRollFormula() {
  const raw = String(game.settings.get(MODULE_ID, SETTINGS.rollFormula) ?? "").trim();
  // Roll.validate is dnd5e/Foundry's own dice-syntax checker, so we never store a formula that throws.
  return raw && Roll.validate(raw) ? raw : DEFAULTS.rollFormula;
}

/** Console logger namespaced to the module. */
export function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

/**
 * Resolve the ApplicationV2 options for a launch, based on the configured display mode, so the
 * creator and level-up windows feel identical. Fullscreen covers the viewport with no chrome;
 * windowed opens a themed, draggable, resizable frame at ~90% of the screen, centred.
 * @returns {object}
 */
export function launchWindowOptions() {
  const windowed = game.settings.get(MODULE_ID, SETTINGS.displayMode) === "windowed";
  // Carry the base class explicitly: ApplicationV2 may replace (rather than merge)
  // the static DEFAULT_OPTIONS.classes with the array passed here.
  const classes = ["sogrom-creator", windowed ? "sogrom-creator-windowed" : "sogrom-creator-fullscreen"];
  // With Ember active the window wears its skin (styles/ember-skin.css) so the level-up
  // reads as part of Ember's creator rather than a foreign UI dropped on top of it.
  if ( emberActive() ) classes.push("sogrom-ember");
  if ( !windowed ) return { classes };

  const w = Math.min(1800, Math.round(window.innerWidth * 0.9));
  const h = Math.min(1100, Math.round(window.innerHeight * 0.9));
  return {
    classes,
    window: { frame: true, positioned: true, resizable: true },
    position: {
      width: w,
      height: h,
      top: Math.max(4, Math.round((window.innerHeight - h) / 2)),
      left: Math.max(4, Math.round((window.innerWidth - w) / 2))
    }
  };
}
