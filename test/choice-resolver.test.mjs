import { describe, it, expect } from "vitest";
import { advancementArray, choicesComplete, traitChoiceTitle } from "../scripts/data/choice-resolver.mjs";
import { fighter, sage } from "./fixtures/dnd5e-5.3.3.mjs";

/**
 * `advancementArray` is the resolver's "flattening" seam: dnd5e hands advancements back in
 * several shapes across versions (a live `advancement.byId` Map, a plain object, or the raw
 * `system.advancement` array/object of a `toObject()`d doc). Every downstream reader depends on
 * this returning a plain array, so it's exactly where a dnd5e version bump tends to break.
 */
describe("advancementArray", () => {
  it("reads the raw system.advancement array of a toObject()'d item", () => {
    const arr = advancementArray(fighter);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toBe(fighter.system.advancement);
    expect(arr.find(a => a._id === "UaSYMl2io5kbXNOY").type).toBe("Trait");
  });

  it("reads a live advancement.byId Map", () => {
    const byId = new Map(sage.system.advancement.map(a => [a._id, a]));
    const arr = advancementArray({ advancement: { byId } });
    expect(arr).toHaveLength(sage.system.advancement.length);
    expect(arr.map(a => a._id)).toContain("kKt7VMmZUuRr35dP");
  });

  it("reads a plain-object advancement.byId", () => {
    const byId = Object.fromEntries(sage.system.advancement.map(a => [a._id, a]));
    const arr = advancementArray({ advancement: { byId } });
    expect(arr).toHaveLength(sage.system.advancement.length);
  });

  it("reads a keyed system.advancement object", () => {
    const keyed = Object.fromEntries(fighter.system.advancement.map(a => [a._id, a]));
    const arr = advancementArray({ system: { advancement: keyed } });
    expect(arr).toHaveLength(fighter.system.advancement.length);
  });

  it("returns an empty array when there are no advancements", () => {
    expect(advancementArray({})).toEqual([]);
    expect(advancementArray({ system: {} })).toEqual([]);
  });
});

/**
 * `choicesComplete` gates the Choices step's Next button. Spell-type picks (`spellStep`) are
 * deliberately excluded — they gate the dedicated feat-spells step instead.
 */
describe("choicesComplete", () => {
  it("is true when every non-spell requirement has enough picks", () => {
    const resolved = { sources: [{ requirements: [
      { complete: true }, { complete: true },
      { spellStep: true, complete: false }   // ignored here
    ] }] };
    expect(choicesComplete(resolved)).toBe(true);
  });

  it("is false when any non-spell requirement is short", () => {
    const resolved = { sources: [{ requirements: [{ complete: true }, { complete: false }] }] };
    expect(choicesComplete(resolved)).toBe(false);
  });

  it("is true for an empty / missing resolved set", () => {
    expect(choicesComplete({ sources: [] })).toBe(true);
    expect(choicesComplete(null)).toBe(true);
  });
});

/** `traitChoiceTitle` picks an i18n title from a pool's key namespace. */
describe("traitChoiceTitle", () => {
  it("maps a pool namespace to its title key", () => {
    expect(traitChoiceTitle(["skills:acr"])).toContain("traitChoice.skills");
    expect(traitChoiceTitle(["weapon:mar:*"])).toContain("traitChoice.weapon");
    expect(traitChoiceTitle(["languages:standard:*"])).toContain("traitChoice.languages");
  });

  it("falls back for an unrecognised namespace", () => {
    expect(traitChoiceTitle(["mystery:thing"])).toContain("choice.fallback");
    expect(traitChoiceTitle([])).toContain("choice.fallback");
  });
});
