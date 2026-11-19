import { log, MODULE_ID } from "../config.mjs";
import { heroClassesFor } from "./warcraft.mjs";

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
  return { uuid: doc.uuid ?? uuid, type: doc.type, identifier: doc.system?.identifier ?? null };
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
      const hero = heroClassesFor(cls.identifier).find(h => h.name === entry.name)?.identifier ?? null;

      const specs = [];
      for ( const s of sections ) {
        const picks = { subclass: null, feats: [], spells: [] };
        for ( const uuid of s.links ) {
          if ( !described.has(uuid) ) described.set(uuid, await describeLink(uuid));
          const d = described.get(uuid);
          if ( !d ) continue;
          if ( (d.type === "subclass") && !picks.subclass ) picks.subclass = d.uuid;
          else if ( d.type === "feat" ) picks.feats.push(d.uuid);
          else if ( d.type === "spell" ) picks.spells.push(d.uuid);
        }
        specs.push({ id: specializationId(s.name), name: s.name, intro: s.intro, pageUuid: page.uuid, ...picks });
      }
      map.set(keyOf(cls.identifier, hero), specs);
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
