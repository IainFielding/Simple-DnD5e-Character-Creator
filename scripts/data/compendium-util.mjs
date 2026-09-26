/**
 * Shared compendium helpers for the data layer. Kept tiny and dependency-free so the
 * spell and equipment loaders can share one definition of "which packs count".
 *
 * For a junior dev: a "compendium pack" is a Foundry content library (a bundle of Items,
 * Actors, etc.) shipped by a system or module — e.g. the dnd5e classes pack, or the PHB
 * module's spells pack. A GM can toggle sources on/off in dnd5e's settings, and these two
 * helpers answer "which packs are we allowed to read from?" so every loader agrees.
 */

/**
 * The set of pack collection ids the world's dnd5e source configuration leaves
 * enabled, or `null` when nothing is excluded (meaning: don't filter at all).
 * Mirrors how the Compendium Browser honours `packSourceConfiguration`.
 * @returns {Set<string>|null}
 */
export function getEnabledPacks() {
  try {
    const setting = game.settings.get("dnd5e", "packSourceConfiguration");
    if ( !setting || typeof setting !== "object" ) return null;
    if ( !Object.values(setting).some(v => v === false) ) return null;
    const sources = new Set();
    for ( const { collection, documentName } of game.packs ) {
      if ( documentName !== "Actor" && documentName !== "Item" ) continue;
      if ( setting[collection] !== false ) sources.add(collection);
    }
    return sources;
  } catch {
    return null;
  }
}

/**
 * Whether a pack should be scanned for dnd5e content: it must hold Items, belong to dnd5e (or
 * declare no system at all), and — when source filtering is active — be in the enabled set.
 *
 * The system guard applies in both cases. `packSourceConfiguration` only ever names packs the
 * GM has switched *off*, so a foreign system's pack is absent from it and therefore counts as
 * "enabled"; without this check an enabled set would let it through, which is exactly what the
 * "never trawl unrelated systems" rule exists to prevent.
 * @param {CompendiumCollection} pack
 * @param {Set<string>|null} enabled  Result of {@link getEnabledPacks}.
 */
export function isUsableItemPack(pack, enabled) {
  if ( pack.metadata.type !== "Item" ) return false;
  if ( pack.metadata.system && pack.metadata.system !== "dnd5e" ) return false;
  return enabled ? enabled.has(pack.collection) : true;
}

/**
 * What {@link packIndex} has fetched per pack: whether it has indexed at all, the extra fields it
 * has asked for, the fetch in flight, and fields waiting on that fetch to ask for next.
 * @type {WeakMap<CompendiumCollection, {index: any, fetched: Set<string>, queued: Set<string>, pending: Promise|null}>}
 */
let indexState = new WeakMap();

/**
 * The index fields every Item-pack read on the warm path asks for, requested together.
 *
 * Foundry's `getIndex` rebuilds whenever a request is not a subset of the *latest* request's
 * fields, and dnd5e's `CompendiumBrowser.fetch` calls it too, with whatever fields its caller
 * names. So as long as each reader asked for its own few fields, readers took turns knocking each
 * other's set out and every pack was re-indexed seven or eight times in one warm. With everyone —
 * {@link packIndex} and each `CompendiumBrowser.fetch` this module makes — asking for this one set,
 * the first read indexes a pack and every later one is a subset of it.
 *
 * Kept to small scalar fields: the magic shop's descriptions are asked for by the magic shop alone,
 * rather than being pulled for every item in every pack. `system.container` and `system.level` are
 * here because `CompendiumBrowser.fetch` adds them itself (its container filter, the spell-level
 * filter), and a set missing them would never be the superset. No field may sit under another here:
 * Foundry builds the projection with `setProperty`, and a parent plus a sub-path throws server-side.
 */
export const ITEM_INDEX_FIELDS = Object.freeze([
  "type", "system.identifier", "system.classIdentifier", "system.source", "system.container",
  "system.level", "system.school", "system.properties",
  "system.activation.type", "system.activation.value", "system.range.units", "system.range.value",
  "system.type.value", "system.type.baseItem", "system.type.subtype",
  "system.prerequisites.level", "system.prerequisites.items"
]);

/**
 * Drop any field whose parent is also present — the parent carries it, and asking for both throws.
 * @param {Iterable<string>} fields
 * @returns {string[]}
 */
export function collapseFields(fields) {
  const all = [...new Set(fields)];
  return all.filter(f => !all.some(g => (g !== f) && f.startsWith(`${g}.`)));
}

/** Whether `field` is in `fetched`, or sits under a field that is. */
function covered(field, fetched) {
  for ( let path = field; ; ) {
    if ( fetched.has(path) ) return true;
    const dot = path.lastIndexOf(".");
    if ( dot < 0 ) return false;
    path = path.slice(0, dot);
  }
}

/**
 * A pack's index carrying at least `fields` — `pack.getIndex` without the thrashing.
 *
 * Foundry's `getIndex` remembers only the field set of its *latest* request: asking for
 * `["system.level"]` and then `["system.identifier"]` makes the next `["system.level"]` go back to
 * the server, though the entries still hold it (fetched data is merged into them, never removed).
 * Nor does it share a fetch already in flight. With a dozen loaders each asking the same packs for
 * a different field set, concurrently, one creator open rebuilt the PHB spell index 162 times.
 *
 * So the fields fetched are remembered here, per pack, and a request they cover returns the index
 * without a round trip. A request that needs more asks in one call for everything fetched so far,
 * its own fields and, for an Item pack, {@link ITEM_INDEX_FIELDS}; requests arriving while it runs
 * wait for it and then fold their fields into the next one, so concurrent callers cost one fetch
 * each round rather than one each.
 * @param {CompendiumCollection} pack
 * @param {{fields?: string[]}} [options]
 * @returns {Promise<Collection>}  What `getIndex` returned — for a real pack, `pack.index` itself.
 */
export async function packIndex(pack, { fields = [] } = {}) {
  let state = indexState.get(pack);
  if ( !state ) indexState.set(pack, state = { index: null, fetched: new Set(), queued: new Set(), pending: null });
  for ( ;; ) {
    if ( state.index && fields.every(f => covered(f, state.fetched)) ) return state.index;
    if ( state.pending ) {
      for ( const f of fields ) state.queued.add(f);
      await state.pending.catch(() => {});
      continue;
    }
    const shared = (pack.documentName ?? pack.metadata?.type) === "Item" ? ITEM_INDEX_FIELDS : [];
    const union = collapseFields([...state.fetched, ...state.queued, ...fields, ...shared]);
    state.queued.clear();
    state.pending = pack.getIndex({ fields: union }).then(index => {
      state.index = index;
      for ( const f of union ) state.fetched.add(f);
    }).finally(() => { state.pending = null; });
    await state.pending;
  }
}

/** Forget what {@link packIndex} has fetched, so the next request goes back to the server. */
export function resetPackIndexes() {
  indexState = new WeakMap();
}
