import { beforeAll, describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

// The two Foundry helpers `commit()` leans on that the shared shims don't carry.
beforeAll(() => {
  foundry.utils.equals ??= (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if ( !Array.prototype.findSplice ) {
    Object.defineProperty(Array.prototype, "findSplice", {
      configurable: true,
      value(find) {
        const i = this.findIndex(find);
        return (i < 0) ? null : this.splice(i, 1)[0];
      }
    });
  }
});

/**
 * `commit()` skips items the level-up did not change, where the native manager re-writes every item.
 * That re-write is what lets dnd5e's `preUpdateActivities` rebuild `flags.dnd5e.riders` from the
 * item's enchant activities. So an unchanged item whose rider flag disagrees with its activities must
 * still be sent through an update. "Disagrees" covers an empty list (the original case) and a list
 * naming riders the enchantments no longer declare: Tasha's Experimental Elixir ships four, and it
 * was the Alchemist's one remaining sweep difference.
 */

function makeItems(initial = []) {
  const m = new Map(initial.map(i => [i.id ?? i._id, i]));
  return {
    get: id => m.get(id), set: item => m.set(item.id, item), delete: id => m.delete(id),
    map: fn => [...m.values()].map(fn), filter: fn => [...m.values()].filter(fn),
    has: id => m.has(id), [Symbol.iterator]: () => m.values()
  };
}

/**
 * Commit a driver whose clone holds one item identical to the actor's, carrying `riders`, whose
 * enchant activities declare `declared`. Returns the item ids sent to `updateEmbeddedDocuments`.
 */
async function commitWith({ riders, declared = { activity: [], effect: [] } }) {
  const data = { _id: "itemElixir000000", name: "Experimental Elixir", flags: { dnd5e: { riders } } };
  const existing = { id: data._id, toObject: () => structuredClone(data) };
  const cloneDoc = {
    id: data._id,
    system: { activities: { getByType: type => (type === "enchant")
      ? [{ effects: [{ riders: { activity: new Set(declared.activity), effect: new Set(declared.effect) } }] }]
      : [] } }
  };
  let updated = [];
  const actor = {
    items: makeItems([existing]),
    update: async () => {}, createEmbeddedDocuments: async () => [],
    updateEmbeddedDocuments: async (_type, list) => { updated = list.map(i => i._id); },
    deleteEmbeddedDocuments: async () => []
  };
  const manager = {
    actor,
    clone: { items: makeItems([cloneDoc]), reset() {}, toObject: () => ({ items: [structuredClone(data)] }) },
    steps: []
  };
  await new LevelUpDriver(manager).commit();
  return updated;
}

describe("commit sends an unchanged item through an update when its rider flag is stale", () => {
  it("leaves an item alone when its flag matches what its enchantments declare", async () => {
    expect(await commitWith({ riders: { effect: ["e1"] }, declared: { activity: [], effect: ["e1"] } })).toEqual([]);
  });

  it("updates an item whose flag names riders its enchantments no longer declare", async () => {
    expect(await commitWith({ riders: { effect: ["e1", "e2", "e3", "e4"] } })).toEqual(["itemElixir000000"]);
  });

  it("updates an item whose flag is missing a rider its enchantments declare", async () => {
    expect(await commitWith({ riders: { effect: ["e1"] }, declared: { activity: [], effect: ["e1", "e2"] } }))
      .toEqual(["itemElixir000000"]);
  });

  it("still updates an item carrying an empty rider list", async () => {
    expect(await commitWith({ riders: { effect: [] } })).toEqual(["itemElixir000000"]);
  });

  it("leaves an item with no rider flag at all alone", async () => {
    expect(await commitWith({ riders: undefined })).toEqual([]);
  });
});
