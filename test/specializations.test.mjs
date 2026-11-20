import { describe, it, expect } from "vitest";
import {
  parseSpecializations, recommendationKeys, recommendedInOrder, recommends, specializationId
} from "../scripts/data/specializations.mjs";

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
  spec.keys = spec.refs.flatMap(r => recommendationKeys(r.type, r));

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
