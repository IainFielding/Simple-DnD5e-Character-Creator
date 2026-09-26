import { log } from "../config.mjs";
import { artDirectoriesFor, artPathsFor, resolveOriginArt } from "./origin-art.mjs";

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
 * ## Players who may not browse
 *
 * `FilePicker.browse` needs the "Use File Browser" permission, which Foundry withholds from players
 * by default — so for most players every browse failed, read as "no art here", and every card fell
 * back to its icon. For a user without that permission each candidate file is checked on its own
 * instead: module assets are served to anyone, so no permission is involved. It costs a handful of
 * requests per card rather than one per directory, which is fine for the few cards that carry art
 * (the entry chooser's paths, the quick screen's three), and each answer is cached for the session
 * just as a listing is.
 *
 * ## Hosts that serve module files from somewhere else (The Forge)
 *
 * Two things differ on a host like The Forge, and neither can be seen from a local install:
 *
 *   - **A listing can come back empty for files that exist.** Premium content installed from the
 *     Bazaar is not in the plain `data` source a browse asks, so even a GM can get nothing back.
 *     When every directory a card's art could be in lists empty, that card is checked file by file
 *     rather than given up on. A real local install never lists a directory it has as empty, so there
 *     this costs nothing.
 *   - **The file may be redirected to a CDN on another domain.** A `fetch` that follows that redirect
 *     is subject to CORS and fails if the CDN doesn't allow it, which would read as "no file". So a
 *     candidate is checked by loading it as an image instead, which CORS does not govern and which
 *     follows redirects the way the page's own `<img>` will. The one that exists is then already in
 *     the browser's cache for the card that shows it.
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

/** file path -> Promise<boolean>: whether it exists, for users who can't browse. */
const probes = new Map();

/** Whether this user may list directories (the "Use File Browser" permission). */
function canBrowse() {
  return game.user?.isGM || !!game.user?.can?.("FILES_BROWSE");
}

/** How long an image probe may take before it counts as "not there". */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Whether one image exists, by loading it the way the card's `<img>` would. Routed through
 * `getRoute` so a world served under a route prefix is asked at the right address. See the note on
 * other hosts above for why this is an image load rather than a `HEAD` request.
 * @param {string} path  A Data-relative path, e.g. `modules/x/assets/art/wizard.webp`.
 * @returns {Promise<boolean>}
 */
function exists(path) {
  if ( probes.has(path) ) return probes.get(path);
  const url = foundry.utils.getRoute?.(path) ?? `/${path}`;
  const promise = new Promise(resolve => {
    const img = new Image();
    const done = ok => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
  probes.set(path, promise);
  return promise;
}

/**
 * One card's art without a directory listing: every candidate checked at once, and the first in
 * the plan's preference order that exists is the answer — the same answer a listing gives.
 * @returns {Promise<object|null>}
 */
async function probeArt(card, category) {
  const candidates = artPathsFor(card, category);
  const found = await Promise.all(candidates.map(c => exists(c.path)));
  return candidates[found.indexOf(true)] ?? null;
}

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

  if ( !canBrowse() ) {
    await Promise.all(wanted.map(async ({ card, category }) => {
      const art = await probeArt(card, category);
      if ( art ) out.set(card.uuid, art);
    }));
    return out;
  }

  const dirs = artDirectoriesFor(wanted);
  const sets = new Map();
  await Promise.all(dirs.map(async dir => sets.set(dir, await browse(dir))));

  const unlisted = [];
  for ( const { card, category } of wanted ) {
    const art = resolveOriginArt(card, category, dir => sets.get(dir) ?? null);
    if ( art ) { out.set(card.uuid, art); continue; }
    // Every directory this card could draw on listed empty: on a host that serves packages from
    // elsewhere that says nothing about whether the files exist, so ask about each one directly.
    const cardDirs = [...new Set(artPathsFor(card, category).map(c => c.dir))];
    if ( cardDirs.length && cardDirs.every(dir => !sets.get(dir)?.size) ) unlisted.push({ card, category });
  }
  await Promise.all(unlisted.map(async ({ card, category }) => {
    const art = await probeArt(card, category);
    if ( art ) out.set(card.uuid, art);
  }));
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
  probes.clear();
}
