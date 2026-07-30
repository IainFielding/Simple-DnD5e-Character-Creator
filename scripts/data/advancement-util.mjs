/**
 * Shape-tolerant readers for a dnd5e item's advancements.
 *
 * dnd5e hands advancements back in several shapes depending on how the document was obtained and
 * which system version produced it: a prepared document exposes an `advancement.byId` Collection
 * (Map-like) or plain object, while a `toObject()`d one carries only the raw `system.advancement`,
 * itself either an array or an id-keyed object. Every reader in the module wants a plain array, so
 * the flattening lives here once rather than being re-derived per caller.
 *
 * For a junior dev: this is the single seam a dnd5e version bump is most likely to break, which is
 * exactly why it is one function with its own unit tests rather than an inline expression repeated
 * across the data modules.
 */

/**
 * A document's advancements as a flat array, tolerating every shape dnd5e may hand back. The
 * prepared `doc.advancement.byId` is preferred because it is always populated; the raw
 * `system.advancement` is the fallback for plain object data.
 * @param {object} doc
 * @returns {object[]}
 */
export function advancementArray(doc) {
  const byId = doc.advancement?.byId;
  if ( byId ) return typeof byId.values === "function" ? [...byId.values()] : Object.values(byId);
  const raw = doc.system?.advancement;
  if ( !raw ) return [];
  if ( Array.isArray(raw) ) return raw;
  if ( typeof raw.values === "function" ) return [...raw.values()];
  return Object.values(raw);
}
