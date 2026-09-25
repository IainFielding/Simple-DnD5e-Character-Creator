import { MODULE_ID, SPELLBOOK_CLASSES } from "../config.mjs";

/**
 * The flag on a book class's item recording how many free book picks this module has handed out.
 * @type {string}
 */
export const BOOK_FREE_FLAG = "spellbookFree";

/**
 * The wizard's spellbook: how big it should be, and which of a character's spells are in it.
 *
 * A book caster learns more spells than it prepares. The book starts with six 1st-level spells and
 * gains two with every level, in both editions; only the class's allowance of them is prepared, and
 * the rest sit on the sheet unprepared (`system.prepared: 0`) — the shape dnd5e's own premade wizards
 * use. Both Spells steps (creation and level-up) and the Quick Build climb read the book through
 * here, so they agree on what "in the book" means.
 *
 * Domain terms for a junior: *the book* is every leveled spell the wizard has written down, prepared
 * or not. *Prepared* is the subset it can cast today. Cantrips are never in the book.
 *
 * @module data/spellbook
 */

/**
 * The book rule for a casting item, or null when it keeps no book. Only a *class* can: an Eldritch
 * Knight casts from the Wizard's list through its subclass, but it learns spells the ordinary way.
 * @param {Item5e|object|null} castItem  The class (or subclass) item or document that casts.
 * @returns {{start:number, perLevel:number}|null}
 */
export function spellbookRule(castItem) {
  if ( !castItem ) return null;
  if ( castItem.type && (castItem.type !== "class") ) return null;
  return SPELLBOOK_CLASSES[castItem.system?.identifier ?? ""] ?? null;
}

/**
 * How many spells the book should hold at a class level, counting only the ones the class hands out
 * for free: six at 1st level, then two per level.
 * @param {{start:number, perLevel:number}|null} rule
 * @param {number} classLevel
 * @returns {number}
 */
export function bookTarget(rule, classLevel) {
  if ( !rule ) return 0;
  return rule.start + (rule.perLevel * Math.max(0, (Number(classLevel) || 1) - 1));
}

/**
 * The spells in a class's book, read off an actor (or the level-up driver's clone).
 *
 * Two kinds of spell are in it:
 *  - **Our own picks**: leveled spells tagged `class:<identifier>`, the tag both Spells steps stamp.
 *  - **Spells an advancement wrote in**: a subclass feature like the 2024 Evoker's *Savant* adds
 *    spells to the book, and dnd5e tags those to the item that granted them (the subclass or the
 *    feature), not to the class — `SpellConfigurationData#applySpellChanges` sets `sourceItem` to
 *    `<item type>:<identifier>`. They are found instead by following dnd5e's own grant record,
 *    `flags.dnd5e.advancementOrigin` (`<itemId>.<advancementId>`), back to this class or its
 *    subclass. A spell whose trail passes through a *feat* is left out: Magic Initiate or Fey
 *    Touched taken at a Wizard ASI level is rooted at the class too, but those spells belong to the
 *    feat, not the book.
 *
 * `counted` is our own picks with no advancement behind them. It is only an *estimate* of the free
 * picks used, for a character built before {@link BOOK_FREE_FLAG} existed: dnd5e tags any spell a
 * player adds to a caster with its class (`SpellData#_preCreate`), so a spell copied into the book
 * in play looks exactly like a free pick here.
 *
 * @param {{items: Iterable<object>}} actorLike
 * @param {Item5e|object} classItem  The book class's item on that actor.
 * @returns {{all: object[], counted: object[]}}  Spell items, in actor order.
 */
export function bookSpells(actorLike, classItem) {
  const all = [];
  const counted = [];
  const classId = classItem?.system?.identifier ?? "";
  if ( !classId ) return { all, counted };
  const items = [...(actorLike?.items ?? [])];
  const byId = new Map(items.map(i => [i.id ?? i._id, i]));
  const ownTag = `class:${classId}`;

  for ( const item of items ) {
    if ( (item.type !== "spell") || !(Number(item.system?.level ?? 0) > 0) ) continue;
    const origin = item.flags?.dnd5e?.advancementOrigin ?? "";
    if ( (item.system?.sourceItem ?? "") === ownTag ) {
      all.push(item);
      if ( !origin ) counted.push(item);
      continue;
    }
    if ( origin && grantedByClass(origin, byId, classId) ) all.push(item);
  }
  return { all, counted };
}

/**
 * Whether an advancement grant traces back to a class (or its subclass) through features only.
 * Walks at most a few links, since a feature can grant a feature that grants the spell.
 * @param {string} origin              `<itemId>.<advancementId>`
 * @param {Map<string, object>} byId   The actor's items by id.
 * @param {string} classId
 * @returns {boolean}
 */
function grantedByClass(origin, byId, classId) {
  let link = origin;
  for ( let depth = 0; link && (depth < 5); depth++ ) {
    const item = byId.get(String(link).split(".")[0]);
    if ( !item ) return false;
    if ( item.type === "class" ) return item.system?.identifier === classId;
    if ( item.type === "subclass" ) return item.system?.classIdentifier === classId;
    // A feat (the "feat" feature type) owns its spells; a class or subclass feature passes through.
    if ( (item.type === "feat") && (item.system?.type?.value === "feat") ) return false;
    if ( !["feat", "spell"].includes(item.type) ) return false;
    link = item.flags?.dnd5e?.advancementOrigin ?? "";
  }
  return false;
}

/**
 * How many free book picks a class has already had.
 *
 * Read from {@link BOOK_FREE_FLAG} on the class item, which creation and every level-up keep up to
 * date. That is a ledger of picks handed out, not a count of spells, which is the point: spells a
 * player copies into the book during play are extra by the rules and must not use up the two free
 * spells a level, and a spell they later erase doesn't hand one back.
 *
 * A class with no ledger (a Wizard built before it existed) falls back to counting its own untagged
 * picks ({@link bookSpells}), once: its next level-up writes the ledger from there.
 * @param {{items: Iterable<object>}} actorLike
 * @param {Item5e|object} classItem
 * @returns {number}
 */
export function bookFreeUsed(actorLike, classItem) {
  const recorded = Number(classItem?.flags?.[MODULE_ID]?.[BOOK_FREE_FLAG]);
  if ( Number.isFinite(recorded) && (recorded >= 0) ) return recorded;
  return bookSpells(actorLike, classItem).counted.length;
}

/**
 * The free book picks a class is still owed at a level: the book's target size less the picks it
 * has already had. A wizard built before the book was modelled catches up on its next level-up;
 * picks left unmade at one level are offered again at the next. Never negative.
 * @param {{items: Iterable<object>}} actorLike
 * @param {Item5e|object} classItem
 * @param {number} classLevel
 * @returns {number}
 */
export function bookPicksOwed(actorLike, classItem, classLevel) {
  const rule = spellbookRule(classItem);
  if ( !rule ) return 0;
  return Math.max(0, bookTarget(rule, classLevel) - bookFreeUsed(actorLike, classItem));
}

/**
 * The class-item update that records `added` more free picks in the ledger. Read the current figure
 * *before* the new spells are created, so a class with no ledger yet estimates from the book as it
 * stood. Null for a class without a book, or nothing to record.
 * @param {{items: Iterable<object>}} actorLike
 * @param {Item5e|object} classItem
 * @param {number} added
 * @returns {{_id:string}|null}
 */
export function bookFreeUpdate(actorLike, classItem, added) {
  if ( !spellbookRule(classItem) || !(added > 0) ) return null;
  return {
    _id: classItem.id ?? classItem._id,
    [`flags.${MODULE_ID}.${BOOK_FREE_FLAG}`]: bookFreeUsed(actorLike, classItem) + added
  };
}
