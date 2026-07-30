import { describe, it, expect } from "vitest";
import { originSpecifiedClasses, lockedAbility } from "../scripts/steps/feat-spells-step.mjs";

/**
 * `originSpecifiedClasses` pins a Magic Initiate to the class its origin names, even though the 2024
 * backgrounds reference the *generic* Magic Initiate feat (which allows cleric/druid/wizard) and
 * state the actual class only in prose. Without it, a background like Sage would wrongly present a
 * cleric/druid/wizard picker instead of granting Wizard outright.
 */
describe("originSpecifiedClasses", () => {
  it("reads the class from the description parenthetical (as Sage states it)", () => {
    const sage = { system: { description: { value:
      "<p><strong>Feat:</strong> @UUID[Compendium.dnd5e.feats24.Item.phbftMagicInitia]{Magic Initiate} (Wizard)</p>" } } };
    expect(originSpecifiedClasses(sage)).toEqual(["wizard"]);
  });

  it("reads the class from a granting advancement's hint", () => {
    const doc = {
      system: { description: { value: "<p>A learned adventurer.</p>" } },
      advancement: { byId: { g: {
        type: "ItemGrant", hint: "Your background grants you the Magic Initiate (Wizard) feat."
      } } }
    };
    expect(originSpecifiedClasses(doc)).toEqual(["wizard"]);
  });

  it("returns [] when no class is named, so the full list (and its picker) stands", () => {
    const doc = { system: { description: { value: "<p>Grants @UUID[x]{Magic Initiate}.</p>" } } };
    expect(originSpecifiedClasses(doc)).toEqual([]);
  });

  it("de-duplicates and lower-cases across description and advancement text", () => {
    const doc = {
      system: {
        description: { value: "Magic Initiate (Cleric)" },
        advancement: [{ title: "Magic Initiate (CLERIC)" }]
      }
    };
    expect(originSpecifiedClasses(doc)).toEqual(["cleric"]);
  });
});

/**
 * `lockedAbility` fixes the casting ability once the Magic Initiate class is a single one — a Wizard
 * Magic Initiate always casts off Intelligence, so the ability picker should vanish too.
 */
describe("lockedAbility", () => {
  const allowed = ["int", "wis", "cha"];

  it("locks a single-class list to that class's ability", () => {
    expect(lockedAbility(["wizard"], allowed)).toBe("int");
    expect(lockedAbility(["cleric"], allowed)).toBe("wis");
    expect(lockedAbility(["druid"], allowed)).toBe("wis");
  });

  it("stays open when the class list still holds a choice", () => {
    expect(lockedAbility(["cleric", "wizard"], allowed)).toBeNull();
    expect(lockedAbility([], allowed)).toBeNull();
  });

  it("won't lock to an ability the feat doesn't permit", () => {
    expect(lockedAbility(["wizard"], ["wis", "cha"])).toBeNull();
  });

  it("ignores classes it doesn't map", () => {
    expect(lockedAbility(["bard"], allowed)).toBeNull();
  });
});
