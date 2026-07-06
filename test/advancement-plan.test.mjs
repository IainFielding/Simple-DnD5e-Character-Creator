import { describe, it, expect } from "vitest";
import { buildChoicePlan, mergeTraitGrants } from "../scripts/build/advancement-apply.mjs";
import { fighter, sage, UUID } from "./fixtures/dnd5e-5.3.3.mjs";

/**
 * `buildChoicePlan` decides two things from the resolver output + the origin items:
 *   • which advancements the AdvancementManager must SKIP (the wizard already resolved them), and
 *   • which granted-feature ItemGrants the wizard must recreate by hand ("takeovers"), because
 *     the granted feature carries its own nested choices.
 * These fixtures are the real Sage/Fighter advancement graphs, so the plan is exercised against
 * the exact ItemGrant/Trait/ItemChoice shapes the live system produces.
 */
describe("buildChoicePlan", () => {
  it("takes over the ItemGrant of a feature that owns choices, and skips it", () => {
    // Sage grants Magic Initiate (an ItemGrant), whose two spell picks the resolver surfaces
    // as SpellChoice requirements tagged with the feat's UUID as their `ownerUuid`.
    const resolved = {
      sources: [{
        key: "background",
        requirements: [
          { type: "SpellChoice", ownerUuid: UUID.magicInitiate, advId: "ElkyDafWSUXOkPdJ", selKey: "ElkyDafWSUXOkPdJ" },
          { type: "SpellChoice", ownerUuid: UUID.magicInitiate, advId: "ZbKHs2FVCkJVNW8p", selKey: "ZbKHs2FVCkJVNW8p" },
          { type: "Trait", ownerUuid: null, advId: "pLGiyOjTP7nwuwTl", selKey: "pLGiyOjTP7nwuwTl#0", level: 0 }
        ]
      }]
    };

    const plan = buildChoicePlan(resolved, { background: sage });

    // The Magic Initiate ItemGrant is both skipped and taken over.
    expect(plan.takeovers).toEqual([{ source: "background", grantAdvId: "kKt7VMmZUuRr35dP" }]);
    expect(plan.skipAdvIds.has("kKt7VMmZUuRr35dP")).toBe(true);
    // The background's own language Trait choice is skipped (wizard-resolved) but never a takeover.
    expect(plan.skipAdvIds.has("pLGiyOjTP7nwuwTl")).toBe(true);
    expect(plan.skipAdvIds.size).toBe(2);
  });

  it("skips wizard-resolved Trait/ItemChoice advancements without taking over plain feature grants", () => {
    // Fighter's granted features (Second Wind, Weapon Mastery, the Fighting-Style feature) carry
    // no owner-tagged choices, so its Class-Features ItemGrant is left to the manager, not taken over.
    const resolved = {
      sources: [{
        key: "class",
        requirements: [
          { type: "Trait", ownerUuid: null, advId: "UaSYMl2io5kbXNOY", selKey: "UaSYMl2io5kbXNOY#0", level: 1 },
          { type: "Trait", ownerUuid: null, advId: "mJnrjhWpEz2lMDq4", selKey: "mJnrjhWpEz2lMDq4#0", level: 1 },
          { type: "ItemChoice", ownerUuid: null, advId: "EmTANp6x6GfXFTmU", selKey: "EmTANp6x6GfXFTmU", level: 1 }
        ]
      }]
    };

    const plan = buildChoicePlan(resolved, { class: fighter });

    expect(plan.takeovers).toEqual([]);
    expect([...plan.skipAdvIds].sort()).toEqual(
      ["EmTANp6x6GfXFTmU", "UaSYMl2io5kbXNOY", "mJnrjhWpEz2lMDq4"].sort()
    );
  });

  it("ignores requirement types that aren't wizard-owned (e.g. SpellAbility surfaced elsewhere)", () => {
    // A SpellAbility requirement (choose the casting ability of a granted spell) is applied on its
    // own step, not skipped as a Trait/Size/ItemChoice — so it never lands in skipAdvIds here.
    const resolved = {
      sources: [{ key: "class", requirements: [
        { type: "SpellAbility", ownerUuid: null, advId: "someSpellAdv0000", selKey: "someSpellAdv0000" }
      ] }]
    };
    const plan = buildChoicePlan(resolved, { class: fighter });
    expect(plan.skipAdvIds.has("someSpellAdv0000")).toBe(false);
  });

  it("returns an empty plan when the source item is absent", () => {
    const resolved = { sources: [{ key: "class", requirements: [{ type: "Trait", advId: "x" }] }] };
    const plan = buildChoicePlan(resolved, {});   // no `class` entry
    expect(plan.skipAdvIds.size).toBe(0);
    expect(plan.takeovers).toEqual([]);
  });

  it("tolerates a null/empty resolved input", () => {
    expect(buildChoicePlan(null, {}).takeovers).toEqual([]);
    expect(buildChoicePlan({}, {}).skipAdvIds.size).toBe(0);
  });
});

/**
 * `mergeTraitGrants` folds an advancement's automatic `configuration.grants` back together with
 * the player's recorded picks, de-duplicated — the manual-apply path would otherwise drop the
 * automatic grants (the manager skipped the whole advancement to let the wizard own the choice).
 */
describe("mergeTraitGrants", () => {
  const languageAdv = sage.system.advancement.find(a => a._id === "pLGiyOjTP7nwuwTl");

  it("unions automatic grants with the player's picks", () => {
    const chosen = mergeTraitGrants(languageAdv, ["languages:standard:elvish", "languages:standard:dwarvish"]);
    expect(chosen).toEqual([
      "languages:standard:common",       // the automatic grant
      "languages:standard:elvish",
      "languages:standard:dwarvish"
    ]);
  });

  it("de-duplicates a pick that repeats an automatic grant", () => {
    const chosen = mergeTraitGrants(languageAdv, ["languages:standard:common", "languages:standard:orc"]);
    expect(chosen).toEqual(["languages:standard:common", "languages:standard:orc"]);
  });

  it("returns just the grants when there are no picks", () => {
    expect(mergeTraitGrants(languageAdv)).toEqual(["languages:standard:common"]);
  });

  it("returns just the picks for a grant-less advancement", () => {
    expect(mergeTraitGrants({ configuration: { grants: [] } }, ["skills:arc"])).toEqual(["skills:arc"]);
    expect(mergeTraitGrants(undefined, ["skills:his"])).toEqual(["skills:his"]);
  });
});
