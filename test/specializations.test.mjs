import { describe, it, expect } from "vitest";
import { parseSpecializations, specializationId } from "../scripts/data/specializations.mjs";

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
