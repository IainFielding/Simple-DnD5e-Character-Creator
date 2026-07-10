import { beforeEach, describe, expect, it } from "vitest";
import { choicesStep } from "../scripts/levelup/steps/choices-step.mjs";
import { traitStep } from "../scripts/levelup/steps/trait-step.mjs";

/**
 * The exhausted-pool escape hatch. A decision's quota ("pick 2") normally gates the screen until
 * it is full — but when the pool can no longer supply that many picks (the other options are
 * already owned from earlier levels or another source), the player must still be able to proceed.
 * `sectionsAt` derives `record.exhausted` from the very option list it renders, and `isCompleteAt`
 * honours it; the shell builds the active screen before reading the flags, so the gate opens on
 * the same render that shows the screen.
 */

beforeEach(() => {
  globalThis.fromUuid = async uuid => ({ name: uuid.split(".").pop(), img: "" });
});

/* -------------------------------------------- */
/*  Feature choices (ItemChoice)                */
/* -------------------------------------------- */

/** A choice record over a 3-option pool, with the painted selection state a test needs. */
function choiceFixture({ owned = [], selected = [], max = 2, replaceable = true } = {}) {
  const pool = ["Compendium.t.f.Item.aaa", "Compendium.t.f.Item.bbb", "Compendium.t.f.Item.ccc"];
  const record = {
    level: 4, screenLevel: 4,
    advancement: { title: "Magic Item Plans", configuration: { pool: pool.map(uuid => ({ uuid })) } }
  };
  const st = {
    current: selected.length, max, full: selected.length >= max,
    selected: new Set(selected.map(i => pool[i])),
    replaceable, replacing: null,
    priorEntries: owned.map(i => ({ id: `prior${i}0000000000`, uuid: pool[i] }))
  };
  const state = { choiceSteps: [record], driver: { choiceState: () => st } };
  return { record, state };
}

describe("choicesStep quota exhaustion", () => {
  it("stays incomplete while unowned options remain to pick", async () => {
    const { record, state } = choiceFixture({ owned: [0], selected: [] });   // b, c still pickable
    await choicesStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(false);
    expect(choicesStep.isCompleteAt(state, 4)).toBe(false);
  });

  it("completes a 'pick 2' with one pick when everything else is already owned", async () => {
    // Owns a and b from earlier levels; picked c — 1 of 2, but nothing is left to take.
    const { record, state } = choiceFixture({ owned: [0, 1], selected: [2] });
    expect(choicesStep.isCompleteAt(state, 4)).toBe(false);                  // before the screen renders
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(true);
    expect(choicesStep.isCompleteAt(state, 4)).toBe(true);
    expect(data.sections[0].complete).toBe(true);
  });

  it("still completes the ordinary way when the quota fills", async () => {
    const { record, state } = choiceFixture({ owned: [0], selected: [1, 2] });
    await choicesStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(false);
    expect(choicesStep.isCompleteAt(state, 4)).toBe(true);
  });
});

/* -------------------------------------------- */
/*  Trait choices                               */
/* -------------------------------------------- */

/** A trait record whose options and counts a test paints directly. */
function traitFixture({ options, current = 0, max = 2 }) {
  const record = { level: 4, screenLevel: 4, advancement: { title: "Tool Proficiency" } };
  const state = {
    traitSteps: [record],
    driver: {
      traitState: () => ({ chosen: new Set(), current, max, full: current >= max }),
      traitOptions: async () => options
    }
  };
  return { record, state };
}

/** One trait option; owned = taken at an earlier level (shown selected but locked). */
function opt(key, { owned = false, selected = owned, disabled = owned } = {}) {
  return { key, label: key, img: null, selected, owned, disabled, groupKey: "tool:art", groupLabel: "Artisan's Tools" };
}

describe("traitStep quota exhaustion", () => {
  it("stays incomplete while an eligible option remains", async () => {
    const { record, state } = traitFixture({
      options: [opt("tool:art:smith", { owned: true }), opt("tool:art:weaver")],
      current: 0, max: 2
    });
    await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(false);
    expect(traitStep.isCompleteAt(state, 4)).toBe(false);
  });

  it("completes a 'pick 2' when only one option was ever available and it is taken", async () => {
    const { record, state } = traitFixture({
      options: [
        opt("tool:art:smith", { owned: true }),
        opt("tool:art:tinker", { owned: true }),
        opt("tool:art:weaver", { selected: true })                           // this level's one pick
      ],
      current: 1, max: 2
    });
    expect(traitStep.isCompleteAt(state, 4)).toBe(false);                    // before the screen renders
    const data = await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(true);
    expect(traitStep.isCompleteAt(state, 4)).toBe(true);
    expect(data.sections[0].complete).toBe(true);
  });

  it("completes with an empty pool (nothing was ever offered)", async () => {
    const { record, state } = traitFixture({ options: [], current: 0, max: 1 });
    await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(true);
    expect(traitStep.isCompleteAt(state, 4)).toBe(true);
  });
});
