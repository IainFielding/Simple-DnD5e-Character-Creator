import { log, MODULE_ID } from "../config.mjs";
import { heroClassesFor, isHeroName } from "./warcraft.mjs";

/**
 * World of Warcraft's class specializations — Paladin's Holy, Protection and Retribution, Mage's
 * Arcane, Fire and Frost — read from the module's own journal.
 *
 * Each class's "Playing a …" page describes three or four specializations under headings named
 * "<Name> Specialization", and under each recommends picks as item links: the spells to prepare,
 * the cantrips, a fighting style, the subclass to take, feats for later levels, a table of spells.
 * The creator lets a player choose one (Class step), keeps it on the character, and marks what it
 * names as recommended wherever those things are picked — and Quick Build follows it.
 *
 * Nothing here understands the prose. A section is cut out by its headings and every `@UUID` link
 * inside it is a recommendation, sorted by what the link points at (a feat, a spell, a subclass).
 * Weapon Mastery picks are plain words in the book, not links, so they are not read.
 *
 * Read at runtime from the installed module, as the class "Full Details" pages are — nothing is
 * copied — and built once per session.
 */

const PACKAGE = "dnd-world-warcraft";
const BOOK = `${PACKAGE}.book`;

/* -------------------------------------------- */
/*  Parsing (pure)                              */
/* -------------------------------------------- */

const HEADING = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g;
const LINK = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;
/**
 * A specialization's own heading — "Holy Specialization". A sub-heading that happens to end the same
 * way ("Level 6: Pet Specialization Choice" is inside Beast Mastery; "Level 6: Pet Specialization")
 * carries a colon, which no specialization's name does.
 */
const SPEC_HEADING = /^([^:]+?)\s+Specialization$/i;
const stripTags = html => String(html ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

/**
 * The specializations on one page, in order: each section runs from its "… Specialization" heading to
 * the next specialization heading or the next heading of a higher rank, so a sub-heading inside one
 * (Beast Mastery's "Level 6: Pet …") stays part of it.
 * @param {string} html   The page's text content.
 * @returns {{name: string, intro: string, links: string[]}[]}
 */
export function parseSpecializations(html) {
  const text = String(html ?? "");
  const heads = [...text.matchAll(HEADING)].map(m => ({
    level: Number(m[1]), title: stripTags(m[2]), start: m.index, end: m.index + m[0].length
  }));
  const out = [];
  heads.forEach((h, i) => {
    const match = SPEC_HEADING.exec(h.title);
    if ( !match ) return;
    const next = heads.slice(i + 1).find(n => (n.level < h.level) || SPEC_HEADING.test(n.title));
    const body = text.slice(h.end, next ? next.start : text.length);
    const intro = /<p[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[0] ?? "";
    const links = [...new Set([...body.matchAll(LINK)].map(m => m[1]))];
    out.push({ name: match[1].trim(), intro, links });
  });
  return out;
}

/** A specialization's id: its name, slugged ("Beast Mastery" → "beast-mastery"). */
export function specializationId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The ways one item can be recognised: its uuid, its identifier and its name, each scoped by type.
 * The book links one package's copy of a spell or feat (Hunter's Mark from the Player's Handbook, say)
 * while a picker may list another's — the system's own, or a different book's — so a uuid alone
 * recognises nothing in most worlds. The same rule as the "already known" check
 * ({@link module:data/spell-identity}): the same spell from two packages is one spell.
 * @param {string} type                       "spell" | "feat" | "subclass"
 * @param {{uuid?: string, identifier?: string, system?: object, name?: string}} item
 * @returns {string[]}
 */
export function recommendationKeys(type, item) {
  if ( !item ) return [];
  const keys = [];
  if ( item.uuid ) keys.push(`uuid:${item.uuid}`);
  const identifier = item.identifier || item.system?.identifier;
  if ( identifier ) keys.push(`${type}:id:${identifier}`);
  const name = String(item.name ?? "").trim().toLowerCase();
  if ( name ) keys.push(`${type}:name:${name}`);
  return keys;
}

/**
 * Whether a specialization recommends this item. **Pure.**
 * @param {object|null} spec                  From {@link findSpecialization}.
 * @param {string} type                       "spell" | "feat" | "subclass"
 * @param {object} item                       A picker row, an index entry or a document.
 * @returns {boolean}
 */
export function recommends(spec, type, item) {
  const keys = spec?.keys;
  if ( !keys?.size ) return false;
  return recommendationKeys(type, item).some(k => keys.has(k));
}

/**
 * Whether a specialization recommends anything of a type at all. **Pure.**
 * @param {object|null} spec
 * @param {string} type   "spell" | "feat" | "subclass"
 * @returns {boolean}
 */
export function recommendsAny(spec, type) {
  return !!spec?.refs?.some(r => r.type === type);
}

/**
 * The candidates a specialization recommends, in the order the book names them. **Pure.**
 * @param {object|null} spec
 * @param {string} type
 * @param {object[]} candidates
 * @returns {object[]}
 */
export function recommendedInOrder(spec, type, candidates) {
  const refs = (spec?.refs ?? []).filter(r => r.type === type);
  const out = [];
  for ( const ref of refs ) {
    const want = recommendationKeys(type, ref);
    const hit = candidates.find(c => !out.includes(c) && recommendationKeys(type, c).some(k => want.includes(k)));
    if ( hit ) out.push(hit);
  }
  return out;
}

/* -------------------------------------------- */
/*  The index                                   */
/* -------------------------------------------- */

/** `${classIdentifier}|${heroClass ?? ""}` → specializations. Built once per session. */
let index = null;
let building = null;

/** Forget the index — called when the enabled sources change. */
export function resetSpecializations() {
  index = null;
  building = null;
}

/** The key a class (played as a hero class, or not) is filed under. */
function keyOf(classIdentifier, heroClass = null) {
  return `${classIdentifier ?? ""}|${heroClass ?? ""}`;
}

/** What an item link points at: its document type and identifier, from its pack's index. */
async function describeLink(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return null;
  return { uuid: doc.uuid ?? uuid, type: doc.type, identifier: doc.system?.identifier ?? null, name: doc.name };
}

/**
 * Read every class page in the module's journal into the index.
 * @returns {Promise<Map<string, object[]>>}
 */
async function build() {
  const map = new Map();
  const pack = game.packs?.get?.(BOOK);
  if ( !pack || !game.modules?.get(PACKAGE)?.active ) return map;
  const entries = await pack.getDocuments().catch(err => { log("specializations: book unreadable", err); return []; });
  for ( const entry of entries ) {
    for ( const page of entry.pages ?? [] ) {
      const html = page.text?.content;
      if ( (page.type !== "text") || !html || !/Specialization<\/h[1-6]>/i.test(html) ) continue;
      const sections = parseSpecializations(html);
      // A page that names the specializations without recommending anything (Evoker's spell-list
      // page repeats the headings) is not the class's page, and must not replace it.
      if ( !sections.some(s => s.links.length) ) continue;

      // The page's class is the first class it links ("choose the Paladin class"); a hero class's
      // page links the class it is built on, and its entry carries the hero's own name.
      const described = new Map();
      for ( const uuid of [...html.matchAll(LINK)].map(m => m[1]) ) {
        if ( !described.has(uuid) ) described.set(uuid, await describeLink(uuid));
        if ( described.get(uuid)?.type === "class" ) break;
      }
      const cls = [...described.values()].find(d => d?.type === "class");
      if ( !cls?.identifier ) continue;
      // Matched through isHeroName, not the translated name alone: in a world in another language the
      // book's English "Death Knight" is not the hero's translated name, and a missed match would file
      // the Death Knight's specializations as the Paladin's own.
      const hero = heroClassesFor(cls.identifier).find(h => isHeroName(entry.name, h))?.identifier ?? null;
      const key = keyOf(cls.identifier, hero);

      const specs = [];
      for ( const s of sections ) {
        // The picks, in the book's order: only the first subclass it links (a section names one).
        // Matching always goes through `refs` and `keys`, never a bare uuid — see {@link recommends}.
        const refs = [];
        for ( const uuid of s.links ) {
          if ( !described.has(uuid) ) described.set(uuid, await describeLink(uuid));
          const d = described.get(uuid);
          if ( !d || !["subclass", "feat", "spell"].includes(d.type) ) continue;
          if ( (d.type === "subclass") && refs.some(r => r.type === "subclass") ) continue;
          refs.push(d);
        }
        const keys = new Set(refs.flatMap(r => recommendationKeys(r.type, r)));
        specs.push({ id: specializationId(s.name), name: s.name, intro: s.intro, pageUuid: page.uuid, refs, keys });
      }
      // One page per class (or hero class). A second page claiming the same one is a misread — a hero's
      // page whose entry did not match its hero — and must not replace the first: the first stays,
      // and the clash is logged.
      if ( map.has(key) ) {
        log(`specializations: "${entry.name}" also reads as ${key}; keeping the first page`);
        continue;
      }
      map.set(key, specs);
    }
  }
  log(`specializations: read ${map.size} class page(s)`);
  return map;
}

/** The index, building it on first use. */
async function getIndex() {
  if ( index ) return index;
  building ??= build().then(m => (index = m)).catch(err => {
    log("specializations: build failed", err);
    building = null;
    return new Map();
  });
  return building;
}

/**
 * The specializations a class (as a hero class, if played as one) can follow. Empty without the
 * module, or for a class its book does not describe.
 * @param {string} classIdentifier
 * @param {string|null} [heroClass]
 * @returns {Promise<object[]>}
 */
export async function specializationsFor(classIdentifier, heroClass = null) {
  if ( !classIdentifier ) return [];
  const map = await getIndex();
  return map.get(keyOf(classIdentifier, heroClass)) ?? [];
}

/**
 * The specialization a built class item follows — the creator saves it as a flag on the class —
 * or null.
 * @param {Item5e|null} classItem
 * @returns {Promise<object|null>}
 */
export async function specializationOf(classItem) {
  const id = classItem?.flags?.[MODULE_ID]?.specialization;
  if ( !id ) return null;
  const hero = classItem.flags?.[PACKAGE]?.heroClass ?? null;
  return findSpecialization(classItem.system?.identifier ?? classItem.identifier, hero, id);
}

/**
 * One specialization by id, or null.
 * @param {string} classIdentifier
 * @param {string|null} heroClass
 * @param {string|null} id
 * @returns {Promise<object|null>}
 */
export async function findSpecialization(classIdentifier, heroClass, id) {
  if ( !id ) return null;
  return (await specializationsFor(classIdentifier, heroClass)).find(s => s.id === id) ?? null;
}
