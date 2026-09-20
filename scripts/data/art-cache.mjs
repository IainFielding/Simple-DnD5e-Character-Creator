import { log } from "../config.mjs";
import { artDirectoriesFor, resolveOriginArt } from "./origin-art.mjs";

/**
 * The Foundry half of the art lookup: browse each art directory once, remember what was in it, and
 * hand the filename sets to the pure resolver in {@link module:data/origin-art}.
 *
 * Split from that module on purpose. Everything here touches a Foundry global (`FilePicker`,
 * `game`), and everything there is a decision about filenames; keeping the decisions on the pure
 * side is what lets 25 unit tests cover the naming irregularities without a browser.
 *
 * ## Why browse at all
 *
 * Because the alternative is constructing a path and hoping. There is no field linking a compendium
 * item to the journal page that illustrates it, so the filename is the only join, and the filenames
 * are irregular (see the note atop `origin-art.mjs`). A `<img src>` pointing at a file that isn't
 * there is a broken image on the first screen a new player sees, and a browse costs one request per
 * directory per session — three, in a typical Player's Handbook world.
 *
 * ## Lifetime
 *
 * Module-level, and deliberately not per-window: a player who opens the creator, closes it and
 * opens it again should not re-browse. {@link invalidateArtCache} exists for the case where the set
 * of installed modules can have changed under us, and is wired to the same signal that invalidates
 * the source cache.
 */

/** directory path -> Promise<Set<string>> of the filenames in it. */
const listings = new Map();

/**
 * Browse one directory and remember its contents. A directory that does not exist — a class module
 * with no `subjects/` — resolves to an empty set rather than rejecting, because "this package has
 * no species art" is an ordinary answer, not a failure.
 * @param {string} dir
 * @returns {Promise<Set<string>>}
 */
function browse(dir) {
  if ( listings.has(dir) ) return listings.get(dir);
  // FilePicker moved namespace across Foundry versions; the details step resolves it the same way.
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  const promise = (async () => {
    try {
      const result = await Picker.browse("data", dir);
      // `files` are full paths; we match on basenames.
      return new Set((result?.files ?? []).map(f => f.split("/").pop()));
    } catch {
      // Almost always "directory does not exist", which is not worth a console warning on every
      // world that lacks a premium module. Logged at debug level only.
      log(`no art directory at ${dir}`);
      return new Set();
    }
  })();
  listings.set(dir, promise);
  return promise;
}

/**
 * Resolve banner art for a batch of cards, browsing each directory they need exactly once.
 *
 * Batched rather than per-card because the three origin cards in a Player's Handbook world touch
 * two directories between them, and doing it one card at a time would serialise three awaits behind
 * each other for no reason.
 *
 * @param {Array<{card: object, category: "class"|"species"|"background"}>} requests
 * @returns {Promise<Map<string, {path: string, packageId: string}>>}
 *   Keyed by card uuid. A card with no match is simply absent from the map, which is the caller's
 *   signal to fall back to the item's own icon.
 */
export async function resolveArtFor(requests) {
  const out = new Map();
  const wanted = (requests ?? []).filter(r => r?.card?.uuid);
  if ( !wanted.length ) return out;

  const dirs = artDirectoriesFor(wanted);
  const sets = new Map();
  await Promise.all(dirs.map(async dir => sets.set(dir, await browse(dir))));

  for ( const { card, category } of wanted ) {
    const art = resolveOriginArt(card, category, dir => sets.get(dir) ?? null);
    if ( art ) out.set(card.uuid, art);
  }
  return out;
}

/**
 * Whether any art at all was found for a package — used for the credit line, which should name the
 * books actually on screen rather than every book installed.
 * @param {Map<string, {packageId: string}>} art
 * @returns {string[]}  Package titles, deduplicated, in the order they were first used.
 */
export function creditFor(art) {
  const seen = new Set();
  const titles = [];
  for ( const { packageId } of art.values() ) {
    if ( seen.has(packageId) ) continue;
    seen.add(packageId);
    const title = game.modules.get(packageId)?.title;
    if ( title ) titles.push(title);
  }
  return titles;
}

/** Drop everything, so the next lookup re-browses. Called when the installed content may have changed. */
export function invalidateArtCache() {
  listings.clear();
}
