import { log, t } from "../config.mjs";
import { slugify } from "./origin-art.mjs";
import { isPlaceholderName } from "../state/creator-state.mjs";
import { getEnabledPacks } from "./compendium-util.mjs";

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

/**
 * Packs that hold ready-made player characters, in the order they are offered.
 *
 * `idHint` is an optimisation, not the rule. The rule is "a character document whose class levels
 * total one", which is the only test that stays right when a pack changes shape — but applying it
 * means loading documents, and `dnd5e.actors24` holds 471 of them across four levels. Matching the
 * id first cuts that to twelve. A pack with no hint is filtered on `type` from the index instead,
 * which is cheap, and only the characters are loaded.
 */
export const PREGEN_SOURCES = [
  { pack: "dnd5e.actors24", idHint: "Lv01" },
  // `describe: false` because these characters' biographies are not biographies. Every one of the
  // twelve carries the same ~1,900 characters of the book's own character-creation walkthrough —
  // "Step 1: Choose a Class", then a table of classes and their primary abilities — which is
  // useful on the sheet and meaningless on a card. There is nothing to trim it down to, so the
  // card shows no description rather than a sentence of someone else's instructions.
  { pack: "dnd-players-handbook.actors", describe: false },
  { pack: "dnd-heroes-borderlands.actors" }
];

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

/** Resolved pregens, memoised — these Actor documents are not a load to repeat on every render. */
let pregenCache = null;

/** A character's level: the sum of its class items, which is the only place the truth lives. */
function levelOf(doc) {
  return doc.items.reduce((sum, i) => sum + (i.type === "class" ? (i.system?.levels ?? 0) : 0), 0);
}

/**
 * A short, plain-text description from a character's biography.
 *
 * The biography is enriched HTML — paragraphs, links, sometimes an embedded image — and a card has
 * room for a sentence. Tags are stripped rather than rendered, both because the card is a button
 * (so nested interactive markup would be invalid) and because a half-rendered link is worse than
 * no description. Entities are decoded via the DOM rather than by hand, so `&amp;` and friends read
 * as themselves. A pack with no biographies — Heroes of the Borderlands has none — simply gets no
 * descriptions, which is why the card treats it as optional.
 * @param {Actor} doc
 * @param {number} [limit]
 * @returns {string}
 */
export function describePregen(doc, limit = 130) {
  const html = doc?.system?.details?.biography?.value ?? "";
  if ( !html ) return "";

  let text = "";
  // The DOM is the right way to do this — it handles every entity and every malformed tag — but it
  // is not always there. This runs under Node in the unit tests, and a `document` reference that
  // throws would take the whole pack down with it (the caller catches, so the failure would show
  // as "this book has no ready-made characters", which is a hard bug to trace back to here).
  try {
    const el = document.createElement("div");
    el.innerHTML = html;
    text = el.textContent ?? "";
  } catch {
    text = html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&(?:quot|#34);/g, '"')
      .replace(/&(?:apos|#39);/g, "'");
  }

  text = text.replace(/\s+/g, " ").trim();
  if ( text.length <= limit ) return text;
  // Cut at a word boundary, so the ellipsis never lands mid-word.
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

/**
 * The label for a group of pregens: the book they came from.
 *
 * Read off the package rather than listed here, so adding a pack above needs no new translation
 * string and a module's own title is always what the player sees.
 * @param {string} pack   e.g. "dnd-heroes-borderlands.actors"
 * @returns {{label: string, badge: string|null}}
 */
function groupFor(pack) {
  const packageId = pack.split(".")[0];
  if ( packageId === "dnd5e" ) {
    return { label: t("entry.premade.fromFoundry"), badge: "icons/vtt-512.png" };
  }
  return { label: game.modules?.get(packageId)?.title ?? packageId, badge: null };
}

/**
 * Every level 1 ready-made character this world has, grouped by the book that ships it.
 *
 * Each entry carries what the card needs and the uuid to import from, including the character's
 * own portrait ({@link portraitFor}) and a sentence of their biography ({@link describePregen}).
 * A pack that is not installed contributes nothing and is not mentioned.
 *
 * @returns {Promise<Array<{label: string, badge: string|null, pack: string, entries: object[]}>>}
 */
export async function foundryPregens() {
  if ( pregenCache ) return pregenCache;
  const groups = [];
  for ( const source of PREGEN_SOURCES ) {
    const entries = await readPregenPack(source);
    if ( entries.length ) groups.push({ ...groupFor(source.pack), pack: source.pack, entries });
  }
  return (pregenCache = groups);
}

/**
 * The level 1 characters in one pack, or an empty list if it is absent or unreadable.
 * @param {{pack: string, idHint?: string, describe?: boolean}} source
 * @returns {Promise<object[]>}
 */
async function readPregenPack({ pack: packId, idHint, describe = true }) {
  const pack = game.packs?.get(packId);
  if ( !pack ) return [];
  // A pack the GM has switched off in dnd5e's source configuration is not offered, as it isn't on
  // any other shelf — installed is not the same as wanted.
  const enabled = getEnabledPacks();
  if ( enabled && !enabled.has(packId) ) return [];
  try {
    const index = await pack.getIndex();
    const wanted = [...index].filter(e => {
      if ( idHint && !String(e._id).includes(idHint) ) return false;
      // `type` is in every index; filtering on it here is what keeps a 166-actor pack of monsters
      // from being loaded in full to find twelve characters.
      return !e.type || e.type === "character";
    });
    const docs = await Promise.all(wanted.map(e => pack.getDocument(e._id).catch(() => null)));

    return docs
      .filter(doc => doc && doc.type === "character" && levelOf(doc) === 1)
      // Described inside the map, which is inside the try below — but note what the try is for:
      // a pack that cannot be read at all. A single malformed document must not empty the list,
      // which is why `describePregen` swallows its own failures rather than throwing here.
      .map(doc => {
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
          line: parts ? (background?.name ? `${parts} 1 · ${background.name}` : `${parts} 1`) : "",
          tagline: describe ? describePregen(doc) : "",
          img: portraitFor(doc, cls),
          official: true
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang ?? "en"));
  } catch ( err ) {
    log(`could not read ready-made characters from ${packId}`, err);
    return [];
  }
}

/** Drop the memo, so the next read re-queries. Called when the enabled packs may have changed. */
export function invalidatePregenCache() {
  pregenCache = null;
}

/**
 * Import one of Foundry's pregenerated characters into the world as a new actor — or, given `into`,
 * onto a blank character the GM prepared (see {@link module:app/blank-build}).
 *
 * A straight import, on purpose. The document is already a finished, correct character; running it
 * back through our own build engine could only introduce differences, and there is nothing for that
 * engine to decide that the pregen has not already decided.
 *
 * @param {string} uuid  The compendium actor's uuid.
 * @param {object} [options]
 * @param {Actor|null} [options.into]  A blank character to fill instead of creating a new one. The
 *   player building into a GM's sheet may lack permission to create actors at all.
 * @returns {Promise<Actor|null>}
 */
export async function importPregen(uuid, { into = null } = {}) {
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return null;
  const data = doc.toObject();
  if ( into ) return importPregenInto(into, data);
  delete data._id;
  // The player who built it should be able to play it. A GM doing this for someone else can
  // reassign ownership afterwards; leaving it GM-only would mean the character they just made is
  // one they cannot open.
  data.ownership = { ...(data.ownership ?? {}), [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  return Actor.implementation.create(data, { renderSheet: false });
}

/**
 * Fill a blank character with a pregen's contents: its system data, portrait, token art, items and
 * effects. The sheet itself — its id, its ownership, the folder the GM filed it in — stays the GM's.
 *
 * Items and effects keep their ids. A pregen's advancements record the ids of the items they
 * granted, so fresh ids would leave every class feature orphaned from the advancement that gave it;
 * a blank sheet has nothing those ids could collide with. The name is taken only when the sheet
 * still has a placeholder one — a GM who named it after the player meant that name.
 * @param {Actor} actor
 * @param {object} data   The pregen's `toObject()`.
 * @returns {Promise<Actor>}
 */
async function importPregenInto(actor, data) {
  const update = {
    system: data.system,
    img: data.img,
    "prototypeToken.texture": data.prototypeToken?.texture ?? {},
    "prototypeToken.ring": data.prototypeToken?.ring ?? {}
  };
  if ( isPlaceholderName(actor.name) ) {
    update.name = data.name;
    update["prototypeToken.name"] = data.name;
  }
  await actor.update(update);
  if ( data.items?.length ) await actor.createEmbeddedDocuments("Item", data.items, { keepId: true });
  if ( data.effects?.length ) await actor.createEmbeddedDocuments("ActiveEffect", data.effects, { keepId: true });
  return actor;
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
