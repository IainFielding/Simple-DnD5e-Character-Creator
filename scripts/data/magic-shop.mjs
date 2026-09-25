import { PHYSICAL_TYPES } from "./store-source.mjs";

/**
 * The Magic Items step's rules, as pure functions: the starting-wealth table for a character who
 * begins above level 1, the rarity allowance that table grants, and the inventory entries the GM
 * stocks. Nothing here touches Foundry's documents, so all of it is unit-tested directly; the
 * resolving and the drop handling live in {@link module:data/magic-shop-source}.
 *
 * The defaults are the DMG's "Starting at Higher Level" table. The four level bands are fixed; the
 * gold and item counts inside each are the GM's to override in the Magic Item Shop window.
 *
 * Items from the table are free picks, not purchases. A slot takes an item of its own rarity *or
 * lower*, so a character allowed one Uncommon may take a second Common instead.
 */

/* -------------------------------------------- */
/*  Rarity                                      */
/* -------------------------------------------- */

/**
 * Item rarity keys in ascending order, in the normalised form the sogrom magic shop uses.
 *
 * dnd5e stores `system.rarity` as `veryRare` (and older data as "Very Rare"). Lowercased with the
 * whitespace stripped, every form lands on one of these, which double as the CSS class suffix —
 * so an item wears the same colour here as it does in the shop and on the DM's Toolkit sheet.
 */
export const RARITIES = ["common", "uncommon", "rare", "veryrare", "legendary", "artifact"];

/** The dnd5e `CONFIG.DND5E.itemRarity` key for each normalised rarity, for its label. */
const SYSTEM_RARITY_KEYS = {
  common: "common", uncommon: "uncommon", rare: "rare",
  veryrare: "veryRare", legendary: "legendary", artifact: "artifact"
};

/**
 * Normalise a raw `system.rarity` value to one of {@link RARITIES}.
 * @param {string} [raw]
 * @returns {string}  A key from {@link RARITIES}, or "" for a mundane item or an unknown rarity.
 */
export function normalizeRarity(raw) {
  if ( typeof raw !== "string" ) return "";
  const key = raw.replaceAll(/\s/g, "").toLowerCase();
  return RARITIES.includes(key) ? key : "";
}

/**
 * An item's rarity, normalised, from whichever shape its data is in.
 *
 * dnd5e 6.0.2 replaced `system.rarity` with a `system.rarities` set (so an item can list "Uncommon
 * (+1), Rare (+2)…"), keeping `rarity` only as a getter for the first. A live document answers
 * either; its `toObject()` data, a world export and a migrated compendium index carry only
 * `rarities`, while an unmigrated pack on disk still carries `rarity`.
 * @param {object} item  A document, its data, or an index entry.
 * @returns {string}  A key from {@link RARITIES}, or "".
 */
export function itemRarity(item) {
  const direct = normalizeRarity(item?.system?.rarity);
  if ( direct ) return direct;
  const many = item?.system?.rarities;
  const first = (many && typeof many !== "string") ? [...many][0] : many;
  return normalizeRarity(first);
}

/** Position of a rarity in {@link RARITIES}, or -1. */
export function rarityRank(rarity) {
  return RARITIES.indexOf(rarity);
}

/** The system's localised label for a normalised rarity, falling back to the key. */
export function rarityLabel(rarity) {
  const entry = globalThis.CONFIG?.DND5E?.itemRarity?.[SYSTEM_RARITY_KEYS[rarity]];
  const label = typeof entry === "string" ? entry : entry?.label;
  return label || rarity;
}

/* -------------------------------------------- */
/*  The wealth table                            */
/* -------------------------------------------- */

/** The four fixed level bands. Level 1 has no band: a level-1 character never sees the step. */
/**
 * The Dungeon Master's Guide's own four bands. Not what the GM edits any more — see {@link BANDS} —
 * but still what "reset to the DMG" means, and still how a table stored by an older version is
 * read back.
 */
export const DMG_BANDS = Object.freeze([
  { key: "t1", from: 2, to: 4 },
  { key: "t2", from: 5, to: 10 },
  { key: "t3", from: 11, to: 16 },
  { key: "t4", from: 17, to: 20 }
]);

/**
 * The levels a starting character can be given wealth for.
 *
 * First level is included and defaults to nothing, which is the book's answer — a 1st-level
 * character starts with their class equipment and no more. It is a row rather than an absence so a
 * GM who wants to hand their party a single common item at the start of a campaign can simply say
 * so, instead of being told the table begins at 2nd.
 */
export const WEALTH_LEVELS = Object.freeze(
  Array.from({ length: 20 }, (_, i) => i + 1)
);

/**
 * One row per level, rather than one per DMG band.
 *
 * The book groups levels 5–10 into a single entitlement, and while that is a fine default it is a
 * poor thing to be *limited to*: a GM who wants a level 7 party to start with something a level 5
 * party does not had no way to say so, because editing the band changed both. Nineteen rows is more
 * to look at, but it removes the whole question of band boundaries — there is nothing to overlap,
 * nothing to leave a gap, and "what does a level 7 character get" is answered by reading one line.
 *
 * The shape is unchanged (`{key, from, to}`, with `from === to`), so everything that walks this list
 * — the sanitiser, the lookup, the config form — works without knowing the difference.
 */
export const BANDS = Object.freeze(
  WEALTH_LEVELS.map(level => ({ key: `l${level}`, from: level, to: level }))
);

/** The DMG band a level falls in, which is where its default entitlement comes from. */
export function dmgBandFor(level) {
  const lvl = Math.floor(Number(level) || 0);
  return DMG_BANDS.find(b => lvl >= b.from && lvl <= b.to)
    ?? ((lvl > DMG_BANDS.at(-1).to) ? DMG_BANDS.at(-1) : null);
}

/** An allowance with nothing in it, so every band carries all six rarities. */
function emptyAllowance() {
  return Object.fromEntries(RARITIES.map(r => [r, 0]));
}

/**
 * The DMG's starting wealth for a character above level 1: bonus gold of `baseGp + 1d10 ×
 * perD10Gp` on top of normal starting equipment, and a count of magic items per rarity.
 */
const DMG_BAND_WEALTH = Object.freeze({
  t1: { baseGp: 0, perD10Gp: 0, allowance: { ...emptyAllowance(), common: 1 } },
  t2: { baseGp: 500, perD10Gp: 25, allowance: { ...emptyAllowance(), common: 1, uncommon: 1 } },
  t3: { baseGp: 5000, perD10Gp: 250, allowance: { ...emptyAllowance(), common: 2, uncommon: 3, rare: 1 } },
  t4: { baseGp: 20000, perD10Gp: 250, allowance: { ...emptyAllowance(), common: 2, uncommon: 4, rare: 3, veryrare: 1 } }
});

/** The DMG's entitlement for every level, spread out of its four bands into nineteen rows. */
export const DEFAULT_WEALTH_TABLE = Object.freeze(Object.fromEntries(
  WEALTH_LEVELS.map(level => {
    // Level 1 falls in no DMG band, so its row starts empty — present, and granting nothing.
    const band = DMG_BAND_WEALTH[dmgBandFor(level)?.key] ?? null;
    return [`l${level}`, {
      baseGp: band?.baseGp ?? 0,
      perD10Gp: band?.perD10Gp ?? 0,
      allowance: band ? { ...band.allowance } : emptyAllowance()
    }];
  })
));

/** A stored number as a non-negative integer, or the fallback when it isn't a number at all. */
function count(value, fallback) {
  if ( value === null || value === undefined || value === "" ) return fallback;
  const n = Number(value);
  if ( !Number.isFinite(n) ) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * Guard a stored wealth table field by field. Anything missing or unreadable takes the DMG value,
 * so `null` (the setting's default) is the DMG table and a hand-edited or partial setting can
 * never leave a band without a number.
 * @param {object|null} raw
 * @returns {Record<string, {baseGp: number, perD10Gp: number, allowance: Record<string, number>}>}
 */
export function sanitizeWealthTable(raw) {
  const stored = (raw && typeof raw === "object") ? raw : {};
  // A table written before the per-level split is keyed by DMG band (`t1`…`t4`). Read it, and
  // spread each band's numbers across the levels it covered, so a GM who tuned their table an
  // update ago opens the new form on their own values rather than on the book's.
  const legacy = DMG_BANDS.some(b => stored[b.key] && typeof stored[b.key] === "object");

  const table = {};
  for ( const { key, from } of BANDS ) {
    const def = DEFAULT_WEALTH_TABLE[key];
    // Level 1 was never in the old table, so a legacy read leaves it at its empty default rather
    // than inheriting the 2nd-4th band it sits below.
    const band = legacy ? (from === 1 ? null : stored[dmgBandFor(from)?.key ?? ""]) : stored[key];
    const src = (band && typeof band === "object") ? band : {};
    const allowance = (src.allowance && typeof src.allowance === "object") ? src.allowance : {};
    table[key] = {
      baseGp: count(src.baseGp, def.baseGp),
      perD10Gp: count(src.perD10Gp, def.perD10Gp),
      allowance: Object.fromEntries(RARITIES.map(r => [r, count(allowance[r], def.allowance[r])]))
    };
  }
  return table;
}

/** A deep copy of the DMG table, safe to edit. */
export function defaultWealthTable() {
  return sanitizeWealthTable(null);
}

/**
 * A table where no level grants anything — no gold, no items. This is the shop switched off: with
 * every row empty, {@link tierGrantsAnything} is false at every level and no Magic Items step appears.
 * @returns {Record<string, {baseGp: number, perD10Gp: number, allowance: Record<string, number>}>}
 */
export function emptyWealthTable() {
  return Object.fromEntries(WEALTH_LEVELS.map(level => [`l${level}`, {
    baseGp: 0, perD10Gp: 0, allowance: emptyAllowance()
  }]));
}

/**
 * The band a starting level falls in, with its row from the table.
 * @param {number} level
 * @param {object} [table]  A sanitised table; the DMG table when omitted.
 * @returns {{key: string, from: number, to: number, baseGp: number, perD10Gp: number,
 *            allowance: Record<string, number>}|null}  Null below level 2.
 */
export function tierFor(level, table = DEFAULT_WEALTH_TABLE) {
  const lvl = Math.floor(Number(level) || 0);
  // Level 1 has a row now. It grants nothing unless the GM filled it in, and `tierGrantsAnything`
  // is what hides the step in that case — so this no longer refuses below 2nd.

  // One row per level now, so this is a lookup rather than a search. A level past the top of the
  // table takes the last row, which is what an epic-level world would expect and what the banded
  // version did.
  const band = BANDS.find(b => b.from === lvl)
    ?? ((lvl > BANDS.at(-1).to) ? BANDS.at(-1) : null);
  if ( !band ) return null;
  const row = table[band.key] ?? DEFAULT_WEALTH_TABLE[band.key];
  return {
    ...band, level: band.from,
    baseGp: row.baseGp, perD10Gp: row.perD10Gp, allowance: { ...row.allowance }
  };
}

/** Whether a tier grants anything at all. A band the GM zeroed out hides the step. */
export function tierGrantsAnything(tier) {
  if ( !tier ) return false;
  return (tier.baseGp > 0) || (tier.perD10Gp > 0) || RARITIES.some(r => (tier.allowance[r] ?? 0) > 0);
}

/**
 * The bonus gold, in copper, for a tier and a d10 result.
 * @param {object|null} tier  From {@link tierFor}.
 * @param {number|null} d10   The stored roll; a missing roll counts as 0 for the per-die part.
 * @returns {number}
 */
export function bonusGoldCp(tier, d10) {
  if ( !tier ) return 0;
  const die = Math.min(10, Math.max(0, Math.floor(Number(d10) || 0)));
  return (tier.baseGp + (die * tier.perD10Gp)) * 100;
}

/** The lowest and highest bonus gold a tier can roll, in gp. */
export function goldRange(tier) {
  if ( !tier ) return { min: 0, max: 0 };
  return { min: tier.baseGp + tier.perD10Gp, max: tier.baseGp + (10 * tier.perD10Gp) };
}

/* -------------------------------------------- */
/*  The allowance                               */
/* -------------------------------------------- */

/**
 * Tally picks by rarity.
 * @param {Record<string, {qty: number, rarity: string}>} picks
 * @returns {Record<string, number>}
 */
export function countPicks(picks) {
  const counts = emptyAllowance();
  for ( const pick of Object.values(picks ?? {}) ) {
    const qty = Math.max(0, Math.floor(Number(pick?.qty) || 0));
    const rarity = normalizeRarity(pick?.rarity);
    if ( qty && rarity ) counts[rarity] += qty;
  }
  return counts;
}

/**
 * Seat each pick in a slot. A slot holds its own rarity or anything lower, so picks are placed
 * rarest first, each into the lowest slot that can still hold it — which leaves the high slots
 * free for whatever still needs them, and so places everything whenever any placement could.
 * @param {Record<string, number>} counts     Picks per rarity.
 * @param {Record<string, number>} allowance  Slots per rarity.
 * @returns {{used: Record<string, number>, unplaced: number}}  Slots filled per slot rarity, and
 *   how many picks found no slot.
 */
export function assignSlots(counts, allowance) {
  const free = Object.fromEntries(RARITIES.map(r => [r, Math.max(0, Number(allowance?.[r]) || 0)]));
  const used = emptyAllowance();
  let unplaced = 0;
  for ( let i = RARITIES.length - 1; i >= 0; i-- ) {
    let need = Math.max(0, Number(counts?.[RARITIES[i]]) || 0);
    for ( let j = i; (j < RARITIES.length) && need; j++ ) {
      const take = Math.min(need, free[RARITIES[j]]);
      free[RARITIES[j]] -= take;
      used[RARITIES[j]] += take;
      need -= take;
    }
    unplaced += need;
  }
  return { used, unplaced };
}

/** Whether every pick fits the allowance. */
export function withinAllowance(counts, allowance) {
  return assignSlots(counts, allowance).unplaced === 0;
}

/** Whether one more item of `rarity` would still fit. */
export function canPick(counts, rarity, allowance) {
  if ( !RARITIES.includes(rarity) ) return false;
  return withinAllowance({ ...counts, [rarity]: (counts?.[rarity] ?? 0) + 1 }, allowance);
}

/** The rarest rarity a tier has any slot for, as a rank; -1 when it grants no items. */
export function highestSlotRank(allowance) {
  for ( let i = RARITIES.length - 1; i >= 0; i-- ) {
    if ( (allowance?.[RARITIES[i]] ?? 0) > 0 ) return i;
  }
  return -1;
}

/**
 * The slot chips for the aside: one per rarity the tier grants, with how many are filled.
 * @returns {{rarity: string, used: number, allowed: number, full: boolean}[]}
 */
export function slotsSummary(counts, allowance) {
  const { used } = assignSlots(counts, allowance);
  return RARITIES
    .filter(r => (allowance?.[r] ?? 0) > 0)
    .map(r => ({ rarity: r, used: used[r], allowed: allowance[r], full: used[r] >= allowance[r] }));
}

/* -------------------------------------------- */
/*  Inventory entries                           */
/* -------------------------------------------- */

/**
 * Guard one stored inventory entry. The shop can hold thousands, so only what the shelf needs to
 * sort, group and colour a row is kept — no art (the index has it) and no price (the items are free).
 * @param {object} raw
 * @returns {{uuid: string, name: string, type: string, subtype: string, rarity: string, hidden: boolean}}
 */
export function sanitizeMagicEntry(raw) {
  const src = (raw && typeof raw === "object") ? raw : {};
  return {
    uuid: typeof src.uuid === "string" ? src.uuid : "",
    name: typeof src.name === "string" ? src.name : "",
    type: typeof src.type === "string" ? src.type : "",
    subtype: typeof src.subtype === "string" ? src.subtype : "",
    rarity: normalizeRarity(src.rarity),
    hidden: !!src.hidden
  };
}

/**
 * An inventory entry from an item document or a compendium index entry.
 * @param {object} item  Anything carrying `name`, `type` and `system.rarity`/`system.type`.
 * @param {string} uuid
 */
export function magicEntryFromItem(item, uuid) {
  return sanitizeMagicEntry({
    uuid,
    name: item?.name,
    type: item?.type,
    subtype: item?.system?.type?.value ?? "",
    rarity: itemRarity(item),
    hidden: false
  });
}

/** Why an item can or can't be stocked: "ok", "contained", "notPhysical" or "mundane". */
export function stockability(item) {
  if ( item?.system?.container ) return "contained";
  if ( !PHYSICAL_TYPES.includes(item?.type) ) return "notPhysical";
  if ( !itemRarity(item) ) return "mundane";
  return "ok";
}

/**
 * The ids of a folder and every folder beneath it, however deep.
 *
 * Walks the parent links rather than `Folder#getSubfolders`, which only ever looks in the world's
 * folders and so finds nothing inside a compendium.
 * @param {string} rootId
 * @param {{id: string, parent: string|null}[]} folders  Every folder alongside it.
 * @returns {Set<string>}
 */
export function descendantFolderIds(rootId, folders) {
  const ids = new Set([rootId]);
  let grew = true;
  while ( grew ) {
    grew = false;
    for ( const { id, parent } of folders ) {
      if ( ids.has(id) || !ids.has(parent) ) continue;
      ids.add(id);
      grew = true;
    }
  }
  return ids;
}

/**
 * Sort the contents of a dropped folder or pack into what can be stocked and what can't.
 * @param {object[]} items  Index entries or documents, each with a `uuid`.
 * @param {(item: object) => boolean} [include]  Which items are in the dropped folder.
 * @returns {{entries: object[], mundane: number, other: number}}  `entries` are inventory entries
 *   for every magic item; `mundane` counts physical gear with no rarity, `other` non-physical items.
 *   Items inside a container are left out of every count — the container is the thing to stock.
 */
export function filterMagicIndex(items, include = () => true) {
  const out = { entries: [], mundane: 0, other: 0 };
  for ( const item of items ?? [] ) {
    if ( !item || !include(item) ) continue;
    const verdict = stockability(item);
    if ( verdict === "ok" ) out.entries.push(magicEntryFromItem(item, item.uuid));
    else if ( verdict === "mundane" ) out.mundane++;
    else if ( verdict === "notPhysical" ) out.other++;
  }
  out.entries.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The most entries the shop holds. Past this the setting and the shelf get unwieldy. */
export const MAX_INVENTORY = 6000;

/**
 * Merge incoming entries into an inventory, skipping duplicates and stopping at the cap.
 * @param {object[]} inventory
 * @param {object[]} incoming
 * @param {number} [cap]
 * @returns {{inventory: object[], added: object[], duplicates: number, overflow: number}}
 */
export function mergeEntries(inventory, incoming, cap = MAX_INVENTORY) {
  const seen = new Set(inventory.map(e => e.uuid));
  const merged = [...inventory];
  const added = [];
  let duplicates = 0;
  let overflow = 0;
  for ( const entry of incoming ) {
    if ( !entry?.uuid ) continue;
    if ( seen.has(entry.uuid) ) { duplicates++; continue; }
    if ( merged.length >= cap ) { overflow++; continue; }
    seen.add(entry.uuid);
    merged.push(entry);
    added.push(entry);
  }
  return { inventory: merged, added, duplicates, overflow };
}

/** Entries per rarity, for the GM window's header and the folder-drop confirmation. */
export function countByRarity(entries) {
  const counts = emptyAllowance();
  for ( const e of entries ?? [] ) if ( counts[e?.rarity] !== undefined ) counts[e.rarity]++;
  return counts;
}

/* -------------------------------------------- */
/*  Usability                                   */
/* -------------------------------------------- */

/**
 * Whether a character can make proper use of a shelf item, and why not.
 *
 * Two things stop a magic weapon or suit of armour being the prize it looks like: proficiency, which
 * a class or origin has to grant, and armour's Strength requirement, which plate and splint carry.
 * Neither prevents the pick — a player may want an item for a later level, or for someone else at the
 * table — so this only reports; the shelf shows it as a badge.
 *
 * The proficiency test mirrors the system's own (`EquipmentData#proficiencyMultiplier` and
 * `WeaponData#proficiencyMultiplier`): the item's category maps to a proficiency key, and the
 * character qualifies by holding that key *or* the specific base item ("longsword" for an Elf).
 * Anything that is not a weapon or armour needs no proficiency at all.
 * @param {{type: string, subtype: string, baseItem?: string, strength?: number|null}} entry
 * @param {{armorProf: Set<string>, weaponProf: Set<string>, strength: number}} character
 * @param {{armor: Record<string, string|boolean>, weapon: Record<string, string|boolean>}} maps
 *   The system's `armorProficienciesMap` / `weaponProficienciesMap`.
 * @returns {{proficient: boolean, needsStrength: number|null}}
 */
export function itemUsability(entry, character, maps = {}) {
  const out = { proficient: true, needsStrength: null };
  if ( !entry || !character ) return out;
  const subtype = entry.subtype ?? "";
  const baseItem = entry.baseItem ?? "";

  if ( entry.type === "weapon" ) {
    const key = maps.weapon?.[subtype];
    // "natural" maps to true: a creature's own attacks need no training. An unmapped category is
    // treated the same way rather than reported — the system only warns about what it knows.
    if ( key === undefined || key === true ) out.proficient = true;
    else out.proficient = character.weaponProf.has(key) || (!!baseItem && character.weaponProf.has(baseItem));
  } else if ( entry.type === "equipment" ) {
    const key = maps.armor?.[subtype];
    // Clothing and trinkets map to `true` — worn, not armour.
    if ( key === undefined || key === true ) out.proficient = true;
    else out.proficient = character.armorProf.has(key) || (!!baseItem && character.armorProf.has(baseItem));

    const needed = Number(entry.strength) || 0;
    if ( needed > 0 && (Number(character.strength) || 0) < needed ) out.needsStrength = needed;
  }
  return out;
}

/**
 * Who an item's attunement is limited to, read from its description: "Requires Attunement by a Bard",
 * "by a Sorcerer, Warlock, or Wizard", "by a Spellcaster". dnd5e has no structured field for this —
 * `system.attunement` only says whether attunement is required — so the prose is the only source.
 *
 * Enricher links are reduced to their label first, so "by a Dwarf or a Creature Attuned to a
 * @UUID[…]{Belt of Dwarvenkind}" reads as the words a player sees.
 * @param {string} html  The item's description.
 * @returns {{who: string, names: string[]}|null}  The phrase as written ("a Bard") and its names,
 *   lower-cased with the articles dropped (["bard"]); null when the item names no one.
 */
export function attunementRestriction(html) {
  if ( !html ) return null;
  const text = String(html)
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (_, label) => label ?? "")
    // A tag ends the phrase: the headline is often a paragraph of its own, and the text after it is not
    // part of who may attune.
    .replace(/<[^>]+>/g, "|")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  const match = text.match(/requires attunement by ([^).;:|]+)/i);
  if ( !match ) return null;
  const who = match[1].trim();
  const names = who.split(/,|\bor\b|\band\b/i)
    .map(s => s.trim().replace(/^(?:an?|the)\s+/i, "").toLowerCase())
    .filter(Boolean);
  return names.length ? { who, names } : null;
}

/**
 * Whether the character is one of the creatures an item's attunement is limited to — the attunement
 * counterpart of {@link itemUsability}, and like it a note, never a block.
 *
 * Only a limit this can fully judge is reported. Every name must be "spellcaster" or a class or species
 * the system knows; one it cannot place ("a Creature of the Weapon's Choice", "a Creature Attuned to a
 * Belt of Dwarvenkind", an alignment) makes the whole limit undecidable, and an item the character might
 * well qualify for is better left unmarked than wrongly marked.
 * @param {{who: string, names: string[]}|null} restriction  From {@link attunementRestriction}.
 * @param {{classes?: Set<string>, species?: Set<string>, spellcaster?: boolean}} character
 *   Class and species identifiers *and* lower-cased names the character holds.
 * @param {{classes?: Map<string, string>, species?: Map<string, string>}} known
 *   Every class and species the system knows, lower-cased name (and identifier) → identifier.
 * @returns {string|null}  The phrase to show ("a Bard") when the character is none of them, else null.
 */
export function unmetAttunement(restriction, character, known = {}) {
  if ( !restriction?.names?.length || !character ) return null;
  let met = false;
  for ( const name of restriction.names ) {
    if ( name === "spellcaster" ) {
      met ||= !!character.spellcaster;
      continue;
    }
    const cls = known.classes?.get(name);
    const species = known.species?.get(name);
    if ( !cls && !species ) return null;
    if ( cls && (character.classes?.has(cls) || character.classes?.has(name)) ) met = true;
    if ( species && (character.species?.has(species) || character.species?.has(name)) ) met = true;
  }
  return met ? null : restriction.who;
}
