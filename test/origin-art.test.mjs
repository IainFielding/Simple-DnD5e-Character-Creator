import { describe, it, expect } from "vitest";
import {
  artCandidates, artDirectories, artDirectoriesFor, packageOf, resolveOriginArt, slugify
} from "../scripts/data/origin-art.mjs";

/**
 * The art resolver's whole job is to never emit a path that isn't there, because a path that isn't
 * there is a broken image on the first screen a new player sees.
 *
 * The listings below are the real ones, read off the installed modules on 2026-09-20 and trimmed to
 * the entries under test. The irregularities they encode are measured, not guessed, and every one
 * of them is a case that a "just build the path" implementation gets wrong:
 *
 *   - `soldier.webp` exists but `soldier-origin.webp` does not;
 *   - `acolyte-origin.webp` exists but `acolyte.webp` does not;
 *   - no species has a journal banner, so species come from `subjects/` instead;
 *   - `aasimar.webp` is unnumbered where every other species is `<id>-01.webp`;
 *   - the Artificer's art is in its own module, not the PHB's.
 */

const PHB = "modules/dnd-players-handbook/assets/journal-art";
const PHB_SUBJECTS = "modules/dnd-players-handbook/assets/subjects";
const FORGE = "modules/dnd-forge-artificer/assets/journal-art";
// The newer books put their scenes in assets/art/ instead, and suffix backgrounds differently.
const AU_ART = "modules/dnd-arcana-unleashed/assets/art";
const RL_ART = "modules/dnd-ravenloft-horrors-within/assets/art";
const RL_SUBJECTS = "modules/dnd-ravenloft-horrors-within/assets/subjects";

const LISTINGS = {
  [PHB]: new Set([
    // classes — clean 1:1
    "barbarian.webp", "bard.webp", "cleric.webp", "druid.webp", "fighter.webp", "monk.webp",
    "paladin.webp", "ranger.webp", "rogue.webp", "sorcerer.webp", "warlock.webp", "wizard.webp",
    // backgrounds — seven suffixed
    "acolyte-origin.webp", "artisan-origin.webp", "charlatan-origin.webp", "criminal-origin.webp",
    "entertainer-origin.webp", "farmer-origin.webp", "guard-origin.webp",
    // backgrounds — nine bare
    "guide.webp", "hermit.webp", "merchant.webp", "noble.webp", "sage.webp", "sailor.webp",
    "scribe.webp", "soldier.webp", "wayfarer.webp",
    // the lone species-named file, and a scene that must never be mistaken for one
    "tiefling.webp", "dwarf-paladin-uses-divine-smite.webp"
  ]),
  [PHB_SUBJECTS]: new Set([
    "aasimar.webp", "dragonborn-01.webp", "dwarf-01.webp", "elf-01.webp", "gnome-01.webp",
    "goliath-01.webp", "halfling-01.webp", "human-01.webp", "orc-01.webp", "tiefling-01.webp"
  ]),
  [FORGE]: new Set(["artificer.webp", "armorer-icon.webp", "battle-smith.webp"]),
  [AU_ART]: new Set([
    "phantasmic-circus-trouper-background.webp", "seer-apprentice-background.webp",
    "familiar-trainer-background.webp", "enchanter-wizard.webp"
  ]),
  [RL_ART]: new Set(["dhampir.webp", "hexbloods.webp", "hexblood-witch-in-tepest.webp", "reborn.webp"]),
  [RL_SUBJECTS]: new Set(["hexblood.webp", "reborns-01.webp", "reborns-02.webp"])
};

const listingFor = dir => LISTINGS[dir] ?? null;
const phbCard = (identifier, name = identifier) =>
  ({ uuid: `Compendium.dnd-players-handbook.classes.Item.${identifier}`, name, identifier });

describe("slugify", () => {
  it("folds names into the shape the art files are named with", () => {
    expect(slugify("Acolyte")).toBe("acolyte");
    expect(slugify("Half-Elf")).toBe("half-elf");
    expect(slugify("Elf, Drow")).toBe("elf-drow");
    expect(slugify("Nature’s Wrath")).toBe("natures-wrath");
    expect(slugify("  spaced  out  ")).toBe("spaced-out");
  });

  it("survives nothing", () => {
    expect(slugify(undefined)).toBe("");
    expect(slugify("---")).toBe("");
  });
});

describe("packageOf", () => {
  it("reads the package out of a compendium uuid", () => {
    expect(packageOf("Compendium.dnd-players-handbook.classes.Item.abc")).toBe("dnd-players-handbook");
    expect(packageOf("Compendium.dnd-forge-artificer.classes.Item.abc")).toBe("dnd-forge-artificer");
  });

  it("returns null for anything that is not one, so the caller drops a tier", () => {
    expect(packageOf("Item.abc123")).toBeNull();          // a world item
    expect(packageOf("")).toBeNull();
    expect(packageOf(undefined)).toBeNull();
    expect(packageOf("Compendium.")).toBeNull();
  });
});

describe("artDirectories", () => {
  it("searches journal-art before art for scenes, because both conventions are in the wild", () => {
    expect(artDirectories("class", "dnd-players-handbook")).toEqual([PHB, AU_ART.replace("dnd-arcana-unleashed", "dnd-players-handbook")]);
    expect(artDirectories("background", "dnd-players-handbook")[0]).toBe(PHB);
  });

  it("searches subjects first for species, then the scene directories", () => {
    expect(artDirectories("species", "dnd-players-handbook")[0]).toBe(PHB_SUBJECTS);
    expect(artDirectories("species", "dnd-players-handbook")).toContain(
      "modules/dnd-players-handbook/assets/art");
  });

  it("keys off the package, so a third-party book looks in its own directories", () => {
    expect(artDirectories("class", "dnd-forge-artificer")).toContain(FORGE);
  });

  it("is empty for a category it does not know", () => {
    expect(artDirectories("subclass", "dnd-players-handbook")).toEqual([]);
    expect(artDirectories("class", "")).toEqual([]);
  });
});

describe("artCandidates", () => {
  it("tries all three background suffixes, because three books spell it three ways", () => {
    expect(artCandidates("background", "acolyte"))
      .toEqual(["acolyte-origin.webp", "acolyte-background.webp", "acolyte.webp"]);
  });

  it("tries the numbered subject first, then the unnumbered, then the plurals", () => {
    expect(artCandidates("species", "dwarf"))
      .toEqual(["dwarf-01.webp", "dwarf.webp", "dwarfs-01.webp", "dwarfs.webp"]);
  });

  it("has exactly one candidate for a class", () => {
    expect(artCandidates("class", "paladin")).toEqual(["paladin.webp"]);
  });

  it("is empty for an unknown category or a missing identifier", () => {
    expect(artCandidates("subclass", "thief")).toEqual([]);
    expect(artCandidates("class", "")).toEqual([]);
  });
});

describe("resolveOriginArt", () => {
  it("resolves all twelve PHB classes from journal-art", () => {
    const classes = ["barbarian", "bard", "cleric", "druid", "fighter", "monk",
                     "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];
    for ( const id of classes ) {
      const art = resolveOriginArt(phbCard(id), "class", listingFor);
      expect(art?.path, id).toBe(`${PHB}/${id}.webp`);
    }
  });

  it("resolves all sixteen backgrounds across both naming conventions", () => {
    const suffixed = ["acolyte", "artisan", "charlatan", "criminal", "entertainer", "farmer", "guard"];
    const bare = ["guide", "hermit", "merchant", "noble", "sage", "sailor", "scribe", "soldier", "wayfarer"];
    for ( const id of suffixed ) {
      expect(resolveOriginArt(phbCard(id), "background", listingFor)?.file, id).toBe(`${id}-origin.webp`);
    }
    for ( const id of bare ) {
      expect(resolveOriginArt(phbCard(id), "background", listingFor)?.file, id).toBe(`${id}.webp`);
    }
  });

  it("resolves all ten species from subjects, including the unnumbered Aasimar", () => {
    const numbered = ["dragonborn", "dwarf", "elf", "gnome", "goliath", "halfling", "human", "orc", "tiefling"];
    for ( const id of numbered ) {
      expect(resolveOriginArt(phbCard(id), "species", listingFor)?.file, id).toBe(`${id}-01.webp`);
    }
    expect(resolveOriginArt(phbCard("aasimar"), "species", listingFor)?.file).toBe("aasimar.webp");
  });

  it("never serves a species the journal scene that merely mentions it", () => {
    // `dwarf-paladin-uses-divine-smite.webp` illustrates a moment, not a people, and lives in the
    // directory species art is NOT taken from. A resolver that searched by prefix would find it.
    const art = resolveOriginArt(phbCard("dwarf"), "species", listingFor);
    expect(art.dir).toBe(PHB_SUBJECTS);
    expect(art.file).not.toContain("divine-smite");
  });

  it("finds a third-party class in its own module", () => {
    const card = {
      uuid: "Compendium.dnd-forge-artificer.classes.Item.xyz",
      name: "Artificer", identifier: "artificer"
    };
    const art = resolveOriginArt(card, "class", listingFor);
    expect(art).toEqual({
      path: `${FORGE}/artificer.webp`, dir: FORGE, file: "artificer.webp", packageId: "dnd-forge-artificer"
    });
  });

  it("falls back to the name when content ships without an identifier", () => {
    const card = { uuid: "Compendium.dnd-players-handbook.origins.Item.q", name: "Soldier", identifier: "" };
    expect(resolveOriginArt(card, "background", listingFor)?.file).toBe("soldier.webp");
  });

  it("returns null rather than a guess when nothing matches", () => {
    const homebrew = phbCard("gunslinger", "Gunslinger");
    expect(resolveOriginArt(homebrew, "class", listingFor)).toBeNull();
  });

  it("returns null for a world item, which has no package to look in", () => {
    expect(resolveOriginArt({ uuid: "Item.local", name: "Fighter", identifier: "fighter" },
      "class", listingFor)).toBeNull();
  });

  it("returns null when the directory was never browsed or does not exist", () => {
    // A class-only module has no subjects/ directory at all; that must read as "no art", not throw.
    const card = { uuid: "Compendium.dnd-forge-artificer.options.Item.a", name: "Warforged", identifier: "warforged" };
    expect(resolveOriginArt(card, "species", listingFor)).toBeNull();
    expect(resolveOriginArt(phbCard("paladin"), "class", () => null)).toBeNull();
    expect(resolveOriginArt(phbCard("paladin"), "class", () => new Set())).toBeNull();
  });

  it("survives a missing card", () => {
    expect(resolveOriginArt(null, "class", listingFor)).toBeNull();
  });

  it("stops at the first directory that answers", () => {
    const seen = [];
    resolveOriginArt(phbCard("acolyte"), "background", dir => { seen.push(dir); return listingFor(dir); });
    expect(seen).toEqual([PHB]);
  });

  it("finds a background that uses the -background suffix in assets/art", () => {
    // The case that sent Phantasmic Circus Trouper to the icon tier: a newer book, a different
    // directory and a third spelling of the suffix, all at once.
    const card = {
      uuid: "Compendium.dnd-arcana-unleashed.origins.Item.pct",
      name: "Phantasmic Circus Trouper", identifier: "phantasmic-circus-trouper"
    };
    expect(resolveOriginArt(card, "background", listingFor)?.path)
      .toBe(`${AU_ART}/phantasmic-circus-trouper-background.webp`);
  });

  it("finds a lineage whose subject art is pluralised", () => {
    const reborn = {
      uuid: "Compendium.dnd-ravenloft-horrors-within.options.Item.rb",
      name: "Reborn", identifier: "reborn"
    };
    expect(resolveOriginArt(reborn, "species", listingFor)?.file).toBe("reborns-01.webp");
  });

  it("falls through to assets/art for a lineage with no subject at all", () => {
    const dhampir = {
      uuid: "Compendium.dnd-ravenloft-horrors-within.options.Item.dh",
      name: "Dhampir", identifier: "dhampir"
    };
    const art = resolveOriginArt(dhampir, "species", listingFor);
    expect(art?.dir).toBe(RL_ART);
    expect(art?.file).toBe("dhampir.webp");
  });

  it("prefers the subject over the scene when a lineage has both", () => {
    // Hexblood is in subjects/ AND art/. The portrait-orientation painting is the one that crops
    // like a card; the scene ("hexblood-witch-in-tepest") is a moment, not a people.
    const hexblood = {
      uuid: "Compendium.dnd-ravenloft-horrors-within.options.Item.hb",
      name: "Hexblood", identifier: "hexblood"
    };
    expect(resolveOriginArt(hexblood, "species", listingFor)?.dir).toBe(RL_SUBJECTS);
  });
});

describe("artDirectoriesFor", () => {
  it("dedupes, so twelve PHB classes browse the same two directories once", () => {
    const requests = ["barbarian", "bard", "cleric"].map(id => ({ card: phbCard(id), category: "class" }));
    expect(artDirectoriesFor(requests)).toEqual([PHB, "modules/dnd-players-handbook/assets/art"]);
  });

  it("collects every directory the requested packages and categories could use", () => {
    const requests = [
      { card: phbCard("paladin"), category: "class" },
      { card: phbCard("dwarf"), category: "species" },
      { card: { uuid: "Compendium.dnd-forge-artificer.classes.Item.x", identifier: "artificer" }, category: "class" }
    ];
    const dirs = artDirectoriesFor(requests);
    expect(dirs).toContain(PHB);
    expect(dirs).toContain(PHB_SUBJECTS);
    expect(dirs).toContain(FORGE);
    // Deduplicated even though two categories in the same package share a directory.
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it("skips anything with no package, and survives no requests at all", () => {
    expect(artDirectoriesFor([{ card: { uuid: "Item.x" }, category: "class" }])).toEqual([]);
    expect(artDirectoriesFor(undefined)).toEqual([]);
  });
});
