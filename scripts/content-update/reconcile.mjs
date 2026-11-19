import { itemIdentity, uuidTail } from "./answers.mjs";

/**
 * Give rebuilt items back the ids their predecessors had.
 *
 * A rebuild re-grants a class's features through dnd5e's own advancements, and those create every
 * item under a fresh random id. Left alone that would break everything on the character that points
 * at an item by id: favourites, the ammunition a weapon draws on, what sits in which container, the
 * `originalClass`/`race`/`background` links, effects whose origin is `Actor.x.Item.y`, and other
 * items' `advancementOrigin`. It would also turn every rebuilt feature into a delete plus a create,
 * so "uses spent" and toggled effects would reset.
 *
 * So once the rebuild has finished on the clone, each new item is paired with the old item it
 * replaces (by compendium document id, then identifier, then name — always within one type; and a
 * species or background, of which an actor holds one, with the one it replaces whatever it is called) and the
 * new id is swapped for the old one *throughout* the actor data. Item ids are 16 random characters,
 * so a plain textual replacement cannot hit anything else.
 *
 * Pure functions over plain data.
 */

/** Item types an actor holds one of. */
const SINGLE_TYPES = ["race", "background"];

/**
 * The keys an item can be paired on, strongest first, one per tier (null where it has none): a tier
 * must mean the same key for every item, or an item without a source uuid would offer its identifier
 * as a source match.
 * The last tier pairs a species or background with its predecessor outright: PHB 3.0.0 folded
 * "Gnome, Rock" into a Gnome with a lineage, and the two share no id, identifier or name.
 */
function pairingKeys(itemData) {
  const id = itemIdentity(itemData);
  return [
    id.uuid ? `src:${id.type}:${uuidTail(id.uuid)}` : null,
    id.identifier ? `ident:${id.type}:${id.identifier}` : null,
    id.name ? `name:${id.type}:${id.name.toLowerCase()}` : null,
    SINGLE_TYPES.includes(id.type) ? `single:${id.type}` : null
  ];
}

/**
 * Pair new items with the old items they replace, one to one.
 * @param {object[]} oldItems   Items the rebuild removed (plain data).
 * @param {object[]} newItems   Items the rebuild created (plain data).
 * @returns {Map<string, string>}   new id → old id.
 */
export function pairItems(oldItems, newItems) {
  const pairs = new Map();
  const taken = new Set();
  // Strongest key tier first across *all* items, so a weak name match never steals an item a
  // stronger key would have claimed.
  for ( let tier = 0; tier < 4; tier++ ) {
    const index = new Map();
    for ( const o of oldItems ) {
      if ( taken.has(o._id) ) continue;
      const key = pairingKeys(o)[tier];
      if ( !key ) continue;
      if ( !index.has(key) ) index.set(key, []);
      index.get(key).push(o);
    }
    for ( const n of newItems ) {
      if ( pairs.has(n._id) ) continue;
      const key = pairingKeys(n)[tier];
      const list = key ? index.get(key) : null;
      const match = list?.find(o => !taken.has(o._id));
      if ( !match ) continue;
      pairs.set(n._id, match._id);
      taken.add(match._id);
    }
  }
  return pairs;
}

/**
 * Swap ids throughout a data tree.
 * @param {object} data                 Actor data (plain); not modified.
 * @param {Map<string,string>} idMap    from → to.
 * @returns {object}   A rewritten copy.
 */
export function remapIds(data, idMap) {
  if ( !idMap.size ) return data;
  let text = JSON.stringify(data);
  for ( const [from, to] of idMap ) {
    if ( !from || (from === to) ) continue;
    text = text.split(from).join(to);
  }
  return JSON.parse(text);
}
