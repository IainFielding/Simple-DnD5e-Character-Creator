import { describe, expect, it } from "vitest";
import { itemUsability, attunementRestriction, unmetAttunement } from "../scripts/data/magic-shop.mjs";

/**
 * Whether the character can make proper use of a magic item — the note the Magic Items shelf shows
 * under an item's name. Two things stop a prize being one: proficiency (a class or origin has to
 * grant it) and armour's minimum Strength. Neither blocks the pick; both are worth knowing before
 * spending one of a handful of free slots.
 *
 * The proficiency rule mirrors the system's own: an item's *category* maps to a proficiency key, and
 * the character qualifies by holding that key or the specific base item — which is how an Elf's
 * longsword training makes a martial weapon usable without martial proficiency.
 */

const MAPS = {
  armor: { light: "lgt", medium: "med", heavy: "hvy", shield: "shl", clothing: true, trinket: true },
  weapon: { simpleM: "sim", simpleR: "sim", martialM: "mar", martialR: "mar", natural: true }
};

const character = ({ armor = [], weapon = [], strength = 10 } = {}) => ({
  armorProf: new Set(armor), weaponProf: new Set(weapon), strength
});

describe("itemUsability", () => {

  it("passes an item the character is trained for", () => {
    const entry = { type: "weapon", subtype: "martialM", baseItem: "greatsword" };
    expect(itemUsability(entry, character({ weapon: ["mar"] }), MAPS))
      .toEqual({ proficient: true, needsStrength: null });
  });

  it("reports a weapon category the character has no training in", () => {
    const entry = { type: "weapon", subtype: "martialM", baseItem: "greatsword" };
    expect(itemUsability(entry, character({ weapon: ["sim"] }), MAPS).proficient).toBe(false);
  });

  it("accepts proficiency in the specific base item, as an Elf has with a longsword", () => {
    const entry = { type: "weapon", subtype: "martialM", baseItem: "longsword" };
    expect(itemUsability(entry, character({ weapon: ["sim", "longsword"] }), MAPS).proficient).toBe(true);
  });

  it("reports armour the character is untrained in", () => {
    const entry = { type: "equipment", subtype: "heavy", baseItem: "plate" };
    expect(itemUsability(entry, character({ armor: ["lgt", "med"] }), MAPS).proficient).toBe(false);
  });

  it("reports armour whose Strength requirement the character misses, and by what", () => {
    const entry = { type: "equipment", subtype: "heavy", baseItem: "plate", strength: 15 };
    const use = itemUsability(entry, character({ armor: ["hvy"], strength: 13 }), MAPS);
    expect(use).toEqual({ proficient: true, needsStrength: 15 });
  });

  it("says nothing about Strength once the character meets the requirement", () => {
    const entry = { type: "equipment", subtype: "heavy", baseItem: "plate", strength: 15 };
    expect(itemUsability(entry, character({ armor: ["hvy"], strength: 15 }), MAPS).needsStrength).toBeNull();
  });

  it("can report both at once", () => {
    const entry = { type: "equipment", subtype: "heavy", baseItem: "plate", strength: 15 };
    const use = itemUsability(entry, character({ strength: 8 }), MAPS);
    expect(use).toEqual({ proficient: false, needsStrength: 15 });
  });

  it("leaves clothing and trinkets alone — worn, not armour", () => {
    for ( const subtype of ["clothing", "trinket"] ) {
      const entry = { type: "equipment", subtype };
      expect(itemUsability(entry, character(), MAPS).proficient).toBe(true);
    }
  });

  it("asks nothing of a wand, a potion or a ring", () => {
    for ( const type of ["consumable", "equipment", "loot"] ) {
      const entry = { type, subtype: "" };
      expect(itemUsability(entry, character(), MAPS)).toEqual({ proficient: true, needsStrength: null });
    }
  });

  it("stays quiet about a category the system's maps don't cover", () => {
    // A third-party weapon category we cannot judge is not the same as one the character fails.
    const entry = { type: "weapon", subtype: "siege", baseItem: "" };
    expect(itemUsability(entry, character(), MAPS).proficient).toBe(true);
  });

  it("is a no-op without a character to measure against", () => {
    const entry = { type: "equipment", subtype: "heavy", strength: 15 };
    expect(itemUsability(entry, null, MAPS)).toEqual({ proficient: true, needsStrength: null });
  });
});

describe("attunementRestriction", () => {

  it("reads a single class out of the headline", () => {
    const html = "<p><em>Wondrous Item, Rare (Requires Attunement by a Bard)</em></p><p>This lute…</p>";
    expect(attunementRestriction(html)).toEqual({ who: "a Bard", names: ["bard"] });
  });

  it("splits a list of classes on commas and 'or'", () => {
    const html = "<p>Requires Attunement by a Sorcerer, Warlock, or Wizard</p>";
    expect(attunementRestriction(html).names).toEqual(["sorcerer", "warlock", "wizard"]);
  });

  it("stops at the end of the headline's paragraph, not the description's first sentence", () => {
    const html = "<p><em>Requires Attunement by a Spellcaster</em></p><p>This staff has 10 charges.</p>";
    expect(attunementRestriction(html)).toEqual({ who: "a Spellcaster", names: ["spellcaster"] });
  });

  it("reads an enricher link as the label a player sees", () => {
    const html = "<p>Requires Attunement by a Dwarf or a Creature Attuned to a "
      + "@UUID[Compendium.dmg.equipment.Item.belt]{Belt of Dwarvenkind}</p>";
    expect(attunementRestriction(html).names).toEqual(["dwarf", "creature attuned to a belt of dwarvenkind"]);
  });

  it("is null for an item any creature may attune to, or none at all", () => {
    expect(attunementRestriction("<p>Wondrous Item, Rare (Requires Attunement)</p>")).toBeNull();
    expect(attunementRestriction("<p>A plain potion.</p>")).toBeNull();
    expect(attunementRestriction("")).toBeNull();
  });
});

describe("unmetAttunement", () => {
  const KNOWN = {
    classes: new Map([["bard", "bard"], ["cleric", "cleric"], ["wizard", "wizard"], ["paladin", "paladin"]]),
    species: new Map([["dwarf", "dwarf"], ["elf", "elf"]])
  };
  const who = (classes = [], { species = [], spellcaster = false } = {}) => ({
    classes: new Set(classes), species: new Set(species), spellcaster
  });
  const limit = html => attunementRestriction(`<p>Requires Attunement by ${html}</p>`);

  it("reports a class limit the character is not", () => {
    expect(unmetAttunement(limit("a Bard"), who(["fighter"]), KNOWN)).toBe("a Bard");
  });

  it("is quiet when the character holds any one of the classes — a multiclass counts", () => {
    expect(unmetAttunement(limit("a Cleric or Paladin"), who(["fighter", "paladin"]), KNOWN)).toBeNull();
  });

  it("reads 'spellcaster' from whether any class casts", () => {
    expect(unmetAttunement(limit("a Spellcaster"), who(["fighter"]), KNOWN)).toBe("a Spellcaster");
    expect(unmetAttunement(limit("a Spellcaster"), who(["fighter"], { spellcaster: true }), KNOWN)).toBeNull();
  });

  it("matches a species as well as a class", () => {
    expect(unmetAttunement(limit("an Elf"), who(["wizard"], { species: ["elf"] }), KNOWN)).toBeNull();
    expect(unmetAttunement(limit("an Elf"), who(["wizard"], { species: ["dwarf"] }), KNOWN)).toBe("an Elf");
  });

  it("says nothing about a limit it cannot fully place", () => {
    // A Dwarf *or* whoever wears the belt — the second half is beyond us, so the whole limit is.
    const belt = limit("a Dwarf or a Creature Attuned to a Belt of Dwarvenkind");
    expect(unmetAttunement(belt, who(["fighter"], { species: ["elf"] }), KNOWN)).toBeNull();
    expect(unmetAttunement(limit("a Creature of the Weapon’s Choice"), who(["fighter"]), KNOWN)).toBeNull();
  });

  it("is a no-op without a limit or a character", () => {
    expect(unmetAttunement(null, who(["fighter"]), KNOWN)).toBeNull();
    expect(unmetAttunement(limit("a Bard"), null, KNOWN)).toBeNull();
  });
});
