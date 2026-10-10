import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  EquipmentSource, collectEquipment, describeOption, summarizeEquipment, summarizeOption
} from "../scripts/data/equipment-source.mjs";

/**
 * Starting equipment: a class's or background's `system.startingEquipment` tree becomes lettered
 * options (a root OR gives one per branch, a root AND gives one), a non-zero `wealth` adds a gold
 * option, and the player's picks are read back for the review summary and for the build. These run
 * the real tree walkers on plain data, with `fromUuid` and item creation stubbed.
 */

/** Compendium items the trees point at. */
const ITEMS = {
  "Compendium.x.items.Item.sword": { name: "Longsword", img: "sword.webp", type: "weapon", system: { identifier: "longsword" } },
  "Compendium.x.items.Item.axe": { name: "Greataxe", img: "axe.webp", type: "weapon", system: { identifier: "greataxe" } },
  "Compendium.x.items.Item.pack": { name: "Explorer's Pack", img: "pack.webp", type: "container", system: { identifier: "explorers-pack" } },
  "Compendium.x.items.Item.arrows": { name: "Arrows", img: "arrows.webp", type: "consumable", system: { identifier: "arrows", quantity: 1 } }
};

const linked = (_id, key, count = null) => ({ _id, type: "linked", key, count });

/**
 * A Fighter-like class: (A) a sword *or* an axe, a pack and 20 arrows, plus 5 gp; (B) 155 gp of wealth.
 * The description states option A's gold in prose too, the shape some books use.
 */
const FIGHTER = {
  name: "Fighter", img: "fighter.webp",
  system: {
    identifier: "fighter",
    wealth: "155",
    description: { value: "<p>Choose (A) a weapon, a pack and 20 arrows, and 5 GP; or (B) 155 GP.</p>" },
    startingEquipment: [{
      _id: "root", type: "AND", sort: 0,
      children: [
        { _id: "weapon", type: "OR", children: [linked("sword", "Compendium.x.items.Item.sword"), linked("axe", "Compendium.x.items.Item.axe")] },
        linked("pack", "Compendium.x.items.Item.pack"),
        linked("arrows", "Compendium.x.items.Item.arrows", 20),
        { _id: "coin", type: "currency", key: "gp", count: 5 }
      ]
    }]
  }
};

/** A background whose root is a choice between two bundles. */
const SOLDIER = {
  name: "Soldier", img: "soldier.webp",
  system: {
    identifier: "soldier", wealth: "0", description: { value: "" },
    startingEquipment: [{
      _id: "root", type: "OR", sort: 0,
      children: [
        { _id: "kitA", type: "AND", children: [linked("s2", "Compendium.x.items.Item.sword")] },
        { _id: "kitB", type: "AND", children: [{ _id: "gold", type: "currency", key: "gp", count: 50 }] }
      ]
    }]
  }
};

const DOCS = { "Compendium.x.classes.Item.fighter": FIGHTER, "Compendium.x.bgs.Item.soldier": SOLDIER, ...ITEMS };
const source = { card: () => null };
const freshState = () => ({
  classUuid: "Compendium.x.classes.Item.fighter", backgroundUuid: "Compendium.x.bgs.Item.soldier", equipment: {}
});

beforeEach(() => {
  installFoundryShims();
  vi.stubGlobal("fromUuid", async uuid => DOCS[uuid] ?? null);
  CONFIG.Item = { documentClass: { createWithContents: async docs => docs.map(d => structuredClone(d)) } };
});

describe("EquipmentSource.load", () => {
  it("turns a root AND into option A and wealth into a gold option B", async () => {
    const loaded = await new EquipmentSource().load(freshState(), source);
    expect(loaded.class.options.map(o => [o.label, o.type])).toEqual([["A", "equipment"], ["B", "gold"]]);
    expect(loaded.class.options[1].wealth).toBe("155");
  });

  it("turns a root OR into one lettered option per branch, with no gold option at zero wealth", async () => {
    const loaded = await new EquipmentSource().load(freshState(), source);
    expect(loaded.background.options.map(o => [o.label, o.type])).toEqual([["A", "equipment"], ["B", "equipment"]]);
  });

  it("resolves linked items' names and reads gold stated in the description", async () => {
    const loaded = await new EquipmentSource().load(freshState(), source);
    const pack = loaded.class.options[0].tree.children.find(c => c._id === "pack");
    expect(pack.name).toBe("Explorer's Pack");
    expect(loaded.class.options[0].descriptionGold).toBe(5);
  });

  it("seeds the first option and the first branch of every nested choice", async () => {
    const state = freshState();
    await new EquipmentSource().load(state, source);
    expect(state.equipment.class).toEqual({ selectedOption: 0, orSelections: { weapon: "sword" } });
    expect(state.equipment.background.selectedOption).toBe(0);
  });

  it("skips an origin that does not resolve", async () => {
    const state = { ...freshState(), backgroundUuid: "Compendium.x.bgs.Item.missing" };
    const loaded = await new EquipmentSource().load(state, source);
    expect(loaded.background).toBeUndefined();
    expect(loaded.class).toBeDefined();
  });
});

describe("the review summaries", () => {
  it("lists the picked branch of a choice, the fixed items, and the gold", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    state.equipment.class.orSelections.weapon = "axe";
    const { items, gold } = summarizeOption(loaded.class, state.equipment.class);
    expect(items.map(i => i.name)).toEqual(["Greataxe", "Explorer's Pack", "Arrows"]);
    expect(items.find(i => i.name === "Arrows").count).toBe(20);
    expect(gold).toBe("5 GP");
  });

  it("summarises the gold option as its wealth", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    state.equipment.class.selectedOption = 1;
    expect(summarizeOption(loaded.class, state.equipment.class)).toEqual({ items: [], gold: "155 GP" });
  });

  it("describes the options and marks the selected one, with an inline selector for the choice", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    const view = describeOption(loaded.class, state.equipment.class);
    expect(view.options.map(o => o.isSelected)).toEqual([true, false]);
    expect(view.rows.find(r => r.isOrGroup).options.map(o => o.name)).toEqual(["Longsword", "Greataxe"]);
    expect(view.currency).toBe("5 GP");
  });

  it("omits an origin the player never reached", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    delete state.equipment.background;
    expect(Object.keys(summarizeEquipment(loaded, state.equipment))).toEqual(["class"]);
  });
});

describe("collectEquipment", () => {
  it("creates the chosen items, with quantities and weapons equipped, and totals the coin", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    const { items, currency } = await collectEquipment(loaded, state);
    expect(items.map(i => i.name)).toEqual(["Longsword", "Explorer's Pack", "Arrows", "Longsword"]);
    expect(items.find(i => i.name === "Arrows").system.quantity).toBe(20);
    expect(items[0].system.equipped).toBe(true);
    expect(currency).toEqual({ gp: 5 });
  });

  it("does not add the description's gold again when the tree already grants gold", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    const { currency } = await collectEquipment(loaded, state, { currencyOnly: true });
    expect(currency.gp).toBe(5);
  });

  it("takes the wealth for a gold option, and resolves no item for a currency-only walk", async () => {
    const state = freshState();
    const loaded = await new EquipmentSource().load(state, source);
    state.equipment.class.selectedOption = 1;
    state.equipment.background.selectedOption = 1;
    const spy = vi.fn(async uuid => DOCS[uuid] ?? null);
    vi.stubGlobal("fromUuid", spy);
    const { items, currency } = await collectEquipment(loaded, state, { currencyOnly: true });
    expect(items).toEqual([]);
    expect(currency).toEqual({ gp: 205 });
    expect(spy).not.toHaveBeenCalled();
  });
});
