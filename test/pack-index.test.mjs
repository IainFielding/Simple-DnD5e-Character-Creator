import { describe, it, expect, beforeEach } from "vitest";
import { packIndex, resetPackIndexes, collapseFields, ITEM_INDEX_FIELDS } from "../scripts/data/compendium-util.mjs";

/** A pack whose getIndex records every field list it was asked for and resolves after a tick. */
function fakePack() {
  const calls = [];
  const index = new Map();
  return {
    calls,
    index,
    getIndex: async ({ fields = [] } = {}) => {
      calls.push([...fields].sort());
      await new Promise(r => setTimeout(r, 5));
      return index;
    }
  };
}

describe("packIndex", () => {
  beforeEach(() => resetPackIndexes());

  it("fetches once, then answers requests the fetched fields cover without a round trip", async () => {
    const pack = fakePack();
    expect(await packIndex(pack, { fields: ["system.level"] })).toBe(pack.index);
    await packIndex(pack, { fields: ["system.level"] });
    await packIndex(pack);
    expect(pack.calls).toEqual([["system.level"]]);
  });

  it("asks for everything fetched so far plus the new field, so the old ones are never knocked out", async () => {
    const pack = fakePack();
    await packIndex(pack, { fields: ["system.level"] });
    await packIndex(pack, { fields: ["system.identifier"] });
    await packIndex(pack, { fields: ["system.level"] });
    expect(pack.calls).toEqual([["system.level"], ["system.identifier", "system.level"]]);
  });

  it("shares a fetch in flight, folding waiting callers' fields into one follow-up", async () => {
    const pack = fakePack();
    await Promise.all([
      packIndex(pack, { fields: ["a"] }),
      packIndex(pack, { fields: ["a"] }),
      packIndex(pack, { fields: ["b"] }),
      packIndex(pack, { fields: ["c"] })
    ]);
    expect(pack.calls).toEqual([["a"], ["a", "b", "c"]]);
  });

  it("asks an Item pack for the shared field set, so a later reader's fields are already there", async () => {
    const items = Object.assign(fakePack(), { documentName: "Item" });
    await packIndex(items, { fields: ["system.level"] });
    await packIndex(items, { fields: ["system.identifier", "system.type.baseItem"] });
    expect(items.calls).toEqual([[...ITEM_INDEX_FIELDS].sort()]);
  });

  it("leaves the shared set off packs that are not Items", async () => {
    const actors = Object.assign(fakePack(), { documentName: "Actor" });
    await packIndex(actors, { fields: ["type"] });
    expect(actors.calls).toEqual([["type"]]);
  });

  it("never asks for a field and its parent together, and counts the parent as covering it", async () => {
    const items = Object.assign(fakePack(), { documentName: "Item" });
    await packIndex(items, { fields: ["system.type", "system.damage.base"] });
    const [asked] = items.calls;
    expect(asked).toContain("system.type");
    expect(asked.filter(f => f.startsWith("system.type."))).toEqual([]);
    await packIndex(items, { fields: ["system.damage.base.types", "system.type.value"] });
    expect(items.calls).toHaveLength(1);
  });

  it("collapseFields keeps a parent and drops what sits under it", () => {
    expect(collapseFields(["system.type.value", "system.type", "system.typeface", "system.type"]))
      .toEqual(["system.type", "system.typeface"]);
  });

  it("has no field in the shared set sitting under another", () => {
    expect(collapseFields(ITEM_INDEX_FIELDS)).toEqual([...ITEM_INDEX_FIELDS]);
  });

  it("goes back to the server after a reset", async () => {
    const pack = fakePack();
    await packIndex(pack, { fields: ["a"] });
    resetPackIndexes();
    await packIndex(pack, { fields: ["a"] });
    expect(pack.calls).toHaveLength(2);
  });

  it("lets a failed fetch reject its caller, and retries on the next request", async () => {
    const pack = fakePack();
    const ok = pack.getIndex;
    pack.getIndex = async () => { throw new Error("offline"); };
    await expect(packIndex(pack, { fields: ["a"] })).rejects.toThrow("offline");
    pack.getIndex = ok;
    expect(await packIndex(pack, { fields: ["a"] })).toBe(pack.index);
  });
});
