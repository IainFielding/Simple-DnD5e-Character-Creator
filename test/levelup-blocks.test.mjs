import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { levelStep } from "../scripts/levelup/steps/level-step.mjs";
import { traitStep } from "../scripts/levelup/steps/trait-step.mjs";

/**
 * One collapsible block per decision on a level screen.
 *
 * A level granting several decisions of the same kind used to pool them into a single panel headed
 * by the component's generic label — which a character creation surfaces in force: an Ember build
 * arrives with "Path Skills", "Path Language", "Cultural Proficiencies" and "Path Tools" all at
 * once. Pooled, one decision greying out an option another had already taken looked like a bug, and
 * the panel was headed "Weapon Mastery" whatever it actually held. Each decision now owns its
 * block, titled and counted from its own advancement.
 */

/** A trait decision with a title, a quota, and a two-option pool. */
function traitRecord(title, advId, { current = 0, max = 1 } = {}) {
  return { level: 1, screenLevel: 1, advancement: { id: advId, title, configuration: {} }, _current: current, _max: max };
}

function opt(key) {
  return { key, label: key, img: null, selected: false, owned: false, disabled: false, groupKey: "g", groupLabel: "Group" };
}

/** A state carrying only trait decisions — every other component reports nothing at this level. */
function makeState(records) {
  return {
    traitSteps: records,
    hpSteps: [], asiSteps: [], choiceSteps: [], subclassSteps: [], grantSteps: [],
    collapsedBlocks: new Set(),
    driver: {
      traitState: r => ({ chosen: new Set(), current: r._current, max: r._max, full: r._current >= r._max }),
      traitOptions: async () => [opt("a"), opt("b")]
    }
  };
}

beforeEach(() => installFoundryShims());

describe("a level screen's blocks", () => {
  const records = () => [
    traitRecord("Path Skills", "advSkills0000000", { current: 2, max: 2 }),
    traitRecord("Path Language", "advLanguage00000", { current: 0, max: 1 }),
    traitRecord("Path Tools", "advTools00000000", { current: 0, max: 1 })
  ];

  it("gives every trait decision its own block, titled from its advancement", async () => {
    const state = makeState(records());
    const ctx = await levelStep(1).context({ state, driver: state.driver });

    expect(ctx.blocks.map(b => b.label)).toEqual(["Path Skills", "Path Language", "Path Tools"]);
  });

  it("reports each block's own completion, not the component's", async () => {
    const state = makeState(records());
    const ctx = await levelStep(1).context({ state, driver: state.driver });

    // Path Skills is filled; the other two are not — the old pooled block was all-or-nothing.
    expect(ctx.blocks.map(b => b.complete)).toEqual([true, false, false]);
  });

  it("keys blocks by advancement so a collapse survives the next render", async () => {
    const state = makeState(records());
    const first = await levelStep(1).context({ state, driver: state.driver });
    const languageKey = first.blocks[1].key;
    expect(languageKey).toBe("1:traits:advLanguage00000");

    state.collapsedBlocks.add(languageKey);
    const second = await levelStep(1).context({ state, driver: state.driver });
    expect(second.blocks.map(b => b.open)).toEqual([true, false, true]);
  });

  it("leaves a lone decision exactly as it was — one block, named for the advancement", async () => {
    const state = makeState([traitRecord("Weapon Mastery", "advMastery000000", { current: 0, max: 2 })]);
    const ctx = await levelStep(1).context({ state, driver: state.driver });

    expect(ctx.blocks).toHaveLength(1);
    expect(ctx.blocks[0].label).toBe("Weapon Mastery");
    // The section body never repeats the header's title/count.
    expect(ctx.blocks[0].sections[0].collapsed).toBe(true);
  });

  it("sizes each block's option grid on its own pool, not the busiest one", async () => {
    const state = makeState(records());
    // A long iconned pool for one decision only; the others stay short and art-less.
    const big = Array.from({ length: 12 }, (_, i) => ({ ...opt(`w${i}`), img: "sword.webp" }));
    state.driver.traitOptions = async r => (r.advancement.id === "advTools00000000" ? big : [opt("a"), opt("b")]);

    const ctx = await levelStep(1).context({ state, driver: state.driver });
    expect(ctx.blocks.map(b => b.density)).toEqual(["chip", "chip", "compact"]);
  });

  it("still hands the step's own completion the whole level", async () => {
    const state = makeState(records());
    await levelStep(1).context({ state, driver: state.driver });
    expect(traitStep.isCompleteAt(state, 1)).toBe(false);
  });
});
