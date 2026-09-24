/**
 * Banner art for a class, species or background — resolved out of the content modules the GM has
 * already bought and installed.
 *
 * We ship no artwork and redistribute none. Every path this module returns points at a file inside
 * someone else's installed package, which Foundry serves to that GM's own players, exactly as
 * `CreatorShell#applySourceArt` already does for the two PHB sketches behind the empty states. That
 * is the whole licensing position: **reference paths, ship nothing**. Every premium package is
 * `"protected": true`, carries a signature, and grants no reuse; core Foundry's own `icons/LICENSE`
 * says its art "may not be redistributed or used outside of Foundry Virtual Tabletop". So the one
 * art layer that is ours to bundle is the frame — the gradient and sigil a card falls back to — and
 * that is the only one in this repo.
 *
 * ## Why there is a table here instead of a formula
 *
 * There is no link field from a compendium item to the journal page that illustrates it, so the
 * only join available is the filename, and the filenames are irregular in a way that has to be
 * measured rather than guessed. Measured against the installed Player's Handbook module
 * (201 journal-art files, 234 subjects) on 2026-09-20:
 *
 *   - **Classes** are clean: `journal-art/<identifier>.webp`, all twelve. A bled scene.
 *   - **Backgrounds** split. All sixteen exist, but seven carry an `-origin` suffix
 *     (`acolyte-origin`, `artisan-origin`, `charlatan-origin`, `criminal-origin`,
 *     `entertainer-origin`, `farmer-origin`, `guard-origin`) and nine do not (`guide`, `hermit`,
 *     `merchant`, `noble`, `sage`, `sailor`, `scribe`, `soldier`, `wayfarer`). Trying the suffix
 *     then the bare id resolves 16/16.
 *   - **Species** have proper art, but under names no rule produces — `dwarves-working.webp`,
 *     `elves-socializing.webp`. Those are the 2225x1440 scenes the book uses to depict each people,
 *     and they are listed in {@link NAMED_ART}. The earlier reading of this directory was wrong:
 *     it concluded there was no species art because none of it is named after the species alone.
 *     `subjects/<identifier>-01.webp` remains the fallback for anything unlisted, but those are
 *     512px alpha cutouts — a figure with no ground — so they float on a large card rather than
 *     filling it. Scene-specific art (`dwarf-paladin-uses-divine-smite.webp`) is still never used:
 *     it illustrates a moment, not a people.
 *
 * Hence: **never construct a path and hope.** Every lookup is matched against a real directory
 * listing before it is returned, and an unmatched identifier returns `null` so the caller can drop
 * a tier. Originate's `phb-image-mapping.js` does the same alias mapping without that check, which
 * is why a renamed asset breaks its cards and would not break ours.
 *
 * ## Why the module is read off the item
 *
 * Third-party books follow the same convention inside their own directory — Forge of the Artificer
 * ships `dnd-forge-artificer/assets/journal-art/artificer.webp` — so the directory is derived from
 * the item's own package rather than hard-coded to the PHB. That is not speculative generality: the
 * thirteenth class needs it on day one.
 *
 * Pure by design. No Foundry globals are touched here; the caller passes in the directory listings
 * it has already browsed and cached, which is what makes the whole thing unit-testable.
 */

/**
 * Where each category's art lives, relative to a package's root, and how a filename is built.
 *
 * `subdirs` are searched in order and `candidates` are tried in order within each, so the preferred
 * directory wins even on a later candidate. Both lists are measured, not guessed:
 *
 * **Two directory conventions are in the wild.** The Player's Handbook and Heroes of the Forgotten
 * Realms use `assets/journal-art/`; the newer books — Arcana Unleashed, Ravenloft: Horrors Within,
 * Deadfall — use `assets/art/`. Neither is going away, so both are searched. Species keep
 * `assets/subjects/` first, because that is where the portrait-orientation paintings live, and only
 * fall through to the scene directories after.
 *
 * **Backgrounds carry a suffix, and which suffix depends on the book.** The PHB splits between
 * `acolyte-origin.webp` and `soldier.webp`; Arcana Unleashed uses a third form,
 * `phantasmic-circus-trouper-background.webp`. All three are tried before giving up, which is the
 * difference between that background showing its painting and showing a small icon.
 *
 * **Some species art is pluralised.** Ravenloft ships `subjects/reborns-01.webp` and
 * `art/hexbloods.webp` for lineages whose identifiers are singular, so the plural forms are tried
 * after the singular ones.
 *
 * Every one of these is an exact filename match against a real listing — never a prefix or fuzzy
 * search. A prefix search would hand a species the scene that merely mentions it
 * (`dwarf-paladin-uses-divine-smite.webp`), which is the failure the whole module is shaped around.
 */
const CATEGORY_ART = {
  class: {
    subdirs: ["assets/journal-art", "assets/art"],
    candidates: id => [`${id}.webp`]
  },
  background: {
    subdirs: ["assets/journal-art", "assets/art"],
    candidates: id => [`${id}-origin.webp`, `${id}-background.webp`, `${id}.webp`]
  },
  species: {
    subdirs: ["assets/subjects", "assets/art", "assets/journal-art"],
    candidates: id => [`${id}-01.webp`, `${id}.webp`, `${id}s-01.webp`, `${id}s.webp`]
  }
};

/**
 * Art that has a proper name rather than a derivable one, per package and category.
 *
 * **Species are the reason this exists.** The generic rule sends them to `assets/subjects/`, but
 * those are 512px alpha cutouts — a figure with no ground, which floats on a card rather than
 * filling it. The Player's Handbook illustrates each species properly elsewhere, as a 2225x1440
 * scene of those people: `dwarves-working.webp`, `elves-socializing.webp`, `orcs-riding.webp`.
 * Those are the images the book uses to say "this is what a dwarf is", and they are what belongs
 * on a card the size of ours.
 *
 * They cannot be derived. The names are plural, verbed, and inconsistent about both
 * ("gnomes-working-on-armor" beside "aasimar-working"), so there is no rule that produces them —
 * which is exactly the case an alias table is for. Each entry was checked against the installed
 * module; anything not listed falls through to the generic candidates below, so a species from a
 * third-party book still gets its subject art and nothing regresses.
 */
const NAMED_ART = {
  "dnd-players-handbook": {
    species: {
      subdir: "assets/journal-art",
      files: {
        aasimar: "aasimar-working.webp",
        dragonborn: "dragonborn-meeting.webp",
        dwarf: "dwarves-working.webp",
        elf: "elves-socializing.webp",
        gnome: "gnomes-working-on-armor.webp",
        goliath: "goliaths-transporting-stone.webp",
        halfling: "halflings-dining.webp",
        human: "humans-celebrate.webp",
        orc: "orcs-riding.webp",
        tiefling: "tieflings-playing-cards.webp"
      }
    }
  }
};

/**
 * Fold a display name or identifier into the slug the art files are named with: lowercase, curly
 * and straight apostrophes dropped, every other run of non-alphanumerics collapsed to one hyphen.
 *
 * Deliberately the same shape as `name-generator.mjs`'s own slugify, and for the same reason: a
 * fair amount of content ships without a `system.identifier`, so the name has to be usable as a
 * fallback key.
 * @param {string} [value]
 * @returns {string}
 */
export function slugify(value) {
  return String(value ?? "").trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The package a compendium document belongs to, read off its UUID.
 *
 * A compendium uuid is `Compendium.<package>.<pack>.<DocType>.<id>`, so the package id is the
 * second segment. Anything that is not a compendium uuid — a world item, an empty string — returns
 * null, and the caller falls through to the next art tier.
 * @param {string} [uuid]
 * @returns {string|null}
 */
export function packageOf(uuid) {
  const parts = String(uuid ?? "").split(".");
  if ( parts[0] !== "Compendium" || parts.length < 3 ) return null;
  return parts[1] || null;
}

/**
 * The directories a category's art could live in for one package, in search order. Empty for an
 * unknown category. Returned as Foundry-servable paths (`modules/<id>/assets/...`), which is both
 * what an `<img src>` wants and what `FilePicker.browse` expects.
 * @param {"class"|"species"|"background"} category
 * @param {string} packageId
 * @returns {string[]}
 */
export function artDirectories(category, packageId) {
  const spec = CATEGORY_ART[category];
  if ( !spec || !packageId ) return [];
  const named = NAMED_ART[packageId]?.[category]?.subdir;
  const subdirs = named && !spec.subdirs.includes(named) ? [named, ...spec.subdirs] : spec.subdirs;
  return subdirs.map(sub => `modules/${packageId}/${sub}`);
}

/**
 * The filenames worth trying for one identifier, in priority order. Exported for the tests, which
 * assert the ordering directly — it is the part most likely to be "tidied" into a single guess by
 * someone who has not read the note at the top of this file.
 * @param {"class"|"species"|"background"} category
 * @param {string} identifier   Already slugified.
 * @returns {string[]}
 */
export function artCandidates(category, identifier) {
  const spec = CATEGORY_ART[category];
  if ( !spec || !identifier ) return [];
  return spec.candidates(identifier);
}

/**
 * Every `{dir, file}` worth trying for one card, in order.
 *
 * Named art comes first — where a book illustrates something properly, that beats whatever the
 * generic rule would have found — then the per-directory candidates. Exported so the tests can
 * assert the ordering, which is the part that decides whether a dwarf gets a painting of dwarves
 * or a cutout of one.
 * @param {"class"|"species"|"background"} category
 * @param {string} packageId
 * @param {string[]} keys   Slugified identifier, then name, already deduplicated.
 * @returns {Array<{dir: string, file: string}>}
 */
export function artPlan(category, packageId, keys) {
  const spec = CATEGORY_ART[category];
  if ( !spec || !packageId ) return [];
  const plan = [];

  const named = NAMED_ART[packageId]?.[category];
  if ( named ) {
    for ( const key of keys ) {
      const file = named.files[key];
      if ( file ) plan.push({ dir: `modules/${packageId}/${named.subdir}`, file });
    }
  }
  for ( const sub of spec.subdirs ) {
    const dir = `modules/${packageId}/${sub}`;
    for ( const key of keys ) {
      for ( const file of spec.candidates(key) ) plan.push({ dir, file });
    }
  }
  return plan;
}

/**
 * Resolve one card's banner art against directory listings the caller has already fetched.
 *
 * @param {object} card                     A source-index card: `{uuid, name, identifier}`.
 * @param {"class"|"species"|"background"} category
 * @param {(dir: string) => Set<string>|null} listingFor
 *   Returns the set of filenames in a directory, or null when that directory has not been browsed
 *   (or does not exist). Never called more than once per directory by this function.
 * @returns {{path: string, dir: string, file: string, packageId: string}|null}
 *   `null` when nothing matched, which is the signal to fall back to the icon tier.
 */
export function resolveOriginArt(card, category, listingFor) {
  // Listings are memoised per directory by the caller, so asking repeatedly across the plan costs
  // nothing. A directory that does not exist in this package, and one that exists but is empty,
  // both mean "not here" and both move on rather than throwing.
  for ( const candidate of artPathsFor(card, category) ) {
    const listing = listingFor(candidate.dir);
    if ( !listing || !listing.size ) continue;
    if ( listing.has(candidate.file) ) return candidate;
  }
  return null;
}

/**
 * Every file that could be this card's art, most preferred first — the same plan
 * {@link resolveOriginArt} walks, as full paths.
 *
 * For a user who may not browse directories (see art-cache.mjs): with no listing to check against,
 * each candidate is tested on its own, and the first that exists wins, exactly as it would have
 * against a listing.
 * @param {object} card                     A source-index card: `{uuid, name, identifier}`.
 * @param {"class"|"species"|"background"} category
 * @returns {{path: string, dir: string, file: string, packageId: string}[]}
 */
export function artPathsFor(card, category) {
  if ( !card ) return [];
  const packageId = packageOf(card.uuid);
  if ( !packageId ) return [];
  // The identifier is the primary key; the name is a fallback for content that ships without one.
  const keys = [slugify(card.identifier), slugify(card.name)].filter((v, i, a) => v && a.indexOf(v) === i);
  return artPlan(category, packageId, keys).map(({ dir, file }) => ({ path: `${dir}/${file}`, dir, file, packageId }));
}

/**
 * Every directory this set of cards could need art from — what the caller browses, once, before
 * resolving. Deduplicated, so a world with twelve PHB classes browses one directory rather than
 * twelve times.
 * @param {Array<{card: object, category: string}>} requests
 * @returns {string[]}
 */
export function artDirectoriesFor(requests) {
  const dirs = new Set();
  for ( const { card, category } of requests ?? [] ) {
    const packageId = packageOf(card?.uuid);
    if ( !packageId ) continue;
    for ( const dir of artDirectories(category, packageId) ) dirs.add(dir);
  }
  return [...dirs];
}
