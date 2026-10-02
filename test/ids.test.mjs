import { describe, expect, it } from "vitest";
import { slugify, packageOf } from "../scripts/data/ids.mjs";
import { rankPackage } from "../scripts/data/dedupe.mjs";

/**
 * The shared slug and package readers. Two copies of `packageOf` had drifted: one returned a world
 * item's own id as its "package". These pin the one copy left, and that a world item still ranks
 * where it did.
 */
describe("slugify", () => {
  it("folds names and identifiers to the same key", () => {
    expect(slugify("Elf, Drow")).toBe("elf-drow");
    expect(slugify("Kithkin, Shadowmoor")).toBe("kithkin-shadowmoor");
    expect(slugify("Dragon’s Teeth")).toBe("dragons-teeth");
    expect(slugify("  --Wizard--  ")).toBe("wizard");
    expect(slugify(undefined)).toBe("");
  });
});

describe("packageOf", () => {
  it("reads the package off a compendium uuid", () => {
    expect(packageOf("Compendium.dnd-players-handbook.classes.Item.abc")).toBe("dnd-players-handbook");
  });

  it("gives no package for anything that isn't a compendium uuid", () => {
    expect(packageOf("Item.abc123")).toBeNull();
    expect(packageOf("")).toBeNull();
    expect(packageOf(null)).toBeNull();
  });

  it("leaves a world item ranked as a real package, below the preferred book and above the SRD", () => {
    const typeOf = id => ({ dnd5e: "system", "dnd-players-handbook": "module" })[id] ?? null;
    expect(rankPackage(packageOf("Item.abc123"), typeOf)).toBe(1);
    expect(rankPackage(packageOf("Compendium.dnd-players-handbook.classes.Item.a"), typeOf)).toBe(0);
    expect(rankPackage(packageOf("Compendium.dnd5e.classes.Item.a"), typeOf)).toBe(2);
  });
});
