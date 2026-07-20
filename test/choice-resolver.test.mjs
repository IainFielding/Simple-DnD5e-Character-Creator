import { describe, it, expect } from "vitest";
import {
  advancementArray, choicesComplete, traitChoiceTitle, evalItemPrereq, groupRecommended
} from "../scripts/data/choice-resolver.mjs";
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

/**
 * `evalItemPrereq` decides whether a feat/invocation's item prerequisites are satisfied by the
 * identifiers a build owns — the gate that hides ineligible feats and promotes build-unlocked ones
 * to the "recommended" panel. Matching is on the bare identifier slug, tolerating `type:identifier`.
 */
describe("evalItemPrereq", () => {
  it("reports no requirement (and is met) when the option carries no item prerequisite", () => {
    expect(evalItemPrereq(undefined, new Set())).toEqual({ hasReq: false, met: true });
    expect(evalItemPrereq([], new Set(["pact-of-the-blade"]))).toEqual({ hasReq: false, met: true });
  });

  it("is met when the build owns one of the required identifiers", () => {
    const owned = new Set(["pact-of-the-blade", "warlock"]);
    expect(evalItemPrereq(["thirsting-blade"], owned)).toEqual({ hasReq: true, met: false });
    expect(evalItemPrereq(["pact-of-the-blade"], owned)).toEqual({ hasReq: true, met: true });
  });

  it("is met when any one of several alternatives is owned", () => {
    const owned = new Set(["pact-of-the-tome"]);
    expect(evalItemPrereq(["pact-of-the-blade", "pact-of-the-tome"], owned)).toEqual({ hasReq: true, met: true });
  });

  it("strips a `type:identifier` prefix before matching the bare slug", () => {
    const owned = new Set(["pact-of-the-blade"]);
    expect(evalItemPrereq(["feat:pact-of-the-blade"], owned)).toEqual({ hasReq: true, met: true });
  });

  it("accepts a Set of requirements and a missing owned set", () => {
    expect(evalItemPrereq(new Set(["thirsting-blade"]), undefined)).toEqual({ hasReq: true, met: false });
  });
});

/**
 * `groupRecommended` splits options into a leading "Recommended" panel and an "Other" panel, and
 * returns null (a single flat grid) when nothing is recommended.
 */
describe("groupRecommended", () => {
  it("returns null when no option is recommended", () => {
    expect(groupRecommended([{ key: "a" }, { key: "b" }])).toBeNull();
  });

  it("splits recommended options into their own leading panel", () => {
    const opts = [{ key: "a" }, { key: "b", recommended: true }, { key: "c" }];
    const groups = groupRecommended(opts);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toContain("choice.recommended");
    expect(groups[0].options.map(o => o.key)).toEqual(["b"]);
    expect(groups[1].label).toContain("choice.other");
    expect(groups[1].options.map(o => o.key)).toEqual(["a", "c"]);
  });

  it("omits the 'Other' panel when every option is recommended", () => {
    const groups = groupRecommended([{ key: "a", recommended: true }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map(o => o.key)).toEqual(["a"]);
  });
});
