/**
 * Shared compendium helpers for the data layer. Kept tiny and dependency-free so the
 * spell and equipment loaders can share one definition of "which packs count".
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
 * Whether a pack should be scanned for dnd5e content: it must hold Items, and either
 * be in the enabled set (when source filtering is active) or belong to dnd5e (when
 * it isn't), so unrelated game systems are never trawled.
 * @param {CompendiumCollection} pack
 * @param {Set<string>|null} enabled  Result of {@link getEnabledPacks}.
 */
export function isUsableItemPack(pack, enabled) {
  if ( pack.metadata.type !== "Item" ) return false;
  if ( enabled ) return enabled.has(pack.collection);
  return !pack.metadata.system || pack.metadata.system === "dnd5e";
}
