import { log } from "../config.mjs";

/**
 * D&D World of Warcraft support: its hero classes and its Renown choices.
 *
 * The module hangs both on the actor sheet's *drop* (`dnd5e.dropCreateItems`): dropping a Paladin
 * opens a dialog offering Death Knight, and dropping a Druid or a Dwarf adds a Renown choice to the
 * item before it is created. The creator never drops anything — it stages items on an
 * AdvancementManager (`forNewItem` / `buildCreationManager`) — so without this a creator-built
 * character could not be a Death Knight and never got its Renown.
 *
 * Nothing here names a class or a species. Both tables are the module's own, published on its
 * package (`game.modules.get("dnd-world-warcraft").config` — `heroClasses` and `renownAdvancement`),
 * and the transforms below repeat what its own handlers do to an item's data, so a creator-built
 * character holds the same items a dropped one would. Everything after creation is the module's
 * own code running on our items: it swaps a hero class's *subclass* features in its
 * `dnd5e.advancementCreateItemData` hook (the driver creates subclasses through that same path),
 * and it adds Renown to granted lineage feats there too.
 *
 * Inert without the module: every entry point answers "nothing to do".
 */

const PACKAGE = "dnd-world-warcraft";
const FLAG = PACKAGE;

/** The module's published config, or null when it isn't active. */
function wowConfig() {
  const mod = game.modules?.get(PACKAGE);
  return mod?.active ? (mod.config ?? null) : null;
}

/* -------------------------------------------- */
/*  Hero classes                                */
/* -------------------------------------------- */

/**
 * The hero classes a class can be played as — Paladin → Death Knight, Ranger → Demon Hunter or
 * Hunter — localised for display. Empty for a class with none, or without the module.
 * @param {string} classIdentifier
 * @returns {{identifier: string, name: string, img: string, subclass: string|null}[]}
 */
export function heroClassesFor(classIdentifier) {
  const list = wowConfig()?.heroClasses?.[classIdentifier];
  if ( !Array.isArray(list) ) return [];
  return list.map(h => ({
    identifier: h.identifier,
    name: game.i18n.localize(h.name),
    img: h.img,
    subclass: h.subclass ?? null
  }));
}

/**
 * The hero class a creator build is played as — `state.heroClass` on `state.classUuid` — or null.
 * @param {{heroClass?: string|null, classUuid?: string|null}} state
 * @param {{card: (uuid: string) => object|null}} source
 * @returns {{identifier: string, name: string, img: string, subclass: string|null}|null}
 */
export function chosenHeroClass(state, source) {
  if ( !state?.heroClass || !state.classUuid ) return null;
  const identifier = source?.card(state.classUuid)?.identifier ?? "";
  return heroClassesFor(identifier).find(h => h.identifier === state.heroClass) ?? null;
}

/**
 * Whether a book entry or page name is a hero class's. The module's hero names are localisation keys
 * and its book is written in English, so in a world in another language the translated name and the
 * book's own disagree. A name matches when it is the hero's translated name (a translated book), or
 * when it slugs to the hero's identifier — "Death Knight" → `death-knight`, which is how the module
 * coins its identifiers (an untranslated book). **Pure.**
 * @param {string} name                                The entry's or page's name.
 * @param {{identifier: string, name: string}} hero    From {@link heroClassesFor}.
 * @returns {boolean}
 */
export function isHeroName(name, hero) {
  if ( !name || !hero ) return false;
  if ( name === hero.name ) return true;
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return !!slug && (slug === hero.identifier);
}

/**
 * A hero class's own description, from the module's book: the entry named for the hero ("Death
 * Knight") opens with a page of the same name describing it. The large art the page opens with is
 * left out; the smaller piece further down is moved to the front, so the class page can float it
 * beside the text rather than after it. Null when the book has no such page.
 * @param {{identifier: string, name: string}} hero   From {@link heroClassesFor}.
 * @returns {Promise<string|null>}   Enriched HTML.
 */
export function heroDescription(hero) {
  if ( !hero?.identifier || !wowConfig() ) return Promise.resolve(null);
  if ( !HERO_TEXT.has(hero.identifier) ) {
    HERO_TEXT.set(hero.identifier, (async () => {
      const pack = game.packs?.get?.(`${PACKAGE}.book`);
      const index = pack ? await pack.getIndex() : null;
      const id = index?.find(e => isHeroName(e.name, hero))?._id;
      const entry = id ? await pack.getDocument(id) : null;
      const pages = [...(entry?.pages ?? [])].filter(p => (p.type === "text") && p.text?.content);
      const page = pages.find(p => isHeroName(p.name, hero)) ?? null;
      if ( !page ) return null;
      const html = artFirst(stripLeadingEmbed(page.text.content));
      return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: page, secrets: false });
    })().catch(err => {
      log(`warcraft: could not read ${hero.name}'s description`, err);
      return null;
    }));
  }
  return HERO_TEXT.get(hero.identifier);
}

/**
 * The book a hero class comes from, as dnd5e names it: the module registers its book under
 * `flags.dnd5e.sourceBooks` (a localisation key), which its own items' source badges read. Falls back
 * to the module's title.
 * @returns {string|null}
 */
export function warcraftSourceBook() {
  const mod = game.modules?.get(PACKAGE);
  if ( !mod?.active ) return null;
  const books = mod.flags?.dnd5e?.sourceBooks ?? {};
  const label = Object.values(books)[0];
  return label ? game.i18n.localize(label) : (mod.title ?? null);
}

/** Hero identifier → promise of its enriched description. Cleared with the sources. */
const HERO_TEXT = new Map();

/**
 * A page's text without the art it opens with: a leading paragraph holding nothing but an `@Embed`.
 * @param {string} html
 * @returns {string}
 */
export function stripLeadingEmbed(html) {
  return String(html ?? "").replace(/^\s*<p>\s*@Embed\[[^\]]*\]\s*<\/p>/, "");
}

/**
 * A page's text with its art paragraphs (a paragraph holding nothing but an `@Embed`) moved to the
 * front, in their order, so the art can sit beside the text it illustrates.
 * @param {string} html
 * @returns {string}
 */
export function artFirst(html) {
  const ART = /<p>\s*@Embed\[[^\]]*\]\s*<\/p>/g;
  const text = String(html ?? "");
  const art = text.match(ART) ?? [];
  return art.length ? art.join("") + text.replace(ART, "") : text;
}

/** The raw hero-class entry for one class, or null. */
function heroEntry(classIdentifier, heroId) {
  if ( !heroId ) return null;
  return wowConfig()?.heroClasses?.[classIdentifier]?.find(h => h.identifier === heroId) ?? null;
}

/** An item's advancements as a list, whichever of dnd5e's two source shapes it is stored in. */
function advList(data) {
  const adv = data?.system?.advancement;
  if ( !adv ) return [];
  return Array.isArray(adv) ? adv : Object.values(adv);
}

/** A granted item's identifier, resolved from its uuid. */
async function identifierOf(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  return doc?.system?.identifier ?? doc?.identifier ?? null;
}

/**
 * Swap features granted by an item's ItemGrants, by level and by the granted feature's identifier —
 * the module's own `replaceFeatures`, on source data. It takes the first ItemGrant at each level;
 * so does this.
 * @param {object} data                                       Item source data, mutated.
 * @param {Record<number, Record<string, string>>} replacements level → { identifier → replacement uuid }
 */
export async function replaceFeatures(data, replacements) {
  for ( const [level, swaps] of Object.entries(replacements ?? {}) ) {
    const grant = advList(data).find(a => (a.type === "ItemGrant") && (Number(a.level) === Number(level)));
    if ( !grant ) continue;
    const items = grant.configuration?.items ?? [];
    for ( const [identifier, uuid] of Object.entries(swaps) ) {
      for ( const entry of items ) {
        if ( await identifierOf(entry.uuid ?? entry) !== identifier ) continue;
        if ( typeof entry === "string" ) items[items.indexOf(entry)] = { uuid };
        else entry.uuid = uuid;
        break;
      }
    }
  }
}

/**
 * Make a class item's data the hero class — what the module's dialog does to a dropped class:
 * its name and badge, the flag its later hooks read, the subclass it is locked to, and the class
 * features it swaps. Mutates and returns `data`.
 * @param {object} data      Class item source data.
 * @param {string} heroId    The hero class's identifier ("death-knight").
 * @returns {Promise<object>}
 */
export async function applyHeroClass(data, heroId) {
  const hero = heroEntry(data?.system?.identifier, heroId);
  if ( !hero ) return data;
  if ( hero.subclass ) {
    const sub = advList(data).find(a => a.type === "Subclass");
    if ( sub ) {
      sub.configuration ??= {};
      sub.configuration.suggested = { fixed: true, uuid: hero.subclass };
    }
  }
  if ( hero.replacedClassFeatures ) await replaceFeatures(data, hero.replacedClassFeatures);
  data.name = game.i18n.localize(hero.name);
  data.img = hero.img;
  foundry.utils.setProperty(data, `flags.${FLAG}.heroClass`, hero.identifier);
  return data;
}

/**
 * Pet Specialization, which the module adds to a Beast Master Hunter's level-6 Roving grant (in its
 * `dnd5e.preAdvancementManagerRender` hook, which the driver fires). The module keeps this uuid in a
 * private constant, so it is repeated here — the one World of Warcraft item this file names.
 */
const PET_SPECIALIZATION = "Compendium.dnd-world-warcraft.classes.Item.wowrngPetSpecial";

/**
 * The "one or the other" a World of Warcraft grant offers, as a replacement map (`{base: alt}`) the
 * level-up screen's pairs understand — or null for any other grant.
 *
 * The module makes the Hunter's level-6 grant optional and adds Pet Specialization to it, then
 * turns its dialog's checkboxes into radio buttons: the Hunter takes Roving **or** Pet
 * Specialization, never both. Plain optional grants are independent checkboxes on our screen, so
 * this names the pair: the grant's one non-optional item (Roving, which dnd5e and the driver both
 * keep by default) against Pet Specialization.
 * @param {object} advancement   An ItemGrant advancement.
 * @returns {Record<string, string>|null}
 */
export function exclusiveGrantPair(advancement) {
  if ( !warcraftActive() || !advancement?.configuration?.optional ) return null;
  const items = Array.from(advancement.configuration.items ?? []).map(i => (typeof i === "string") ? { uuid: i } : i);
  if ( !items.some(i => i.uuid === PET_SPECIALIZATION) ) return null;
  const bases = items.filter(i => !i.optional && (i.uuid !== PET_SPECIALIZATION));
  return (bases.length === 1) ? { [bases[0].uuid]: PET_SPECIALIZATION } : null;
}

/* -------------------------------------------- */
/*  Renown                                      */
/* -------------------------------------------- */

/** Whether Renown choices apply: the module is active and dnd5e's Renown variant rule is on. */
export function renownActive() {
  return !!(wowConfig()?.renownAdvancement && dnd5e?.settings?.renownScore);
}

/** The advancement id the module gives every Renown choice, so its own checks recognise ours. */
function renownId() {
  return dnd5e.utils.staticID("wowRenown");
}

/**
 * Give an item the Renown choice the module adds on drop — a class, a species, or a lineage feat it
 * lists (a shaman's Barbarian only as the shaman). Mutates and returns `data`; untouched when the
 * item takes none, already has it, or Renown is off.
 * @param {object} data   Item source data.
 * @returns {object}
 */
export function addRenown(data) {
  if ( !renownActive() ) return data;
  const renown = wowConfig().renownAdvancement?.[data?.type]?.[data?.system?.identifier];
  if ( !renown ) return data;
  if ( renown.heroClass && (data.flags?.[FLAG]?.heroClass !== renown.heroClass) ) return data;
  const id = renownId();
  if ( advList(data).some(a => a._id === id) ) return data;
  const advancement = {
    _id: id,
    type: "ItemChoice",
    name: game.i18n.format("WOW.Renown.Advancement", { name: data.name }),
    hint: renown.description ?? `<p>@Embed[${renown.embed} inline]</p>`,
    configuration: {
      allowDrops: false,
      choices: { [data.type === "class" ? 1 : 0]: { count: 1 } },
      pool: renown.options.map(uuid => ({ uuid })),
      type: "renown"
    }
  };
  data.system ??= {};
  if ( Array.isArray(data.system.advancement) ) data.system.advancement.push(advancement);
  else data.system.advancement = { ...(data.system.advancement ?? {}), [id]: advancement };
  return data;
}

/* -------------------------------------------- */
/*  Documents the creator reads                 */
/* -------------------------------------------- */

/** The module's per-user "customize classes" option; on unless the user turned it off. */
function customizeClasses() {
  try { return game.settings.get(PACKAGE, "customizeClasses") !== false; } catch { return true; }
}

/** Whether anything here could change an item — false skips every transform cheaply. */
export function warcraftActive() {
  return !!wowConfig();
}

/**
 * The item data the creator stages for an origin: the compendium copy with the hero class applied
 * (a class) and Renown added (whatever takes it). Mutates and returns `data`.
 * @param {object} data
 * @param {{heroClass?: string|null}} [options]
 * @returns {Promise<object>}
 */
export async function transformItemData(data, { heroClass = null } = {}) {
  if ( !warcraftActive() || !data ) return data;
  if ( data.type === "class" ) {
    // The module's "customize classes" option (per user, on by default) gives a dropped Druid, Monk,
    // Paladin, Rogue or Warlock its World of Warcraft badge; a hero class then replaces it with its own.
    const icon = wowConfig().classIcons?.[data.system?.identifier];
    if ( icon && customizeClasses() && !data.flags?.[FLAG]?.heroClass ) data.img = icon;
    if ( heroClass ) await applyHeroClass(data, heroClass);
  }
  addRenown(data);
  return data;
}

/** uuid + options → promise of the transformed in-memory document. Cleared with the sources. */
const DOCS = new Map();

/** Forget the transformed documents — called when the enabled sources or the Renown rule change. */
export function resetWarcraftDocs() {
  HERO_TEXT.clear();
  DOCS.clear();
}

/**
 * The document the creator should *read* for a compendium item: itself when nothing here applies,
 * else an in-memory copy carrying the hero class and Renown, so the choice resolver asks the
 * questions the built character will raise and the class page lists the hero's own features.
 * Memoised per item and hero class.
 *
 * Built from `toObject()` with the pack kept, so its uuid, relative links and identifier are the
 * compendium item's own.
 * @param {Item5e|null} doc
 * @param {{heroClass?: string|null}} [options]
 * @returns {Promise<Item5e|null>}
 */
export async function readableDoc(doc, { heroClass = null } = {}) {
  if ( !doc || !warcraftActive() ) return doc;
  const hero = (doc.type === "class") ? heroClass : null;
  const takesRenown = renownActive() && !!wowConfig().renownAdvancement?.[doc.type]?.[doc.system?.identifier];
  if ( !hero && !takesRenown ) return doc;
  const key = `${doc.uuid}|${hero ?? ""}|${renownActive() ? "r" : ""}`;
  if ( !DOCS.has(key) ) {
    const promise = (async () => {
      const data = await transformItemData(doc.toObject(), { heroClass: hero });
      return new doc.constructor(data, { pack: doc.pack, parent: doc.parent, strict: false });
    })().catch(err => {
      DOCS.delete(key);
      log(`warcraft: could not transform ${doc.uuid}`, err);
      return doc;
    });
    DOCS.set(key, promise);
  }
  return DOCS.get(key);
}
