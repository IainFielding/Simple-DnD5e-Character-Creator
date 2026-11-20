import { describe, it, expect, beforeEach } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  parseSpecializations, recommendationKeys, recommendedInOrder, recommends, specializationId,
  specializationsFor, resetSpecializations
} from "../scripts/data/specializations.mjs";
import { isHeroName } from "../scripts/data/warcraft.mjs";
import { specializationStep } from "../scripts/levelup/steps/specialization-step.mjs";

/**
 * Reading World of Warcraft's "Playing a …" pages into specializations. The shapes below are the
 * book's own: "<Name> Specialization" headings (h3 on some pages, h4 on others), item links for the
 * picks, and a sub-heading inside a section (the Hunter's "Level 6: Pet …").
 */
const link = (id, label) => `@UUID[Compendium.p.x.Item.${id}]{${label}}`;
const PAGE = [
  "<p>To play a hunter, choose the Ranger class.</p>",
  "<h4>Beast Mastery Specialization</h4>",
  `<p>You fight beside your pet. ${link("bm1", "Beast Master")}</p>`,
  `<p><strong>Level 1.</strong> Prepare ${link("spell1", "Hunter's Mark")}.</p>`,
  "<h4>Level 6: Pet Specialization</h4>",
  `<p>Choose ${link("pet", "Pet Specialization")}. Also ${link("spell1", "Hunter's Mark")} again.</p>`,
  "<h4>Marksmanship Specialization</h4>",
  `<p>You shoot from afar.</p><p><strong>Feats.</strong> ${link("feat1", "Sharpshooter")}</p>`,
  "<h3>Hunter Pets</h3>",
  `<p>${link("other", "Not a pick")}</p>`
].join("");

describe("parseSpecializations", () => {
  it("finds each specialization by its heading, in order", () => {
    expect(parseSpecializations(PAGE).map(s => s.name)).toEqual(["Beast Mastery", "Marksmanship"]);
    // "Level 6: Pet Specialization" is a sub-heading inside Beast Mastery, not a fourth one.
  });

  it("keeps a sub-heading inside its specialization", () => {
    const [bm] = parseSpecializations(PAGE);
    expect(bm.links).toEqual(["Compendium.p.x.Item.bm1", "Compendium.p.x.Item.spell1", "Compendium.p.x.Item.pet"]);
  });

  it("ends a section at a higher heading, so the page's other sections are not picks", () => {
    const [, mm] = parseSpecializations(PAGE);
    expect(mm.links).toEqual(["Compendium.p.x.Item.feat1"]);
  });

  it("takes the first paragraph as the introduction", () => {
    expect(parseSpecializations(PAGE)[1].intro).toBe("<p>You shoot from afar.</p>");
  });

  it("returns nothing for a page without specializations", () => {
    expect(parseSpecializations("<h3>Languages</h3><p>Common.</p>")).toEqual([]);
    expect(parseSpecializations(null)).toEqual([]);
  });

  it("ids a specialization by its slugged name", () => {
    expect(specializationId("Beast Mastery")).toBe("beast-mastery");
  });
});

/**
 * The book links one package's copy of a spell; the Spells page may list another's. Recognising a
 * recommendation by uuid alone badged nothing in a world running the Player's Handbook module.
 */
describe("recommends", () => {
  const ref = { type: "spell", uuid: "Compendium.dnd-players-handbook.spells.Item.hm", identifier: "hunters-mark", name: "Hunter's Mark" };
  const spec = { refs: [ref, { type: "feat", uuid: "Compendium.p.feats.Item.ss", identifier: "sharpshooter", name: "Sharpshooter" }] };
  spec.keys = new Set(spec.refs.flatMap(r => recommendationKeys(r.type, r)));

  it("matches the same spell from another package by identifier", () => {
    expect(recommends(spec, "spell", { uuid: "Compendium.dnd5e.spells24.Item.x", identifier: "hunters-mark", name: "Hunter's Mark" })).toBe(true);
  });

  it("matches by name when a row carries no identifier", () => {
    expect(recommends(spec, "spell", { uuid: "Compendium.w.s.Item.y", name: "hunter's mark" })).toBe(true);
  });

  it("keeps types apart and rejects other items", () => {
    expect(recommends(spec, "feat", { name: "Hunter's Mark" })).toBe(false);
    expect(recommends(spec, "spell", { uuid: "Compendium.w.s.Item.z", identifier: "bless", name: "Bless" })).toBe(false);
    expect(recommends(null, "spell", { name: "Hunter's Mark" })).toBe(false);
  });

  it("reads a document's system identifier", () => {
    expect(recommends(spec, "feat", { uuid: "u", system: { identifier: "sharpshooter" }, name: "Sharp Shooter" })).toBe(true);
  });

  it("lists the recommended candidates in the book's order", () => {
    const pool = [{ uuid: "a", name: "Bless" }, { uuid: "b", name: "Hunter's Mark", identifier: "hunters-mark" }];
    expect(recommendedInOrder(spec, "spell", pool).map(c => c.uuid)).toEqual(["b"]);
    expect(recommendedInOrder(spec, "feat", pool)).toEqual([]);
  });
});

/**
 * A hero class's page is told from its base class's by the entry's name. The module's hero names are
 * localisation keys and its book is English, so in a German world "Death Knight" is not the hero's
 * translated "Todesritter". Matched on the translated name alone, the Death Knight's page was filed
 * as the Paladin's own and replaced it.
 */
describe("the specialization index", () => {
  const WOW = "dnd-world-warcraft";
  const PALADIN = "Compendium.p.classes.Item.paladin";
  const page = (name, specs) => ({
    name, type: "text", uuid: `Compendium.${WOW}.book.JournalEntry.x.JournalEntryPage.${name}`,
    text: { content: `<p>Choose the @UUID[${PALADIN}]{Paladin} class.</p>`
      + specs.map(s => `<h4>${s} Specialization</h4><p>${s}.</p><p>@UUID[Compendium.p.feats.Item.${s}]{${s}}</p>`).join("") }
  });

  beforeEach(() => {
    installFoundryShims();
    resetSpecializations();
    const hero = { name: "WOW.HeroClasses.DeathKnight", identifier: "death-knight", img: "dk.webp" };
    game.modules = { get: id => (id === WOW) ? { active: true, config: { heroClasses: { paladin: [hero] } } } : null };
    game.i18n.localize = key => (key === "WOW.HeroClasses.DeathKnight") ? "Todesritter" : key;
    const entries = [
      { name: "Paladin", pages: [page("Playing a Paladin", ["Holy", "Protection"])] },
      { name: "Death Knight", pages: [page("Playing a Death Knight", ["Blood", "Unholy"])] }
    ];
    game.packs = { get: id => (id === `${WOW}.book`) ? { getDocuments: async () => entries } : null };
    globalThis.fromUuid = async uuid => (uuid === PALADIN)
      ? { uuid, type: "class", name: "Paladin", system: { identifier: "paladin" } }
      : { uuid, type: "feat", name: uuid.split(".").pop(), system: { identifier: uuid.split(".").pop().toLowerCase() } };
  });

  it("files a hero's page under the hero in a world in another language", async () => {
    expect((await specializationsFor("paladin")).map(s => s.id)).toEqual(["holy", "protection"]);
    expect((await specializationsFor("paladin", "death-knight")).map(s => s.id)).toEqual(["blood", "unholy"]);
  });

  it("keeps the first page when a second claims the same class", async () => {
    // A hero entry the matcher cannot place reads as its base class; it must not replace that page.
    game.modules.get(WOW).config.heroClasses.paladin = [];
    expect((await specializationsFor("paladin")).map(s => s.id)).toEqual(["holy", "protection"]);
  });
  /** A class item on the driver's clone: flags written through updateSource, as dnd5e's would be. */
  const classItem = (hero = null) => {
    const item = { system: { identifier: "paladin" }, flags: hero ? { [WOW]: { heroClass: hero } } : {} };
    item.updateSource = changes => {
      for ( const [path, value] of Object.entries(changes) ) {
        const [, scope, key] = path.split(".");
        (item.flags[scope] ??= {})[key] = value;
      }
    };
    return item;
  };
  const levelState = item => ({ classItem: item, committed: false, gainedLevels: () => [4, 5] });

  it("offers the class's specializations at level-up, on the first level screen only", async () => {
    const state = levelState(classItem());
    const block = await specializationStep.sectionsAt({ state }, 4);
    expect(block.options.map(o => o.id)).toEqual(["holy", "protection"]);
    expect(block.chosen).toBe(false);
    expect(await specializationStep.sectionsAt({ state }, 5)).toBeNull();
    // A hero class offers its own.
    const dk = await specializationStep.sectionsAt({ state: levelState(classItem("death-knight")) }, 4);
    expect(dk.options.map(o => o.id)).toEqual(["blood", "unholy"]);
  });

  it("writes the level-up pick to the class item, and None clears it", async () => {
    const item = classItem();
    const state = levelState(item);
    specializationStep.handle("specPick", { value: "protection" }, { state });
    expect(item.flags["sogrom-dnd5e-character-creator"].specialization).toBe("protection");
    const block = await specializationStep.sectionsAt({ state }, 4);
    expect(block.options.find(o => o.selected)?.id).toBe("protection");
    specializationStep.handle("specPick", { value: "" }, { state });
    expect(item.flags["sogrom-dnd5e-character-creator"].specialization).toBeNull();
  });
});

describe("isHeroName", () => {
  const hero = { identifier: "death-knight", name: "Todesritter" };
  it("matches the translated name or the name the identifier was slugged from", () => {
    expect(isHeroName("Todesritter", hero)).toBe(true);
    expect(isHeroName("Death Knight", hero)).toBe(true);
    expect(isHeroName("Demon Hunter", hero)).toBe(false);
    expect(isHeroName("", hero)).toBe(false);
  });
});
