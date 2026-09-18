import { describe, expect, it } from "vitest";
import { itemUsability } from "../scripts/data/magic-shop.mjs";

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
