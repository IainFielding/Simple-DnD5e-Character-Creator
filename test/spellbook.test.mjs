import { describe, expect, it } from "vitest";
import { BOOK_FREE_FLAG, bookFreeUpdate, bookFreeUsed, bookPicksOwed, bookSpells, bookTarget, spellbookRule }
  from "../scripts/data/spellbook.mjs";
import { levelOneSpellLimits } from "../scripts/data/spell-source.mjs";

/**
 * The wizard's spellbook rules ({@link module:data/spellbook}): how big the book should be, which of
 * a character's spells are in it, and how many free picks are still owed. These numbers decide how
 * many spells a level-up offers a Wizard, so the edge cases get pinned down here: spells a feature
 * wrote into the book, feat spells that are not in it, and a book that is short from before the
 * book was modelled.
 */

const wizardClass = { id: "wizard0000000000", type: "class", system: { identifier: "wizard", levels: 5 } };
const evoker = { id: "evoker0000000000", type: "subclass", system: { identifier: "evoker", classIdentifier: "wizard" } };

/** A leveled spell item: our own pick unless an advancement `origin` is given. */
function spell(id, { level = 1, sourceItem = "class:wizard", prepared = 0, origin = "" } = {}) {
  const item = { id, type: "spell", name: id, system: { level, sourceItem, prepared } };
  if ( origin ) item.flags = { dnd5e: { advancementOrigin: origin } };
  return item;
}

describe("spellbookRule", () => {
  it("gives the Wizard class a six-spell book that grows by two", () => {
    expect(spellbookRule(wizardClass)).toEqual({ start: 6, perLevel: 2 });
  });

  it("gives no book to other classes, or to a subclass that borrows the Wizard's list", () => {
    expect(spellbookRule({ type: "class", system: { identifier: "cleric" } })).toBe(null);
    expect(spellbookRule({ type: "subclass", system: { identifier: "wizard" } })).toBe(null);
    expect(spellbookRule(null)).toBe(null);
  });

  it("reads a compendium document with no type the same way", () => {
    expect(spellbookRule({ system: { identifier: "wizard" } })).toEqual({ start: 6, perLevel: 2 });
  });
});

describe("bookTarget", () => {
  it("is 6 at 1st level, 14 at 5th and 44 at 20th", () => {
    const rule = spellbookRule(wizardClass);
    expect(bookTarget(rule, 1)).toBe(6);
    expect(bookTarget(rule, 5)).toBe(14);
    expect(bookTarget(rule, 20)).toBe(44);
  });

  it("is 0 without a book", () => {
    expect(bookTarget(null, 5)).toBe(0);
  });
});

describe("bookSpells", () => {
  const savantFeature = {
    id: "savant0000000000", type: "feat", system: { type: { value: "subclass" } },
    flags: { dnd5e: { advancementOrigin: "evoker0000000000.adv1" } }
  };
  const feyTouched = {
    id: "feytouched000000", type: "feat", system: { type: { value: "feat" } },
    flags: { dnd5e: { advancementOrigin: "wizard0000000000.asi4" } }
  };
  const actor = {
    items: [
      wizardClass, evoker, savantFeature, feyTouched,
      spell("own1", { prepared: 1 }),
      spell("own2"),
      spell("cantrip", { level: 0 }),
      // The Evoker's subclass grants a spell straight from the subclass...
      spell("subclassGrant", { sourceItem: "subclass:evoker", origin: "evoker0000000000.adv2" }),
      // ...and Savant, a subclass feature, writes two more in through its own advancement.
      spell("savant1", { sourceItem: "feat:evocation-savant", origin: "savant0000000000.advA" }),
      // A feat taken at a Wizard ASI level is rooted at the class, but its spell is the feat's.
      spell("feySpell", { sourceItem: "feat:fey-touched", origin: "feytouched000000.advB", prepared: 2 }),
      // Another class's spell.
      spell("clericSpell", { sourceItem: "class:cleric" })
    ]
  };

  it("lists our picks and the spells the class's own features wrote in", () => {
    const { all } = bookSpells(actor, wizardClass);
    expect(all.map(s => s.id)).toEqual(["own1", "own2", "subclassGrant", "savant1"]);
  });

  it("counts only our own picks against the free picks", () => {
    expect(bookSpells(actor, wizardClass).counted.map(s => s.id)).toEqual(["own1", "own2"]);
  });

  it("leaves out cantrips, feat spells and other classes' spells", () => {
    const ids = bookSpells(actor, wizardClass).all.map(s => s.id);
    expect(ids).not.toContain("cantrip");
    expect(ids).not.toContain("feySpell");
    expect(ids).not.toContain("clericSpell");
  });
});

describe("bookPicksOwed", () => {
  const bookOf = (count, levels) => ({
    items: [{ ...wizardClass, system: { ...wizardClass.system, levels } },
      ...Array.from({ length: count }, (_, i) => spell(`s${i}`))]
  });

  it("owes two on an ordinary level-up", () => {
    const actor = bookOf(6, 2);
    expect(bookPicksOwed(actor, actor.items[0], 2)).toBe(2);
  });

  it("owes the whole gap to a wizard built before the book was modelled", () => {
    // A level-10 wizard with only 10 spells: its book should hold 6 + 2×9 = 24.
    const actor = bookOf(10, 10);
    expect(bookPicksOwed(actor, actor.items[0], 10)).toBe(14);
  });

  it("owes nothing, never a negative, when the book already holds more", () => {
    const actor = bookOf(20, 3);
    expect(bookPicksOwed(actor, actor.items[0], 3)).toBe(0);
  });

  it("owes nothing to a class without a book", () => {
    const cleric = { id: "c", type: "class", system: { identifier: "cleric" } };
    expect(bookPicksOwed({ items: [cleric] }, cleric, 5)).toBe(0);
  });
});

describe("the free-pick ledger", () => {
  const M = "sogrom-dnd5e-character-creator";
  /** A level-5 wizard whose class records 12 free picks, with `copied` more spells written in play. */
  function withLedger({ recorded = 12, copied = 0 } = {}) {
    const cls = { ...wizardClass, system: { ...wizardClass.system, levels: 5 }, flags: { [M]: { [BOOK_FREE_FLAG]: recorded } } };
    // dnd5e tags a spell a player adds to a caster with its class, so copied spells look like picks.
    const spells = Array.from({ length: 12 + copied }, (_, i) => spell(`s${i}`));
    return { items: [cls, ...spells], cls };
  }

  it("owes two free spells however many were copied into the book in play", () => {
    const { items, cls } = withLedger({ copied: 5 });
    expect(bookFreeUsed({ items }, cls)).toBe(12);
    expect(bookPicksOwed({ items }, cls, 5)).toBe(2);
  });

  it("carries picks left unmade at one level over to the next", () => {
    // Level 5 should have had 14; only 12 were made.
    const { items, cls } = withLedger({ recorded: 12 });
    expect(bookPicksOwed({ items }, cls, 5)).toBe(2);
  });

  it("falls back to counting the book for a wizard built before the ledger", () => {
    const actor = { items: [{ ...wizardClass, system: { ...wizardClass.system, levels: 5 } }, ...Array.from({ length: 9 }, (_, i) => spell(`s${i}`))] };
    expect(bookFreeUsed(actor, actor.items[0])).toBe(9);
    expect(bookPicksOwed(actor, actor.items[0], 5)).toBe(5);
  });

  it("builds the class-item update that adds this level's picks", () => {
    const { items, cls } = withLedger({ recorded: 12, copied: 3 });
    expect(bookFreeUpdate({ items }, cls, 2)).toEqual({ _id: cls.id, [`flags.${M}.${BOOK_FREE_FLAG}`]: 14 });
    expect(bookFreeUpdate({ items }, cls, 0)).toBe(null);
    expect(bookFreeUpdate({ items: [] }, { type: "class", system: { identifier: "cleric" } }, 2)).toBe(null);
  });
});

describe("level-1 limits for a book caster", () => {
  it("gives a 2024 Wizard a six-spell book and its scale's four prepared", () => {
    // The 2024 class carries a "Max Prepared Spells" scale (4 at 1st level) and no ability formula.
    const wizard2024 = { maxCantrips: 3, maxSpells: 4, classId: "wizard", preparedFormula: "", spellbook: true, bookSize: 6 };
    expect(levelOneSpellLimits(wizard2024, null)).toEqual({ maxCantrips: 3, maxSpells: 6, maxPrepared: 4 });
  });

  it("never prepares more than the book holds", () => {
    const odd = { maxCantrips: 3, maxSpells: 9, classId: "wizard", preparedFormula: "", spellbook: true, bookSize: 6 };
    expect(levelOneSpellLimits(odd, null)).toEqual({ maxCantrips: 3, maxSpells: 6, maxPrepared: 6 });
  });
});
