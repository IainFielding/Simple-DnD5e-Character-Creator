import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  BANDS, DEFAULT_WEALTH_TABLE, assignSlots, bonusGoldCp, canPick, countByRarity, countPicks,
  descendantFolderIds, filterMagicIndex, goldRange, highestSlotRank, mergeEntries, normalizeRarity,
  sanitizeMagicEntry, sanitizeWealthTable, slotsSummary, tierFor, tierGrantsAnything, withinAllowance
} from "../scripts/data/magic-shop.mjs";
import {
  MagicShopSource, ensureMagicShopRoll, grantMagicItems, locateUuid, magicShopConfig, magicShopGrant, magicShopTier
} from "../scripts/data/magic-shop-source.mjs";
import { MODULE_ID, SETTINGS } from "../scripts/config.mjs";

/**
 * The Magic Items step's rules: the DMG starting-wealth table (and a GM's override of it), the
 * rarity allowance with its "a slot holds its own rarity or lower" rule, the inventory entries a
 * dropped folder turns into, and the lazy stock loader's progress.
 */

const table = sanitizeWealthTable(null);

/** An allowance with only the named slots. */
function slots(partial) {
  return { common: 0, uncommon: 0, rare: 0, veryrare: 0, legendary: 0, artifact: 0, ...partial };
}

describe("normalizeRarity", () => {
  it("maps the system's keys and older labels onto the shop's form", () => {
    expect(normalizeRarity("veryRare")).toBe("veryrare");
    expect(normalizeRarity("Very Rare")).toBe("veryrare");
    expect(normalizeRarity("uncommon")).toBe("uncommon");
  });

  it("treats a missing or unknown rarity as mundane", () => {
    expect(normalizeRarity("")).toBe("");
    expect(normalizeRarity(undefined)).toBe("");
    expect(normalizeRarity("mythic")).toBe("");
  });
});

describe("the wealth table", () => {
  it("defaults to the DMG", () => {
    expect(table).toEqual(JSON.parse(JSON.stringify(DEFAULT_WEALTH_TABLE)));
    expect(table.t3).toMatchObject({ baseGp: 5000, perD10Gp: 250 });
    expect(table.t4.allowance).toEqual(slots({ common: 2, uncommon: 4, rare: 3, veryrare: 1 }));
  });

  it("puts each starting level in its band, and level 1 in none", () => {
    const at = level => tierFor(level, table)?.key ?? null;
    expect(at(1)).toBeNull();
    expect([at(2), at(4)]).toEqual(["t1", "t1"]);
    expect([at(5), at(10)]).toEqual(["t2", "t2"]);
    expect([at(11), at(16)]).toEqual(["t3", "t3"]);
    expect([at(17), at(20)]).toEqual(["t4", "t4"]);
    expect(BANDS.map(b => b.from)).toEqual([2, 5, 11, 17]);
  });

  it("prices the bonus gold from the stored d10", () => {
    expect(bonusGoldCp(tierFor(3, table), 7)).toBe(0);
    expect(bonusGoldCp(tierFor(5, table), 7)).toBe((500 + (7 * 25)) * 100);
    expect(bonusGoldCp(tierFor(12, table), 1)).toBe((5000 + 250) * 100);
    expect(bonusGoldCp(tierFor(20, table), 10)).toBe((20000 + 2500) * 100);
    expect(goldRange(tierFor(5, table))).toEqual({ min: 525, max: 750 });
  });

  it("follows a GM's override", () => {
    const custom = sanitizeWealthTable({ t2: { baseGp: 1000, perD10Gp: 50, allowance: { uncommon: 2 } } });
    const tier = tierFor(6, custom);
    expect(bonusGoldCp(tier, 4)).toBe((1000 + 200) * 100);
    // A partial band keeps the DMG's value for everything it doesn't name.
    expect(tier.allowance).toEqual(slots({ common: 1, uncommon: 2 }));
    expect(tierFor(12, custom).baseGp).toBe(5000);
  });

  it("guards a hand-edited setting field by field", () => {
    const guarded = sanitizeWealthTable({ t1: { baseGp: -5, perD10Gp: "abc", allowance: { common: 2.7, rare: null } } });
    expect(guarded.t1).toMatchObject({ baseGp: 0, perD10Gp: 0 });
    expect(guarded.t1.allowance.common).toBe(2);
    expect(guarded.t1.allowance.rare).toBe(0);
    expect(sanitizeWealthTable("nonsense")).toEqual(table);
  });

  it("hides a band the GM zeroed out", () => {
    const zeroed = sanitizeWealthTable({ t1: { baseGp: 0, perD10Gp: 0, allowance: { common: 0 } } });
    expect(tierGrantsAnything(tierFor(3, zeroed))).toBe(false);
    expect(tierGrantsAnything(tierFor(3, table))).toBe(true);
  });
});

describe("the allowance", () => {
  const t3 = slots({ common: 2, uncommon: 3, rare: 1 });

  it("lets a slot hold a lower rarity", () => {
    // Three Commons: the third borrows an Uncommon slot.
    expect(withinAllowance(slots({ common: 3 }), t3)).toBe(true);
    expect(assignSlots(slots({ common: 3 }), t3).used).toMatchObject({ common: 2, uncommon: 1 });
    // Six Commons fill every slot there is.
    expect(withinAllowance(slots({ common: 6 }), t3)).toBe(true);
    expect(withinAllowance(slots({ common: 7 }), t3)).toBe(false);
  });

  it("never lets a slot hold a higher rarity", () => {
    expect(withinAllowance(slots({ rare: 2 }), t3)).toBe(false);
    expect(withinAllowance(slots({ uncommon: 4, rare: 1 }), t3)).toBe(false);
    expect(withinAllowance(slots({ veryrare: 1 }), t3)).toBe(false);
  });

  it("places rarest first so a mixed set fits whenever it can", () => {
    // A Rare needs the one Rare slot; the Uncommons take the Uncommon slots; the Commons fill the rest.
    expect(withinAllowance(slots({ common: 2, uncommon: 3, rare: 1 }), t3)).toBe(true);
    expect(assignSlots(slots({ uncommon: 4 }), t3)).toEqual({ used: slots({ uncommon: 3, rare: 1 }), unplaced: 0 });
  });

  it("answers whether one more fits", () => {
    const counts = slots({ common: 2, uncommon: 3 });
    expect(canPick(counts, "rare", t3)).toBe(true);
    expect(canPick(counts, "common", t3)).toBe(true);    // borrows the Rare slot
    expect(canPick(slots({ common: 2, uncommon: 3, rare: 1 }), "common", t3)).toBe(false);
    expect(canPick(counts, "veryrare", t3)).toBe(false);
    expect(canPick(counts, "", t3)).toBe(false);
  });

  it("tallies picks by quantity", () => {
    const picks = { a: { qty: 2, rarity: "common" }, b: { qty: 1, rarity: "veryRare" }, c: { qty: 0, rarity: "rare" } };
    expect(countPicks(picks)).toEqual(slots({ common: 2, veryrare: 1 }));
  });

  it("summarises the slots the tier grants", () => {
    expect(slotsSummary(slots({ common: 1 }), slots({ common: 1, uncommon: 1 }))).toEqual([
      { rarity: "common", used: 1, allowed: 1, full: true },
      { rarity: "uncommon", used: 0, allowed: 1, full: false }
    ]);
    expect(highestSlotRank(t3)).toBe(2);
    expect(highestSlotRank(slots({}))).toBe(-1);
  });
});

describe("inventory entries", () => {
  it("keeps only what the shelf needs", () => {
    expect(sanitizeMagicEntry({ uuid: "u", name: "Wand", type: "equipment", rarity: "Rare", img: "x.png", baseCp: 9 }))
      .toEqual({ uuid: "u", name: "Wand", type: "equipment", subtype: "", rarity: "rare", hidden: false });
    expect(sanitizeMagicEntry(null).uuid).toBe("");
  });

  it("finds every folder under a root, however deep", () => {
    const folders = [
      { id: "b", parent: "a" }, { id: "c", parent: "b" }, { id: "d", parent: "c" },
      { id: "x", parent: null }, { id: "y", parent: "x" }
    ];
    expect([...descendantFolderIds("a", folders)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the magic items from a dropped folder and counts what it leaves out", () => {
    const index = [
      { uuid: "1", name: "Wand of Web", type: "equipment", folder: "c", system: { rarity: "uncommon", type: { value: "wand" } } },
      { uuid: "2", name: "Rope", type: "loot", folder: "a", system: { rarity: "" } },
      { uuid: "3", name: "Bag of Holding", type: "container", folder: "a", system: { rarity: "uncommon" } },
      { uuid: "4", name: "Potion inside the bag", type: "consumable", folder: "a", system: { rarity: "common", container: "3" } },
      { uuid: "5", name: "Fireball", type: "spell", folder: "a", system: {} },
      { uuid: "6", name: "Elsewhere", type: "weapon", folder: "z", system: { rarity: "rare" } }
    ];
    const ids = new Set(["a", "c"]);
    const result = filterMagicIndex(index, e => ids.has(e.folder));
    expect(result.entries.map(e => e.uuid)).toEqual(["3", "1"]);
    expect(result.entries[1]).toMatchObject({ subtype: "wand", rarity: "uncommon" });
    expect(result).toMatchObject({ mundane: 1, other: 1 });
  });

  it("merges without duplicates and stops at the cap", () => {
    const have = [{ uuid: "a" }];
    const { inventory, added, duplicates, overflow } = mergeEntries(have, [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }], 2);
    expect(inventory.map(e => e.uuid)).toEqual(["a", "b"]);
    expect(added.map(e => e.uuid)).toEqual(["b"]);
    expect({ duplicates, overflow }).toEqual({ duplicates: 1, overflow: 1 });
    expect(countByRarity([{ rarity: "rare" }, { rarity: "rare" }, { rarity: "" }]).rare).toBe(2);
  });
});

describe("the stock loader", () => {
  it("locates pack and world uuids", () => {
    expect(locateUuid("Compendium.dnd5e.items.Item.abc")).toEqual({ pack: "dnd5e.items", id: "abc" });
    expect(locateUuid("Item.xyz")).toEqual({ pack: null, id: "xyz" });
    expect(locateUuid("Actor.a.Item.b")).toBeNull();
  });

  it("reports rising progress to 100 and drops entries that no longer resolve", async () => {
    installFoundryShims();
    const packs = {
      "p.one": new Map([["a", { name: "Alpha", img: "a.png", type: "weapon", system: { rarity: "rare" } }]]),
      "p.two": new Map([["c", { name: "Charlie", img: "c.png", type: "equipment", system: { rarity: "common", type: { value: "ring" } } }]])
    };
    const source = new MagicShopSource({ packIndex: async c => packs[c] ?? null, worldItem: () => null });
    const entries = [
      { uuid: "Compendium.p.one.Item.a", rarity: "rare" },
      { uuid: "Compendium.p.one.Item.gone", rarity: "rare" },
      { uuid: "Compendium.p.two.Item.c", rarity: "common" },
      { uuid: "Compendium.p.two.Item.d", rarity: "common" }
    ];
    const seen = [];
    const stock = await source.load(entries, pct => seen.push(pct));
    expect(seen.at(-1)).toBe(100);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(stock.map(s => s.name)).toEqual(["Alpha", "Charlie"]);
    expect(stock[1]).toMatchObject({ subtype: "ring", img: "c.png" });
    expect(source.peek(entries)).toBe(stock);
  });

  it("shares one load between concurrent callers, and forgets it on clear", async () => {
    installFoundryShims();
    let reads = 0;
    const source = new MagicShopSource({
      packIndex: async () => { reads++; return new Map([["a", { name: "A", type: "loot", system: { rarity: "common" } }]]); }
    });
    const entries = [{ uuid: "Compendium.p.one.Item.a", rarity: "common" }];
    const [first, second] = await Promise.all([source.load(entries), source.load(entries)]);
    expect(first).toBe(second);
    expect(reads).toBe(1);
    source.clear();
    expect(source.peek(entries)).toBeNull();
  });
});

describe("the step's gate and grant", () => {
  beforeEach(() => installFoundryShims());

  function enable(config = {}) {
    game.settings.set(MODULE_ID, SETTINGS.magicShopEnabled, true);
    game.settings.set(MODULE_ID, SETTINGS.magicShopConfig, { inventory: [], wealthTable: null, ...config });
  }

  it("is off by default and needs a level above 1", () => {
    expect(magicShopConfig().enabled).toBe(false);
    expect(magicShopTier({ targetLevel: 12 })).toBeNull();
    enable();
    expect(magicShopTier({ targetLevel: 1 })).toBeNull();
    expect(magicShopTier({ targetLevel: 12 })?.key).toBe("t3");
  });

  it("grants the picks and the gold, but no items once they no longer fit", () => {
    enable();
    const state = {
      targetLevel: 5,
      magicShop: { d10: 4, picks: { "u1": { qty: 1, name: "Wand", rarity: "uncommon" }, "c1": { qty: 1, name: "Cloak", rarity: "common" } } }
    };
    const grant = magicShopGrant(state);
    expect(grant.items.map(i => i.uuid)).toEqual(["c1", "u1"]);
    expect(grant.goldCp).toBe((500 + 100) * 100);
    state.targetLevel = 3;
    expect(magicShopGrant(state).items).toEqual([]);
  });

  it("rolls the d10 once when two renders race for it", async () => {
    // Both calls land before the first roll resolves; the later one must not roll again and win.
    let evaluations = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    const totals = [3, 9];
    globalThis.Roll = class { async evaluate() { const total = totals[evaluations++]; await gate; return { total }; } };
    const state = { targetLevel: 5 };
    const first = ensureMagicShopRoll(state);
    const second = ensureMagicShopRoll(state);
    release();
    expect(await Promise.all([first, second])).toEqual([3, 3]);
    expect(evaluations).toBe(1);
    expect(state.magicShop.d10).toBe(3);
  });

  it("rolls again for a state whose roll failed, rather than caching the failure", async () => {
    let fail = true;
    globalThis.Roll = class { async evaluate() { if ( fail ) throw new Error("no dice"); return { total: 6 }; } };
    const state = { targetLevel: 5 };
    await expect(ensureMagicShopRoll(state)).rejects.toThrow("no dice");
    fail = false;
    expect(await ensureMagicShopRoll(state)).toBe(6);
  });

  it("reports what it granted, so the chat card can show the roll behind the gold", async () => {
    enable();
    let update = null;
    const actor = { system: { currency: { gp: 15 } }, update: async data => { update = data; } };
    const state = { targetLevel: 5, magicShop: { d10: 7, picks: {} } };
    expect(await grantMagicItems(actor, state)).toEqual({ d10: 7, baseGp: 500, perD10Gp: 25, gp: 675, items: [] });
    expect(update).toEqual({ "system.currency.gp": 690 });
    expect(await grantMagicItems(actor, { targetLevel: 1 })).toBeNull();
  });
});
