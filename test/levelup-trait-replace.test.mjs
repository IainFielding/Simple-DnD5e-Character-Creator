import { beforeEach, describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";
import { traitStep } from "../scripts/levelup/steps/trait-step.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * Trait grants with `allowReplacements` — the Cult of the Dragon Initiate shape (Heroes of
 * Faerûn): Dragon's Tongue *grants* Draconic with no choice pool, but if the character already
 * knows Draconic the rules let them learn any other language instead. The system surfaces this
 * by returning "not automatic" from `automaticApplicationValue` and widening `availableChoices()`
 * to the whole trait type; the driver's option list must fold that widened pool in, or the
 * screen shows only the already-owned grant (locked), `exhausted` settles the step, and the
 * replacement language is silently lost.
 */

const DRACONIC = "languages:standard:draconic";
const ELVISH = "languages:standard:elvish";
const DEEP_SPEECH = "languages:exotic:deepSpeech";
const NETHERESE = "languages:standard:faerun:netherese";   // module-added, nested a level deeper
const ALL = "languages:ALL";                                // the system's "All Languages" pseudo-entry

beforeEach(() => {
  installFoundryShims();
  // Pool expansion: the fixtures use concrete keys only, so expansion is identity.
  dnd5e.documents.Trait.mixedChoices = async keys => ({ asSet: () => new Set(keys) });
});

/**
 * A Dragon's-Tongue-shaped Trait advancement: one grant, no choice pools. `known` paints the
 * clone's languages; `replacementPool` is what the system's own availableChoices() would return
 * once the grant is unfulfillable (empty = not called / nothing to widen).
 */
function dragonsTongueAdv({ allowReplacements = true, known = [DRACONIC], replacementPool = [ELVISH, DEEP_SPEECH, NETHERESE, ALL] } = {}) {
  const adv = {
    type: "Trait",
    title: "Dragon's Tongue",
    configuration: { allowReplacements, grants: [DRACONIC], choices: [], mode: "default" },
    value: { chosen: [] },
    get maxTraits() { return 1; },
    availableChoicesCalls: [],
    async actorSelected() {
      const selected = new Set([...known, ...adv.value.chosen]);
      const available = new Set([ELVISH, DEEP_SPEECH].filter(k => !selected.has(k)));
      return { selected, available };
    },
    async availableChoices(chosen) {
      adv.availableChoicesCalls.push(chosen);
      const taken = new Set([...known, ...adv.value.chosen]);
      const pool = replacementPool.filter(k => !taken.has(k));
      return pool.length ? { choices: { asSet: () => new Set(pool) }, label: "" } : null;
    },
    async apply(level, { key }) { adv.value.chosen = [...adv.value.chosen, key]; },
    async reverse(level, { key }) { adv.value.chosen = adv.value.chosen.filter(k => k !== key); }
  };
  return adv;
}

function makeWorld(advOpts) {
  const advancement = dragonsTongueAdv(advOpts);
  const driver = new LevelUpDriver({
    actor: { system: { details: { level: 3 } } },
    clone: { reset: () => {} },
    steps: []
  });
  const record = { level: 4, screenLevel: 4, advancement, item: null };
  driver.traitSteps.push(record);
  const state = { traitSteps: driver.traitSteps, driver };
  return { driver, record, advancement, state };
}

describe("traitOptions — grant already owned, replacements allowed", () => {
  it("widens the options to the system's replacement pool", async () => {
    const { driver, record } = makeWorld();
    const options = await driver.traitOptions(record);
    const byKey = Object.fromEntries(options.map(o => [o.key, o]));

    // The fulfilled grant shows as owned and locked; the replacement languages are pickable,
    // including a module-added language nested below a sub-category (Faerûn's Netherese).
    expect(byKey[DRACONIC]).toMatchObject({ owned: true, selected: true, disabled: true });
    expect(byKey[ELVISH]).toMatchObject({ owned: false, selected: false, disabled: false });
    expect(byKey[DEEP_SPEECH]).toMatchObject({ owned: false, selected: false, disabled: false });
    expect(byKey[NETHERESE]).toMatchObject({ owned: false, selected: false, disabled: false });

    // The "All Languages" pseudo-entry is not a real language and must never be offered.
    expect(byKey[ALL]).toBeUndefined();
  });

  it("keeps the step gated until the replacement is picked", async () => {
    const { record, state } = makeWorld();
    await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(false);
    expect(traitStep.isCompleteAt(state, 4)).toBe(false);
  });

  it("completes once a replacement is picked, keeping the widened pool visible but disabled", async () => {
    const { driver, record, advancement, state } = makeWorld();
    await driver.toggleTrait(record, ELVISH);

    expect(advancement.value.chosen).toEqual([ELVISH]);
    expect(driver.traitState(record)).toMatchObject({ current: 1, max: 1, full: true });
    await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(traitStep.isCompleteAt(state, 4)).toBe(true);

    // The pick stays toggleable (to swap), the rest of the widened pool disables like any
    // other filled pool — availableChoices is asked with nothing chosen to keep it visible.
    const byKey = Object.fromEntries((await driver.traitOptions(record)).map(o => [o.key, o]));
    expect(byKey[ELVISH]).toMatchObject({ selected: true, owned: false, disabled: false });
    expect(byKey[DEEP_SPEECH]).toMatchObject({ selected: false, disabled: true });
    for ( const call of advancement.availableChoicesCalls ) expect(call.size).toBe(0);
  });

  it("still settles via exhaustion when only the ALL pseudo-entry is left to widen to", async () => {
    // The character knows every real language, so the system can only offer "All Languages" —
    // which is filtered out, leaving nothing pickable: the step settles instead of jamming.
    const { record, state } = makeWorld({ known: [DRACONIC, ELVISH, DEEP_SPEECH, NETHERESE] });
    await traitStep.sectionsAt({ state, driver: state.driver }, 4);
    expect(record.exhausted).toBe(true);
    expect(traitStep.isCompleteAt(state, 4)).toBe(true);
  });
});

describe("traitOptions — no replacements allowed", () => {
  it("stays scoped to the advancement's own pool", async () => {
    const { driver, record, advancement } = makeWorld({ allowReplacements: false });
    const options = await driver.traitOptions(record);

    expect(options.map(o => o.key)).toEqual([DRACONIC]);
    expect(advancement.availableChoicesCalls).toHaveLength(0);
  });
});
