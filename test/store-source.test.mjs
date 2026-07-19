import { describe, it, expect, beforeEach } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  toCopper, totalCp, multiplyCp, priceCp, formatCp, fromCopper,
  sanitizeEntry, entryFromItem, effectiveCp, parsePriceInput, cpToPriceParts,
  hydrateEntries, buildStock, cartTotalCp, remainingCurrency,
  equipmentBudgetCp, purchasedItems
} from "../scripts/data/store-source.mjs";

/**
 * The store's money maths is all integer copper — these tests pin the conversion,
 * multiplier, and formatting edges the shelf/cart/build all rely on. Conversion rates
 * come from CONFIG.DND5E.currencies with the standard-rules fallback; the shims carry
 * no currency config, so the fallback path is what's exercised unless a test adds one.
 */
describe("price math", () => {
  beforeEach(() => installFoundryShims());

  it("normalises each denomination to copper at the standard rates", () => {
    expect(toCopper(1, "gp")).toBe(100);
    expect(toCopper(3, "sp")).toBe(30);
    expect(toCopper(7, "cp")).toBe(7);
    expect(toCopper(2, "ep")).toBe(100);
    expect(toCopper(1, "pp")).toBe(1000);
  });

  it("prefers the system's configured conversion rates when present", () => {
    CONFIG.DND5E.currencies = { gp: { conversion: 1 }, sp: { conversion: 20 } };
    expect(toCopper(1, "sp")).toBe(5);
    expect(toCopper(1, "gp")).toBe(100);
  });

  it("treats bad amounts and unknown denominations defensively", () => {
    expect(toCopper("x", "gp")).toBe(0);
    expect(toCopper(2, "zz")).toBe(200);   // unknown denom falls back to a 1:1-gp-like rate
  });

  it("totals a currency map in copper", () => {
    expect(totalCp({ gp: 15, sp: 3, cp: 4 })).toBe(1534);
    expect(totalCp({})).toBe(0);
    expect(totalCp(null)).toBe(0);
  });

  it("applies the GM multiplier with a 1 cp floor", () => {
    expect(multiplyCp(100, 1.5)).toBe(150);
    expect(multiplyCp(1, 0.1)).toBe(1);     // never free
    expect(multiplyCp(0, 2)).toBe(0);       // unpriced stays unpriced
    expect(multiplyCp(100, -3)).toBe(100);  // bad multiplier ignored
  });

  it("prices a system.price object, multiplied", () => {
    expect(priceCp({ value: 15, denomination: "gp" })).toBe(1500);
    expect(priceCp({ value: 5, denomination: "sp" }, 2)).toBe(100);
    expect(priceCp(null)).toBe(0);
    expect(priceCp({ value: 0, denomination: "gp" }, 2)).toBe(0);
  });

  it("formats copper largest-denomination first", () => {
    expect(formatCp(1500)).toBe("15 gp");
    expect(formatCp(75)).toBe("7 sp 5 cp");
    expect(formatCp(12345)).toBe("123 gp 4 sp 5 cp");
    expect(formatCp(0)).toBe("0 cp");
  });

  it("re-expresses copper as gp/sp/cp change", () => {
    expect(fromCopper(7950)).toEqual({ gp: 79, sp: 5, cp: 0 });
    expect(fromCopper(0)).toEqual({ gp: 0, sp: 0, cp: 0 });
  });
});

/**
 * The curated inventory model: stored entries are uuid + display/price snapshot + the GM's
 * per-item override, guarded field by field. Skeleton entries (the factory default list)
 * hydrate through an injected resolver; the shelf is built from the hydrated list.
 */
describe("inventory entries", () => {
  it("sanitizes a stored entry field by field", () => {
    expect(sanitizeEntry({ uuid: "u", name: "Rope", img: "x.png", type: "loot", subtype: "gear", baseCp: 100, overrideCp: 50, hidden: 1 }))
      .toEqual({ uuid: "u", name: "Rope", img: "x.png", type: "loot", subtype: "gear", baseCp: 100, overrideCp: 50, hidden: true });
    // A skeleton {uuid} passes through with defaults filled in.
    expect(sanitizeEntry({ uuid: "u" }))
      .toEqual({ uuid: "u", name: "", img: "icons/svg/item-bag.svg", type: "", subtype: "", baseCp: 0, overrideCp: null, hidden: false });
    // Garbage never escapes: bad prices collapse to 0/null, extra fields are dropped.
    expect(sanitizeEntry({ uuid: "u", baseCp: "x", overrideCp: -5, junk: true }).baseCp).toBe(0);
    expect(sanitizeEntry({ uuid: "u", overrideCp: 0 }).overrideCp).toBe(null);
    expect(sanitizeEntry(null).uuid).toBe("");
    expect(sanitizeEntry({ uuid: "u", junk: true })).not.toHaveProperty("junk");
  });

  it("builds an entry from a resolved item document", () => {
    const item = {
      name: "Dagger", img: "d.png", type: "weapon",
      system: { type: { value: "simpleM" }, price: { value: 2, denomination: "gp" } }
    };
    expect(entryFromItem(item, "Compendium.p.e.Item.dag")).toEqual({
      uuid: "Compendium.p.e.Item.dag", name: "Dagger", img: "d.png", type: "weapon", subtype: "simpleM",
      baseCp: 200, overrideCp: null, hidden: false
    });
    // Unpriced items snapshot at 0 — stocked but shelved only once the GM sets an override.
    expect(entryFromItem({ name: "Trinket", type: "loot" }, "u").baseCp).toBe(0);
  });

  it("prices an entry: the override wins, else base × multiplier with the 1 cp floor", () => {
    expect(effectiveCp({ baseCp: 100, overrideCp: 250 }, 2)).toBe(250);
    expect(effectiveCp({ baseCp: 100, overrideCp: null }, 1.5)).toBe(150);
    expect(effectiveCp({ baseCp: 1, overrideCp: null }, 0.1)).toBe(1);
    expect(effectiveCp({ baseCp: 0, overrideCp: null }, 2)).toBe(0);
  });

  it("parses override inputs to copper, treating blank and junk as no-override", () => {
    expect(parsePriceInput("2", "gp")).toBe(200);
    expect(parsePriceInput("3", "sp")).toBe(30);
    expect(parsePriceInput("1.5", "gp")).toBe(150);
    expect(parsePriceInput("", "gp")).toBe(null);
    expect(parsePriceInput("  ", "gp")).toBe(null);
    expect(parsePriceInput("abc", "gp")).toBe(null);
    expect(parsePriceInput("0", "gp")).toBe(null);
    expect(parsePriceInput("-1", "gp")).toBe(null);
  });

  it("re-expresses copper as the largest cleanly-dividing denomination", () => {
    expect(cpToPriceParts(1500)).toEqual({ value: 15, denomination: "gp" });
    expect(cpToPriceParts(30)).toEqual({ value: 3, denomination: "sp" });
    expect(cpToPriceParts(7)).toEqual({ value: 7, denomination: "cp" });
    expect(cpToPriceParts(2000)).toEqual({ value: 2, denomination: "pp" });
    expect(cpToPriceParts(0)).toEqual({ value: 0, denomination: "cp" });
    // Round-trips through the override inputs.
    const parts = cpToPriceParts(150);
    expect(parsePriceInput(String(parts.value), parts.denomination)).toBe(150);
  });

  it("hydrates skeleton entries through the resolver, preserving GM edits", async () => {
    const docs = {
      dag: { name: "Dagger", img: "d.png", type: "weapon", system: { type: { value: "simpleM" }, price: { value: 2, denomination: "gp" } } }
    };
    const resolve = async uuid => docs[uuid] ?? null;
    const out = await hydrateEntries([
      { uuid: "dag", overrideCp: 50, hidden: true },              // skeleton with GM edits
      { uuid: "gone" },                                           // unresolvable — stays skeletal
      { uuid: "kept", name: "Rope", subtype: "", baseCp: 100 },   // snapshot present — untouched
      { name: "no uuid" }                                         // dropped
    ], resolve);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ uuid: "dag", name: "Dagger", img: "d.png", type: "weapon", subtype: "simpleM", baseCp: 200, overrideCp: 50, hidden: true });
    expect(out[1].name).toBe("");
    expect(out[2].name).toBe("Rope");
  });

  it("never lets a resolver call for a snapshot-complete entry", async () => {
    let calls = 0;
    await hydrateEntries([{ uuid: "a", name: "Rope", subtype: "", baseCp: 10 }], async () => { calls += 1; return null; });
    expect(calls).toBe(0);
  });

  it("re-resolves a pre-subtype snapshot to heal it", async () => {
    const resolve = async () => ({ name: "Dagger", img: "d.png", type: "weapon", system: { type: { value: "simpleM" }, price: { value: 2, denomination: "gp" } } });
    // No `subtype` field at all = a save from before the subtype filter existed.
    const out = await hydrateEntries([{ uuid: "dag", name: "Dagger", baseCp: 200, overrideCp: 50 }], resolve);
    expect(out[0].subtype).toBe("simpleM");
    expect(out[0].overrideCp).toBe(50);
  });

  it("builds the shelf: visible, resolvable, priced entries only, priced final", () => {
    const inventory = [
      { uuid: "a", name: "Dagger", img: "d.png", type: "weapon", subtype: "simpleM", baseCp: 200 },
      { uuid: "b", name: "Rope", type: "loot", baseCp: 100, overrideCp: 30 },
      { uuid: "c", name: "Hidden", type: "loot", baseCp: 100, hidden: true },
      { uuid: "d", name: "Broken", type: "loot", baseCp: 100 },
      { uuid: "e", name: "Unpriced", type: "loot", baseCp: 0 },
      { uuid: "f" }                                          // skeleton — not shelved
    ];
    const out = buildStock(inventory, 1.5, uuid => uuid !== "d");
    expect(out).toEqual([
      { uuid: "a", name: "Dagger", img: "d.png", type: "weapon", subtype: "simpleM", cp: 300 },
      { uuid: "b", name: "Rope", img: "icons/svg/item-bag.svg", type: "loot", subtype: "", cp: 30 }
    ]);
  });
});

describe("cart totals & deduction", () => {
  it("totals qty × cached unit price, ignoring malformed rows", () => {
    expect(cartTotalCp({
      a: { qty: 2, cp: 150 },
      b: { qty: 1, cp: 30 },
      c: { qty: 0, cp: 999 },
      d: { qty: 2 }                 // no cached price → contributes nothing
    })).toBe(330);
    expect(cartTotalCp({})).toBe(0);
    expect(cartTotalCp(null)).toBe(0);
  });

  it("deducts a fitting cart and re-expresses the remainder as change", () => {
    const { spendable, remainder } = remainingCurrency({ gp: 125 }, 4550);
    expect(spendable).toBe(true);
    expect(remainder).toEqual({ gp: 79, sp: 5, cp: 0 });
  });

  it("declines a cart that exceeds the currency, leaving it untouched", () => {
    const { spendable, remainder } = remainingCurrency({ gp: 10 }, 1001);
    expect(spendable).toBe(false);
    expect(remainder).toEqual({ gp: 10 });
  });

  it("passes an empty cart through without collapsing denominations", () => {
    const { spendable, remainder } = remainingCurrency({ gp: 10, sp: 5 }, 0);
    expect(spendable).toBe(true);
    expect(remainder).toEqual({ gp: 10, sp: 5 });
  });
});

/**
 * The budget is the currency the player's current equipment selection yields — the same
 * walk the build's equipment grant performs, in currency-only mode (no item resolution).
 */
describe("equipmentBudgetCp", () => {
  beforeEach(() => installFoundryShims());

  const equipTree = children => ({ type: "AND", _id: "root", children });
  const currencyNode = (amount, key = "gp") => ({ type: "currency", _id: `c-${key}`, count: amount, key, children: [] });
  const linkedNode = uuid => ({ type: "linked", _id: `l-${uuid}`, key: uuid, count: 1, children: [] });

  const stateFor = selections => ({
    equipment: {
      class: { selectedOption: selections.class ?? 0, orSelections: {} },
      background: { selectedOption: selections.background ?? 0, orSelections: {} }
    }
  });

  it("sums the gold option, package currency, and description gold across sources", async () => {
    const loaded = {
      class: { options: [
        { type: "equipment", label: "A", tree: equipTree([linkedNode("x")]) },
        { type: "gold", label: "B", wealth: "125" }
      ] },
      background: { options: [
        { type: "equipment", label: "A", tree: equipTree([currencyNode(15), linkedNode("y")]) }
      ] }
    };
    expect(await equipmentBudgetCp(loaded, stateFor({ class: 1 }))).toBe(14000);
  });

  it("uses description gold when the chosen bundle carries no currency node", async () => {
    const loaded = {
      class: { options: [
        { type: "equipment", label: "A", tree: equipTree([linkedNode("x")]), descriptionGold: 10 }
      ] }
    };
    expect(await equipmentBudgetCp(loaded, stateFor({}))).toBe(1000);
  });

  it("never resolves item documents in currency-only mode", async () => {
    let resolved = 0;
    globalThis.fromUuid = async () => { resolved += 1; return null; };
    const loaded = {
      class: { options: [
        { type: "equipment", label: "A", tree: equipTree([linkedNode("x"), currencyNode(5)]) }
      ] }
    };
    expect(await equipmentBudgetCp(loaded, stateFor({}))).toBe(500);
    expect(resolved).toBe(0);
  });
});

describe("purchasedItems", () => {
  beforeEach(() => installFoundryShims());

  it("resolves the cart to item data with quantity set, skipping missing items", async () => {
    const docs = {
      "Compendium.p.e.Item.rope": { name: "Rope", toObject: () => ({}) }
    };
    globalThis.fromUuid = async uuid => docs[uuid] ?? null;
    globalThis.CONFIG.Item = {
      documentClass: {
        createWithContents: async ([doc]) => [{
          _id: "new", name: doc.name, type: "loot", system: { quantity: 1 }, _stats: {}
        }]
      }
    };
    const out = await purchasedItems({
      "Compendium.p.e.Item.rope": { qty: 3, cp: 100 },
      "Compendium.p.e.Item.gone": { qty: 1, cp: 50 },
      "Compendium.p.e.Item.none": { qty: 0, cp: 50 }
    });
    expect(out).toHaveLength(1);
    expect(out[0].system.quantity).toBe(3);
    expect(out[0]._stats.compendiumSource).toBe("Compendium.p.e.Item.rope");
  });

  it("equips bought weapons and equipment like the class kit, leaves the rest packed", async () => {
    const docs = {
      "Compendium.p.e.Item.sword": { name: "Longsword", type: "weapon", toObject: () => ({}) },
      "Compendium.p.e.Item.mail": { name: "Chain Mail", type: "equipment", toObject: () => ({}) },
      "Compendium.p.e.Item.rope": { name: "Rope", type: "loot", toObject: () => ({}) }
    };
    globalThis.fromUuid = async uuid => docs[uuid] ?? null;
    globalThis.CONFIG.Item = {
      documentClass: {
        createWithContents: async ([doc]) => [{
          _id: "new", name: doc.name, type: doc.type, system: { quantity: 1 }, _stats: {}
        }]
      }
    };
    const out = await purchasedItems({
      "Compendium.p.e.Item.sword": { qty: 1, cp: 1500 },
      "Compendium.p.e.Item.mail": { qty: 1, cp: 7500 },
      "Compendium.p.e.Item.rope": { qty: 1, cp: 100 }
    });
    const byName = Object.fromEntries(out.map(i => [i.name, i]));
    expect(byName["Longsword"].system.equipped).toBe(true);
    expect(byName["Chain Mail"].system.equipped).toBe(true);
    expect(byName["Rope"].system.equipped).toBeUndefined();
  });
});
