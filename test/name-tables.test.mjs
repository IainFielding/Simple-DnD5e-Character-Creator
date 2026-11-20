import { describe, it, expect } from "vitest";
import { NAME_STYLES, SPECIES_STYLE_ALIASES, PACKAGE_STYLE_ALIASES, LINEAGE_STYLE_ALIASES } from "../scripts/data/name-data.mjs";
import { styleForSpecies, generateName, nameStyleOptions, speciesNameKey } from "../scripts/data/name-generator.mjs";

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
    ["Triton", "triton"], ["Fairy", "fairy"], ["Harengon", "harengon"],
    // World of Warcraft (its Goblin is told from the D&D one by package — see below)
    ["Dracthyr", "dracthyr"], ["Draenei", "draenei"], ["Earthen", "earthen"], ["Forsaken", "forsaken"],
    ["Haranir", "haranir"], ["Mechagnome", "mechagnome"], ["Pandaren", "pandaren"], ["Tauren", "tauren"],
    ["Troll", "troll"], ["Vulpera", "vulpera"], ["Worgen", "worgen"]
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

  it("points every package alias at a style that exists", () => {
    for ( const [pkg, aliases] of Object.entries(PACKAGE_STYLE_ALIASES) ) {
      for ( const [alias, style] of Object.entries(aliases) ) {
        expect(NAME_STYLES[style], `${pkg} ${alias} -> ${style}`).toBeDefined();
      }
    }
  });

  // Both books' Goblin is `goblin`: the D&D one keeps the goblinoid names it always had, the
  // Warcraft one gets its own, told apart by the package that publishes it.
  it("names World of Warcraft's Goblin apart from D&D's", () => {
    const wow = { uuid: "Compendium.dnd-world-warcraft.origins.Item.goblin0000000000", identifier: "goblin", name: "Goblin" };
    const dnd = { uuid: "Compendium.sogrom-dms-toolkit.species.Item.goblin0000000000", identifier: "goblin", name: "Goblin" };
    expect(styleForSpecies(speciesNameKey(wow))).toBe("warcraft-goblin");
    expect(styleForSpecies(speciesNameKey(dnd))).toBe("goblinoid");
    // Anything else is its identifier, or its name when it has none.
    expect(speciesNameKey({ uuid: "Compendium.dnd-world-warcraft.origins.Item.x", identifier: "tauren" })).toBe("tauren");
    expect(speciesNameKey({ name: "Lupin" })).toBe("Lupin");
    expect(speciesNameKey(null)).toBe("");
  });

  it("points every lineage alias at a style that exists", () => {
    for ( const [pkg, aliases] of Object.entries(LINEAGE_STYLE_ALIASES) ) {
      for ( const [alias, style] of Object.entries(aliases) ) {
        expect(NAME_STYLES[style], `${pkg} ${alias} -> ${style}`).toBeDefined();
      }
    }
  });

  /**
   * World of Warcraft's fourteen lineages as the pack ships them, `[name, identifier, species, style]`.
   * A lineage whose people are named like their species keeps the species' style.
   */
  const WOW = "Compendium.dnd-world-warcraft.origins.Item.";
  const LINEAGES = [
    ["Blood Elf", "blood-elf-lineage", "elf", "blood-elf"],
    ["Void Elf", "void-elf-lineage", "elf", "void-elf"],
    ["Night Elf", "night-elf-lineage", "elf", "night-elf"],
    ["Nightborne", "nightborne-lineage", "elf", "nightborne"],
    ["Zandalari Troll", "zandalari-troll-lineage", "troll", "zandalari-troll"],
    ["Amani Troll", "amani-troll-lineage", "troll", "amani-troll"],
    ["Darkspear Troll", "darkspear-troll-lineage", "troll", "troll"],
    ["Highmountain Tauren", "highmountain-tauren-lineage", "tauren", "highmountain-tauren"],
    ["Mulgore Tauren", "mulgore-tauren-lineage", "tauren", "tauren"],
    ["Taunka", "taunka-lineage", "tauren", "taunka"],
    ["Draenei", "draenei-lineage", "draenei", "draenei"],
    ["Krokul", "krokul-lineage", "draenei", "krokul"],
    ["Lightforged", "lightforged-lineage", "draenei", "draenei"],
    ["Mar'ari", "marari-lineage", "draenei", "draenei"]
  ];

  it.each(LINEAGES)("names a %s in its own people's style", (label, identifier, species, style) => {
    const lineage = { uuid: `${WOW}${identifier}`, identifier, label };
    expect(styleForSpecies(speciesNameKey({ identifier: species }, lineage))).toBe(style);
  });

  it("names a Blood Elf and a Night Elf apart, though both are one Elf", () => {
    const elf = { uuid: "Compendium.dnd-players-handbook.origins.Item.elf", identifier: "elf", name: "Elf" };
    const blood = { uuid: `${WOW}bloodelf`, identifier: "blood-elf-lineage", label: "Blood Elf" };
    const night = { uuid: `${WOW}nightelf`, identifier: "night-elf-lineage", label: "Night Elf" };
    expect(speciesNameKey(elf, blood)).toBe("blood-elf");
    expect(speciesNameKey(elf, night)).toBe("night-elf");
    expect(NAME_STYLES["blood-elf"].surnames).toContain(generateName("blood-elf").split(" ")[1]);
  });

  it("finds a lineage by its identifier in a world that translates its name", () => {
    const lineage = { uuid: `${WOW}zandalari`, identifier: "zandalari-troll-lineage", label: "Zandalari-Troll (übersetzt)" };
    expect(speciesNameKey({ identifier: "troll" }, lineage)).toBe("zandalari-troll");
  });

  it("finds a lineage by its name when it has no identifier", () => {
    const lineage = { uuid: `${WOW}taunka`, name: "Taunka" };
    expect(speciesNameKey({ identifier: "tauren" }, lineage)).toBe("taunka");
  });

  it("keeps the species' style for a lineage of another book, or none", () => {
    const elf = { identifier: "elf", name: "Elf" };
    const drow = { uuid: "Compendium.dnd-players-handbook.origins.Item.drow", identifier: "drow", label: "Drow" };
    // Another book's lineage that happens to share a Warcraft lineage's name is not a Warcraft one.
    const imposter = { uuid: "Compendium.some-homebrew.origins.Item.x", identifier: "blood-elf-lineage", label: "Blood Elf" };
    expect(speciesNameKey(elf, drow)).toBe("elf");
    expect(speciesNameKey(elf, imposter)).toBe("elf");
    expect(speciesNameKey(elf, null)).toBe("elf");
  });

  it("folds punctuation and case out of a lookup", () => {
    expect(styleForSpecies("Elf, Drow")).toBe("elf");
    expect(styleForSpecies("HALF-ORC")).toBe("half-orc");
    expect(styleForSpecies("  Kithkin, Shadowmoor  ")).toBe("kithkin");
  });
});
