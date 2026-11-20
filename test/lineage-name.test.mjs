import { describe, it, expect, beforeEach } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  lineageShortName, lineageCardName, lineageArt, lineageRename, LINEAGE_FLAG
} from "../scripts/data/lineage-name.mjs";

/**
 * Naming a species for its lineage: the Species page's cards and the rename of the built species
 * item. The shims' `t` echoes the key and its data, so the assertions read the data
 * handed to the format string.
 */
describe("lineage naming", () => {
  beforeEach(() => installFoundryShims());

  it("qualifies a species by the lineage's own name", () => {
    expect(lineageShortName("Drow")).toBe("Drow");
    expect(lineageShortName("Gold Dragon Ancestor")).toBe("Gold Dragon Ancestor");
  });

  it("keeps only the bracketed part of a lineage named with brackets", () => {
    expect(lineageShortName("Cloud's Jaunt (Cloud Giant)")).toBe("Cloud Giant");
    expect(lineageShortName("Stone's Endurance (Stone Giant) ")).toBe("Stone Giant");
  });

  it("formats the card name with the short lineage name", () => {
    expect(lineageCardName("Goliath", "Cloud's Jaunt (Cloud Giant)"))
      .toContain('"species":"Goliath","lineage":"Cloud Giant"');
  });

  it("uses a lineage's image only when it is art, not a core icon", () => {
    expect(lineageArt("modules/dnd-players-handbook/assets/icons/species/drow.webp"))
      .toBe("modules/dnd-players-handbook/assets/icons/species/drow.webp");
    expect(lineageArt("icons/skills/wounds/blood-cells-red.webp")).toBeNull();
    expect(lineageArt("")).toBeNull();
  });

  it("renames the species item and records what it replaced", () => {
    const update = lineageRename(
      { name: "Elf", img: "modules/p/elf.webp" },
      { label: "Drow", uuid: "Compendium.p.origins.Item.drow", img: "modules/p/drow.webp" }
    );
    expect(update.name).toContain('"species":"Elf","lineage":"Drow"');
    expect(update.img).toBe("modules/p/drow.webp");
    expect(update[`flags.sogrom-dnd5e-character-creator.${LINEAGE_FLAG}`]).toEqual({
      uuid: "Compendium.p.origins.Item.drow", name: "Elf", img: "modules/p/elf.webp"
    });
  });

  it("leaves the species' image alone for a lineage with only a core icon", () => {
    const update = lineageRename({ name: "Elf", img: "modules/p/elf.webp" },
      { label: "Blood Elf", img: "icons/skills/wounds/blood-cells-red.webp" });
    expect(update).not.toHaveProperty("img");
    expect(update[`flags.sogrom-dnd5e-character-creator.${LINEAGE_FLAG}`].uuid).toBeNull();
  });
});
