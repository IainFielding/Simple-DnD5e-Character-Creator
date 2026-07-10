import { beforeEach, describe, expect, it } from "vitest";
import { advancementHint } from "../scripts/levelup/levelup-state.mjs";
import { choicesStep } from "../scripts/levelup/steps/choices-step.mjs";
import { traitStep } from "../scripts/levelup/steps/trait-step.mjs";

/**
 * Advancement descriptions on the level-up screens. Authors describe a decision in the
 * advancement's `hint` field (e.g. the PHB Wizard's level-2 Scholar: "While studying magic, you
 * also specialized in another field of study…"); each choice-bearing step surfaces it on its
 * section so the player sees what the pick means, and an absent hint stays invisible.
 */

beforeEach(() => {
  globalThis.fromUuid = async uuid => ({ name: uuid.split(".").pop(), img: "" });
});

const SCHOLAR_HINT = "While studying magic, you also specialized in another field of study. "
  + "Choose one of the following skills in which you have proficiency. You have Expertise in the chosen skill.";

describe("advancementHint", () => {
  it("returns the advancement's hint, enriched", async () => {
    const record = { advancement: { hint: SCHOLAR_HINT } };
    expect(await advancementHint(record)).toBe(SCHOLAR_HINT);
  });

  it("returns '' for a missing, empty, or whitespace hint", async () => {
    expect(await advancementHint({ advancement: {} })).toBe("");
    expect(await advancementHint({ advancement: { hint: "" } })).toBe("");
    expect(await advancementHint({ advancement: { hint: "   " } })).toBe("");
  });
});

describe("trait sections carry the advancement description", () => {
  function traitFixture(advancement) {
    const record = { level: 2, screenLevel: 2, advancement };
    const state = {
      traitSteps: [record],
      driver: {
        traitState: () => ({ chosen: new Set(), current: 0, max: 1, full: false }),
        traitOptions: async () => [
          { key: "skills:arc", label: "Arcana", img: null, selected: false, owned: false, disabled: false, groupKey: "skills", groupLabel: "Skills" }
        ]
      }
    };
    return { state };
  }

  it("surfaces the hint (the Scholar case)", async () => {
    const { state } = traitFixture({ title: "Scholar", hint: SCHOLAR_HINT });
    const data = await traitStep.sectionsAt({ state, driver: state.driver }, 2);
    expect(data.sections[0].hint).toBe(SCHOLAR_HINT);
  });

  it("falls back to the creator's generated blurb when the advancement has none", async () => {
    // The i18n shim echoes keys back, so the generated sentence is asserted by its keys: a
    // skills-pool trait with no authored hint reads as the skills blurb + a "choose one".
    const { state } = traitFixture({ title: "Weapon Mastery" });
    const data = await traitStep.sectionsAt({ state, driver: state.driver }, 2);
    expect(data.sections[0].hint).toContain("choice.blurb.skills");
    expect(data.sections[0].hint).toContain("choice.chooseOne");
  });
});

describe("feature-choice sections carry the advancement description", () => {
  it("surfaces the hint alongside (not instead of) the replace hint", async () => {
    const pool = ["Compendium.t.f.Item.aaa", "Compendium.t.f.Item.bbb"];
    const record = {
      level: 4, screenLevel: 4,
      advancement: { title: "Fighting Style", hint: "Choose a style of combat to specialize in.", configuration: { pool: pool.map(uuid => ({ uuid })) } }
    };
    const st = {
      current: 0, max: 1, full: false,
      selected: new Set(), replaceable: true, replacing: null,
      priorEntries: [{ id: "prior00000000000", uuid: pool[0] }]
    };
    const state = { choiceSteps: [record], driver: { choiceState: () => st } };
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(data.sections[0].hint).toBe("Choose a style of combat to specialize in.");
    expect(data.sections[0].replaceHint).not.toBe("");
  });

  it("falls back to the creator's generated blurb when the advancement has none", async () => {
    const pool = ["Compendium.t.f.Item.aaa", "Compendium.t.f.Item.bbb"];
    const record = {
      level: 4, screenLevel: 4,
      advancement: { title: "Fighting Style", configuration: { pool: pool.map(uuid => ({ uuid })) } }
    };
    const st = {
      current: 0, max: 1, full: false,
      selected: new Set(), replaceable: false, replacing: null, priorEntries: []
    };
    const state = { choiceSteps: [record], driver: { choiceState: () => st } };
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(data.sections[0].hint).toContain("choice.blurb.itemChoice");
    expect(data.sections[0].hint).toContain("choice.chooseOne");
  });
});
