import { describe, it, expect, beforeEach } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  heroClassesFor, applyHeroClass, addRenown, transformItemData, chosenHeroClass
} from "../scripts/data/warcraft.mjs";

/**
 * World of Warcraft's hero classes and Renown, applied to the item data the creator stages.
 *
 * The module does both in its sheet-drop handler, which the creator never goes through, so these
 * transforms have to leave an item exactly as that handler would: the e2e hero axis compares a
 * creator build against the module's own handler, and these pin the pieces of that contract down
 * without a world.
 */
const WOW = "dnd-world-warcraft";
const LAY_ON_HANDS = "Compendium.x.classes.Item.layOnHands000000";
const DEATH_COIL = "Compendium.dnd-world-warcraft.classes.Item.wowpdnDeathCoil0";
const EBON_BLADE = "Compendium.dnd-world-warcraft.classes.Item.wowpdnOathEbonBl";

const CONFIG_TABLES = {
  classIcons: { paladin: "badge-paladin.webp" },
  heroClasses: {
    paladin: [{
      name: "WOW.HeroClasses.DeathKnight", img: "badge-death-knight.webp", identifier: "death-knight",
      subclass: EBON_BLADE,
      replacedClassFeatures: { 1: { "lay-on-hands": DEATH_COIL } }
    }]
  },
  renownAdvancement: {
    class: {
      barbarian: { description: "<p>Earthen Ring</p>", heroClass: "shaman", options: ["Compendium.w.Item.ring"] },
      druid: { description: "<p>Cenarion</p>", options: ["Compendium.w.Item.cenarion"] }
    },
    race: { dwarf: { embed: "Compendium.w.book.JournalEntry.dwarf", options: ["Compendium.w.Item.ironforge"] } }
  }
};

/** A 2024-style Paladin, its advancement in dnd5e's id-keyed source shape. */
function paladin() {
  return {
    name: "Paladin", type: "class", img: "paladin.webp", flags: {},
    system: {
      identifier: "paladin",
      advancement: {
        grant1: { _id: "grant1", type: "ItemGrant", level: 1, configuration: { items: [{ uuid: LAY_ON_HANDS }] } },
        sub3: { _id: "sub3", type: "Subclass", level: 3, configuration: {} }
      }
    }
  };
}

describe("World of Warcraft hero classes and Renown", () => {
  beforeEach(() => {
    installFoundryShims();
    game.modules = { get: id => (id === WOW) ? { active: true, config: CONFIG_TABLES } : null };
    dnd5e.utils.staticID = id => `${id}`.padEnd(16, "0").slice(0, 16);
    dnd5e.settings.renownScore = false;
    globalThis.fromUuid = async uuid => (uuid === LAY_ON_HANDS) ? { system: { identifier: "lay-on-hands" } } : null;
  });

  it("offers nothing without the module", async () => {
    game.modules = { get: () => null };
    expect(heroClassesFor("paladin")).toEqual([]);
    const data = paladin();
    await transformItemData(data, { heroClass: "death-knight" });
    expect(data).toEqual(paladin());
  });

  it("lists a class's hero classes, localised", () => {
    expect(heroClassesFor("paladin")).toEqual([{
      identifier: "death-knight", name: "WOW.HeroClasses.DeathKnight", img: "badge-death-knight.webp", subclass: EBON_BLADE
    }]);
    expect(heroClassesFor("wizard")).toEqual([]);
  });

  it("makes the class the hero: name, badge, flag, locked subclass, swapped feature", async () => {
    const data = await applyHeroClass(paladin(), "death-knight");
    expect(data.name).toBe("WOW.HeroClasses.DeathKnight");
    expect(data.img).toBe("badge-death-knight.webp");
    expect(data.flags[WOW].heroClass).toBe("death-knight");
    expect(data.system.advancement.sub3.configuration.suggested).toEqual({ fixed: true, uuid: EBON_BLADE });
    expect(data.system.advancement.grant1.configuration.items).toEqual([{ uuid: DEATH_COIL }]);
  });

  it("works on the array advancement shape too", async () => {
    const data = paladin();
    data.system.advancement = Object.values(data.system.advancement);
    await applyHeroClass(data, "death-knight");
    expect(data.system.advancement[0].configuration.items[0].uuid).toBe(DEATH_COIL);
  });

  it("gives the plain class its badge, as the module's 'customize classes' drop does", async () => {
    const data = await transformItemData(paladin());
    expect(data.img).toBe("badge-paladin.webp");
    expect(data.name).toBe("Paladin");
  });

  it("adds no Renown while dnd5e's Renown rule is off", () => {
    const data = addRenown({ name: "Druid", type: "class", flags: {}, system: { identifier: "druid", advancement: {} } });
    expect(data.system.advancement).toEqual({});
  });

  it("adds the module's Renown choice: level 1 on a class, level 0 on a species", () => {
    dnd5e.settings.renownScore = true;
    const druid = addRenown({ name: "Druid", type: "class", flags: {}, system: { identifier: "druid", advancement: {} } });
    const [adv] = Object.values(druid.system.advancement);
    expect(adv.type).toBe("ItemChoice");
    expect(adv.configuration).toEqual({
      allowDrops: false, choices: { 1: { count: 1 } }, pool: [{ uuid: "Compendium.w.Item.cenarion" }], type: "renown"
    });
    const dwarf = addRenown({ name: "Dwarf", type: "race", flags: {}, system: { identifier: "dwarf", advancement: [] } });
    expect(dwarf.system.advancement[0].configuration.choices).toEqual({ 0: { count: 1 } });
    expect(dwarf.system.advancement[0].hint).toContain("@Embed[Compendium.w.book.JournalEntry.dwarf inline]");
  });

  it("adds Renown only once, and a hero-only Renown only to that hero", () => {
    dnd5e.settings.renownScore = true;
    const druid = { name: "Druid", type: "class", flags: {}, system: { identifier: "druid", advancement: {} } };
    addRenown(addRenown(druid));
    expect(Object.keys(druid.system.advancement)).toHaveLength(1);
    const barbarian = { name: "Barbarian", type: "class", flags: {}, system: { identifier: "barbarian", advancement: {} } };
    expect(Object.keys(addRenown(barbarian).system.advancement)).toHaveLength(0);
    barbarian.flags[WOW] = { heroClass: "shaman" };
    expect(Object.keys(addRenown(barbarian).system.advancement)).toHaveLength(1);
  });

  it("names the hero a creator build is played as", () => {
    const source = { card: () => ({ identifier: "paladin" }) };
    expect(chosenHeroClass({ classUuid: "x", heroClass: "death-knight" }, source)?.name).toBe("WOW.HeroClasses.DeathKnight");
    expect(chosenHeroClass({ classUuid: "x", heroClass: null }, source)).toBeNull();
  });
});
