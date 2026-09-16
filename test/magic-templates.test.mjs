import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import {
  baseRuleFromText, baseMatchesRule, enchantedItemData, isTemplate, linkUuid, linkedBaseUuids, mightBeTemplate,
  parseVariant, templateProfiles, templateVariants, variantId, isShell, shellBases, shellVariants, shellItemData,
  SHELL_PROFILE
} from "../scripts/data/magic-templates.mjs";
import { itemRarity } from "../scripts/data/magic-shop.mjs";
import { MODULE_ID } from "../scripts/config.mjs";

/**
 * DMG template items expanded into shop entries, tested against real items from the 2024 Dungeon
 * Master's Guide module (trimmed to the fields the expansion reads — see test/fixtures/dmg-templates).
 */

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/dmg-templates/${name}.json`, import.meta.url), "utf8"));
const uuidOf = item => `Compendium.dnd-dungeon-masters-guide.equipment.Item.${item._id}`;

const WAND = { uuid: "Compendium.dnd-players-handbook.equipment.Item.phbafcWand000000", name: "Wand", type: "equipment", subtype: "wand", properties: ["foc"] };
const base = (name, type, subtype, extra = {}) => ({ uuid: `Compendium.dnd5e.equipment24.Item.${name}`, name, type, subtype, properties: [], ...extra });
const POOL = [
  base("Longsword", "weapon", "martialM"),
  base("Dagger", "weapon", "simpleM"),
  base("Longbow", "weapon", "martialR"),
  base("Arrows", "consumable", "ammo"),
  base("Chain Mail", "equipment", "heavy"),
  base("Hide Armor", "equipment", "medium"),
  base("Leather Armor", "equipment", "light"),
  base("Shield", "equipment", "shield"),
  base("Flame Longsword", "weapon", "martialM", { properties: ["mgc"] })
];

beforeEach(() => installFoundryShims());

describe("recognising a template", () => {
  it("knows a DMG template by its reference embed, and leaves a finished item alone", () => {
    expect(isTemplate(fixture("wand-of-the-war-mage"))).toBe(true);
    expect(isTemplate(fixture("weapon-plus"))).toBe(true);
    expect(isTemplate(fixture("potion-of-healing"))).toBe(false);
    expect(mightBeTemplate(fixture("wand-of-the-war-mage"))).toBe(true);
    expect(mightBeTemplate(fixture("potion-of-healing"))).toBe(false);
  });

  it("reads the base the headline links", () => {
    expect(linkedBaseUuids(fixture("wand-of-the-war-mage"))).toEqual([WAND.uuid]);
    expect(linkedBaseUuids(fixture("frost-brand"))).toHaveLength(6);
    expect(linkedBaseUuids(fixture("weapon-plus"))).toEqual([]);
  });

  it("keeps the enchantments that make an item and skips add-ons, riders and item grants", () => {
    expect(templateProfiles(fixture("wand-of-the-war-mage")).map(p => p.rarity)).toEqual(["uncommon", "rare", "veryrare"]);
    // Moonblade's seven runes add to a blade already made; only the blade itself is an item.
    expect(templateProfiles(fixture("moonblade"))).toHaveLength(1);
    // Flame Tongue's "Engulf in Flames" is a rider activity, not a second kind of sword.
    expect(templateProfiles(fixture("flame-tongue"))).toHaveLength(1);
    // Demon Armor's enchantment grants its claws as an item, which a shop entry can't carry.
    expect(templateProfiles(fixture("demon-armor"))).toHaveLength(0);
  });
});

describe("expanding a template", () => {
  it("makes Wand of the War Mage +1, +2 and +3 from its linked Wand", () => {
    const template = fixture("wand-of-the-war-mage");
    const entries = templateVariants({ template, templateUuid: uuidOf(template), linked: [WAND], pool: POOL });
    expect(entries.map(e => [e.name, e.rarity])).toEqual([
      ["Wand of the War Mage, +1", "uncommon"],
      ["Wand of the War Mage, +2", "rare"],
      ["Wand of the War Mage, +3", "veryrare"]
    ]);
    expect(entries[0]).toMatchObject({ type: "equipment", subtype: "wand", hidden: false });
    expect(parseVariant(entries[0].uuid)).toMatchObject({ template: uuidOf(template), base: WAND.uuid });
    expect(linkUuid(entries[0].uuid)).toBe(uuidOf(template));
  });

  it("puts an unlinked weapon template on every simple and martial weapon, but no magic ones", () => {
    const template = fixture("weapon-plus");
    const names = templateVariants({ template, templateUuid: uuidOf(template), pool: POOL }).map(e => e.name);
    expect(names).toEqual(["Dagger +1", "Dagger +2", "Dagger +3", "Longbow +1", "Longbow +2", "Longbow +3",
      "Longsword +1", "Longsword +2", "Longsword +3"]);
  });

  it("tells apart enchantments that rename alike", () => {
    const template = fixture("armor-of-vulnerability");
    const names = templateVariants({ template, templateUuid: uuidOf(template), pool: POOL })
      .filter(e => e.name.startsWith("Chain Mail")).map(e => e.name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
  });

  it("reads a headline's wording into the bases it allows", () => {
    const rule = text => POOL.filter(b => baseMatchesRule(b, baseRuleFromText(text))).map(b => b.name);
    expect(rule("Weapon (Any Melee Weapon), Rare")).toEqual(["Longsword", "Dagger", "Flame Longsword"]);
    expect(rule("Weapon (Any Ammunition), Common")).toEqual(["Arrows"]);
    expect(rule("Weapon (Any Ammunition or Melee Weapon), Uncommon")).toEqual(["Longsword", "Dagger", "Arrows", "Flame Longsword"]);
    expect(rule("Armor (Any Medium or Heavy, Except Hide Armor), Uncommon")).toEqual(["Chain Mail"]);
    expect(rule("Armor (Any Light, Medium, or Heavy), Rare")).toEqual(["Chain Mail", "Hide Armor", "Leather Armor"]);
    expect(baseRuleFromText("Wondrous Item, Uncommon")).toBeNull();
  });

  /** A one-profile template of the given shape, for the cases the fixtures don't cover. */
  function synthetic({ type, subtype = "", headline = "", effectName = "Profile", nameChange = "{} Thing" }) {
    return {
      _id: "synthetic", name: "Adamantine Ammunition", type,
      system: {
        type: { value: subtype }, properties: ["mgc"], rarity: "uncommon",
        description: { value: `${headline ? `<p><em>${headline}</em></p>` : "<p>Prose.</p>"}<p>@Embed[Compendium.dnd-dungeon-masters-guide.content.JournalEntry.dmgFoundryRefere.JournalEntryPage.Ok4iCgD25ENgoRxE]</p>` },
        activities: { a1: { _id: "a1", type: "enchant", effects: [{ _id: "e1" }], restrictions: {} } }
      },
      effects: [{ _id: "e1", type: "enchantment", name: effectName, system: { changes: [{ key: "name", value: nameChange, type: "override" }] } }]
    };
  }

  it("keeps a template to its own kind of item when its wording is broader", () => {
    // Adamantine Ammunition's headline reads "Ammunition or Melee Weapon", but it is ammunition.
    const template = synthetic({ type: "consumable", subtype: "ammo", headline: "Weapon (Any Ammunition or Melee Weapon), Uncommon" });
    expect(templateVariants({ template, templateUuid: "T", pool: POOL }).map(e => e.name)).toEqual(["Arrows Thing"]);
  });

  it("falls back on the template's type when it has no headline", () => {
    // Ammunition of Slaying opens straight into prose.
    const template = synthetic({ type: "consumable", subtype: "ammo" });
    expect(templateVariants({ template, templateUuid: "T", pool: POOL }).map(e => e.name)).toEqual(["Arrows Thing"]);
  });

  it("reads a headline that isn't italic, with links missing their document type", () => {
    // Candleflame Bow (sogrom-griffons-saddlebag): the headline opens the first paragraph and breaks
    // to the prose with <br>, three of its links omit ".Item.", and only the headline names a rarity.
    const phb = id => `Compendium.dnd-players-handbook.equipment.Item.${id}`;
    const template = {
      _id: "xcpBs8HXVQEVeaxA", name: "Candleflame Bow", type: "weapon",
      system: {
        type: { value: "simpleM" }, properties: [], rarities: [],
        description: { value: `<p>Weapon (@UUID[${phb("phbwepLongbow000")}]{Longbow}, @UUID[${phb("phbwepShortbow00")}]{Shortbow}, @UUID[Compendium.dnd-players-handbook.equipment.phbwepHandCrossb]{Hand Crossbow}, @UUID[Compendium.dnd-players-handbook.equipment.phbwepLightCross]{Light Crossbow}, @UUID[Compendium.dnd-players-handbook.equipment.phbwepHeavyCross]{Heavy Crossbow}), Uncommon (Requires Attunement)<br><br>Wrought from metal in the likeness of a brazier, see @UUID[${phb("phbwepLongsword0")}]{Longsword}.<br><br>@Embed[Compendium.dnd-dungeon-masters-guide.content.JournalEntry.dmgFoundryRefere.JournalEntryPage.Ok4iCgD25ENgoRxE cite=false]</p>` },
        activities: {
          EHdAL6OLjzrtJgkm: { _id: "EHdAL6OLjzrtJgkm", type: "damage" },
          BEo4hcVsK5nFkByL: { _id: "BEo4hcVsK5nFkByL", type: "enchant", restrictions: { type: "", categories: [] },
            effects: [{ _id: "ih0kl8SUIgvCmTkJ", riders: { activity: ["EHdAL6OLjzrtJgkm"], effect: [], item: [] } }] }
        }
      },
      effects: [{ _id: "ih0kl8SUIgvCmTkJ", type: "enchantment", name: "Candleflame Bow",
        system: { changes: [{ key: "name", value: "Candleflame {}", type: "override" }] } }]
    };
    expect(isTemplate(template)).toBe(true);
    const linked = linkedBaseUuids(template);
    expect(linked).toEqual([phb("phbwepLongbow000"), phb("phbwepShortbow00"), phb("phbwepHandCrossb"),
      phb("phbwepLightCross"), phb("phbwepHeavyCross")]);
    const bows = ["Longbow", "Shortbow", "Hand Crossbow", "Light Crossbow", "Heavy Crossbow"]
      .map((name, i) => ({ uuid: linked[i], name, type: "weapon", subtype: i < 2 ? "martialR" : "simpleR", properties: [] }));
    const entries = templateVariants({ template, templateUuid: "T", linked: bows, pool: POOL });
    expect(entries.map(e => e.name)).toEqual(["Candleflame Hand Crossbow", "Candleflame Heavy Crossbow",
      "Candleflame Light Crossbow", "Candleflame Longbow", "Candleflame Shortbow"]);
    expect(entries.every(e => e.rarity === "uncommon")).toBe(true);
  });

  it("round-trips variant ids", () => {
    expect(parseVariant(variantId("Item.s", SHELL_PROFILE, "Item.b"))).toEqual({ template: "Item.s", profile: "shell", base: "Item.b" });
  });

  it("reads a variant id", () => {
    const id = variantId("Compendium.a.b.Item.t", "p1", "Compendium.c.d.Item.b");
    expect(parseVariant(id)).toEqual({ template: "Compendium.a.b.Item.t", profile: "p1", base: "Compendium.c.d.Item.b" });
    expect(parseVariant("Compendium.a.b.Item.t")).toBeNull();
    expect(linkUuid("Item.x")).toBe("Item.x");
  });
});

describe("building a variant", () => {
  it("embeds the enchantment and its riders on the base item", () => {
    const template = fixture("wand-of-the-war-mage");
    const [profile] = templateProfiles(template);
    let n = 0;
    const data = enchantedItemData({
      base: { _id: "wand", name: "Wand", type: "equipment", folder: "f", system: { type: { value: "wand" } }, effects: [] },
      baseUuid: WAND.uuid,
      template,
      templateUuid: uuidOf(template),
      profile,
      newId: () => `id${++n}`
    });
    expect(data._id).toBeUndefined();
    expect(data.folder).toBeUndefined();
    const [enchantment, rider] = data.effects;
    expect(enchantment).toMatchObject({ _id: "id1", type: "enchantment", disabled: false, name: "Wand of the War Mage, +1" });
    expect(enchantment.flags.dnd5e.enchantmentProfile).toBe(profile.profileId);
    expect(enchantment.origin).toBeUndefined();
    // The +1 bonus to spell attacks rides along, dependent on the enchantment.
    expect(rider).toMatchObject({ _id: "id2", name: "War Mage +1" });
    expect(rider.flags.dnd5e.dependentOn).toBe("id1");
    expect(data._stats.compendiumSource).toBe(WAND.uuid);
    expect(data.flags[MODULE_ID].madeFrom.template).toBe(uuidOf(template));
  });
});

describe("shells", () => {
  /** A Griffon's Saddlebag work-in-progress item: a description and a rarity, no stats underneath. */
  const shell = (headline, extra = {}) => ({
    _id: "XsITVercGyV693MP", name: "Bonfire Blade", type: "weapon", img: "bonfire.webp",
    system: {
      description: { value: `<p><em>${headline}</em></p>
<p>The tip of this blade is smothered in dirt and soot.</p>` },
      type: { value: "", baseItem: "" }, properties: ["mgc"], rarities: ["common"], attunement: "",
      damage: { base: { types: [] } },
      activities: { NjHX: { _id: "NjHX", type: "attack", damage: { parts: [] } } }
    },
    effects: [],
    ...extra
  });
  const WEAPONS = [
    base("Longsword", "weapon", "martialM", { damageTypes: ["slashing"] }),
    base("Shortsword", "weapon", "martialM", { damageTypes: ["piercing"], properties: ["fin", "lgt"] }),
    base("Scimitar", "weapon", "martialM", { damageTypes: ["slashing"], properties: ["fin", "lgt"] }),
    base("Dagger", "weapon", "simpleM", { damageTypes: ["piercing"], properties: ["fin", "lgt", "thr"] }),
    base("Club", "weapon", "simpleM", { damageTypes: ["bludgeoning"], properties: ["lgt"] }),
    base("Glaive", "weapon", "martialM", { damageTypes: ["slashing"], properties: ["hvy", "rch", "two"] }),
    base("Heavy Crossbow", "weapon", "martialR", { damageTypes: ["piercing"] }),
    base("Light Crossbow", "weapon", "simpleR", { damageTypes: ["piercing"] }),
    base("Hand Crossbow", "weapon", "martialR", { damageTypes: ["piercing"] }),
    base("Sling", "weapon", "simpleR", { damageTypes: ["bludgeoning"] }),
    base("Bullets, Sling", "consumable", "ammo"),
    base("Arrows", "consumable", "ammo"),
    base("Leather Armor", "equipment", "light"),
    base("Studded Leather Armor", "equipment", "light"),
    base("Hide Armor", "equipment", "medium"),
    base("Chain Mail", "equipment", "heavy"),
    base("Plate Armor", "equipment", "heavy"),
    base("Half Plate Armor", "equipment", "medium")
  ];
  const names = (headline, extra) => shellBases(shell(headline, extra), WEAPONS).map(b => b.name).sort();

  it("knows a shell from a finished weapon", () => {
    expect(isShell(shell("Weapon (any sword), common"))).toBe(true);
    expect(isShell(shell("Weapon (longsword), rare", { system: { ...shell("").system, type: { value: "martialM", baseItem: "longsword" } } }))).toBe(false);
    expect(isShell(shell("Wondrous item, common"))).toBe(false);
  });

  it("reads rarity from dnd5e 6.0.2's rarities set as well as the old field", () => {
    expect(itemRarity(shell("Weapon (any sword), common"))).toBe("common");
    expect(itemRarity({ system: { rarity: "veryRare" } })).toBe("veryrare");
    expect(itemRarity({ system: { rarities: new Set(["rare", "veryRare"]) } })).toBe("rare");
    expect(itemRarity({ system: {} })).toBe("");
  });

  it("finds the bases a headline names", () => {
    expect(names("Weapon (any sword), common")).toEqual(["Longsword", "Scimitar", "Shortsword"]);
    expect(names("Weapon (crossbow, heavy or light), rare")).toEqual(["Heavy Crossbow", "Light Crossbow"]);
    expect(names("Weapon (a longsword or scimitar), rare")).toEqual(["Longsword", "Scimitar"]);
    expect(names("Weapon (sling), common")).toEqual(["Sling"]);
    expect(names("Weapon (any piercing weapon with the thrown property), rare")).toEqual(["Dagger"]);
    expect(names("Weapon (any melee weapon without the reach or heavy property), rare"))
      .toEqual(["Club", "Dagger", "Longsword", "Scimitar", "Shortsword"]);
    expect(names("Weapon (any slashing or piercing simple weapon), rare")).toEqual(["Dagger", "Light Crossbow"]);
    const armour = { type: "equipment" };
    expect(names("Armor (leather), common", armour)).toEqual(["Leather Armor"]);
    expect(names("Armor (any medium or heavy armor, but not hide), rare", armour)).toEqual(["Chain Mail", "Half Plate Armor", "Plate Armor"]);
    expect(names("Armor (halfplate), rare", armour)).toEqual(["Half Plate Armor"]);
    expect(names("Armor (any heavy barding), rare", armour)).toEqual([]);
  });

  it("makes Bonfire Blade on every sword, named by its base", () => {
    const entries = shellVariants({ item: shell("Weapon (any sword), common"), itemUuid: "Compendium.gs.wip.Item.XsIT", pool: WEAPONS });
    expect(entries.map(e => [e.name, e.rarity, e.subtype])).toEqual([
      ["Bonfire Blade (Longsword)", "common", "martialM"],
      ["Bonfire Blade (Scimitar)", "common", "martialM"],
      ["Bonfire Blade (Shortsword)", "common", "martialM"]
    ]);
    expect(parseVariant(entries[0].uuid).profile).toBe(SHELL_PROFILE);
  });

  it("builds the base item dressed as the shell", () => {
    const data = shellItemData({
      base: { _id: "ls", name: "Longsword", type: "weapon", img: "longsword.webp",
        system: { rarities: [], properties: ["ver"], damage: { base: { number: 1, denomination: 8 } },
          activities: { atk: { _id: "atk", type: "attack" } }, description: { value: "A sword." } }, effects: [] },
      baseUuid: "Compendium.dnd5e.equipment24.Item.ls",
      shell: shell("Weapon (any sword), common"),
      shellUuid: "Compendium.gs.wip.Item.XsIT",
      name: "Bonfire Blade (Longsword)"
    });
    expect(data).toMatchObject({ name: "Bonfire Blade (Longsword)", img: "bonfire.webp" });
    expect(data.system.damage.base.denomination).toBe(8);
    expect(data.system.rarities).toEqual(["common"]);
    expect(data.system.properties.sort()).toEqual(["mgc", "ver"]);
    expect(data.system.description.value).toContain("smothered in dirt");
    // The shell's empty attack is left out; the longsword's own stays.
    expect(Object.keys(data.system.activities)).toEqual(["atk"]);
    expect(data._id).toBeUndefined();
  });
});
