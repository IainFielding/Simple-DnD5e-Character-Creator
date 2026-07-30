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
