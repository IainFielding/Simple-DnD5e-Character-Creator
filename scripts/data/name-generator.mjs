import { NAME_STYLES, SPECIES_STYLE_ALIASES } from "./name-data.mjs";

/**
 * Random fantasy name generator for the Details step.
 *
 * Given a species' dnd5e `system.identifier` it resolves a naming *style*
 * ({@link module:data/name-data}) and assembles a name: a gender-appropriate given
 * name plus, where the style defines them, a surname/clan name. Generation is pure
 * — it reads only the tables and an optional gender hint and returns a string — so
 * the step handler can call it synchronously on a click.
 *
 * Distinct from other tools by design: it draws from curated, authored lists rather
 * than a procedural syllable grammar, and it keys off the species the player has
 * *already chosen* rather than a separate culture picker.
 *
 * Worlds/modules may extend it without editing the data file:
 *   CONFIG.SOGROM ??= {};
 *   CONFIG.SOGROM.nameStyles  = { kalashtar: { male:[…], female:[…], surnames:[…] } };
 *   CONFIG.SOGROM.nameAliases = { kalashtar: "kalashtar" };
 */

/** Pick a uniformly random element, or "" for an empty/absent array. */
function pick(list) {
  return list?.length ? list[Math.floor(Math.random() * list.length)] : "";
}

/** Merge the built-in tables with any `CONFIG.SOGROM` overrides (overrides win). */
function styleTables() {
  return { ...NAME_STYLES, ...(globalThis.CONFIG?.SOGROM?.nameStyles ?? {}) };
}
function styleAliases() {
  return { ...SPECIES_STYLE_ALIASES, ...(globalThis.CONFIG?.SOGROM?.nameAliases ?? {}) };
}

/**
 * Resolve a species identifier to a style key that exists in the (merged) tables.
 * Unknown or empty identifiers — and aliases pointing at a missing style — resolve
 * to "default", so the generator always has a pool to draw from.
 * @param {string} [identifier]
 * @returns {string}
 */
export function styleForSpecies(identifier) {
  const tables = styleTables();
  const key = String(identifier ?? "").trim().toLowerCase();
  const style = styleAliases()[key] ?? (tables[key] ? key : "default");
  return tables[style] ? style : "default";
}

/** A human-readable label for a style key ("half-orc" -> "Half-Orc", "default" -> "Generic"). */
export function styleLabel(key) {
  if ( key === "default" ) return "Generic";
  return String(key).split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
}

/**
 * Every available style key with a display label, sorted for a picker. Reflects any
 * `CONFIG.SOGROM.nameStyles` additions, so a registered custom style shows up too.
 * @returns {{key: string, label: string}[]}
 */
export function nameStyleOptions() {
  return Object.keys(styleTables())
    .map(key => ({ key, label: styleLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which given-name pool to draw from. The Details `gender` field is free text, so we
 * only honour it when it clearly reads masculine or feminine; anything else (blank,
 * "non-binary", a pronoun, a culture-specific term) draws from both pools combined.
 * @param {object} style  A style table `{ male, female, surnames }`.
 * @param {string} [gender]
 * @returns {string[]}
 */
function givenPool(style, gender) {
  const g = String(gender ?? "").trim().toLowerCase();
  if ( /^(m|male|man|boy|masc)/.test(g) ) return style.male ?? [];
  if ( /^(f|female|woman|girl|fem)/.test(g) ) return style.female ?? [];
  return [...(style.male ?? []), ...(style.female ?? [])];
}

/**
 * Generate a random name for a species.
 * @param {string} [identifier]        The species' dnd5e `system.identifier`.
 * @param {object} [opts]
 * @param {string} [opts.gender]       Free-text gender hint from the Details step.
 * @returns {string}                   The assembled name (never empty for a known style).
 */
export function generateName(identifier, { gender } = {}) {
  const style = styleTables()[styleForSpecies(identifier)];
  const given = pick(givenPool(style, gender));
  const surname = pick(style.surnames);
  return surname ? `${given} ${surname}`.trim() : given;
}
