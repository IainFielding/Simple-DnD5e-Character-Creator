import { describe, expect, it } from "vitest";
import { isPreparedPick, normalizePrepared, spellsStep } from "../scripts/steps/spells-step.mjs";

/**
 * The creation Spells step for a spellbook class: the Wizard picks six spells for its book and
 * prepares four of them (the 2024 scale, or Intelligence modifier + 1 in 2014). New picks fill the
 * prepared allowance first, the Prepare tab changes which, and the step is complete only when the
 * book is full and every prepared slot is used.
 */

const M = "sogrom-dnd5e-character-creator";

/** Six 1st-level wizard spells and three cantrips, as the class's spell payload offers them. */
const LEVEL1 = ["alarm", "armor", "missile", "shield", "sleep", "grease", "detect"].map(id => ({
  uuid: `Compendium.dnd5e.spells.Item.${id}`, id, identifier: id, name: id, img: "", level: 1,
  school: "Evocation", propertyKeys: ""
}));
const CANTRIPS = ["light", "bolt", "hand"].map(id => ({
  uuid: `Compendium.dnd5e.spells.Item.${id}`, id, identifier: id, name: id, img: "", level: 0,
  school: "Evocation", propertyKeys: ""
}));

/** A 2024 Wizard's payload: a "Max Prepared Spells" scale of 4, and a six-spell book. */
const WIZARD = {
  isSpellcaster: true, cantrips: CANTRIPS, level1: LEVEL1, maxCantrips: 3, maxSpells: 4,
  classId: "wizard", preparedFormula: "", spellbook: true, bookSize: 6
};
const spells = {
  forClass: async () => WIZARD,
  description: async () => "",
  sourceBook: async () => ""
};

function makeState(over = {}) {
  return {
    classUuid: "Compendium.dnd5e.classes24.Item.wizard",
    spellListOverride: "", spellTab: "level1", focusedSpellUuid: null,
    selectedCantrips: [], selectedSpells: [],
    spellInfo: {
      isSpellcaster: true, maxCantrips: 3, maxSpells: 4, classId: "wizard",
      preparedFormula: "", spellbook: true, bookSize: 6, listMissing: false
    },
    finalScores: () => ({ str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }),
    advChoices: {},
    ...over
  };
}

const pick = (state, s) => spellsStep.handle("pick-spell", { dataset: { uuid: s.uuid, level: String(s.level) } },
  { state, spells });
const toggle = (state, s) => spellsStep.handle("toggle-prepared", { dataset: { uuid: s.uuid } }, { state, spells });

describe("picking a Wizard's book", () => {
  it("prepares the first four picks and writes the rest in unprepared", async () => {
    const state = makeState();
    for ( const s of LEVEL1.slice(0, 6) ) await pick(state, s);
    expect(state.selectedSpells.map(s => s.prepared)).toEqual([true, true, true, true, false, false]);
    // A seventh is refused: the book holds six at 1st level.
    await pick(state, LEVEL1[6]);
    expect(state.selectedSpells).toHaveLength(6);
  });

  it("is complete only when the book is full and every prepared slot is used", async () => {
    const state = makeState();
    for ( const s of CANTRIPS ) await pick(state, s);
    for ( const s of LEVEL1.slice(0, 6) ) await pick(state, s);
    expect(spellsStep.isComplete(state)).toBe(true);

    await toggle(state, LEVEL1[0]);        // unprepare one: three of four
    expect(spellsStep.isComplete(state)).toBe(false);
    expect(spellsStep.incompleteHint(state)).toBe(`${M}.step.spells.prepareHint:{"count":1}`);
  });
});

describe("the Prepare tab", () => {
  it("swaps which spells are prepared, and refuses a fifth", async () => {
    const state = makeState();
    for ( const s of LEVEL1.slice(0, 6) ) await pick(state, s);
    await toggle(state, LEVEL1[4]);        // refused: already four prepared
    expect(isPreparedPick(state.selectedSpells[4])).toBe(false);
    await toggle(state, LEVEL1[0]);        // unprepare alarm
    await toggle(state, LEVEL1[4]);        // prepare sleep
    expect(state.selectedSpells.filter(isPreparedPick).map(s => s.name)).toEqual(["armor", "missile", "shield", "sleep"]);
  });

  it("lists the book, ticked where prepared and flagged either way", async () => {
    const state = makeState({ spellTab: "prepare" });
    for ( const s of LEVEL1.slice(0, 6) ) await pick(state, s);
    const ctx = await spellsStep.context({ state, spells });
    expect(ctx.isPrepareTab).toBe(true);
    expect(ctx.list).toHaveLength(6);
    expect(ctx.list.filter(s => s.active)).toHaveLength(4);
    expect(ctx.list.find(s => s.name === "sleep").ownedTag).toBe(`${M}.step.spells.flagBook`);
    expect(ctx.list.find(s => s.name === "alarm").ownedTag).toBe(`${M}.step.spells.flagPrepared`);
    // At the limit, the unprepared ones can't be ticked.
    expect(ctx.list.find(s => s.name === "sleep").disabled).toBe(true);
    expect(ctx.preparedChips).toHaveLength(4);
    expect(ctx.bookOnlyChips).toHaveLength(2);
  });

  it("is not offered to a class without a book", async () => {
    const cleric = { ...WIZARD, classId: "cleric", spellbook: false, bookSize: 0 };
    const state = makeState({ spellTab: "prepare", spellInfo: { ...makeState().spellInfo, spellbook: false, bookSize: 0 } });
    const ctx = await spellsStep.context({ state, spells: { ...spells, forClass: async () => cleric } });
    expect(ctx.isBook).toBe(false);
    expect(ctx.isPrepareTab).toBe(false);
  });
});

describe("spells an origin grants", () => {
  it("appear locked on the tab they belong to, named after what granted them", async () => {
    // A species that grants a leveled spell (always prepared) and a cantrip.
    const species = { uuid: "Compendium.x.Item.species", name: "Tiefling" };
    const grants = {
      "Compendium.x.Item.species": {
        name: "Tiefling", type: "race", system: {
          advancement: [
            { _id: "g1", type: "ItemGrant", level: 1, configuration: { items: ["Compendium.dnd5e.spells.Item.hellish"], spell: { prepared: 2 } } },
            { _id: "g2", type: "ItemGrant", level: 1, configuration: { items: ["Compendium.dnd5e.spells.Item.thaum"] } }
          ]
        }
      },
      "Compendium.dnd5e.spells.Item.hellish": { type: "spell", name: "Hellish Rebuke", img: "", system: { level: 1, identifier: "hellish-rebuke" } },
      "Compendium.dnd5e.spells.Item.thaum": { type: "spell", name: "Thaumaturgy", img: "", system: { level: 0, identifier: "thaumaturgy" } }
    };
    const saved = globalThis.fromUuid;
    globalThis.fromUuid = async uuid => grants[uuid] ?? null;
    try {
      const book = await spellsStep.context({ state: makeState({ speciesUuid: species.uuid }), spells });
      expect(book.list[0].name).toBe("Hellish Rebuke");
      expect(book.list[0].granted).toBe(true);
      expect(book.list[0].ownedTag).toBe(`${M}.step.spells.flagAlways`);
      expect(book.list[0].ownedTip).toBe(`${M}.step.spells.grantedTip:{"source":"Tiefling"}`);

      const cantrips = await spellsStep.context({ state: makeState({ speciesUuid: species.uuid, spellTab: "cantrips" }), spells });
      expect(cantrips.list[0].name).toBe("Thaumaturgy");
      expect(cantrips.list[0].ownedTag).toBe(`${M}.step.spells.flagGranted`);

      const focused = await spellsStep.context({
        state: makeState({ speciesUuid: species.uuid, focusedSpellUuid: "Compendium.dnd5e.spells.Item.hellish" }), spells
      });
      expect(focused.focused.grantedNote).toBe(`${M}.step.spells.grantedNote:{"source":"Tiefling"}`);
    } finally {
      globalThis.fromUuid = saved;
    }
  });
});

describe("normalizePrepared", () => {
  it("flags unflagged picks up to the allowance, as Quick Build's picks arrive", () => {
    const state = makeState({ selectedSpells: LEVEL1.slice(0, 6).map(s => ({ ...s })) });
    normalizePrepared(state);
    expect(state.selectedSpells.map(s => s.prepared)).toEqual([true, true, true, true, false, false]);
  });

  it("unprepares past a lowered allowance but never re-prepares a player's choice", () => {
    // A 2014 Wizard: Intelligence modifier + 1. Four prepared at Int 16.
    const state = makeState({
      spellInfo: { ...makeState().spellInfo, maxSpells: 6, bookSize: 0, preparedFormula: "@abilities.int.mod + @classes.wizard.levels" },
      selectedSpells: LEVEL1.slice(0, 6).map((s, i) => ({ ...s, prepared: i !== 1 && i < 5 }))
    });
    // Int drops to 12: two prepared.
    state.finalScores = () => ({ int: 12 });
    const saved = { replace: Roll.replaceFormulaData, safeEval: Roll.safeEval };
    Roll.replaceFormulaData = (f, data) => f.replace(/@([\w.-]+)/g, (_, p) => String(p.split(".").reduce((o, k) => o?.[k], data) ?? 0));
    Roll.safeEval = expr => Function(`"use strict"; return (${expr});`)();
    try {
      normalizePrepared(state);
    } finally {
      Roll.replaceFormulaData = saved.replace;
      Roll.safeEval = saved.safeEval;
    }
    expect(state.selectedSpells.map(s => s.prepared)).toEqual([true, false, true, false, false, false]);
  });

  it("leaves every pick of a class without a book prepared", () => {
    const state = makeState({
      spellInfo: { isSpellcaster: true, maxCantrips: 3, maxSpells: 2, classId: "sorcerer", preparedFormula: "", spellbook: false },
      selectedSpells: LEVEL1.slice(0, 2).map(s => ({ ...s }))
    });
    normalizePrepared(state);
    expect(state.selectedSpells.every(isPreparedPick)).toBe(true);
  });
});
