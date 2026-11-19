import { MODULE_ID, log } from "../config.mjs";
import { STAMP_FLAG, sourceStamp } from "./fingerprint.mjs";
import { packageVersion, sourceUuidOf } from "./scan.mjs";

/**
 * Stamp every compendium-made item as it lands on a character: which package and version it came
 * from, and a hash of each part of its definition as it arrived (see
 * {@link module:content-update/fingerprint.sourceStamp}).
 *
 * The stamp is what lets a later update tell a player's edit from a content change. Without it, an
 * item that differs from the new version might have been edited or might simply be old, and the
 * review page can only flag it and default to updating.
 *
 * Every creation path is covered, not only ours — the native wizard, a drag from the sidebar, another
 * module's import — because the question "has this been edited since it arrived?" matters whichever
 * way it arrived. The stamp is a flag in our own scope and changes nothing else about the item.
 *
 * Only the user creating the item stamps it (`preCreate` runs on that client), and an item that
 * already carries a stamp keeps it: a ready-made character imported whole, or an item copied from one
 * character to another, still describes the source it was originally made from.
 */
export function registerSourceStamp() {
  Hooks.on("preCreateItem", (item, data) => {
    try {
      const actor = item.parent;
      if ( (actor?.documentName !== "Actor") || (actor.type !== "character") ) return;
      if ( item.getFlag?.(MODULE_ID, STAMP_FLAG) ?? data?.flags?.[MODULE_ID]?.[STAMP_FLAG] ) return;
      const itemData = item.toObject();
      const uuid = sourceUuidOf(itemData);
      if ( !uuid ) return;
      item.updateSource({
        [`flags.${MODULE_ID}.${STAMP_FLAG}`]: sourceStamp(itemData, { uuid, version: packageVersion(uuid) })
      });
    } catch ( err ) {
      // A failed stamp costs only precision on a later update; it must never stop an item being created.
      log("could not stamp an item's source", err);
    }
  });
}
