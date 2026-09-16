/**
 * Shelf sections shared by the two shops the creator runs: the starting-gold Store and the
 * Magic Items step, plus the GM's Magic Item Shop window. All three group their rows by kind
 * of thing the same way, so a wand sits under the same heading in the settings window as it
 * does on the player's shelf.
 */

/**
 * The order the shelf sections appear in, and the icon each one gets.
 *
 * The goods used to be one alphabetical list under a single "Goods" heading, which put a
 * battleaxe between a bedroll and a bell. Alphabetical is the right order *within* a kind of
 * thing and the wrong one across kinds: nobody shops for "something beginning with B", they shop
 * for a weapon, or armour, or rope. The containers already had their own headed section — this is
 * the same treatment for everything else.
 *
 * Weapons and armour first because they are what a level-1 character is usually short of, then
 * the consumables, then the tools and sundries. Any item type not listed (a system or module adds
 * one) still gets a section; it sorts to the end by its localised label rather than being dropped.
 * Icons are FontAwesome 6 Free Solid, which is what Foundry ships.
 *
 * A section is keyed on the item type with three deliberate exceptions: armour, gaming sets and
 * musical instruments. dnd5e files armour and clothing and rings and wands all as
 * `type: "equipment"`, so grouping on the type alone put a suit of plate, a signet ring and a
 * wand of wonder under one heading — which is the same complaint as the original single "Goods"
 * list, one level down. The armour subtypes are exactly the keys of CONFIG.DND5E.armorTypes
 * (light/medium/heavy/natural/shield), so they split out into their own section and the
 * remainder keeps the system's own "Equipment" label. Gaming sets and musical instruments are
 * both filed as `type: "tool"` alongside artisan's tools and kits — a deck of cards or a lute
 * buried under "Tools" is the same complaint again, so the `game` and `music` tool subtypes each
 * get their own section too. See sectionKey().
 */
export const SHELF_SECTIONS = [
  { key: "weapon", icon: "fa-gavel" },
  { key: "armor", icon: "fa-shield-halved" },
  { key: "equipment", icon: "fa-shirt" },
  { key: "consumable", icon: "fa-flask" },
  { key: "tool", icon: "fa-screwdriver-wrench" },
  { key: "game", icon: "fa-dice" },
  { key: "music", icon: "fa-music" },
  { key: "container", icon: "fa-suitcase" },
  { key: "loot", icon: "fa-box" }
];
const SECTION_FALLBACK_ICON = "fa-boxes-stacked";

/** Tool subtypes that get their own shelf section instead of sitting under "Tools". */
const TOOL_SUBTYPE_SECTIONS = new Set(["game", "music"]);

/**
 * Which shelf section a stock entry belongs in: its item type, except that `equipment` splits
 * into armour and everything else, and `tool` splits gaming sets and musical instruments out of
 * the general tool bucket.
 *
 * Read from CONFIG rather than a hard-coded list of subtype keys, so a system update that adds an
 * armour kind files it correctly without a change here.
 * @param {object} entry  A stock entry (`type` plus dnd5e's `subtype`).
 * @returns {string}
 */
export function sectionKey(entry) {
  if ( entry.type === "tool" ) return TOOL_SUBTYPE_SECTIONS.has(entry.subtype) ? entry.subtype : "tool";
  if ( entry.type !== "equipment" ) return entry.type;
  return (entry.subtype in (globalThis.CONFIG?.DND5E?.armorTypes ?? {})) ? "armor" : "equipment";
}

/**
 * Split shelf cards into headed sections, in {@link SHELF_SECTIONS} order.
 * @param {object[]} cards            Cards carrying a `section` key, already filtered and sorted.
 * @param {(key: string) => string} label  The localiser for a section key.
 * @returns {object[]}  `{key, label, icon, cards}`, empty sections omitted.
 */
export function groupCards(cards, label) {
  const bySection = new Map();
  for ( const card of cards ) {
    if ( !bySection.has(card.section) ) bySection.set(card.section, []);
    bySection.get(card.section).push(card);
  }
  const known = SHELF_SECTIONS
    .filter(s => bySection.has(s.key))
    .map(s => ({ key: s.key, label: label(s.key), icon: s.icon, cards: bySection.get(s.key) }));
  const extra = [...bySection.keys()]
    .filter(key => !SHELF_SECTIONS.some(s => s.key === key))
    .map(key => ({ key, label: label(key), icon: SECTION_FALLBACK_ICON, cards: bySection.get(key) }))
    .sort((a, b) => a.label.localeCompare(b.label, globalThis.game?.i18n?.lang));
  return [...known, ...extra];
}

/** The localised label for a dnd5e item type, falling back to the raw key. */
export function itemTypeLabel(type) {
  const key = globalThis.CONFIG?.Item?.typeLabels?.[type];
  const label = key ? game.i18n.localize(key) : type;
  return label === key ? type : label;
}

/**
 * The localised label for a dnd5e subtype within an item type (simple/martial weapons, armour
 * classes, potion vs ammo…). The system pre-localises these maps; consumable/loot entries are
 * objects carrying a `label`.
 * @param {string} type
 * @param {string} key
 * @returns {string}
 */
export function subtypeLabel(type, key) {
  const D = globalThis.CONFIG?.DND5E;
  const entry = {
    weapon: D?.weaponTypes,
    equipment: D?.equipmentTypes,
    consumable: D?.consumableTypes,
    tool: D?.toolTypes,
    loot: D?.lootTypes
  }[type]?.[key];
  return (typeof entry === "string" ? entry : entry?.label) || key;
}
