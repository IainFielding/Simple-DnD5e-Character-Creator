import { describe, expect, it } from "vitest";
import {
  stableStringify, hashString, definitionGroups, groupHashes, changedGroups, advancementChanged,
  sourceStamp, readStamp, editedGroups, packageOfUuid, normalizeHtml, FIELD_GROUPS
} from "../scripts/content-update/fingerprint.mjs";
import { refreshedItemData } from "../scripts/content-update/merge.mjs";
import { isForeignEffect } from "../scripts/content-update/fingerprint.mjs";
import {
  harvestDecisions, matchDecision, matchScore, treeKey, grantedAtLevel, signature, sameIdentity, uuidTail
} from "../scripts/content-update/answers.mjs";
import { pairItems, remapIds } from "../scripts/content-update/reconcile.mjs";

/**
 * The content-update feature's pure core: what an item's definition is (and its fingerprint), how a
 * refreshed item is assembled from the new source plus the character's state, how recorded decisions
 * are harvested and matched to the new content, and how rebuilt items get their old ids back.
 *
 * Fixtures are cut from the real differences measured between dnd5e 6.0.0 → 6.1.0 and PHB 2.1.0 →
 * 3.0.0 (see governance/plan-content-update-refresh.md §1): advancements moving from the class onto a
 * feature, a subclass identifier renamed, an optional grant turned into a choice.
 */

const MOD = "sogrom-dnd5e-character-creator";

function sword(over = {}) {
  return {
    _id: "swordAAAAAAAAAAA", name: "Longsword", type: "weapon", img: "icons/sword.webp",
    _stats: { compendiumSource: "Compendium.dnd5e.equipment24.Item.phbwepLongsword0" },
    system: {
      description: { value: "<p>A sword.</p>" },
      damage: { base: { number: 1, denomination: 8 } },
      quantity: 1, equipped: true, identified: true, container: null,
      uses: { max: "", spent: 0 },
      activities: { atk00000000000000: { type: "attack", uses: { spent: 0, max: "" } } }
    },
    effects: [],
    flags: {},
    ...over
  };
}

describe("fingerprint", () => {
  it("serialises equal objects equally whatever their key order, dropping empties", () => {
    expect(stableStringify({ b: 1, a: { d: [], c: 2 } })).toBe(stableStringify({ a: { c: 2 }, b: 1, e: "" }));
  });

  it("reads HTML as Foundry stores it: a pack's <br /> is the same as a stored <br>", () => {
    // dnd5e 6.1.0's 2014 Cleric: the pack has `<br />`, every created copy `<br>`. Unnormalised, a
    // character without stamps could never come up to date.
    const pack = sword({ system: { ...sword().system, description: { value: "<p>1d8 per cleric level<br /><strong>HP</strong></p>\n<hr />" } } });
    const stored = sword({ system: { ...sword().system, description: { value: "<p>1d8 per cleric level<br><strong>HP</strong></p>\n<hr>" } } });
    expect(changedGroups(stored, pack)).toEqual([]);
    expect(normalizeHtml('<img src="a.webp" />')).toBe('<img src="a.webp">');
    expect(normalizeHtml("no markup / here")).toBe("no markup / here");
    // A real change still shows.
    const edited = sword({ system: { ...sword().system, description: { value: "<p>1d10 per cleric level<br></p>" } } });
    expect(changedGroups(edited, pack)).toEqual(["description"]);
    // A bare ampersand is stored escaped, markup or not (dnd5e 6.1.0's Druid armour hint).
    expect(normalizeHtml("Light Armor, Medium Armor, & Shields")).toBe("Light Armor, Medium Armor, &amp; Shields");
    expect(normalizeHtml("Tom &amp; Jerry &#38; co")).toBe("Tom &amp; Jerry &#38; co");
  });

  it("ignores what dnd5e prepares onto system.source, and reads an empty book as the placeholder", () => {
    const src = { book: "", page: "", custom: "", license: "", revision: 1, rules: "2014" };
    const stored = sword({ system: { ...sword().system, source: { ...src } } });
    const pack = sword({ system: { ...sword().system, source: { ...src, book: "TCoE", bookPlaceholder: "TCoE",
      label: "TCoE", value: "TCoE", slug: "tcoe" } } });
    expect(changedGroups(stored, pack)).toEqual([]);
    const otherBook = sword({ system: { ...sword().system, source: { ...src, book: "XGE" } } });
    expect(changedGroups(otherBook, pack)).toEqual(["other"]);
  });

  it("hashes to 8 hex characters, stably", () => {
    expect(hashString("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  it("ignores state: an equipped, half-used copy has the same definition as the source", () => {
    const used = sword();
    used.system.equipped = false;
    used.system.quantity = 3;
    used.system.uses.spent = 1;
    used.system.activities.atk00000000000000.uses.spent = 1;
    used.flags = { dnd5e: { advancementOrigin: "x.y" } };
    used.sort = 5000;
    expect(changedGroups(sword(), used)).toEqual([]);
  });

  it("names the group that changed", () => {
    const b = sword();
    b.system.damage.base.denomination = 10;
    b.name = "Glimmerfang";
    expect(changedGroups(sword(), b).sort()).toEqual(["damage", "name"]);
  });

  it("treats a granted spell's casting ability and limited uses as state", () => {
    const spell = { _id: "s", name: "Misty Step", type: "spell", system: { level: 2, ability: "", uses: { max: "" } } };
    const granted = structuredClone(spell);
    granted.system.ability = "cha";
    granted.system.uses = { max: "1", recovery: [{ period: "lr" }] };
    granted.system.method = "innate";
    expect(changedGroups(spell, granted)).toEqual([]);
  });

  it("separates advancement configuration from what the advancement recorded", () => {
    const cls = v => ({ type: "class", name: "Fighter", system: { advancement: [
      { _id: "hp", type: "HitPoints", configuration: {}, value: v }
    ] } });
    expect(advancementChanged(cls({ 1: "max" }), cls({ 1: "max", 2: "avg" }))).toBe(false);
    const moved = cls({});
    moved.system.advancement.push({ _id: "fs", type: "ItemChoice", level: 1, configuration: { pool: [] } });
    expect(advancementChanged(cls({}), moved)).toBe(true);
  });

  it("ignores what a limited-use spell grant writes onto the spell's activities", () => {
    const spell = { _id: "s", name: "Contact Other Plane", type: "spell", system: { activities: {
      cast0000000000000: { type: "cast", consumption: { spellSlot: true, targets: [] } } } } };
    const granted = structuredClone(spell);
    granted.flags = { dnd5e: { advancementOrigin: "feat.grant" } };
    granted.system.activities.free000000000000 = { type: "forward", activity: { id: "cast0000000000000" },
      consumption: { targets: [{ type: "itemUses", target: "", value: "1" }] } };
    expect(changedGroups(spell, granted)).toEqual([]);
    const kept = refreshedItemData(granted, spell);
    expect(kept.system.activities.free000000000000?.type).toBe("forward");
  });

  it("treats an effect another item's advancement added as the character's", () => {
    const old = sword();
    old.effects = [{ _id: "mod", name: "Legerdemain", flags: { dnd5e: { advancementOrigin: "rogue.modify" } } }];
    expect(changedGroups(sword(), old)).toEqual([]);
    expect(refreshedItemData(old, sword()).effects.some(e => e._id === "mod")).toBe(true);
  });

  it("treats an identifier dnd5e filled in on creation as the source's own", () => {
    const src = sword();
    src.system.identifier = "";
    const mine = sword();
    mine.system.identifier = "longsword";
    expect(changedGroups(mine, src)).toEqual([]);
    expect(refreshedItemData(mine, src).system.identifier).toBe("longsword");
  });

  it("has one hash per group", () => {
    expect(Object.keys(groupHashes(sword()))).toEqual(FIELD_GROUPS);
    expect(Object.keys(definitionGroups(sword()))).toEqual(FIELD_GROUPS);
  });

  it("stamps package, version and group hashes, and reads back only its own version", () => {
    const stamp = sourceStamp(sword(), { uuid: "Compendium.dnd-players-handbook.equipment.Item.x", version: "3.0.0" });
    expect(stamp).toMatchObject({ v: 1, package: "dnd-players-handbook", version: "3.0.0" });
    expect(readStamp({ flags: { [MOD]: { source: stamp } } }, MOD)).toBe(stamp);
    expect(readStamp({ flags: { [MOD]: { source: { ...stamp, v: 99 } } } }, MOD)).toBeNull();
    expect(packageOfUuid("Compendium.dnd5e.spells24.Item.x")).toBe("dnd5e");
    expect(packageOfUuid("Actor.x.Item.y")).toBeNull();
  });

  it("tells a player's edit from an untouched group using the stamp", () => {
    const stamp = sourceStamp(sword(), { uuid: "u" });
    const mine = sword({ name: "Glimmerfang" });
    expect(editedGroups(mine, stamp)).toEqual(["name"]);
    expect(editedGroups(mine, null)).toBeNull();
  });
});

describe("refreshedItemData", () => {
  it("takes the definition from the source and the state and id from the character", () => {
    const old = sword();
    old.system.equipped = false;
    old.system.uses.spent = 2;
    old.system.activities.atk00000000000000.uses.spent = 1;
    old.system.container = "bagAAAAAAAAAAAAA";
    old.sort = 7;
    const src = sword({ _id: "phbwepLongsword0", sort: 0 });
    src.system.damage.base.denomination = 10;
    src.system.equipped = true;

    const out = refreshedItemData(old, src, { uuid: "Compendium.new.Item.phbwepLongsword0" });
    expect(out._id).toBe(old._id);
    expect(out.sort).toBe(7);
    expect(out.system.damage.base.denomination).toBe(10);
    expect(out.system.equipped).toBe(false);
    expect(out.system.uses.spent).toBe(2);
    expect(out.system.activities.atk00000000000000.uses.spent).toBe(1);
    expect(out.system.container).toBe("bagAAAAAAAAAAAAA");
    expect(out._stats.compendiumSource).toBe("Compendium.new.Item.phbwepLongsword0");
  });

  it("keeps the groups the player chose to keep", () => {
    const old = sword({ name: "Glimmerfang" });
    old.system.description.value = "<p>From the dragon's hoard.</p>";
    const src = sword();
    src.system.description.value = "<p>A better sword.</p>";
    const out = refreshedItemData(old, src, { keep: ["name", "description"] });
    expect(out.name).toBe("Glimmerfang");
    expect(out.system.description.value).toContain("hoard");
  });

  it("carries advancement records by id and drops the ones the new version removed", () => {
    const old = { _id: "f", type: "feat", name: "Skilled", system: { advancement: [
      { _id: "t1", type: "Trait", configuration: {}, value: { chosen: ["skills:arc"] } },
      { _id: "gone", type: "Trait", configuration: {}, value: { chosen: ["x"] } }
    ] }, effects: [] };
    const src = { _id: "src", type: "feat", name: "Skilled", system: { advancement: [
      { _id: "t1", type: "Trait", configuration: { extra: 1 } },
      { _id: "new", type: "Trait", configuration: {} }
    ] }, effects: [] };
    const out = refreshedItemData(old, src);
    expect(out.system.advancement.find(a => a._id === "t1").value).toEqual({ chosen: ["skills:arc"] });
    expect(out.system.advancement.find(a => a._id === "new").value).toBeUndefined();
    expect(out.system.advancement.some(a => a._id === "gone")).toBe(false);
  });

  it("keeps effect toggles and effects applied from elsewhere", () => {
    const old = sword();
    old.effects = [
      { _id: "e1", name: "Own", disabled: true },
      { _id: "ench", name: "+1", type: "enchantment", origin: "Actor.a.Item.wizard00000000000" }
    ];
    const src = sword();
    src.effects = [{ _id: "e1", name: "Own (new)", disabled: false }];
    const out = refreshedItemData(old, src);
    expect(out.effects.find(e => e._id === "e1")).toMatchObject({ name: "Own (new)", disabled: true });
    expect(out.effects.some(e => e._id === "ench")).toBe(true);
    expect(isForeignEffect({ origin: null }, old)).toBe(false);
  });

  it("treats a relative pack origin as the item's own effect on both the pack entry and the copy", () => {
    // dnd5e 6.1.0's 2014 Unarmored Movement: origin "Item.<pack id>" on an effect the copy keeps.
    const pack = { _id: "zCeqyQ8uIPNdYJSW", type: "feat", name: "Unarmored Movement", system: {},
      effects: [{ _id: "Veg0vXI93A0qlxZn", name: "Unarmored Movement", origin: "Item.zCeqyQ8uIPNdYJSW", transfer: true }] };
    const copy = { ...structuredClone(pack), _id: "MLNeJkHQw04MMTeP",
      _stats: { compendiumSource: "Compendium.dnd5e.classfeatures.Item.zCeqyQ8uIPNdYJSW" } };
    expect(isForeignEffect(copy.effects[0], copy)).toBe(false);
    expect(isForeignEffect(pack.effects[0], pack)).toBe(false);
    expect(changedGroups(copy, pack)).toEqual([]);
    // Pointing at another item is still foreign.
    expect(isForeignEffect({ origin: "Actor.a.Item.wizard00000000000" }, copy)).toBe(true);
  });
});

/* -------------------------------------------- */
/*  Harvest + match                             */
/* -------------------------------------------- */

/**
 * A 2.x-shaped Fighter: the Fighting Style choice sits on the class at level 1; Champion subclass;
 * an ASI at 4 spent on +2 Str; hit points recorded per level.
 */
function oldFighter() {
  return { items: [
    { _id: "cls", type: "class", name: "Fighter", system: { identifier: "fighter", levels: 4, advancement: [
      { _id: "hp", type: "HitPoints", configuration: {}, value: { 1: "max", 2: 7, 3: "avg", 4: 10 } },
      { _id: "EmTANp6x6GfXFTmU", type: "ItemChoice", level: 1, title: "Fighting Style",
        configuration: { choices: { 1: { count: 1 } }, pool: [{ uuid: "Compendium.p.feats.Item.defense" }] },
        value: { added: { 1: { def: "Compendium.p.feats.Item.defense" } } } },
      { _id: "sub", type: "Subclass", level: 3, configuration: {}, value: { document: "chmp", uuid: "Compendium.p.classes.Item.champion" } },
      { _id: "asi4", type: "AbilityScoreImprovement", level: 4, configuration: { points: 2 },
        value: { type: "asi", assignments: { str: 2 } } }
    ] } },
    { _id: "def", type: "feat", name: "Defense", flags: { dnd5e: { advancementOrigin: "cls.EmTANp6x6GfXFTmU" } },
      _stats: { compendiumSource: "Compendium.p.feats.Item.defense" }, system: { identifier: "defense" } },
    { _id: "chmp", type: "subclass", name: "Champion", system: { identifier: "champion", classIdentifier: "fighter", advancement: [] },
      _stats: { compendiumSource: "Compendium.p.classes.Item.champion" } }
  ] };
}

describe("harvestDecisions", () => {
  const ds = harvestDecisions(oldFighter());

  it("reads hit points per level, exactly as recorded", () => {
    const hp = ds.filter(d => d.type === "HitPoints").map(d => [d.level, d.answer]);
    expect(hp).toEqual([[1, "max"], [2, 7], [3, "avg"], [4, 10]]);
  });

  it("files everything a class tree recorded under that class", () => {
    expect(new Set(ds.map(d => d.tree))).toEqual(new Set(["class:fighter"]));
  });

  it("records a choice's picks as identities, a subclass, and an ASI", () => {
    const fs = ds.find(d => d.type === "ItemChoice");
    expect(fs.level).toBe(1);
    expect(fs.answer.picks[0]).toMatchObject({ name: "Defense", identifier: "defense" });
    expect(ds.find(d => d.type === "Subclass").answer.subclass).toMatchObject({ name: "Champion" });
    expect(ds.find(d => d.type === "AbilityScoreImprovement").answer).toEqual({ assignments: { str: 2 } });
  });

  it("replays a replacement in place of the pick it replaced, not as an extra", () => {
    const actor = { items: [
      { _id: "cls", type: "class", name: "Warlock", system: { identifier: "warlock", advancement: [
        { _id: "inv", type: "ItemChoice", configuration: { choices: { 2: { count: 2 }, 5: { count: 1, replacement: true } } },
          value: { added: { 2: { a: "u.a", b: "u.b" }, 5: { c: "u.c", d: "u.d" } }, replaced: { 5: { original: "a", replacement: "d" } } } }
      ] } },
      { _id: "b", type: "feat", name: "B" }, { _id: "c", type: "feat", name: "C" }, { _id: "d", type: "feat", name: "D" }
    ] };
    const picks = harvestDecisions(actor).filter(d => d.type === "ItemChoice")
      .map(d => [d.level, d.answer.picks.map(p => p.name)]);
    expect(picks).toEqual([[2, ["B", "D"]], [5, ["C"]]]);
  });
});

describe("matchDecision", () => {
  const ds = harvestDecisions(oldFighter());

  it("follows a choice that moved from the class onto a feature, by advancement id", () => {
    // PHB 3.0 / dnd5e 6.1: the same ItemChoice id, now on the Fighting Style feature at level 0,
    // granted at class level 1.
    const used = new Set();
    const hit = matchDecision({ advId: "EmTANp6x6GfXFTmU", type: "ItemChoice", tree: "class:fighter", level: 1,
      title: "fighting style", sig: new Set(["restriction:feat/fightingStyle"]) }, ds, used);
    expect(hit?.answer.picks[0].name).toBe("Defense");
  });

  it("follows an ASI recreated under a new id, by title or signature", () => {
    const hit = matchDecision({ advId: "brandNewId000000", type: "AbilityScoreImprovement", tree: "class:fighter",
      level: 4, title: "", sig: new Set(["points:2"]) }, ds, new Set());
    expect(hit?.answer.assignments).toEqual({ str: 2 });
  });

  it("refuses a different tree, a different level, or an unrelated choice", () => {
    const fs = ds.find(d => d.type === "ItemChoice");
    expect(matchScore({ advId: fs.advId, type: "ItemChoice", tree: "class:wizard", level: 1, title: "", sig: new Set() }, fs)).toBe(-1);
    expect(matchScore({ advId: fs.advId, type: "ItemChoice", tree: "class:fighter", level: 2, title: "", sig: new Set() }, fs)).toBe(-1);
    expect(matchScore({ advId: "other", type: "ItemChoice", tree: "class:fighter", level: 1, title: "maneuvers",
      sig: new Set(["item:x"]) }, fs)).toBe(-1);
  });

  it("lets an optional grant answer a choice of the same items (Cold Caster, HoF 1.1 → 2.0)", () => {
    const actor = { items: [
      { _id: "ft", type: "feat", name: "Cold Caster", system: { advancement: [
        { _id: "old", type: "ItemGrant", configuration: { items: [{ uuid: "Compendium.h.items.Item.rayoffrost", optional: true }] },
          value: { added: { sp: "Compendium.h.items.Item.rayoffrost" } } }
      ] } },
      { _id: "sp", type: "spell", name: "Ray of Frost", flags: { dnd5e: { advancementOrigin: "ft.old" } } }
    ] };
    const hit = matchDecision({ advId: "newChoice0000000", type: "ItemChoice", tree: "item:cold caster", level: 0,
      title: "", sig: new Set(["item:rayoffrost"]) }, harvestDecisions(actor), new Set());
    expect(hit?.answer.taken[0].name).toBe("Ray of Frost");
  });

  it("reads Tasha's replacement grant as a grant, so a chosen replacement carries", () => {
    const actor = { items: [
      { _id: "rng", type: "class", name: "Ranger", system: { identifier: "ranger", advancement: [
        { _id: "rep", type: "TCOEReplacementGrant", level: 1,
          configuration: { items: [{ uuid: "C.s.c.Item.naturalexplorer", optional: true }, { uuid: "C.t.o.Item.deftexplorer", optional: true }],
            replacements: { "C.s.c.naturalexplorer": "C.t.o.Item.deftexplorer" } },
          value: { added: { deft: "C.t.o.Item.deftexplorer" } } }
      ] } },
      { _id: "deft", type: "feat", name: "Deft Explorer", flags: { dnd5e: { advancementOrigin: "rng.rep" } } }
    ] };
    const d = harvestDecisions(actor).find(x => x.advId === "rep");
    expect(d?.type).toBe("ItemGrant");
    expect(d?.answer.taken.map(t => t.name)).toEqual(["Deft Explorer"]);
  });

  it("records Tasha's optional class features, which mark the whole grant optional", () => {
    const actor = { items: [
      { _id: "ftr", type: "class", name: "Fighter", system: { identifier: "fighter", advancement: [
        { _id: "tcoe1Opt00000000", type: "ItemGrant", level: 1,
          configuration: { optional: true, items: [{ uuid: "C.t.o.Item.fightingstyleopt" }] },
          value: { added: { opt: "C.t.o.Item.fightingstyleopt" } } }
      ] } },
      { _id: "opt", type: "feat", name: "Fighting Style Options", flags: { dnd5e: { advancementOrigin: "ftr.tcoe1Opt00000000" } } }
    ] };
    const d = harvestDecisions(actor).find(x => x.advId === "tcoe1Opt00000000");
    expect(d?.answer.taken.map(t => t.name)).toEqual(["Fighting Style Options"]);
  });

  it("never matches the same recorded decision twice", () => {
    const used = new Set();
    const w = { advId: "hp", type: "HitPoints", tree: "class:fighter", level: 2, title: "", sig: new Set() };
    expect(matchDecision(w, ds, used)?.answer).toBe(7);
    expect(matchDecision(w, ds, used)).toBeNull();
  });
});

describe("trees and identities", () => {
  const actor = oldFighter();
  const byId = new Map(actor.items.map(i => [i._id, i]));
  const get = id => byId.get(id);

  it("follows advancement origins to the root", () => {
    expect(treeKey(byId.get("def"), get)).toBe("class:fighter");
    expect(treeKey(byId.get("chmp"), get)).toBe("class:fighter");
    expect(treeKey({ type: "feat", name: "Alert" }, get)).toBe("item:alert");
    expect(treeKey({ type: "race", name: "Elf" }, get)).toBe("race");
  });

  it("reads the level a granted feature arrived at", () => {
    expect(grantedAtLevel(byId.get("def"), get)).toBe(1);
  });

  it("matches identities by document id, then identifier, then name, within a type", () => {
    expect(sameIdentity({ uuid: "Compendium.a.b.Item.xyz" }, { uuid: "Compendium.c.d.Item.xyz" })).toBe(true);
    expect(sameIdentity({ type: "feat", identifier: "alert" }, { type: "feat", identifier: "alert", name: "Other" })).toBe(true);
    expect(sameIdentity({ type: "feat", name: "Alert" }, { type: "spell", name: "Alert" })).toBe(false);
    expect(uuidTail("Compendium.a.b.Item.xyz")).toBe("xyz");
  });

  it("builds a signature from what an advancement offers", () => {
    expect(signature({ type: "AbilityScoreImprovement", configuration: { points: 2 } })).toEqual(new Set(["points:2"]));
    expect(signature({ type: "Trait", configuration: { mode: "expertise", choices: [{ pool: ["skills:*"] }] } }))
      .toEqual(new Set(["pool:skills:*", "mode:expertise"]));
  });
});

describe("pairItems / remapIds", () => {
  it("pairs by document id first, then identifier, then name, one to one", () => {
    const old = [
      { _id: "OLDsecondwind000", type: "feat", name: "Second Wind", _stats: { compendiumSource: "C.p.c.Item.secondwind" } },
      { _id: "OLDstyle00000000", type: "feat", name: "Fighting Style", system: { identifier: "fighting-style" } },
      { _id: "OLDfoo0000000000", type: "feat", name: "Foo" }
    ];
    const fresh = [
      { _id: "NEWsecondwind000", type: "feat", name: "Second Wind", _stats: { compendiumSource: "C.p2.c.Item.secondwind" } },
      { _id: "NEWstyle00000000", type: "feat", name: "Fighting Style!", system: { identifier: "fighting-style" } },
      { _id: "NEWfoo0000000000", type: "feat", name: "foo" },
      { _id: "NEWextra00000000", type: "feat", name: "Extra" }
    ];
    expect([...pairItems(old, fresh)]).toEqual([
      ["NEWsecondwind000", "OLDsecondwind000"], ["NEWstyle00000000", "OLDstyle00000000"], ["NEWfoo0000000000", "OLDfoo0000000000"]
    ]);
  });

  it("rewrites every reference to a remapped id", () => {
    const data = { system: { details: { originalClass: "NEWcls0000000000" }, favorites: [{ id: ".Item.NEWcls0000000000" }] },
      items: [{ _id: "NEWcls0000000000" }, { _id: "f", flags: { dnd5e: { advancementOrigin: "NEWcls0000000000.adv" } } }] };
    const out = remapIds(data, new Map([["NEWcls0000000000", "OLDcls0000000000"]]));
    expect(JSON.stringify(out)).not.toContain("NEWcls");
    expect(out.items[1].flags.dnd5e.advancementOrigin).toBe("OLDcls0000000000.adv");
    expect(data.items[0]._id).toBe("NEWcls0000000000");
  });
});
