import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { harvestDecisions } from "../scripts/content-update/answers.mjs";
import { UpdateAnswerProvider, keyInPool } from "../scripts/content-update/provider.mjs";

/**
 * `UpdateAnswerProvider` against a stub driver: the decisions a rebuild asks are matched to the ones
 * the character recorded, their picks re-resolved against the new content, and the synchronous
 * accessors `autoResolve` calls answer from that.
 *
 * The new tree mirrors the PHB 3.0 move: the Fighting Style choice is no longer on the Fighter class
 * but on the Fighting Style feature (level 0, granted at class level 1), under the same advancement id.
 */

/** A document-like stand-in: what the provider reads off a clone item. */
function doc(data) {
  return { ...data, toObject: () => structuredClone(data) };
}

/** Old character (plain data, as harvested). */
const OLD = { items: [
  { _id: "oldCls", type: "class", name: "Fighter", system: { identifier: "fighter", levels: 4, advancement: [
    { _id: "hp", type: "HitPoints", configuration: {}, value: { 1: "max", 2: 9 } },
    { _id: "EmTANp6x6GfXFTmU", type: "ItemChoice", level: 1, title: "Fighting Style",
      configuration: { choices: { 1: { count: 1 } }, pool: [] },
      value: { added: { 1: { oldDef: "Compendium.phb.feats.Item.defense00000000" } } } },
    { _id: "skills", type: "Trait", level: 1, configuration: { choices: [{ count: 2, pool: ["skills:*"] }] },
      value: { chosen: ["skills:ath", "skills:prc"] } },
    { _id: "sub", type: "Subclass", level: 3, configuration: {}, value: { document: "oldChamp", uuid: "Compendium.phb.classes.Item.champion0000000" } },
    { _id: "asi4", type: "AbilityScoreImprovement", level: 4, configuration: { points: 2 }, value: { type: "asi", assignments: { str: 2 } } }
  ] } },
  { _id: "oldDef", type: "feat", name: "Defense", system: { identifier: "defense" },
    _stats: { compendiumSource: "Compendium.phb.feats.Item.defense00000000" },
    flags: { dnd5e: { advancementOrigin: "oldCls.EmTANp6x6GfXFTmU" } } },
  { _id: "oldChamp", type: "subclass", name: "Champion", system: { identifier: "champion", classIdentifier: "fighter" },
    _stats: { compendiumSource: "Compendium.phb.classes.Item.champion0000000" } }
] };

/** New tree on the clone. */
function newTree() {
  const cls = doc({ _id: "newCls", type: "class", name: "Fighter", system: { identifier: "fighter", advancement: [
    { _id: "grant", type: "ItemGrant", level: 1, configuration: {}, value: { added: { newStyle: "x" } } }
  ] } });
  const style = doc({ _id: "newStyle", type: "feat", name: "Fighting Style", system: { identifier: "fighting-style" },
    flags: { dnd5e: { advancementOrigin: "newCls.grant" } } });
  const items = new Map([["newCls", cls], ["newStyle", style]]);
  return { cls, style, clone: { items: { get: id => items.get(id) } } };
}

function record(item, adv, level) {
  return { level, screenLevel: level, item, advancement: { item, value: {}, ...adv } };
}

function stubDriver(tree, recs, extra = {}) {
  return {
    clone: tree.clone,
    hpSteps: recs.hp ?? [], sizeSteps: [], grantSteps: [], subclassSteps: recs.subclass ?? [],
    optionalGrantSteps: [], asiSteps: recs.asi ?? [], traitSteps: recs.trait ?? [], choiceSteps: recs.choice ?? [],
    choiceState: () => ({ selected: new Set() }),
    traitOptions: async () => (extra.offered ?? []).map(key => ({ key })),
    optionalGrantState: () => ({ options: [] }),
    asiFeatOptions: async () => ({ options: [] }),
    ...extra
  };
}

describe("UpdateAnswerProvider", () => {
  let docs;
  beforeEach(() => {
    installFoundryShims();
    docs = new Map();
    globalThis.fromUuid = async uuid => {
      const d = docs.get(uuid);
      return d ? doc(d) : null;
    };
  });

  it("carries a choice that moved onto a feature, re-resolving the pick", async () => {
    // The new PHB keeps Defense under the same document id: its uuid still resolves.
    docs.set("Compendium.phb.feats.Item.defense00000000",
      { _id: "defense00000000", type: "feat", name: "Defense", system: { identifier: "defense" } });
    const tree = newTree();
    const rec = record(tree.style, { id: "EmTANp6x6GfXFTmU", type: "ItemChoice", title: "Fighting Style",
      configuration: { choices: { 0: { count: 1 } }, pool: [], restriction: { type: "feat", subtype: "fightingStyle" } } }, 0);
    // A document's uuid is its own; the stub reports the compendium one.
    docs.get("Compendium.phb.feats.Item.defense00000000").uuid = "Compendium.phb.feats.Item.defense00000000";
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { choice: [rec] }));
    expect(provider.choiceUuids(rec)).toEqual(["Compendium.phb.feats.Item.defense00000000"]);
    expect(provider.report[0]).toMatchObject({ status: "carried", detail: "Defense" });
  });

  it("finds a pick by identity in the new pool when its old uuid is gone", async () => {
    docs.set("Compendium.phb.feats.Item.newDefense00000",
      { _id: "newDefense00000", uuid: "Compendium.phb.feats.Item.newDefense00000", type: "feat", name: "Defense", system: { identifier: "defense" } });
    const tree = newTree();
    const rec = record(tree.style, { id: "EmTANp6x6GfXFTmU", type: "ItemChoice", title: "Fighting Style",
      configuration: { choices: { 0: { count: 1 } }, pool: [{ uuid: "Compendium.phb.feats.Item.newDefense00000" }] } }, 0);
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { choice: [rec] }));
    expect(provider.choiceUuids(rec)).toEqual(["Compendium.phb.feats.Item.newDefense00000"]);
  });

  it("takes a pick outside a short pool when the choice lets the player browse for anything it allows", async () => {
    // PHB 3.0's Ranger Fighting Style: one style in the pool, drops allowed, restricted to fighting styles.
    docs.set("Compendium.phb.feats.Item.archery000000000",
      { _id: "archery000000000", uuid: "Compendium.phb.feats.Item.archery000000000", type: "feat", name: "Archery",
        system: { identifier: "archery", type: { value: "feat", subtype: "fightingStyle" } } });
    docs.set("Compendium.phb.feats.Item.alert00000000000",
      { _id: "alert00000000000", uuid: "Compendium.phb.feats.Item.alert00000000000", type: "feat", name: "Alert",
        system: { identifier: "alert", type: { value: "feat", subtype: "origin" } } });
    const old = structuredClone(OLD);
    old.items[0].system.advancement[1].value.added = { 1: { oldDef: "Compendium.phb.feats.Item.archery000000000" } };
    const tree = newTree();
    const config = subtype => ({ id: "EmTANp6x6GfXFTmU", type: "ItemChoice", title: "Fighting Style",
      configuration: { choices: { 0: { count: 1 } }, allowDrops: true, pool: [{ uuid: "Compendium.phb.feats.Item.druidic000000000" }],
        restriction: { type: "feat", subtype } } });
    const ok = record(tree.style, config("fightingStyle"), 0);
    let provider = new UpdateAnswerProvider(harvestDecisions(old));
    await provider.warm(stubDriver(tree, { choice: [ok] }));
    expect(provider.choiceUuids(ok)).toEqual(["Compendium.phb.feats.Item.archery000000000"]);

    // A restriction the pick does not meet keeps it out.
    const no = record(tree.style, config("origin"), 0);
    provider = new UpdateAnswerProvider(harvestDecisions(old));
    await provider.warm(stubDriver(tree, { choice: [no] }));
    expect(provider.choiceUuids(no)).toEqual([]);
  });

  it("answers hit points exactly, and takes the average for a level that was never recorded", async () => {
    const tree = newTree();
    const two = record(tree.cls, { id: "hp", type: "HitPoints" }, 2);
    const three = record(tree.cls, { id: "hp", type: "HitPoints" }, 3);
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { hp: [two, three] }));
    expect(provider.hp(two)).toBe(9);
    expect(provider.hp(three)).toBe("avg");
    expect(provider.report.find(l => l.level === 3).status).toBe("default");
  });

  it("carries an ASI allocation, and keeps only trait keys the new advancement still offers", async () => {
    const tree = newTree();
    const asi = record(tree.cls, { id: "newAsiId0000000", type: "AbilityScoreImprovement", configuration: { points: 2 } }, 4);
    const trait = record(tree.cls, { id: "skills", type: "Trait", configuration: { choices: [{ count: 2, pool: ["skills:*"] }] } }, 1);
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { asi: [asi], trait: [trait] }, { offered: ["skills:ath", "skills:acr"] }));
    expect(provider.asi(asi)).toEqual({ str: 2 });
    expect(provider.traitKeys(trait)).toEqual(["skills:ath"]);
    expect(provider.report.find(l => l.kind === "trait").status).toBe("partial");
  });

  it("carries expertise on skills the clone is not yet proficient in (dnd5e 6.1.0 Bard)", async () => {
    // The provider warms before the walk applies level 1's skill picks, so the clone offers only the
    // background's skills. Expertise is checked against its configured pool instead.
    const old = structuredClone(OLD);
    old.items[0].system.advancement.push({ _id: "zHtnbRgLICltyy8V", type: "Trait", level: 2, title: "Expertise",
      configuration: { mode: "expertise", choices: [{ count: 2, pool: ["skills:*"] }] },
      value: { chosen: ["skills:acr", "skills:ath"] } });
    const tree = newTree();
    const exp = record(tree.style, { id: "zHtnbRgLICltyy8V", type: "Trait", title: "Expertise",
      configuration: { mode: "expertise", choices: [{ count: 2, pool: ["skills:*"] }] } }, 2);
    const provider = new UpdateAnswerProvider(harvestDecisions(old));
    await provider.warm(stubDriver(tree, { trait: [exp] }, { offered: ["skills:arc"] }));
    expect(provider.traitKeys(exp)).toEqual(["skills:acr", "skills:ath"]);
    expect(provider.report.find(l => l.kind === "trait").status).toBe("carried");
  });

  it("keyInPool: exact keys, wildcards and categories", () => {
    expect(keyInPool("skills:acr", "skills:*")).toBe(true);
    expect(keyInPool("tool:art:alchemist", "tool:art:*")).toBe(true);
    expect(keyInPool("weapon:mar:longsword", "weapon:mar")).toBe(true);
    expect(keyInPool("skills:acr", "skills:acr")).toBe(true);
    expect(keyInPool("skills:acr", "tool:*")).toBe(false);
    expect(keyInPool("skills:acrx", "skills:acr")).toBe(false);
  });

  it("answers the subclass once, and not again when it is already applied (selectSubclass toggles)", async () => {
    docs.set("Compendium.phb.classes.Item.champion0000000",
      { _id: "champion0000000", uuid: "Compendium.phb.classes.Item.champion0000000", type: "subclass", name: "Champion" });
    const tree = newTree();
    const rec = record(tree.cls, { id: "sub", type: "Subclass" }, 3);
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { subclass: [rec] }));
    expect(provider.subclass(rec)).toBe("Compendium.phb.classes.Item.champion0000000");
    rec.advancement.value = { uuid: "Compendium.phb.classes.Item.champion0000000" };
    expect(provider.subclass(rec)).toBeNull();
  });

  it("leaves an unmatched decision unanswered and reports it as to choose", async () => {
    const tree = newTree();
    const rec = record(tree.cls, { id: "brandNew0000000", type: "ItemChoice", title: "Weapon Mastery",
      configuration: { choices: { 1: { count: 3 } }, pool: [{ uuid: "Compendium.x.y.Item.longsword000000" }] } }, 1);
    const provider = new UpdateAnswerProvider(harvestDecisions(OLD));
    await provider.warm(stubDriver(tree, { choice: [rec] }));
    expect(provider.choiceUuids(rec)).toEqual([]);
    expect(provider.report[0].status).toBe("ask");
  });
});
