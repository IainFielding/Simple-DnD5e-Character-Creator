import { describe, it, expect, beforeEach } from "vitest";
import {
  QUICK_FILLED_STEPS, abilityPreview, asiLine, hasBothEditions, seedThreshold, thresholdClear,
  thresholdRoll, thresholdRollAll
} from "../scripts/app/threshold.mjs";
import {
  PREGEN_SOURCES, availablePremades, findCard, foundryPregens, invalidatePregenCache,
  portraitFor, profileFor
} from "../scripts/data/premades.mjs";
import { CreatorState } from "../scripts/state/creator-state.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { ENTRY_PATHS, SETTINGS, recommendedPath } from "../scripts/config.mjs";

/**
 * The quick-build screen and the ready-made list.
 *
 * Two things are worth testing here and the rest is markup. First, the ability block: it must show
 * the standard array down the class's priorities with the origin increase *on top and visible*, and
 * it must get the increase from the same `allocateOriginAsi` the character is actually built with
 * rather than from a second copy of the arithmetic that can drift. Second, the premade filter: a
 * ready-made character offered in a world that cannot build it is the one failure this whole path
 * is shaped to avoid.
 */

/* The three real ASI shapes this screen has to draw, as `SourceIndex#abilityScoreIncrease`
   flattens them. Same fixtures as test/origin-abilities.test.mjs, deliberately. */
const BG_2024 = { id: "bg", points: 3, canAllocate: true, cap: 2, fixed: {}, locked: [] };
const HILL_DWARF = { id: "hd", points: 0, canAllocate: false, cap: 2, fixed: { con: 2, wis: 1 }, locked: [] };
const HALF_ELF = { id: "he", points: 2, canAllocate: true, cap: 1, fixed: { cha: 2 }, locked: [] };

const card = (uuid, name, identifier, rules = "2024") =>
  ({ uuid, name, identifier, rules, img: `icons/${identifier}.webp` });

const CLASSES = [
  card("Compendium.dnd-players-handbook.classes.Item.pal", "Paladin", "paladin"),
  card("Compendium.dnd-players-handbook.classes.Item.wiz", "Wizard", "wizard")
];
const SPECIES = [
  card("Compendium.dnd-players-handbook.origins.Item.dwa", "Dwarf", "dwarf"),
  card("Compendium.dnd-players-handbook.origins.Item.elf", "Elf", "elf")
];
const BACKGROUNDS = [
  card("Compendium.dnd-players-handbook.origins.Item.sol", "Soldier", "soldier"),
  card("Compendium.dnd-players-handbook.origins.Item.sag", "Sage", "sage")
];

/** A stand-in SourceIndex: the four lookups these functions actually make. */
function fakeSource() {
  const all = [...CLASSES, ...SPECIES, ...BACKGROUNDS];
  return {
    classes: () => CLASSES,
    species: () => SPECIES,
    backgrounds: () => BACKGROUNDS,
    card: uuid => all.find(c => c.uuid === uuid) ?? null,
    rulesOf: () => null,
    abilityScoreIncrease: async () => BG_2024
  };
}

let state;
let source;
beforeEach(() => {
  installFoundryShims();
  state = new CreatorState(null);
  source = fakeSource();
});

describe("abilityPreview", () => {
  it("lays the standard array down the class's priority order", () => {
    state.classUuid = CLASSES[0].uuid;                      // Paladin: str, cha, con, wis, dex, int
    const { plates } = abilityPreview(state, source);
    const byKey = Object.fromEntries(plates.map(p => [p.key, p.base]));
    expect(byKey).toEqual({ str: 15, cha: 14, con: 13, wis: 12, dex: 10, int: 8 });
  });

  it("keeps the plates in ability order regardless of the priority order", () => {
    state.classUuid = CLASSES[0].uuid;
    const { plates } = abilityPreview(state, source);
    expect(plates.map(p => p.key)).toEqual(["str", "dex", "con", "int", "wis", "cha"]);
  });

  it("adds a 2024 background's increase on top, +2 then +1 down the same priority", () => {
    state.classUuid = CLASSES[0].uuid;
    state.backgroundUuid = BACKGROUNDS[0].uuid;
    state.originAsi.background = BG_2024;
    const { plates } = abilityPreview(state, source);
    const byKey = Object.fromEntries(plates.map(p => [p.key, p]));
    expect(byKey.str.bonus).toBe(2);                        // best priority
    expect(byKey.cha.bonus).toBe(1);                        // next
    expect(byKey.con.bonus).toBe(0);
    // The base is still shown, so the player can see where the total came from.
    expect(byKey.str.base).toBe(15);
    expect(byKey.str.total).toBe(17);
    expect(byKey.str.mod).toBe("+3");
  });

  it("shows a purely fixed 2014 species increase with nothing allocated", () => {
    state.classUuid = CLASSES[0].uuid;
    state.speciesUuid = SPECIES[0].uuid;
    state.originAsi.species = HILL_DWARF;
    const byKey = Object.fromEntries(abilityPreview(state, source).plates.map(p => [p.key, p]));
    expect(byKey.con.bonus).toBe(2);
    expect(byKey.wis.bonus).toBe(1);
    expect(byKey.str.bonus).toBe(0);                        // the priority got nothing: no points
  });

  it("lets the cap close an ability the origin already fixed", () => {
    // The Half-Elf's fixed +2 Charisma fills a cap of 1 on its own, so the two free points must go
    // elsewhere. This is the case that catches an implementation counting fixed and allocated
    // separately, and it is why the arithmetic is delegated rather than re-written here.
    state.classUuid = CLASSES[0].uuid;                      // priority str, cha, con, …
    state.speciesUuid = SPECIES[1].uuid;
    state.originAsi.species = HALF_ELF;
    const byKey = Object.fromEntries(abilityPreview(state, source).plates.map(p => [p.key, p]));
    expect(byKey.cha.bonus).toBe(2);                        // the fixed bump, and no more
    expect(byKey.str.bonus).toBe(1);
    expect(byKey.con.bonus).toBe(1);
  });

  it("falls back to a plain ability order for a class with no profile", () => {
    source.card = () => ({ uuid: "x", name: "Homebrewer", identifier: "homebrewer" });
    state.classUuid = "x";
    const { plates } = abilityPreview(state, source);
    expect(plates.map(p => p.base)).toEqual([15, 14, 13, 12, 10, 8]);
  });

  it("renders with no class chosen rather than throwing", () => {
    expect(() => abilityPreview(state, source)).not.toThrow();
  });
});

describe("asiLine", () => {
  const priorities = ["str", "cha", "con", "wis", "dex", "int"];

  it("names the background and what it spent, under 2024 rules", () => {
    state.classUuid = CLASSES[0].uuid;
    state.backgroundUuid = BACKGROUNDS[0].uuid;
    state.originAsi.background = BG_2024;
    const line = asiLine(state, source, priorities);
    expect(line).toContain("asiSpent");
    expect(line).toContain("Soldier");
    expect(line).toContain("+2 STR");
    expect(line).toContain("+1 CHA");
  });

  it("lists what was spent in priority order, not ability order", () => {
    // An Artificer's "+2 INT, +1 CON" read as "+1 CON, +2 INT" when this walked the ability list —
    // the opposite of the priority the line is trying to explain.
    state.classUuid = CLASSES[1].uuid;                      // Wizard: int, con, dex, wis, cha, str
    state.backgroundUuid = BACKGROUNDS[1].uuid;
    state.originAsi.background = BG_2024;
    const line = asiLine(state, source, ["int", "con", "dex", "wis", "cha", "str"]);
    expect(line.indexOf("+2 INT")).toBeLessThan(line.indexOf("+1 CON"));
  });

  it("says fixed when the origin fixes its increase outright", () => {
    state.classUuid = CLASSES[0].uuid;
    state.speciesUuid = SPECIES[0].uuid;
    state.originAsi.species = HILL_DWARF;
    const line = asiLine(state, source, priorities);
    expect(line).toContain("asiFixed");
    expect(line).toContain("+2 CON");
  });

  it("says both when the origin fixes some and allocates the rest", () => {
    state.classUuid = CLASSES[0].uuid;
    state.speciesUuid = SPECIES[1].uuid;
    state.originAsi.species = HALF_ELF;
    expect(asiLine(state, source, priorities)).toContain("asiBoth");
  });

  it("is null when no chosen origin grants an increase", () => {
    state.classUuid = CLASSES[0].uuid;
    expect(asiLine(state, source, priorities)).toBeNull();
  });
});

describe("seedThreshold and thresholdRoll", () => {
  const ctx = () => ({ state, source });

  it("fills all three slots so the screen never opens on blanks", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    expect(state.classUuid).toBe(CLASSES[0].uuid);
    expect(state.speciesUuid).toBe(SPECIES[0].uuid);
    expect(state.backgroundUuid).toBe(BACKGROUNDS[0].uuid);
  });

  it("leaves a slot the player already chose alone", async () => {
    state.classUuid = CLASSES[1].uuid;
    await seedThreshold(ctx(), { rng: () => 0 });
    expect(state.classUuid).toBe(CLASSES[1].uuid);
  });

  it("resolves the origin's ability increase as it selects, so the plates can show it", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    expect(state.originAsi.background).toEqual(BG_2024);
    expect(state.originAsi.species).toEqual(BG_2024);
  });

  it("never rolls the option already showing", async () => {
    state.classUuid = CLASSES[0].uuid;
    // rng 0 would pick index 0 of the *filtered* pool, which excludes the current pick.
    await thresholdRoll(ctx(), "class", { rng: () => 0 });
    expect(state.classUuid).toBe(CLASSES[1].uuid);
  });

  it("is a no-op when there is nothing else to roll to", async () => {
    source.classes = () => [CLASSES[0]];
    state.classUuid = CLASSES[0].uuid;
    await thresholdRoll(ctx(), "class", { rng: () => 0 });
    expect(state.classUuid).toBe(CLASSES[0].uuid);
  });

  it("re-rolls the name with a new species only when asked", async () => {
    state.details.name = "Typed By Hand";
    await thresholdRoll(ctx(), "species", { rng: () => 0, rerollName: false });
    expect(state.details.name).toBe("Typed By Hand");
  });
});

describe("the recommended way in", () => {
  beforeEach(() => installFoundryShims());

  it("defaults to quick build — the path for a player who cannot tell them apart", () => {
    expect(recommendedPath()).toBe("quick");
  });

  it("follows the GM's choice", () => {
    for ( const path of ENTRY_PATHS ) {
      game.settings.set("x", SETTINGS.recommendedPath, path);
      expect(recommendedPath()).toBe(path);
    }
  });

  it("allows no recommendation at all", () => {
    game.settings.set("x", SETTINGS.recommendedPath, "none");
    expect(recommendedPath()).toBe("none");
  });

  it("falls back rather than badging nothing when the stored value names no path", () => {
    // Guards the case where a way in is removed later and a world still names it.
    game.settings.set("x", SETTINGS.recommendedPath, "telepathy");
    expect(recommendedPath()).toBe("quick");
  });
});

describe("QUICK_FILLED_STEPS", () => {
  it("names the steps the build answers for the player", () => {
    // These are what the dossier labels "Quick Build will pick" instead of leaving as an em-dash.
    for ( const id of ["choices", "spells", "equipment", "store"] ) {
      expect(QUICK_FILLED_STEPS.has(id), id).toBe(true);
    }
  });

  it("leaves the magic shop out, because the build does not touch it", () => {
    // `applyQuickBuild` clears `magicShop.picks` and leaves `magicShopVisited` false — those picks
    // are the player's. Adding it here would promise something the build never delivers.
    expect(QUICK_FILLED_STEPS.has("magic-shop")).toBe(false);
    expect(QUICK_FILLED_STEPS.has("magicShop")).toBe(false);
  });

  it("leaves the three the player chooses on the screen itself out", () => {
    for ( const id of ["class", "species", "background"] ) {
      expect(QUICK_FILLED_STEPS.has(id), id).toBe(false);
    }
  });
});

describe("hasBothEditions", () => {
  it("is false when every class comes from one edition", () => {
    expect(hasBothEditions(source)).toBe(false);
  });

  it("is true once both are represented", () => {
    source.classes = () => [...CLASSES, card("Compendium.m.p.Item.old", "Fighter", "fighter", "2014")];
    expect(hasBothEditions(source)).toBe(true);
  });

  it("ignores content that declares no edition, which is offered to either", () => {
    source.classes = () => [...CLASSES, card("Compendium.m.p.Item.hb", "Gunslinger", "gunslinger", null)];
    expect(hasBothEditions(source)).toBe(false);
  });
});

describe("thresholdRollAll", () => {
  const ctx = () => ({ state, source });

  it("changes all three slots at once", async () => {
    state.classUuid = CLASSES[0].uuid;
    state.speciesUuid = SPECIES[0].uuid;
    state.backgroundUuid = BACKGROUNDS[0].uuid;
    await thresholdRollAll(ctx(), { rng: () => 0 });
    // Each category avoids what was already showing, so with two of each the other one wins.
    expect(state.classUuid).toBe(CLASSES[1].uuid);
    expect(state.speciesUuid).toBe(SPECIES[1].uuid);
    expect(state.backgroundUuid).toBe(BACKGROUNDS[1].uuid);
  });

  it("rolls the name too, even one the player typed", async () => {
    // Unlike the species die, which leaves a typed name alone: asking for a random character is
    // asking for a random name.
    await seedThreshold(ctx(), { rng: () => 0 });
    state.details.name = "Typed By Hand";
    await thresholdRollAll(ctx(), { rng: () => 0 });
    expect(state.details.name).not.toBe("Typed By Hand");
    expect(state.details.name).toBeTruthy();
  });

  it("resolves the new origins' ability increases, so the plates follow", async () => {
    await thresholdRollAll(ctx(), { rng: () => 0 });
    expect(state.originAsi.background).toEqual(BG_2024);
    expect(state.originAsi.species).toEqual(BG_2024);
  });

  it("fills empty slots as readily as it changes full ones", async () => {
    await thresholdRollAll(ctx(), { rng: () => 0 });
    expect(state.classUuid).toBeTruthy();
    expect(state.speciesUuid).toBeTruthy();
    expect(state.backgroundUuid).toBeTruthy();
  });
});

describe("thresholdClear", () => {
  const ctx = () => ({ state, source });

  it("clears the slot, so browsing opens on a question rather than an answer", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    await thresholdClear(ctx(), "class");
    expect(state.classUuid).toBeNull();
  });

  it("clears the ability increase the cleared origin granted", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    expect(state.originAsi.background).toEqual(BG_2024);
    await thresholdClear(ctx(), "background");
    expect(state.backgroundUuid).toBeNull();
    expect(state.originAsi.background).toBeUndefined();
  });

  it("leaves the other two slots alone", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    const { speciesUuid, backgroundUuid } = state;
    await thresholdClear(ctx(), "class");
    expect(state.speciesUuid).toBe(speciesUuid);
    expect(state.backgroundUuid).toBe(backgroundUuid);
  });

  it("re-seeds only the cleared slot when the player comes back empty-handed", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    const kept = state.speciesUuid;
    await thresholdClear(ctx(), "class");
    await seedThreshold(ctx(), { rng: () => 0 });
    expect(state.classUuid).toBe(CLASSES[0].uuid);
    expect(state.speciesUuid).toBe(kept);
  });

  it("ignores a category it does not own", async () => {
    await seedThreshold(ctx(), { rng: () => 0 });
    await expect(thresholdClear(ctx(), "spells")).resolves.toBeUndefined();
    expect(state.classUuid).toBe(CLASSES[0].uuid);
  });
});

describe("the rules edition", () => {
  const ctx = () => ({ state, source });

  it("seeds only from the edition asked for", async () => {
    const legacy = card("Compendium.m.p.Item.old", "Fighter", "fighter", "2014");
    source.classes = () => [...CLASSES, legacy];
    await seedThreshold(ctx(), { rng: () => 0, rules: "2014" });
    expect(state.classUuid).toBe(legacy.uuid);
  });

  it("still offers content that declares no edition", async () => {
    const homebrew = card("Compendium.m.p.Item.hb", "Gunslinger", "gunslinger", null);
    source.classes = () => [homebrew];
    await seedThreshold(ctx(), { rng: () => 0, rules: "2014" });
    expect(state.classUuid).toBe(homebrew.uuid);
  });

  it("rolls within the edition rather than out of it", async () => {
    const legacyA = card("Compendium.m.p.Item.a", "Fighter", "fighter", "2014");
    const legacyB = card("Compendium.m.p.Item.b", "Rogue", "rogue", "2014");
    source.classes = () => [...CLASSES, legacyA, legacyB];
    state.classUuid = legacyA.uuid;
    await thresholdRoll(ctx(), "class", { rng: () => 0, rules: "2014" });
    expect(state.classUuid).toBe(legacyB.uuid);
  });
});

describe("Foundry's pregenerated characters", () => {
  const doc = (id, name, cls, race, bg, img = `systems/dnd5e/tokens/heroes/${cls}${race}.webp`,
               { levels = 1, bio = "" } = {}) => ({
    id, name, uuid: `Compendium.dnd5e.actors24.Actor.${id}`, img, type: "character",
    system: { details: { biography: { value: bio } } },
    items: [
      { type: "class", name: cls, system: { levels },
        img: `systems/dnd5e/icons/classes/${cls.toLowerCase()}.webp` },
      { type: "race", name: race, img: "icons/x.webp" },
      { type: "background", name: bg, img: "icons/y.webp" }
    ]
  });

  const pack = docs => ({
    getIndex: async () => docs.map(d => ({ _id: d.id, name: d.name, type: d.type })),
    getDocument: async id => docs.find(d => d.id === id) ?? null
  });

  /** Only the dnd5e pack exists in these tests; the other sources contribute nothing. */
  const packs = docs => ({ get: id => (id === "dnd5e.actors24" ? pack(docs) : null) });
  /** The entries of the one group, flattened — what the card list is built from. */
  const entries = async () => (await foundryPregens()).flatMap(g => g.entries);

  beforeEach(() => invalidatePregenCache());

  it("offers only the level 1 pregens, not 5, 11 and 17", async () => {
    // Level is read off the class items, not guessed from the id — the id only narrows the load.
    game.packs = packs([
      doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte", undefined, { levels: 1 }),
      doc("AkraLv0500000000", "Akra", "Cleric", "Dragonborn", "Acolyte", undefined, { levels: 5 }),
      doc("AkraLv1700000000", "Akra", "Cleric", "Dragonborn", "Acolyte", undefined, { levels: 17 })
    ]);
    const out = await entries();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("AkraLv0100000000");
  });

  it("describes each one by species, class and background", async () => {
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte")]);
    const [akra] = await entries();
    expect(akra.name).toBe("Akra");
    expect(akra.line).toBe("Dragonborn Cleric 1 \u00b7 Acolyte");
  });

  it("uses the character's own portrait", async () => {
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte")]);
    const [akra] = await entries();
    expect(akra.img).toBe("systems/dnd5e/tokens/heroes/ClericDragonborn.webp");
  });

  it("falls back to the class illustration for a character with no portrait", async () => {
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte", null)]);
    expect((await entries())[0].img).toBe("systems/dnd5e/icons/classes/cleric.webp");
  });

  it("treats the generic silhouette as no portrait, not as one", async () => {
    // A character document with no image resolves to a placeholder rather than to nothing, so
    // `if ( doc.img )` is not the question — "is this actually a picture of them" is.
    game.packs = packs([
      doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte",
          "systems/dnd5e/icons/svg/actors/character.svg")
    ]);
    expect((await entries())[0].img).toBe("systems/dnd5e/icons/classes/cleric.webp");
  });

  it("sorts by name, so the list does not follow pack order", async () => {
    game.packs = packs([
      doc("ZannaLv010000000", "Zanna", "Wizard", "Gnome", "Sage"),
      doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte")
    ]);
    expect((await entries()).map(e => e.name)).toEqual(["Akra", "Zanna"]);
  });

  it("takes a sentence of description from the biography", async () => {
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte", undefined,
      { bio: "<p>A <strong>dragonborn</strong> cleric of Bahamut.</p>" })]);
    expect((await entries())[0].tagline).toBe("A dragonborn cleric of Bahamut.");
  });

  it("shows no description for a pack whose biographies are not descriptions", async () => {
    // The PHB example characters all carry the same ~1,900 characters of the book's own
    // character-creation walkthrough in their biography. There is nothing to trim that down to, so
    // the source opts out rather than printing a sentence of someone else's instructions.
    const phb = PREGEN_SOURCES.find(src => src.pack === "dnd-players-handbook.actors");
    expect(phb.describe).toBe(false);
  });

  it("leaves the description empty where a pack ships no biographies", async () => {
    // Heroes of the Borderlands is exactly this case, so the card treats it as optional.
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte")]);
    expect((await entries())[0].tagline).toBe("");
  });

  it("groups by the book, and names it", async () => {
    game.packs = packs([doc("AkraLv0100000000", "Akra", "Cleric", "Dragonborn", "Acolyte")]);
    const [group] = await foundryPregens();
    expect(group.pack).toBe("dnd5e.actors24");
    expect(group.badge).toBe("icons/vtt-512.png");
  });

  it("survives a document with neither a portrait nor a class", () => {
    expect(portraitFor({ img: null }, undefined)).toBe("icons/svg/mystery-man.svg");
  });

  it("is empty, not broken, in a world without the pack", async () => {
    game.packs = { get: () => null };
    expect(await foundryPregens()).toEqual([]);
  });

  it("is empty, not broken, when the pack cannot be read", async () => {
    game.packs = { get: () => ({ getIndex: async () => { throw new Error("nope"); } }) };
    expect(await foundryPregens()).toEqual([]);
  });
});

describe("premades", () => {
  const PREMADE = {
    id: "thorne", name: "Thorne", tagline: "t",
    class: "paladin", species: "dwarf", background: "soldier",
    needs: ["dnd-players-handbook"]
  };

  it("offers a premade whose modules and content are both present", () => {
    game.modules.get = () => ({ active: true });
    expect(availablePremades(source, [PREMADE])).toHaveLength(1);
  });

  it("hides one whose module is not installed, rather than half-building it", () => {
    game.modules.get = () => null;
    expect(availablePremades(source, [PREMADE])).toHaveLength(0);
  });

  it("hides one whose module is active but whose content the index cannot see", () => {
    // A module can be active with its packs disabled, or excluded by the world's source filtering.
    // Checking `needs` alone would offer a character that then failed to build.
    game.modules.get = () => ({ active: true });
    source.classes = () => [];
    expect(availablePremades(source, [PREMADE])).toHaveLength(0);
  });

  it("resolves each named identifier to its card", () => {
    game.modules.get = () => ({ active: true });
    const [entry] = availablePremades(source, [PREMADE]);
    expect(entry.class.name).toBe("Paladin");
    expect(entry.species.name).toBe("Dwarf");
    expect(entry.background.name).toBe("Soldier");
  });

  it("matches on the display name when content ships without an identifier", () => {
    const nameless = [{ uuid: "Compendium.m.p.Item.x", name: "Soldier", identifier: "" }];
    expect(findCard(nameless, "soldier")?.name).toBe("Soldier");
  });

  it("returns only the fields a premade overrides, so the class profile shows through", () => {
    expect(profileFor(PREMADE)).toEqual({});
    expect(profileFor({ ...PREMADE, skills: ["ath"] })).toEqual({ skills: ["ath"] });
  });

  it("drops an empty array rather than blanking the class's suggestions with it", () => {
    expect(profileFor({ ...PREMADE, skills: [] })).toEqual({});
  });
});
