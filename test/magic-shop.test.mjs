import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { creationMagicShopStep } from "../scripts/steps/magic-shop-step.mjs";
import { INDEX_FIELDS } from "../scripts/data/magic-shop-source.mjs";
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
    // One row per level, seeded from the DMG band that level falls in.
    expect(table.l12).toMatchObject({ baseGp: 5000, perD10Gp: 250 });
    expect(table.l20.allowance).toEqual(slots({ common: 2, uncommon: 4, rare: 3, veryrare: 1 }));
    expect(Object.keys(table)).toHaveLength(20);
    // Level 1 is present but empty: the book gives a 1st-level character nothing, and this is a
    // row so a GM can overrule that rather than being told the table starts at 2nd.
    expect(table.l1).toEqual({ baseGp: 0, perD10Gp: 0, allowance: slots({}) });
  });

  it("gives every level its own row, level 1 included", () => {
    const at = level => tierFor(level, table)?.key ?? null;
    // Level 1 has a row, and it grants nothing until a GM says otherwise — `tierGrantsAnything`
    // is what keeps the step hidden, not the absence of a row.
    expect(at(1)).toBe("l1");
    expect(tierGrantsAnything(tierFor(1, table))).toBe(false);
    expect([at(2), at(4)]).toEqual(["l2", "l4"]);
    expect([at(5), at(10)]).toEqual(["l5", "l10"]);
    expect([at(11), at(16)]).toEqual(["l11", "l16"]);
    expect([at(17), at(20)]).toEqual(["l17", "l20"]);
    // Every level from 2 has its own row, so a GM can give 7th what 5th does not.
    expect(BANDS.map(b => b.from)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1));
    expect(BANDS.every(b => b.from === b.to)).toBe(true);
  });

  it("prices the bonus gold from the stored d10", () => {
    expect(bonusGoldCp(tierFor(3, table), 7)).toBe(0);
    expect(bonusGoldCp(tierFor(5, table), 7)).toBe((500 + (7 * 25)) * 100);
    expect(bonusGoldCp(tierFor(12, table), 1)).toBe((5000 + 250) * 100);
    expect(bonusGoldCp(tierFor(20, table), 10)).toBe((20000 + 2500) * 100);
    expect(goldRange(tierFor(5, table))).toEqual({ min: 525, max: 750 });
  });

  it("follows a GM's override", () => {
    const custom = sanitizeWealthTable({ l6: { baseGp: 1000, perD10Gp: 50, allowance: { uncommon: 2 } } });
    const tier = tierFor(6, custom);
    expect(bonusGoldCp(tier, 4)).toBe((1000 + 200) * 100);
    // A partial band keeps the DMG's value for everything it doesn't name.
    expect(tier.allowance).toEqual(slots({ common: 1, uncommon: 2 }));
    expect(tierFor(12, custom).baseGp).toBe(5000);
    // The neighbouring level is untouched, which is the point of the split.
    expect(tierFor(5, custom).baseGp).toBe(500);
  });

  it("lets a GM grant something at level 1, which the book does not", () => {
    const generous = sanitizeWealthTable({ l1: { allowance: { common: 1 } } });
    expect(tierGrantsAnything(tierFor(1, generous))).toBe(true);
    expect(tierFor(1, generous).allowance.common).toBe(1);
  });

  it("reads a table stored in the old four-band shape, keeping the GM's numbers", () => {
    // Worlds configured before the per-level split have `t1`..`t4`. Those values have to survive
    // the upgrade, spread across the levels each band covered — losing a GM's tuned table to a
    // refactor is the worst outcome here.
    const migrated = sanitizeWealthTable({
      t2: { baseGp: 1000, perD10Gp: 50, allowance: { uncommon: 2 } }
    });
    for ( const level of [5, 7, 10] ) {
      expect(tierFor(level, migrated).baseGp, `level ${level}`).toBe(1000);
      expect(tierFor(level, migrated).allowance.uncommon, `level ${level}`).toBe(2);
    }
    // Bands the GM never touched still read as the book.
    expect(tierFor(12, migrated).baseGp).toBe(5000);
    expect(tierFor(4, migrated).baseGp).toBe(0);
    // Level 1 was never in the old table, so it stays empty rather than inheriting t1.
    expect(tierGrantsAnything(tierFor(1, migrated))).toBe(false);
  });

  it("prefers the new shape when both are somehow present", () => {
    const mixed = sanitizeWealthTable({
      t2: { baseGp: 1000 },
      l6: { baseGp: 7777 }
    });
    // A table carrying legacy keys is read as legacy throughout, so the migration is all-or-
    // nothing rather than a per-row guess about which key the GM meant.
    expect(tierFor(6, mixed).baseGp).toBe(1000);
  });

  it("guards a hand-edited setting field by field", () => {
    const guarded = sanitizeWealthTable({ l2: { baseGp: -5, perD10Gp: "abc", allowance: { common: 2.7, rare: null } } });
    expect(guarded.l2).toMatchObject({ baseGp: 0, perD10Gp: 0 });
    expect(guarded.l2.allowance.common).toBe(2);
    expect(guarded.l2.allowance.rare).toBe(0);
    expect(sanitizeWealthTable("nonsense")).toEqual(table);
  });

  it("hides a band the GM zeroed out", () => {
    const zeroed = sanitizeWealthTable({ l2: { baseGp: 0, perD10Gp: 0, allowance: { common: 0 } } });
    expect(tierGrantsAnything(tierFor(2, zeroed))).toBe(false);
    // Only that level. Zeroing 2nd no longer silently zeroes 3rd and 4th with it, which is the
    // whole reason the table is per level.
    expect(tierGrantsAnything(tierFor(3, zeroed))).toBe(true);
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

  it("asks the index for every field the shelf reads", () => {
    // The stock is built from a compendium index, which carries only the fields requested. Leaving
    // `system.price` out did not make items free — it made them unpriced, and every row on the
    // shelf read "Not for sale". Each entry here is read somewhere in the stock build.
    for ( const field of ["system.rarity", "system.type", "system.price", "system.strength"] ) {
      expect(INDEX_FIELDS, field).toContain(field);
    }
  });

  it("puts the step on the creation rail only for a character with no climb", () => {
    // A 1st-level character never reaches the level-up rail, so the step has to live on the
    // creation one or the GM's 1st-level row is silently ignored. A character starting higher gets
    // theirs from the climb instead, against the row for the level they start at — offering both
    // would ask twice and grant twice.
    enable({ wealthTable: { l1: { allowance: { legendary: 1 } } } });
    expect(creationMagicShopStep.applicable({ targetLevel: 1 })).toBe(true);
    expect(creationMagicShopStep.applicable({ targetLevel: 5 })).toBe(false);
  });

  it("counts as finished on a rail it is not on, so it cannot block Next", () => {
    // The bug this guards: the step overrode `applicable` but inherited `isComplete`, which at 5th
    // level saw the climb's tier and an unrolled d10 and answered "not finished". A hidden step
    // that is permanently incomplete stops Next with nothing on screen to fix — a high-level custom
    // build got stuck on the Store step and could go no further.
    enable({ wealthTable: { l1: { allowance: { legendary: 1 } } } });
    const climbing = { targetLevel: 5, magicShop: { d10: null, picks: {} } };
    expect(creationMagicShopStep.applicable(climbing)).toBe(false);
    expect(creationMagicShopStep.isComplete(climbing)).toBe(true);
    expect(creationMagicShopStep.incompleteHint(climbing)).toBeNull();
    expect(creationMagicShopStep.summary(climbing)).toBe("");
  });

  it("still gates properly on the rail it IS on", () => {
    // The inverse: at 1st level with something to grant, an unrolled tier is genuinely unfinished.
    enable({ wealthTable: { l1: { baseGp: 100, perD10Gp: 10, allowance: { common: 1 } } } });
    const here = { targetLevel: 1, magicShop: { d10: null, picks: {} }, magicShopVisited: true };
    expect(creationMagicShopStep.applicable(here)).toBe(true);
    expect(creationMagicShopStep.isComplete(here)).toBe(false);
  });

  it("stays off the creation rail when the 1st-level row grants nothing", () => {
    enable();
    expect(creationMagicShopStep.applicable({ targetLevel: 1 })).toBe(false);
  });

  it("is off by default and needs a level above 1", () => {
    expect(magicShopConfig().enabled).toBe(false);
    expect(magicShopTier({ targetLevel: 12 })).toBeNull();
    enable();
    expect(magicShopTier({ targetLevel: 1 })).toBeNull();
    expect(magicShopTier({ targetLevel: 12 })?.key).toBe("l12");
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
    expect(await grantMagicItems(actor, state)).toEqual({
      d10: 7, baseGp: 500, perD10Gp: 25, gp: 675, items: [], bought: [], spentCp: 0
    });
    // The whole purse is rewritten rather than gp nudged, because the shop can spend from it too.
    expect(update).toEqual({ "system.currency": { pp: 69, gp: 0, sp: 0, cp: 0 } });
    expect(await grantMagicItems(actor, { targetLevel: 1 })).toBeNull();
  });

  it("charges the cart against the bonus gold and the purse together", async () => {
    enable();
    let update = null;
    const actor = { system: { currency: { gp: 15 } }, update: async data => { update = data; } };
    const state = {
      targetLevel: 5,
      magicShop: {
        d10: 7, picks: {},
        // 100 gp of shopping, bought twice.
        cart: { "Compendium.x.y.Item.z": { qty: 2, cp: 10000, name: "Potion", img: "" } }
      }
    };
    const grant = await grantMagicItems(actor, state);
    // 675 gp rolled + 15 gp carried = 690 gp; 200 gp spent leaves 490 gp, i.e. 49 pp.
    expect(grant.spentCp).toBe(20000);
    expect(update).toEqual({ "system.currency": { pp: 49, gp: 0, sp: 0, cp: 0 } });
  });

  it("never leaves a character owing money, however stale the cart", async () => {
    // The step gates the cart against the budget, so a shortfall here means state from an earlier
    // render. A discount is a better outcome than a negative purse.
    enable();
    let update = null;
    const actor = { system: { currency: {} }, update: async data => { update = data; } };
    const state = {
      targetLevel: 5,
      magicShop: {
        d10: 0, picks: {},
        cart: { "Compendium.x.y.Item.z": { qty: 1, cp: 9999999, name: "Too dear", img: "" } }
      }
    };
    await grantMagicItems(actor, state);
    for ( const value of Object.values(update["system.currency"]) ) expect(value).toBeGreaterThanOrEqual(0);
  });
});
