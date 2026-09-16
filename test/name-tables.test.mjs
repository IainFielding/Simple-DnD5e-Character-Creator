import { describe, it, expect } from "vitest";
import { NAME_STYLES, SPECIES_STYLE_ALIASES } from "../scripts/data/name-data.mjs";
import { styleForSpecies, generateName, nameStyleOptions } from "../scripts/data/name-generator.mjs";

/**
 * The random-name tables.
 *
 * Pure authored data, so the risk is not logic but erosion: a style added without one of its three
 * pools, a name pasted in twice, an alias pointing at a style that was renamed, or a pool that
 * quietly shrinks until the generator repeats itself in play. These guard all four, plus the
 * promise the data file makes in its header — that every species published by the content modules
 * this module reads resolves to a style of its own rather than falling through to "default".
 */
describe("name tables", () => {
  const styles = Object.entries(NAME_STYLES);

  it("gives every style all three pools, with no blank or repeated entry", () => {
    for ( const [key, style] of styles ) {
      for ( const pool of ["male", "female", "surnames"] ) {
        const list = style[pool];
        expect(Array.isArray(list), `${key}.${pool} is an array`).toBe(true);
        expect(list.filter(n => typeof n !== "string" || !n.trim()), `${key}.${pool} blanks`).toEqual([]);
        expect(new Set(list).size, `${key}.${pool} is free of duplicates`).toBe(list.length);
      }
    }
  });

  // Below twenty a style starts repeating itself inside a single session; a surname pool is
  // combined with a given name, so it carries less of the variety and is held to a lower floor.
  it("keeps every pool large enough not to repeat itself", () => {
    for ( const [key, style] of styles ) {
      expect(style.male.length, `${key}.male`).toBeGreaterThanOrEqual(20);
      expect(style.female.length, `${key}.female`).toBeGreaterThanOrEqual(20);
      if ( style.surnames.length ) expect(style.surnames.length, `${key}.surnames`).toBeGreaterThanOrEqual(12);
    }
  });

  it("points every alias at a style that exists", () => {
    for ( const [alias, style] of Object.entries(SPECIES_STYLE_ALIASES) ) {
      expect(NAME_STYLES[style], `alias ${alias} -> ${style}`).toBeDefined();
    }
  });

  it("offers a fallback style the generator can always reach", () => {
    expect(NAME_STYLES.default).toBeDefined();
    expect(styleForSpecies("no-such-species")).toBe("default");
    expect(styleForSpecies("")).toBe("default");
    expect(styleForSpecies(undefined)).toBe("default");
    expect(nameStyleOptions().map(o => o.key)).toContain("default");
  });

  /**
   * Every species item published by the content modules the creator reads, as
   * `[display name, system.identifier]`. The Ravenloft lineages ship with an empty
   * identifier, which is exactly why the generator matches on the name as well.
   */
  const SPECIES = [
    // dnd5e system (2014) and Player's Handbook (2024)
    ["Human", "human"], ["Hill Dwarf", "hill-dwarf"], ["High Elf", "high-elf"], ["Half-Elf", "half-elf"],
    ["Rock Gnome", "rock-gnome"], ["Lightfoot Halfling", "lightfoot-halfling"], ["Half-Orc", "half-orc"],
    ["Tiefling", "tiefling"], ["Dragonborn", "dragonborn"], ["Aasimar", "aasimar"], ["Dwarf", "dwarf"],
    ["Elf, Drow", "elf-drow"], ["Elf, High", "elf-high"], ["Elf, Wood", "elf-wood"],
    ["Gnome, Forest", "gnome-forest"], ["Gnome, Rock", "gnome-rock"], ["Goliath", "goliath"],
    ["Halfling", "halfling"], ["Orc", "orc"], ["Tiefling, Abyssal", "tiefling-abyssal"],
    ["Tiefling, Chthonic", "tiefling-chthonic"], ["Tiefling, Infernal", "tiefling-infernal"],
    // Eberron: Forge of the Artificer
    ["Changeling", "changeling"], ["Kalashtar", "kalashtar"], ["Khoravar", "khoravar"],
    ["Shifter", "shifter"], ["Warforged", "warforged"],
    // Ravenloft: Heroes of Horror — no identifiers, matched by name
    ["Dhampir", ""], ["Hexblood", ""], ["Lupin", ""], ["Reborn", ""],
    // DM's Toolkit species pack
    ["Aarakocra", "aarakocra"], ["Boggart", "boggart"], ["Bugbear", "bugbear"],
    ["Dragonborn, Gem", "dragonborn-gem"], ["Elf, Lorwyn", "elf-lorwyn"], ["Elf, Shadowmoor", "elf-shadowmoor"],
    ["Frogfolk", "frogfolk"], ["Giff", "giff"], ["Githyanki", "githyanki"], ["Githzerai", "githzerai"],
    ["Gnome, Deep", "deep-gnome"], ["Goblin", "goblin"], ["Kenku", "kenku"],
    ["Kithkin, Shadowmoor", "kithkin-shadowmoor"], ["Loxodon", "loxodon"], ["Tabaxi", "tabaxi"],
    ["Tortle", "tortle"],
    // Theros and Wild Beyond the Witchlight
    ["Centaur", "centaur"], ["Leonin", "leonin"], ["Minotaur", "minotaur"], ["Satyr", "satyr"],
    ["Triton", "triton"], ["Fairy", "fairy"], ["Harengon", "harengon"]
  ];

  it.each(SPECIES)("gives %s a style of its own", (name, identifier) => {
    expect(styleForSpecies(identifier || name)).not.toBe("default");
  });

  it("names a species that ships without an identifier, from its name", () => {
    // Regression: the Ravenloft lineages have an empty `system.identifier`, so matching on the
    // identifier alone dropped all four onto the generic pool their own styles were written for.
    const name = generateName("Lupin", { gender: "female" });
    expect(NAME_STYLES.lupin.female).toContain(name.split(" ")[0]);
  });

  it("folds punctuation and case out of a lookup", () => {
    expect(styleForSpecies("Elf, Drow")).toBe("elf");
    expect(styleForSpecies("HALF-ORC")).toBe("half-orc");
    expect(styleForSpecies("  Kithkin, Shadowmoor  ")).toBe("kithkin");
  });
});
