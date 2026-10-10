import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { MODULE_ID } from "../scripts/config.mjs";
import { addSpells, buildFeatSpell, detailsUpdate } from "../scripts/build/actor-assembler.mjs";

/**
 * The parts of building a character that decide the data written to it, outside the advancement
 * walk: the chosen spells (prepared or only in the book, which slot pool, which class owns them),
 * a feat's spells (Magic Initiate's casting configuration), and the Details step's fields. The e2e
 * runs check these only as part of a whole character; these pin each rule on its own.
 */

/** A spell document as fromUuid returns it. */
const spellDoc = (name, level) => ({
  system: { level },
  toObject: () => ({ name, type: "spell", _stats: {}, system: { level, uses: { recovery: [] } } })
});

const DOCS = {
  "Compendium.x.classes.Item.wizard": { system: { identifier: "wizard", spellcasting: { progression: "full" } } },
  "Compendium.x.classes.Item.warlock": { system: { identifier: "warlock", spellcasting: { progression: "pact" } } },
  "Compendium.x.spells.Item.light": spellDoc("Light", 0),
  "Compendium.x.spells.Item.shield": spellDoc("Shield", 1),
  "Compendium.x.spells.Item.sleep": spellDoc("Sleep", 1),
  "Compendium.x.spells.Item.hex": spellDoc("Hex", 1)
};

/** An actor stub recording what the build created and updated. */
function actorWith(classIdentifier) {
  const classItem = { id: "cls", type: "class", system: { identifier: classIdentifier }, flags: {} };
  const created = [];
  const updated = [];
  return {
    created, updated,
    items: [classItem],
    createEmbeddedDocuments: async (_type, data) => { created.push(...data); return data; },
    updateEmbeddedDocuments: async (_type, data) => { updated.push(...data); return data; }
  };
}

beforeEach(() => {
  installFoundryShims();
  vi.stubGlobal("fromUuid", async uuid => DOCS[uuid] ?? null);
  CONFIG.DND5E.spellProgression = { full: { type: "spell" }, pact: { type: "pact" } };
});

describe("addSpells", () => {
  it("creates the picks as the class's spells, prepared unless the book holds them unprepared", async () => {
    const actor = actorWith("wizard");
    await addSpells(actor, {
      classUuid: "Compendium.x.classes.Item.wizard",
      selectedCantrips: [{ uuid: "Compendium.x.spells.Item.light" }],
      selectedSpells: [{ uuid: "Compendium.x.spells.Item.shield" }, { uuid: "Compendium.x.spells.Item.sleep", prepared: false }]
    });
    expect(actor.created.map(s => [s.name, s.system.prepared, s.system.method, s.system.sourceItem])).toEqual([
      ["Light", 1, "spell", "class:wizard"],
      ["Shield", 1, "spell", "class:wizard"],
      ["Sleep", 0, "spell", "class:wizard"]
    ]);
    expect(actor.created[1]._stats.compendiumSource).toBe("Compendium.x.spells.Item.shield");
  });

  it("records a Wizard's free book picks on its class, counting leveled spells only", async () => {
    const actor = actorWith("wizard");
    await addSpells(actor, {
      classUuid: "Compendium.x.classes.Item.wizard",
      selectedCantrips: [{ uuid: "Compendium.x.spells.Item.light" }],
      selectedSpells: [{ uuid: "Compendium.x.spells.Item.shield" }, { uuid: "Compendium.x.spells.Item.sleep" }]
    });
    expect(actor.updated).toEqual([{ _id: "cls", [`flags.${MODULE_ID}.spellbookFree`]: 2 }]);
  });

  it("puts a pact caster's spells in the pact slots, and writes no book ledger for a class without a book", async () => {
    const actor = actorWith("warlock");
    await addSpells(actor, {
      classUuid: "Compendium.x.classes.Item.warlock",
      selectedCantrips: [], selectedSpells: [{ uuid: "Compendium.x.spells.Item.hex" }]
    });
    expect(actor.created[0].system.method).toBe("pact");
    expect(actor.updated).toEqual([]);
  });

  it("skips a pick that no longer resolves, and writes nothing for no picks", async () => {
    const actor = actorWith("wizard");
    await addSpells(actor, {
      classUuid: "Compendium.x.classes.Item.wizard",
      selectedCantrips: [{ uuid: "Compendium.x.spells.Item.gone" }], selectedSpells: []
    });
    expect(actor.created).toEqual([]);
    const empty = actorWith("wizard");
    await addSpells(empty, { selectedCantrips: [], selectedSpells: [] });
    expect(empty.created).toEqual([]);
  });
});

describe("buildFeatSpell", () => {
  const feat = { id: "featMI", getFlag: () => "root.adv" };

  it("hands a feat's spell to its own advancement configuration when it has one", async () => {
    const applySpellChanges = vi.fn((obj, { ability }) => { obj.system.ability = ability; obj.system.method = "atwill"; });
    const obj = await buildFeatSpell("Compendium.x.spells.Item.light", {
      ability: "wis", cantrip: true, feat, advId: "adv1", sourceTag: "feat:magic-initiate", spellConfig: { applySpellChanges }
    });
    expect(applySpellChanges).toHaveBeenCalledOnce();
    expect(obj.system).toMatchObject({ ability: "wis", method: "atwill", sourceItem: "feat:magic-initiate" });
    expect(obj.flags.dnd5e).toMatchObject({ advancementOrigin: "featMI.adv1", advancementRoot: "root.adv" });
  });

  it("makes an advancement-less feat's level-1 spell always prepared and free once per long rest", async () => {
    const obj = await buildFeatSpell("Compendium.x.spells.Item.sleep", {
      ability: "int", cantrip: false, feat, sourceTag: "feat:magic-initiate"
    });
    expect(obj.system).toMatchObject({ ability: "int", method: "spell", prepared: 2, sourceItem: "feat:magic-initiate" });
    expect(obj.system.uses).toMatchObject({ max: "1", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] });
  });

  it("leaves a cantrip's preparation and uses alone", async () => {
    const obj = await buildFeatSpell("Compendium.x.spells.Item.light", {
      ability: "cha", cantrip: true, feat: null, sourceTag: "feat:magic-initiate"
    });
    expect(obj.system.prepared).toBeUndefined();
    expect(obj.system.uses.max).toBeUndefined();
  });

  it("returns nothing for a spell that does not resolve", async () => {
    expect(await buildFeatSpell("Compendium.x.spells.Item.gone", { ability: "int", cantrip: true, sourceTag: "x" })).toBeNull();
  });
});

describe("detailsUpdate", () => {
  const state = {
    actor: { name: "Old Name" },
    portrait: "portrait.webp", tokenImg: "token.webp",
    tokenRingEnabled: true, tokenRingImg: "ring.webp", tokenLockRotation: false,
    details: { name: "  Ash  ", ideals: "Freedom", bonds: "Kin", flaws: "Pride", biography: "<p>Bio</p>" }
  };

  it("names the actor and its token from the trimmed name", () => {
    const update = detailsUpdate(state);
    expect(update.name).toBe("Ash");
    expect(update["prototypeToken.name"]).toBe("Ash");
  });

  it("maps the plural Details fields to dnd5e's singular keys", () => {
    const update = detailsUpdate(state);
    expect(update).toMatchObject({
      "system.details.ideal": "Freedom", "system.details.bond": "Kin", "system.details.flaw": "Pride",
      "system.details.biography.value": "<p>Bio</p>"
    });
  });

  it("keeps the actor's own name when none was typed", () => {
    expect(detailsUpdate({ ...state, details: { name: "  " } }).name).toBe("Old Name");
  });
});
