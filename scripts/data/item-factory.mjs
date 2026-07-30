import { log } from "../config.mjs";

/**
 * The one place a compendium UUID becomes ready-to-create item data.
 *
 * Both paths that put gear on a new character — the starting-equipment grant
 * ({@link module:data/equipment-source}) and the starting-gold store's cart
 * ({@link module:data/store-source}) — need the same four things: resolve the document, expand
 * any container into its contents, set a quantity, and equip what a character would wear or
 * wield on arrival. That sequence lived twice; it lives here once.
 *
 * For a junior dev: `createWithContents` is dnd5e's own helper for "this item, plus everything
 * inside it" — an Explorer's Pack resolves to the pack *and* its bedroll, rations, rope, and so
 * on. The linking between a container and its contents is by id, which is why the caller must
 * pass `{ keepId: true }` to `createEmbeddedDocuments` — without it Foundry re-ids the documents
 * on the way in and the contents fall out of their container.
 */

/** Item types a character carries equipped from the start; everything else goes to the pack. */
const EQUIPPED_TYPES = new Set(["weapon", "equipment"]);

/**
 * Resolve a UUID into item data ready for `createEmbeddedDocuments("Item", …, { keepId: true })`.
 * A missing document or a failed expansion is logged and yields an empty array, so one bad entry
 * degrades to "that item is absent" rather than failing the whole build.
 * @param {string} uuid                   Compendium (or world) UUID of the item.
 * @param {object} [options]
 * @param {number} [options.qty=1]        Quantity for the resolved item, when it carries one.
 * @param {boolean} [options.stampSource=false]  Record the compendium entry the item came from in
 *   `_stats.compendiumSource`, so the sheet can link back to it. Container contents are left
 *   alone — only the item actually addressed by `uuid` is stamped.
 * @param {string} [options.context="item"]  Noun used in the log line, for a readable failure.
 * @returns {Promise<object[]>}  The item and any contents it brought, or [] on failure.
 */
export async function createItemData(uuid, { qty = 1, stampSource = false, context = "item" } = {}) {
  if ( !uuid ) return [];
  try {
    const doc = await fromUuid(uuid);
    if ( !doc ) { log(`${context} not found: ${uuid}`); return []; }
    const result = await CONFIG.Item.documentClass.createWithContents([doc], { keepId: false });
    if ( !result?.length ) return [];

    // createWithContents returns the addressed item first, then whatever it contained.
    const [item] = result;
    if ( qty > 1 && item.system?.quantity !== undefined ) item.system.quantity = qty;
    if ( stampSource && item._stats && uuid.startsWith("Compendium.") ) item._stats.compendiumSource = uuid;
    for ( const entry of result ) {
      if ( EQUIPPED_TYPES.has(entry.type) && entry.system ) entry.system.equipped = true;
    }
    return result;
  } catch ( err ) {
    log(`${context} create failed: ${uuid}`, err);
    return [];
  }
}
