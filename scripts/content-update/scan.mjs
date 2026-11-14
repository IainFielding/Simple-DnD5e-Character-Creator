import { MODULE_ID, log } from "../config.mjs";
import { getEnabledPacks, packIndex } from "../data/compendium-util.mjs";
import { advancementChanged, changedGroups, editedGroups, packageOfUuid, readStamp } from "./fingerprint.mjs";
import { uuidTail } from "./answers.mjs";

/**
 * SCAN: which items on a character have a newer or different source, and what to do about each.
 *
 * Every compendium-made item says where it came from (`_stats.compendiumSource`, or the older
 * `flags.dnd5e.sourceId`). That uuid is resolved with `fromUuid`, which follows the redirects content
 * modules register for documents they moved (`CONFIG.compendium.uuidRedirects`). When the document is
 * gone, the same pack is searched for an item of the same type and identifier, then name; and then the
 * packs the GM's source settings enable — never across rules editions (a 2014 item is never "updated"
 * to its 2024 namesake).
 *
 * The direct source is used even when the GM has since hidden its pack: dnd5e 6.1 hides every legacy
 * pack in a modern world, and a 2014 character must still be able to update from its own content.
 *
 * Each item lands in one tier:
 *  - `same`     — the definition matches the source; nothing to do.
 *  - `refresh`  — the definition changed but its advancement configuration did not: updated in place.
 *  - `rebuild`  — its advancement configuration changed: the character's advancements are rebuilt
 *                 with the decisions already made.
 *  - `report`   — no source, or the source cannot be found: listed, never touched.
 */

/** Item types whose items form the character's advancement skeleton. */
export const ROOT_TYPES = ["class", "subclass", "race", "background"];

/** The uuid an item was made from, or null. */
export function sourceUuidOf(itemData) {
  const uuid = itemData?._stats?.compendiumSource ?? itemData?.flags?.dnd5e?.sourceId ?? null;
  return (typeof uuid === "string") && uuid.startsWith("Compendium.") ? uuid : null;
}

/** The pack collection id of a compendium uuid (`Compendium.<pkg>.<pack>.…` → `<pkg>.<pack>`). */
export function packOfUuid(uuid) {
  const parts = String(uuid ?? "").split(".");
  return (parts[0] === "Compendium") && parts[2] ? `${parts[1]}.${parts[2]}` : null;
}

/** The version of the package a uuid's pack belongs to. */
export function packageVersion(uuid) {
  const pkg = packageOfUuid(uuid);
  if ( !pkg ) return null;
  if ( pkg === game.system?.id ) return game.system.version ?? null;
  return game.modules?.get(pkg)?.version ?? null;
}

/** The rules edition an item declares, or null. */
function rulesOf(data) {
  return data?.system?.source?.rules || null;
}

/** Whether two items may be the same thing across an update: the same type and, when both say, the same edition. */
function compatible(itemData, doc) {
  if ( !doc || (doc.type !== itemData.type) ) return false;
  const a = rulesOf(itemData);
  const b = rulesOf(doc);
  return !(a && b && (a !== b));
}

/**
 * Find the current version of an item's source.
 * @param {object} itemData                  The character's copy (plain).
 * @param {object} [options]
 * @param {Map<string, object>} [options.cache]   Shared across one scan.
 * @returns {Promise<{doc: Item5e|null, uuid: string|null, how: string}>}
 *   `how` is "direct", "redirect", "identifier", "name", "noSource" or "missing".
 */
export async function resolveSource(itemData, { cache = new Map() } = {}) {
  const uuid = sourceUuidOf(itemData);
  if ( !uuid ) return { doc: null, uuid: null, how: "noSource" };
  const key = `${itemData.type}|${uuid}|${itemData.system?.identifier ?? ""}|${itemData.name}`;
  if ( cache.has(key) ) return cache.get(key);

  let result = { doc: null, uuid, how: "missing" };
  try {
    const doc = await fromUuid(uuid);
    if ( doc && compatible(itemData, doc) ) {
      result = { doc, uuid: doc.uuid, how: (uuidTail(doc.uuid) === uuidTail(uuid)) ? "direct" : "redirect" };
    }
  } catch ( err ) {
    log("content update: source lookup failed", uuid, err);
  }

  if ( !result.doc ) {
    const found = await findByIdentity(itemData, packOfUuid(uuid));
    if ( found ) result = found;
  }
  cache.set(key, result);
  return result;
}

/**
 * Search for an item of the same type and identifier (then name): in its own pack first, then in every
 * Item pack the GM's source settings enable.
 * @param {object} itemData
 * @param {string|null} homePack
 * @returns {Promise<{doc: Item5e, uuid: string, how: string}|null>}
 */
export async function findByIdentity(itemData, homePack) {
  const enabled = getEnabledPacks();
  const packs = [];
  const home = homePack ? game.packs.get(homePack) : null;
  if ( home ) packs.push(home);
  for ( const pack of game.packs ) {
    if ( (pack === home) || (pack.documentName !== "Item") ) continue;
    if ( enabled && !enabled.has(pack.collection) ) continue;
    packs.push(pack);
  }

  const identifier = itemData.system?.identifier ?? null;
  const name = String(itemData.name ?? "").toLowerCase();
  for ( const tier of ["identifier", "name"] ) {
    if ( (tier === "identifier") && !identifier ) continue;
    for ( const pack of packs ) {
      let index;
      try {
        // Through the shared index, never `getIndex` directly: Foundry merges a pack's earlier index
        // fields into a new request, the module's shared set already holds `system.source`, and the
        // server throws on a field asked for beside its parent ("Cannot use 'in' operator to search
        // for 'rules'") — once per pack, as red notifications, every time the scan looked by identity.
        index = await packIndex(pack, { fields: ["system.identifier", "system.source.rules"] });
      } catch {
        continue;
      }
      for ( const entry of index ) {
        if ( entry.type !== itemData.type ) continue;
        const hit = (tier === "identifier")
          ? (entry.system?.identifier === identifier)
          : (String(entry.name ?? "").toLowerCase() === name);
        if ( !hit || !compatible(itemData, entry) ) continue;
        const doc = await pack.getDocument(entry._id).catch(() => null);
        if ( doc ) return { doc, uuid: doc.uuid, how: tier };
      }
    }
  }
  return null;
}

/**
 * @typedef {object} ScanEntry
 * @property {Item5e} item          The character's item.
 * @property {string} tier          "same" | "refresh" | "rebuild" | "report".
 * @property {string} how           How the source was found (see {@link resolveSource}).
 * @property {Item5e|null} source   The current source document.
 * @property {string|null} sourceUuid
 * @property {string[]} changed     Definition groups that differ from the source.
 * @property {string[]|null} edited Groups the stamp proves the player edited; null when unknown.
 * @property {boolean} customised   Whether the review page should ask *Update anyway* / *Keep mine*.
 * @property {boolean} keepDefault  The pre-ticked answer: true = keep mine.
 * @property {string|null} fromVersion   Package version the stamp recorded.
 * @property {string|null} toVersion     Package version now installed.
 */

/** Groups a refresh always keeps from the player's copy, whatever they answer. */
export const ALWAYS_KEPT = ["name", "img"];

/**
 * Scan one character.
 * @param {Actor5e} actor
 * @returns {Promise<{entries: ScanEntry[], needsRebuild: boolean, counts: Record<string, number>}>}
 */
export async function scanActor(actor) {
  const cache = new Map();
  const entries = [];
  for ( const item of actor.items ) {
    const data = item.toObject();
    // A spell dnd5e keeps as a cache of another item's Cast activity is dnd5e's to maintain.
    if ( data.flags?.dnd5e?.cachedFor ) {
      entries.push({ item, how: "cached", source: null, sourceUuid: null, changed: [], edited: null,
        customised: false, keepDefault: false, fromVersion: null, toVersion: null, tier: "same" });
      continue;
    }
    const { doc, uuid, how } = await resolveSource(data, { cache });
    const stamp = readStamp(data, MODULE_ID);
    const base = {
      item, how, source: doc, sourceUuid: uuid, changed: [], edited: null, customised: false, keepDefault: false,
      fromVersion: stamp?.version ?? null, toVersion: uuid ? packageVersion(uuid) : null
    };
    if ( !doc ) { entries.push({ ...base, tier: "report" }); continue; }

    const sourceData = doc.toObject();
    const changed = changedGroups(data, sourceData);
    // Nothing to update if the only differences are ones a refresh keeps anyway. Otherwise an icon
    // swapped at runtime (an art module re-skinning the pack) is offered as an update forever.
    if ( !changed.some(g => !ALWAYS_KEPT.includes(g)) ) { entries.push({ ...base, changed, tier: "same" }); continue; }

    const edited = editedGroups(data, stamp);
    // What the update would overwrite beyond the name and icon, which are always kept. With a stamp,
    // only a group the player provably edited counts; without one, any difference might be an edit.
    const overwritten = changed.filter(g => !ALWAYS_KEPT.includes(g));
    const customisedGroups = edited ? overwritten.filter(g => edited.includes(g)) : overwritten;
    entries.push({
      ...base,
      tier: advancementChanged(data, sourceData) ? "rebuild" : "refresh",
      changed, edited,
      // A pre-stamp character can't tell an edit from an update, so it is flagged but pre-ticked to
      // update (the backup covers a mistake); a stamp that proves an edit pre-ticks "Keep mine".
      customised: customisedGroups.length > 0,
      keepDefault: !!edited && (customisedGroups.length > 0)
    });
  }

  const counts = { same: 0, refresh: 0, rebuild: 0, report: 0 };
  for ( const e of entries ) counts[e.tier] += 1;
  return { entries, needsRebuild: counts.rebuild > 0, counts };
}

/**
 * Whether anything on a character would change. Cheap enough for a menu's visibility check once
 * the scan is cached (see {@link cachedScan}).
 * @param {{counts: Record<string, number>}} scan
 */
export function hasUpdates(scan) {
  return !!scan && ((scan.counts.refresh + scan.counts.rebuild) > 0);
}

/** Per-actor scan results, invalidated whenever the actor or one of its items changes. */
const scans = new Map();

/**
 * The scan for an actor, reusing a recent result. Menus ask synchronously, so the first call returns
 * null and starts the scan in the background; `onReady` runs when it lands.
 * @param {Actor5e} actor
 * @param {() => void} [onReady]
 * @returns {object|null}
 */
export function cachedScan(actor, onReady) {
  const hit = scans.get(actor.uuid);
  if ( hit?.result ) return hit.result;
  if ( !hit ) {
    const entry = { result: null };
    scans.set(actor.uuid, entry);
    scanActor(actor).then(result => {
      entry.result = result;
      onReady?.();
    }).catch(err => {
      log("content update: scan failed", err);
      scans.delete(actor.uuid);
    });
  }
  return null;
}

/** Forget a cached scan. */
export function invalidateScan(actor) {
  if ( actor?.uuid ) scans.delete(actor.uuid);
}
