import { DEFAULT_CANTRIPS, DEFAULT_LEVEL1_SPELLS, log } from "../config.mjs";
import { getEnabledPacks, isUsableItemPack } from "./compendium-util.mjs";
import { forEachLimit, WARM_CONCURRENCY } from "./concurrency.mjs";

/** Index fields fetched for spells, so cards can show components/range without the full doc. */
const SPELL_INDEX_FIELDS = new Set([
  "system.level", "system.school", "system.identifier", "system.properties",
  "system.activation.type", "system.activation.value", "system.range.units", "system.range.value"
]);

/**
 * Resolves the cantrips and level-1 spells a spellcasting class can learn at level 1,
 * and how many of each it knows. One instance per builder session; results are
 * memoised per class UUID so re-entering the Spells step is cheap.
 *
 * This is the spell counterpart of {@link SourceIndex}: it reads dnd5e's spell-list
 * registry (with pack-scan fallbacks) and presents lightweight spell cards. It never
 * touches state or the DOM.
 */
export class SpellSource {

  /** classUuid -> resolved spell payload, memoised. */
  #byClass = new Map();

  /** spell uuid -> enriched description html, memoised (loaded on focus). */
  #descriptions = new Map();

  /**
   * Spell options for a class, or a non-caster marker. Memoised per class UUID.
   * @param {string} classUuid
   * @returns {Promise<{isSpellcaster:boolean, cantrips?:object[], level1?:object[],
   *   maxCantrips?:number, maxSpells?:number, classId?:string}>}
   */
  async forClass(classUuid) {
    if ( !classUuid ) return { isSpellcaster: false };
    if ( this.#byClass.has(classUuid) ) return this.#byClass.get(classUuid);

    const payload = await this.#resolve(classUuid);
    this.#byClass.set(classUuid, payload);
    return payload;
  }

  /**
   * Pre-resolve the spell payload for each class up front, so reaching the Spells step
   * (and the class step's known-counts gate) is instant rather than loading the whole
   * spell list on the click that selects a class. Memoised per UUID via {@link forClass};
   * a single class's failure is swallowed so it can't abort the rest of the warm-up.
   * @param {string[]} classUuids
   * @param {() => void} [onTick]  Invoked once per class warmed, for progress reporting.
   */
  async warmClasses(classUuids, onTick) {
    await forEachLimit(classUuids, WARM_CONCURRENCY, async uuid => {
      try {
        await this.forClass(uuid);
      } catch ( err ) {
        log(`failed to warm spells for ${uuid}`, err);
      }
      onTick?.();
    });
  }

  async #resolve(classUuid) {
    const doc = await fromUuid(classUuid);
    const progression = doc?.system?.spellcasting?.progression;
    if ( !doc || !progression || progression === "none" ) return { isSpellcaster: false };

    const classId = doc.system?.identifier ?? doc.name?.toLowerCase() ?? "";
    const maxCantrips = scaleCount(doc, classId, "cantrip", DEFAULT_CANTRIPS);
    const maxSpells = scaleCount(doc, classId, "spell", DEFAULT_LEVEL1_SPELLS);

    const all = deduplicateSpells(await loadSpellsForClass(classId));
    const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
    const cantrips = all.filter(s => s.level === 0).sort(byName);
    const level1 = all.filter(s => s.level === 1).sort(byName);

    log(`spells for "${classId}": ${cantrips.length} cantrips, ${level1.length} lvl-1 ` +
      `(know ${maxCantrips}/${maxSpells})`);
    return { isSpellcaster: true, cantrips, level1, maxCantrips, maxSpells, classId };
  }

  /** Enriched description html for the focused spell, memoised. */
  async description(uuid) {
    if ( !uuid ) return "";
    if ( this.#descriptions.has(uuid) ) return this.#descriptions.get(uuid);
    const doc = await fromUuid(uuid);
    const raw = doc?.system?.description?.value ?? "";
    const html = raw
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, { relativeTo: doc, secrets: false })
      : "";
    this.#descriptions.set(uuid, html);
    return html;
  }
}

/* -------------------------------------------- */
/*  Spell-count resolution                      */
/* -------------------------------------------- */

/**
 * The level-1 value of a class's cantrips-known / spells-known ScaleValue advancement,
 * falling back to the supplied table when the class carries no such scale. `kind` is
 * "cantrip" (matches titles containing "cantrip") or "spell" (a spells-known scale
 * that is neither a cantrip nor a slot scale).
 */
function scaleCount(doc, classId, kind, fallback) {
  for ( const adv of advancementEntries(doc) ) {
    if ( (adv.type ?? adv.constructor?.typeName) !== "ScaleValue" ) continue;
    const title = (adv.title ?? adv.configuration?.identifier ?? "").toLowerCase();
    const isCantrip = title.includes("cantrip");
    // Match the scale to the count we want: a "cantrip" scale for cantrips; for spells, a
    // "spells known" scale that is neither the cantrip scale nor a spell-*slot* scale.
    if ( kind === "cantrip" && !isCantrip ) continue;
    if ( kind === "spell" && (isCantrip || !title.includes("spell") || title.includes("slot")) ) continue;
    const scale = adv.configuration?.scale ?? {};
    const val = scale[1] ?? scale["1"];
    if ( val !== undefined ) return Number(val.value ?? val) || 0;
  }
  return fallback[classId] ?? 0;
}

/* -------------------------------------------- */
/*  Spell-list loading                          */
/* -------------------------------------------- */

/**
 * Cantrips and level-1 spells available to a class identifier. Prefers dnd5e's
 * SpellListRegistry, then a legacy spell-list pack scan, then a direct per-spell
 * class-tag scan — whichever first yields the class's spell UUIDs.
 *
 * Note we collect UUIDs from the registry rather than its synchronous `indexes`:
 * those are built via `fromUuidSync` and silently drop spells whose pack index
 * isn't resolvable yet, and they only carry `system.level` for packs that index
 * it — so the level filter would intermittently discard real spells depending on
 * which pack a spell happens to live in. {@link fetchSpellsByUuids} resolves the
 * level reliably instead.
 */
async function loadSpellsForClass(classId) {
  const uuids = new Set();

  try {
    const registry = dnd5e.registry?.spellLists;
    const list = registry?.forType?.("class", classId);
    if ( list ) for ( const uuid of list.uuids ?? [] ) uuids.add(uuid);
  } catch ( err ) {
    log("spell list registry lookup failed", err);
  }

  if ( !uuids.size ) await scanSpellListPacks(classId, uuids);
  if ( uuids.size ) return fetchSpellsByUuids(uuids);

  return scanSpellsByClassTag(classId);
}

/** Legacy fallback: collect spell UUIDs from any `spellList` item matching the class. */
async function scanSpellListPacks(classId, uuids) {
  const enabled = getEnabledPacks();
  for ( const pack of game.packs ) {
    if ( !isUsableItemPack(pack, enabled) ) continue;
    try {
      const index = await pack.getIndex({ fields: ["type", "system.identifier"] });
      for ( const entry of index ) {
        if ( entry.type !== "spellList" || (entry.system?.identifier ?? "") !== classId ) continue;
        const doc = await pack.getDocument(entry._id);
        collectSpellUuids(doc, uuids);
      }
    } catch ( err ) {
      log(`spell-list pack scan failed for ${pack.collection}`, err);
    }
  }
}

/** Pull spell UUIDs out of a spellList document's `system.spells` collection. */
function collectSpellUuids(doc, uuids) {
  const raw = doc?.system?.spells ?? [];
  const list = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : Object.values(raw ?? {});
  for ( const entry of list ) {
    const uuid = typeof entry === "string" ? entry : entry?.uuid;
    if ( uuid ) uuids.add(uuid);
  }
}

/**
 * Resolve the class's spell UUIDs into level-≤1 spell cards. The Compendium Browser
 * supplies reliable `system.level` for every browsable pack in one bulk query; any
 * UUID it doesn't return (pack not browsable, index not loaded) is reconciled with a
 * direct `fromUuid` so the list is complete rather than all-or-nothing.
 */
async function fetchSpellsByUuids(uuids) {
  const found = new Map();
  const browser = dnd5e.applications?.CompendiumBrowser;
  if ( browser?.fetch ) {
    try {
      const all = await browser.fetch(Item, {
        types: new Set(["spell"]),
        filters: [{ k: "system.level", o: "lte", v: 1 }],
        indexFields: SPELL_INDEX_FIELDS
      });
      for ( const e of all ) {
        if ( e.uuid && uuids.has(e.uuid) ) found.set(e.uuid, buildSpellFromEntry(e));
      }
    } catch ( err ) {
      log("Compendium Browser spell fetch failed, using direct lookups", err);
    }
  }
  for ( const uuid of uuids ) {
    if ( found.has(uuid) ) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if ( doc?.type === "spell" && (doc.system?.level ?? 99) <= 1 ) found.set(uuid, buildSpellFromEntry(doc));
  }
  return [...found.values()];
}

/** Last-resort scan: every level-≤1 spell tagged with the class identifier. */
async function scanSpellsByClassTag(classId) {
  const enabled = getEnabledPacks();
  const out = [];
  const seen = new Set();
  for ( const pack of game.packs ) {
    if ( !isUsableItemPack(pack, enabled) ) continue;
    try {
      const index = await pack.getIndex({ fields: ["type", "system.level"] });
      for ( const entry of index ) {
        if ( entry.type !== "spell" || (entry.system?.level ?? 99) > 1 || seen.has(entry._id) ) continue;
        seen.add(entry._id);
        const doc = await pack.getDocument(entry._id);
        if ( !doc ) continue;
        const raw = doc.system?.source?.class ?? doc.system?.classes ?? [];
        const classes = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw
          : typeof raw === "string" ? [raw] : Object.keys(raw ?? {});
        if ( classes.some(c => (c?.identifier ?? c) === classId) ) out.push(buildSpellFromEntry(doc));
      }
    } catch ( err ) {
      log(`direct spell scan failed for ${pack.collection}`, err);
    }
  }
  return out;
}

/**
 * Drop duplicate spells (the same spell appearing in several packs), preferring the 2024
 * Player's Handbook then the system 2024 pack so a world with both shows one entry.
 *
 * Keyed on the spell's name — its true cross-pack identity. Spells carry no
 * `system.identifier`, and spell-list index entries can omit or share `_id`, so the old
 * id-based key silently collapsed (or skipped) genuinely distinct spells, leaving a class
 * like Cleric showing only one. Two spells never legitimately share a name, so name-keying
 * removes real duplicates without dropping anything.
 */
function deduplicateSpells(spells) {
  const PRIORITY = ["Compendium.dnd-players-handbook.spells.", "Compendium.dnd5e.spells24."];
  const rank = uuid => {
    const idx = PRIORITY.findIndex(p => (uuid ?? "").startsWith(p));
    return idx >= 0 ? idx : PRIORITY.length;
  };
  const byKey = new Map();
  for ( const spell of spells ) {
    const key = (spell.name || spell.uuid || "").toLowerCase();
    if ( !key ) continue;
    const existing = byKey.get(key);
    if ( !existing || rank(spell.uuid) < rank(existing.uuid) ) byKey.set(key, spell);
  }
  return [...byKey.values()];
}

/** A lightweight spell card from an index entry or full document; description loads on focus. */
function buildSpellFromEntry(entry) {
  const level = entry.system?.level ?? 0;
  const schoolKey = entry.system?.school ?? "";
  const props = entry.system?.properties;
  const hasProp = p => props instanceof Set ? props.has(p) : Array.isArray(props) ? props.includes(p) : false;
  return {
    // `||` (not `??`) so an empty identifier falls through to a usable unique id.
    id: entry.system?.identifier || entry._id || entry.id || entry.uuid,
    uuid: entry.uuid,
    name: entry.name,
    img: entry.img || "icons/svg/daze.svg",
    level,
    school: CONFIG.DND5E?.spellSchools?.[schoolKey]?.label ?? schoolKey,
    components: [hasProp("vocal") && "V", hasProp("somatic") && "S", hasProp("material") && "M"]
      .filter(Boolean).join(", "),
    isConcentration: hasProp("concentration"),
    isRitual: hasProp("ritual")
  };
}

/** A document's advancements as a flat array, tolerating dnd5e's various shapes. */
function advancementEntries(doc) {
  const byId = doc.advancement?.byId;
  if ( byId ) return typeof byId.values === "function" ? [...byId.values()] : Object.values(byId);
  const raw = doc.system?.advancement;
  if ( !raw ) return [];
  if ( Array.isArray(raw) ) return raw;
  if ( typeof raw.values === "function" ) return [...raw.values()];
  return Object.values(raw);
}
