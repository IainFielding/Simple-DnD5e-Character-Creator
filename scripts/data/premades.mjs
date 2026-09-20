import { log } from "../config.mjs";
import { slugify } from "./origin-art.mjs";

/**
 * Ready-made characters: the third way into the creator.
 *
 * Two sources, shown as two groups, because they are two different kinds of thing:
 *
 * 1. **Foundry's own pregenerated characters.** The dnd5e system ships twelve finished level 1
 *    characters in `dnd5e.actors24` — one per 2024 class, each with its species, background,
 *    spells, equipment and features already built. They are complete Actors, so taking one is an
 *    *import*, not a build: the character already exists and is correct, and re-deriving it through
 *    our own engine could only make it worse. This is the group offered first.
 * 2. **Configurations we define.** {@link PREMADES} below: a class, a species and a background by
 *    identifier plus optional picks, replayed through the same `applyQuickBuild` a hand-built
 *    character uses. Nothing is redistributed — just identifiers naming content the world owns.
 *
 * The pack also holds the same twelve at levels 5, 11 and 17. Only level 1 is offered here: this is
 * a character *creator*, and a table starting above first level has decisions about equipment and
 * magic items that a pregen cannot make for them.
 */

/** The dnd5e system pack holding the official pregenerated characters. */
export const PREGEN_PACK = "dnd5e.actors24";

/**
 * Placeholder actor art, which is not a portrait and must not be shown as one.
 *
 * A character document with no image of its own resolves to a generic silhouette rather than to
 * nothing, so "has an image" is not the same question as "has a portrait". These are the two that
 * turn up on a dnd5e character, and hitting either means falling through to the class illustration
 * instead.
 */
const PLACEHOLDER_ART = new Set([
  "systems/dnd5e/icons/svg/actors/character.svg",
  "icons/svg/mystery-man.svg"
]);

/**
 * The portrait to show for a pregenerated character.
 *
 * Its own, wherever it has one: the system paints each of these twelve
 * (`systems/dnd5e/tokens/heroes/ClericDragonborn.webp` and friends), and a picture of the actual
 * character beats anything we could infer about them. The class illustration is the fallback for a
 * document that has only a placeholder — which is what a generic silhouette is, however much it
 * looks like an image to `if ( doc.img )`.
 * @param {Actor} doc
 * @param {Item|undefined} cls   The character's class item.
 * @returns {string}
 */
export function portraitFor(doc, cls) {
  const own = doc?.img;
  if ( own && !PLACEHOLDER_ART.has(own) ) return own;
  return cls?.img || "icons/svg/mystery-man.svg";
}

/**
 * How a level is spelled inside a pregen's `_id` — `AkraLv0100000000`, `AkraLv0500000000`.
 *
 * Matching on the id rather than on `system.details.level` is deliberate: the id is in the pack
 * index, so the list can be built without loading twelve Actor documents, and it is stable in a way
 * a computed level is not (a pregen's level is the sum of its class items, which the index cannot
 * see). If a future pack breaks the convention this yields an empty list, which degrades to "no
 * ready-made characters" rather than to a wrong one.
 */
const LEVEL_1 = "Lv01";

/** Resolved pregens, memoised — twelve Actor documents is not a load to repeat on every render. */
let pregenCache = null;

/**
 * Foundry's own level 1 pregenerated characters, newest-system-first.
 *
 * Each entry carries what the card needs and the uuid to import from, including the character's
 * own portrait — see {@link portraitFor}.
 *
 * @returns {Promise<Array<{id: string, uuid: string, name: string, line: string, img: string,
 *   className: string, speciesName: string, backgroundName: string, official: true}>>}
 */
export async function foundryPregens() {
  if ( pregenCache ) return pregenCache;
  const pack = game.packs?.get(PREGEN_PACK);
  if ( !pack ) return (pregenCache = []);

  try {
    const index = await pack.getIndex();
    const wanted = [...index].filter(e => String(e._id).includes(LEVEL_1));
    const docs = await Promise.all(wanted.map(e => pack.getDocument(e._id).catch(() => null)));

    pregenCache = docs.filter(Boolean).map(doc => {
      const of = type => doc.items.find(i => i.type === type);
      const cls = of("class");
      const race = of("race");
      const background = of("background");
      const parts = [race?.name, cls?.name].filter(Boolean).join(" ");
      return {
        id: doc.id,
        uuid: doc.uuid,
        name: doc.name,
        className: cls?.name ?? "",
        speciesName: race?.name ?? "",
        backgroundName: background?.name ?? "",
        line: background?.name ? `${parts} 1 · ${background.name}` : `${parts} 1`,
        img: portraitFor(doc, cls),
        official: true
      };
    }).sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang ?? "en"));
  } catch ( err ) {
    log("could not read the official pregenerated characters", err);
    pregenCache = [];
  }
  return pregenCache;
}

/** Drop the memo, so the next read re-queries. Called when the enabled packs may have changed. */
export function invalidatePregenCache() {
  pregenCache = null;
}

/**
 * Import one of Foundry's pregenerated characters into the world as a new actor.
 *
 * A straight import, on purpose. The document is already a finished, correct character; running it
 * back through our own build engine could only introduce differences, and there is nothing for that
 * engine to decide that the pregen has not already decided.
 *
 * @param {string} uuid  The compendium actor's uuid.
 * @returns {Promise<Actor|null>}
 */
export async function importPregen(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return null;
  const data = doc.toObject();
  delete data._id;
  // The player who built it should be able to play it. A GM doing this for someone else can
  // reassign ownership afterwards; leaving it GM-only would mean the character they just made is
  // one they cannot open.
  data.ownership = { ...(data.ownership ?? {}), [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  return Actor.implementation.create(data, { renderSheet: false });
}

/**
 * Configurations we define — the second group, and empty until there is a roster worth shipping.
 *
 * Only `id`, `name`, `class`, `species` and `background` are required. Every other field overrides
 * that class's Quick Build profile ({@link module:data/quick-build-data}), so a premade wanting the
 * recommended build for its class simply omits them. Identifiers match case-insensitively against
 * `system.identifier`, falling back to the document name, so "Half-Elf" and "half-elf" both work.
 * `needs` lists module ids from each module's own `module.json`.
 *
 * @typedef {object} Premade
 * @property {string} id              Stable key, used for the art seed and as a list key.
 * @property {string} name            The character's name. Ours, not anyone else's.
 * @property {string} tagline         One line on who they are. Kept short; the card is small.
 * @property {string} class           Class identifier, e.g. "fighter".
 * @property {string} species         Species identifier, e.g. "dwarf".
 * @property {string} background      Background identifier, e.g. "soldier".
 * @property {string[]} [needs]       Module ids this premade's content lives in.
 * @property {string[]} [abilities]   Ability priority, highest first.
 * @property {string[]} [skills]      Skill codes in preference order.
 * @property {string[]} [masteries]   Weapon base-item ids.
 * @property {string[]} [tools]       Tool base-item ids.
 * @property {string[]} [cantrips]    Spell names.
 * @property {string[]} [spells]      Spell names.
 * @property {string[]} [features]    Feature/feat names for ItemChoice picks.
 *
 * @type {Premade[]}
 */
export const PREMADES = [];

/** The profile fields a premade may state. Anything else about the build is the class profile's. */
const PROFILE_FIELDS = ["abilities", "skills", "expertise", "masteries", "tools",
                        "cantrips", "spells", "features"];

/**
 * The profile fields this premade overrides — just the overrides, not a whole profile.
 *
 * `applyQuickBuild` merges these over whichever profile it resolves for the class, so a premade
 * that names only its three origins inherits the entire recommended build, and one for a class with
 * no `QUICK_BUILD` entry still gets the generic profile underneath rather than a hole where
 * `abilities` should be. Empty arrays are dropped rather than passed through, so `skills: []`
 * cannot silently blank the class's suggestions.
 * @param {Premade} premade
 * @returns {object}
 */
export function profileFor(premade) {
  const out = {};
  for ( const key of PROFILE_FIELDS ) {
    if ( Array.isArray(premade?.[key]) && premade[key].length ) out[key] = [...premade[key]];
  }
  return out;
}

/**
 * Find the card matching an identifier in a list, by identifier first and display name second.
 *
 * The name fallback matters more than it looks: a fair amount of content ships without a
 * `system.identifier` (every Ravenloft lineage, for one), so an identifier-only match would make
 * those species unreachable from a premade.
 * @param {object[]} cards
 * @param {string} identifier
 * @returns {object|null}
 */
export function findCard(cards, identifier) {
  const key = slugify(identifier);
  if ( !key ) return null;
  return (cards ?? []).find(c => slugify(c.identifier) === key)
    ?? (cards ?? []).find(c => slugify(c.name) === key)
    ?? null;
}

/**
 * The configured premades this world can actually build, each resolved to the cards it names.
 *
 * Two gates, and a premade must pass both. The `needs` check is cheap and catches the common case
 * (a book that isn't installed). The card lookup is the one that actually matters: a module can be
 * active with its packs disabled, or the world's compendium-source filtering can have excluded
 * them, and in either case the identifier resolves to nothing. Only checking `needs` would offer a
 * character that then failed to build, which is precisely the outcome this function exists to
 * prevent.
 *
 * @param {import("./source-index.mjs").SourceIndex} source
 * @param {Premade[]} [list]  Overridable for tests.
 * @returns {Array<{premade: Premade, class: object, species: object, background: object}>}
 */
export function availablePremades(source, list = PREMADES) {
  const classes = source?.classes?.() ?? [];
  const species = source?.species?.() ?? [];
  const backgrounds = source?.backgrounds?.() ?? [];

  const out = [];
  for ( const premade of list ) {
    const missing = (premade.needs ?? []).filter(id => !game.modules.get(id)?.active);
    if ( missing.length ) continue;

    const cls = findCard(classes, premade.class);
    const spc = findCard(species, premade.species);
    const bg = findCard(backgrounds, premade.background);
    if ( !cls || !spc || !bg ) continue;

    out.push({ premade, class: cls, species: spc, background: bg });
  }
  return out;
}
