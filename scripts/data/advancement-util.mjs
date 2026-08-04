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

/**
 * A compendium uuid in its modern form, inserting the `.Item.` segment older content omits.
 *
 * Pre-v10 packs store `Compendium.<scope>.<pack>.<id>`; everything since carries
 * `Compendium.<scope>.<pack>.Item.<id>`. Both are still in the wild — the 2014 SRD classes and
 * Tasha's replacement maps use the old shape — and the two forms compare unequal, so anything that
 * *matches* uuids has to agree on one. Normalising on read and on write is the only way to keep a
 * selection, the record of what was applied, and a click on a card all talking about the same item.
 * @param {string} uuid
 * @returns {string}
 */
export function withItemSegment(uuid) {
  const parts = String(uuid).split(".");
  if ( parts[3] === "Item" ) return uuid;
  parts.splice(3, 0, "Item");
  return parts.join(".");
}
