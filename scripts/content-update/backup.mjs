import { MODULE_ID, log, t } from "../config.mjs";

/**
 * The backup taken before an update writes anything.
 *
 * A user who may create actors gets a **copy of the character** in a "Content update backups" folder,
 * with the original's ownership — restorable with no code of ours, visible, and deletable like any
 * actor. A user who may not (most players, unless the GM grants *Create Actor*) cannot be given one
 * without a socket to the GM, which this module does not have. They are warned on the review page and
 * offered a download of the character in Foundry's own export format (the file the sheet's
 * *Export Data* writes, restored with *Import Data*). The update stays locked until they either
 * download it or tick *Proceed without backup*.
 */

/** The folder backups go into. */
const FOLDER_FLAG = "contentUpdateBackups";

/**
 * Whether the current user can make the actor copy.
 * @returns {boolean}
 */
export function canCopyActor() {
  return !!game.user?.can?.("ACTOR_CREATE");
}

/** The backup folder, created on first use. */
async function backupFolder() {
  const existing = game.folders.find(f => (f.type === "Actor") && f.getFlag(MODULE_ID, FOLDER_FLAG));
  if ( existing ) return existing;
  if ( !game.user?.can?.("FOLDER_CREATE") && !game.user?.isGM ) return null;
  return foundry.documents.Folder.implementation.create({
    name: t("contentUpdate.backup.folder"), type: "Actor", color: "#555555",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } }
  });
}

/**
 * Copy the actor as a backup.
 * @param {Actor5e} actor
 * @returns {Promise<Actor5e|null>}   The copy, or null when it could not be made.
 */
export async function copyActor(actor) {
  if ( !canCopyActor() ) return null;
  try {
    const data = actor.toObject();
    delete data._id;
    data.name = t("contentUpdate.backup.name", { name: actor.name, date: new Date().toLocaleDateString() });
    let folder = null;
    try {
      folder = await backupFolder();
    } catch ( err ) {
      log("content update: backup folder could not be made", err);
    }
    data.folder = folder?.id ?? null;
    data.ownership = foundry.utils.deepClone(actor._source.ownership ?? {});
    // A player creating an actor is given ownership of it by Foundry; keep that.
    if ( !game.user.isGM ) data.ownership[game.user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    // The copy must not itself look like a character waiting to be updated or levelled.
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.backupOf`, actor.uuid);
    return await Actor.implementation.create(data, { keepEmbeddedIds: true });
  } catch ( err ) {
    log("content update: backup copy failed", err);
    return null;
  }
}

/**
 * Download the actor as Foundry's export JSON.
 * @param {Actor5e} actor
 * @returns {boolean}   Whether the download was started.
 */
export function downloadActor(actor) {
  try {
    if ( typeof actor.exportToJSON === "function" ) {
      actor.exportToJSON();
      return true;
    }
    const data = actor.toCompendium?.() ?? actor.toObject();
    const name = `fvtt-Actor-${actor.name.slugify?.() ?? "character"}-${actor.id}.json`;
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "text/json", name);
    return true;
  } catch ( err ) {
    log("content update: backup download failed", err);
    return false;
  }
}
