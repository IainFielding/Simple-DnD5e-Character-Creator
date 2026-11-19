import { describe, it, expect, beforeEach } from "vitest";
import { lineageRequirements, originStep } from "../scripts/steps/origin-step.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * The Species step asks a species' lineage (dnd5e 6.1's Elf, Gnome and Tiefling; the Dragonborn's and
 * Goliath's ancestry) beside the species instead of only on the Choices step. It reads the decision
 * the resolver flags `lineage`, so these tests drive it from a hand-built choice cache.
 */

beforeEach(() => installFoundryShims());

const lineageReq = (over = {}) => ({
  type: "ItemChoice", lineage: true, title: "Choose Lineage", complete: false, selKey: "lin",
  options: [{ key: "drow", label: "Drow" }, { key: "high", label: "High Elf" }], ...over
});
const stateWith = (requirements, sourceKey = "species") => ({
  speciesUuid: "Compendium.x.y.Item.elf",
  choiceCache: { sources: [{ key: sourceKey, requirements }] }
});
const species = originStep({ id: "species", field: "speciesUuid", cards: () => [], lineage: true });

describe("lineageRequirements", () => {
  it("returns the species' lineage choice and nothing else", () => {
    const state = stateWith([lineageReq(), { type: "Trait", title: "Skillful", options: [{ key: "a" }] }]);
    expect(lineageRequirements(state, "species").map(r => r.title)).toEqual(["Choose Lineage"]);
  });

  it("ignores another origin's choices", () => {
    expect(lineageRequirements(stateWith([lineageReq()], "background"), "species")).toEqual([]);
  });

  it("ignores a lineage choice with nothing to offer, so it can never hold the step shut", () => {
    expect(lineageRequirements(stateWith([lineageReq({ options: [] })]), "species")).toEqual([]);
  });
});

describe("Species step with a lineage", () => {
  it("holds Next until the lineage is chosen, and says why", () => {
    const state = stateWith([lineageReq()]);
    expect(species.isComplete(state)).toBe(false);
    expect(species.incompleteHint(state)).toContain("step.species.lineage.hint");
    state.choiceCache.sources[0].requirements[0].complete = true;
    expect(species.isComplete(state)).toBe(true);
  });

  it("is complete as before for a species without one", () => {
    expect(species.isComplete(stateWith([]))).toBe(true);
  });

  it("leaves a step built without the option alone", () => {
    const background = originStep({ id: "species", field: "speciesUuid", cards: () => [] });
    expect(background.isComplete(stateWith([lineageReq()]))).toBe(true);
  });
});
