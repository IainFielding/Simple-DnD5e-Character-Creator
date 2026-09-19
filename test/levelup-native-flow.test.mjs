import { afterEach, describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";
import { nativeFlowStep } from "../scripts/levelup/steps/native-flow-step.mjs";

/**
 * Advancement types the driver has no case for — a premium module's own — are handled generically
 * rather than by name: an automatic one applies itself, and any other is committed exactly as the
 * native manager commits an untouched screen, then surfaced so the wizard can mount that screen.
 *
 * The two types in the wild that used to need a hand-written case are modelled here by shape:
 * Ember's `EmberKnowledge` (automatic) and Forge of the Artificer's `PotentDragonmark` (a V1 flow
 * with no inputs, whose `_updateObject` refuses without a dragonmark).
 */

/** An items store with the handful of Collection methods the walk touches. */
function makeItems(initial = []) {
  const m = new Map(initial.map(i => [i.id, i]));
  return {
    get: id => m.get(id), set: item => m.set(item.id, item), delete: id => m.delete(id),
    map: fn => [...m.values()].map(fn), filter: fn => [...m.values()].filter(fn),
    has: id => m.has(id), [Symbol.iterator]: () => m.values()
  };
}

/** A V2 flow class, installed on the dnd5e shim for the tests that need one. */
class FakeFlowV2 {
  constructor(advancement, level) { this.advancement = advancement; this.level = level; }
  async getAutomaticApplicationValue() { return false; }
}

afterEach(() => {
  delete globalThis.dnd5e.applications;
});

/**
 * Walk one third-party advancement flow and report what the driver did with it.
 * @param {object} [opts]
 * @param {*} [opts.auto=false]           What the flow's `getAutomaticApplicationValue` returns.
 * @param {"v1"|"v2"} [opts.kind="v1"]    Which flow generation to model.
 * @param {Error} [opts.refuse]           Thrown from the V1 flow's `_updateObject`.
 */
async function walk({ auto = false, kind = "v1", refuse = null } = {}) {
  const featItem = { id: "featPotent00000", type: "feat", name: "Potent Dragonmark", updateSource() {} };
  const calls = [];
  const advancement = {
    type: "SomeModuleAdvancement",
    title: "Spells of the Mark",
    item: featItem,
    configuration: {},
    async apply(level, data, options = {}) { calls.push({ op: "apply", level, data, options }); },
    async reverse(level) { calls.push({ op: "reverse", level }); }
  };

  let flow;
  if ( kind === "v2" ) {
    globalThis.dnd5e.applications = { advancement: { AdvancementFlowV2: FakeFlowV2 } };
    flow = new FakeFlowV2(advancement, 0);
  } else {
    flow = {
      advancement,
      level: 0,
      getAutomaticApplicationValue: async () => auto,
      async _updateObject(event, formData) {
        calls.push({ op: "_updateObject", formData });
        if ( refuse ) throw refuse;
        return advancement.apply(0, formData);
      }
    };
  }
  if ( kind === "v2" && (auto !== false) ) flow.getAutomaticApplicationValue = async () => auto;

  const manager = {
    constructor: { flowsForLevel: () => [] },
    actor: { system: { details: { level: 0 } }, items: makeItems() },
    clone: { items: makeItems([featItem]), reset() {} },
    steps: [{ type: "forward", level: 0, flow }]
  };
  const driver = new LevelUpDriver(manager);
  await driver.prepare();
  return { driver, calls, flow };
}

/* -------------------------------------------- */

describe("the driver's walk over an advancement type it has no case for", () => {
  it("applies an automatic one straight away and records no decision (Ember's knowledge grant)", async () => {
    const { driver, calls } = await walk({ auto: ["gods"] });
    expect(driver.nativeSteps).toHaveLength(0);
    expect(calls).toEqual([{ op: "apply", level: 0, data: ["gods"], options: { automatic: true } }]);
  });

  it("commits a V1 flow through its own _updateObject, as an untouched native screen is", async () => {
    const { driver, calls } = await walk();
    // The decisive assertion: it is applied, not skipped — skipping is how Potent Dragonmark lost
    // a character their Spells of the Mark.
    expect(calls[0]).toEqual({ op: "_updateObject", formData: {} });
    expect(calls[1]).toMatchObject({ op: "apply", data: {} });
    expect(driver.nativeSteps).toHaveLength(1);
    const [record] = driver.nativeSteps;
    expect(record).toMatchObject({ level: 0, screenLevel: 0, error: null });
    expect(record.item.id).toBe("featPotent00000");
  });

  it("seeds a V2 flow with the initial apply the native manager makes before rendering it", async () => {
    const { driver, calls } = await walk({ kind: "v2" });
    expect(calls).toEqual([{ op: "apply", level: 0, data: {}, options: { initial: true } }]);
    expect(driver.nativeSteps).toHaveLength(1);
  });

  it("keeps the flow's own refusal on the record, and holds the level incomplete", async () => {
    const refuse = new Error("You need a dragonmark to take this feat.");
    const { driver } = await walk({ refuse });
    const [record] = driver.nativeSteps;
    expect(record.error).toBe("You need a dragonmark to take this feat.");
    expect(nativeFlowStep.isCompleteAt({ nativeSteps: driver.nativeSteps }, 0)).toBe(false);
  });

  it("does not hold back a level whose native screens applied cleanly", async () => {
    const { driver } = await walk();
    expect(nativeFlowStep.isCompleteAt({ nativeSteps: driver.nativeSteps }, 0)).toBe(true);
  });
});

describe("LevelUpDriver#resubmitNativeFlow", () => {
  it("reverses the previous application, then commits the mounted V1 form's data", async () => {
    const { driver, calls, flow } = await walk();
    calls.length = 0;
    flow.form = {};
    flow._getSubmitData = () => ({ "choice": "a" });
    await driver.resubmitNativeFlow(driver.nativeSteps[0]);
    expect(calls.map(c => c.op)).toEqual(["reverse", "_updateObject", "apply"]);
    expect(calls[1].formData).toEqual({ choice: "a" });
  });

  it("clears an earlier refusal once the form submits cleanly", async () => {
    const refuse = new Error("nope");
    const { driver, flow } = await walk({ refuse });
    const record = driver.nativeSteps[0];
    expect(record.error).toBe("nope");
    flow._updateObject = async () => {};
    flow.form = {};
    flow._getSubmitData = () => ({});
    await driver.resubmitNativeFlow(record);
    expect(record.error).toBeNull();
  });

  it("does nothing for a flow that was never mounted", async () => {
    const { driver, calls } = await walk();
    calls.length = 0;
    await driver.resubmitNativeFlow(driver.nativeSteps[0]);
    expect(calls).toHaveLength(0);
  });
});
