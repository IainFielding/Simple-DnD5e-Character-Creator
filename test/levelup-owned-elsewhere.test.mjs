import { beforeEach, describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";
import { choicesStep } from "../scripts/levelup/steps/choices-step.mjs";

/**
 * Pool options the character already holds from ANOTHER source. The canonical case is a Champion
 * Fighter: the level-7 "Additional Fighting Style" pool still lists every style, including the one
 * the base level-1 Fighting Style already granted. A non-repeatable feature cannot be taken twice,
 * so that option must render as already-taken rather than as a fresh pick.
 *
 * Two layers are covered, because the bug can reappear in either: the driver deriving
 * `ownedElsewhere` from the actor's `sourcedItems`, and `choicesStep` turning that into a disabled
 * `taken` option — which in turn feeds the exhausted-quota gate so the player is never stuck.
 */

const DEFENSE = "Compendium.dnd5e.classfeatures.Item.defense0000000";
const DUELING = "Compendium.dnd5e.classfeatures.Item.dueling0000000";
const ARCHERY = "Compendium.dnd5e.classfeatures.Item.archery0000000";
const POOL = [DEFENSE, DUELING, ARCHERY];

/** `actor.sourcedItems`: compendium uuid -> the actor's items that came from it. */
function sourcedItems(map) {
  return new Map(Object.entries(map).map(([uuid, ids]) => [uuid, new Set(ids.map(id => ({ id })))]));
}

/**
 * An ItemChoice advancement as the driver sees it. `added` is dnd5e's own record of what THIS
 * advancement granted (keyed by level, then by the created item's id).
 */
function advancementFixture({ pool = POOL, added = {}, sourced, counts } = {}) {
  return {
    level: 7,
    advancement: {
      title: "Additional Fighting Style",
      configuration: { pool },
      value: { added },
      getCounts: () => counts ?? { current: 0, max: 1, full: false },
      actor: sourced ? { sourcedItems: sourced } : undefined
    }
  };
}

/** `choiceState` reads only its record, so it can be exercised without a constructed driver. */
const choiceState = record => LevelUpDriver.prototype.choiceState.call({}, record);

/* -------------------------------------------- */
/*  Driver: deriving ownedElsewhere             */
/*  -------------------------------------------- */

describe("choiceState ownedElsewhere", () => {
  it("flags a pool option granted by a different feature (the Champion case)", () => {
    // Defense came from the base level-1 Fighting Style — a different item entirely.
    const record = advancementFixture({
      sourced: sourcedItems({ [DEFENSE]: ["baseStyleItem001"] })
    });
    const st = choiceState(record);
    expect(st.ownedElsewhere.has(DEFENSE)).toBe(true);
    expect(st.ownedElsewhere.has(DUELING)).toBe(false);
    expect(st.ownedElsewhere.has(ARCHERY)).toBe(false);
  });

  it("does NOT flag an option this same advancement granted — that is a prior, not a clash", () => {
    // Dueling was picked by THIS advancement at level 4; it must stay swappable via priorEntries
    // rather than being locked as owned-elsewhere.
    const record = advancementFixture({
      added: { 4: { ownGrantItem01: DUELING } },
      sourced: sourcedItems({ [DUELING]: ["ownGrantItem01"] })
    });
    const st = choiceState(record);
    expect(st.ownedElsewhere.has(DUELING)).toBe(false);
    expect(st.priorEntries).toEqual([{ id: "ownGrantItem01", uuid: DUELING }]);
  });

  it("flags an option held from both this advancement and another source", () => {
    const record = advancementFixture({
      added: { 4: { ownGrantItem01: DUELING } },
      sourced: sourcedItems({ [DUELING]: ["ownGrantItem01", "otherFeature01"] })
    });
    expect(choiceState(record).ownedElsewhere.has(DUELING)).toBe(true);
  });

  it("returns an empty set when the advancement has no actor to inspect", () => {
    const st = choiceState(advancementFixture());
    expect(st.ownedElsewhere).toBeInstanceOf(Set);
    expect(st.ownedElsewhere.size).toBe(0);
  });

  it("ignores a uuid whose owner set is empty", () => {
    const record = advancementFixture({ sourced: new Map([[DEFENSE, new Set()]]) });
    expect(choiceState(record).ownedElsewhere.size).toBe(0);
  });

  it("accepts a bare-string pool as well as {uuid} entries", () => {
    const record = advancementFixture({
      pool: POOL,                                                  // strings, not { uuid }
      sourced: sourcedItems({ [DEFENSE]: ["baseStyleItem001"] })
    });
    expect(choiceState(record).ownedElsewhere.has(DEFENSE)).toBe(true);
  });
});

/* -------------------------------------------- */
/*  Step: rendering it as a taken option        */
/* -------------------------------------------- */

beforeEach(() => {
  globalThis.fromUuid = async uuid => ({ name: uuid.split(".").pop(), img: "" });
  globalThis.game = { i18n: { lang: "en", localize: k => k, format: k => k } };
});

/** A choice record over the fighting-style pool, with the selection state painted directly. */
function stepFixture({ ownedElsewhere = [], selected = [], max = 1 } = {}) {
  const record = {
    level: 7, screenLevel: 7,
    advancement: { title: "Additional Fighting Style", configuration: { pool: POOL.map(uuid => ({ uuid })) } }
  };
  const st = {
    current: selected.length, max, full: selected.length >= max,
    selected: new Set(selected),
    replaceable: false, replacing: null, priorEntries: [],
    ownedElsewhere: new Set(ownedElsewhere)
  };
  const state = { choiceSteps: [record], driver: { choiceState: () => st } };
  return { record, state };
}

const byUuid = (data, uuid) => data.sections[0].options.find(o => o.uuid === uuid);

describe("choicesStep rendering of ownedElsewhere", () => {
  it("shows the clashing option as taken and disabled, leaving the rest pickable", async () => {
    const { state } = stepFixture({ ownedElsewhere: [DEFENSE] });
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 7);

    const defense = byUuid(data, DEFENSE);
    expect(defense.taken).toBe(true);
    expect(defense.disabled).toBe(true);
    expect(defense.owned).toBe(false);        // not a prior of this advancement
    expect(defense.selected).toBe(false);     // and not a pick the player made
    expect(byUuid(data, DUELING).disabled).toBe(false);
  });

  it("keeps the step incomplete while a clash-free option remains", async () => {
    const { record, state } = stepFixture({ ownedElsewhere: [DEFENSE] });
    await choicesStep.sectionsAt({ state, driver: state.driver }, 7);
    expect(record.exhausted).toBe(false);
    expect(choicesStep.isCompleteAt(state, 7)).toBe(false);
  });

  it("opens the gate when every remaining option is owned elsewhere", async () => {
    // Nothing left to pick: without the exhausted escape hatch the player would be stuck here.
    const { record, state } = stepFixture({ ownedElsewhere: POOL });
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 7);
    expect(record.exhausted).toBe(true);
    expect(data.sections[0].complete).toBe(true);
    expect(choicesStep.isCompleteAt(state, 7)).toBe(true);
  });

  it("never marks the player's own current pick as taken", async () => {
    const { state } = stepFixture({ ownedElsewhere: [DEFENSE], selected: [DEFENSE] });
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 7);
    const defense = byUuid(data, DEFENSE);
    expect(defense.selected).toBe(true);
    expect(defense.taken).toBe(false);
  });

  it("tolerates a driver state with no ownedElsewhere at all", async () => {
    const { state } = stepFixture();
    delete state.driver.choiceState().ownedElsewhere;
    const data = await choicesStep.sectionsAt({ state, driver: state.driver }, 7);
    expect(byUuid(data, DEFENSE).taken).toBe(false);
  });
});
