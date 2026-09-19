import { describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

/**
 * dnd5e 6.0's `ModifyItem` advancement ("add this effect to every item with these identifiers") is
 * automatic, so the driver applies it as it walks. But which items it reaches depends on what the
 * character holds at that moment, and the walk runs it *before* the same level's choices are made,
 * where the native manager runs it after their screens. Arcana Unleashed's Transmuter is the case in
 * the wild: its Wondrous Alterations modifies Alter Self, and a Savant pick of Alter Self at the same
 * level stayed unmodified in the creator and was modified natively (found by the e2e sweep).
 *
 * The driver therefore settles every ModifyItem once more just before commit. `apply` is incremental
 * by design (it skips what it already modified), so the second pass only adds what the first missed.
 */

function makeItems(initial = []) {
  const m = new Map(initial.map(i => [i.id, i]));
  return {
    get: id => m.get(id), set: item => m.set(item.id, item), delete: id => m.delete(id),
    map: fn => [...m.values()].map(fn), filter: fn => [...m.values()].filter(fn),
    has: id => m.has(id), [Symbol.iterator]: () => m.values()
  };
}

/** A walk over one ModifyItem flow, with a commit-capable actor stub. */
async function walkModifier({ removeItemBeforeCommit = false } = {}) {
  const subclass = { id: "subTransmuter00", type: "subclass", name: "Transmuter", updateSource() {} };
  const applied = [];
  const advancement = {
    type: "ModifyItem", item: subclass, configuration: {},
    async apply(level, data, options) { applied.push({ level, data, options }); }
  };
  const flow = { advancement, level: 3, getAutomaticApplicationValue: async () => ({}) };
  const cloneItems = makeItems([subclass]);
  const actor = {
    system: { details: { level: 3 } }, items: makeItems(),
    update: async () => {}, createEmbeddedDocuments: async () => [], updateEmbeddedDocuments: async () => [],
    deleteEmbeddedDocuments: async () => []
  };
  const manager = {
    constructor: { flowsForLevel: () => [] },
    actor,
    clone: { items: cloneItems, reset() {}, toObject: () => ({ items: [] }) },
    steps: [{ type: "forward", level: 3, flow }]
  };
  const driver = new LevelUpDriver(manager);
  await driver.prepare();
  const afterWalk = applied.length;
  if ( removeItemBeforeCommit ) cloneItems.delete(subclass.id);
  await driver.commit();
  return { applied, afterWalk };
}

describe("a ModifyItem advancement", () => {
  it("is a type the claim gate accepts", () => {
    const step = { type: "forward", level: 3, flow: { advancement: { type: "ModifyItem", configuration: {} }, level: 3 } };
    expect(LevelUpDriver.isStepSupported(step)).toBe(true);
  });

  it("applies automatically during the walk", async () => {
    const { applied, afterWalk } = await walkModifier();
    expect(afterWalk).toBe(1);
    expect(applied[0]).toEqual({ level: 3, data: {}, options: { automatic: true } });
  });

  it("is applied once more at commit, so it reaches items the level's choices added", async () => {
    const { applied } = await walkModifier();
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ level: 3, data: {}, options: { automatic: true } });
  });

  it("is not re-applied when its item has left the character (a subclass swapped out)", async () => {
    const { applied } = await walkModifier({ removeItemBeforeCommit: true });
    expect(applied).toHaveLength(1);
  });
});
