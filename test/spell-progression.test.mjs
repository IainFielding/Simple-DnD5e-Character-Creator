import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeSpellPlan } from "../scripts/levelup/steps/lvl-spells-step.mjs";
import { abilityPreparationFormula, cantripsKnownAtLevel, levelOneSpellLimits, spellsKnownAtLevel }
  from "../scripts/data/spell-source.mjs";

/**
 * Spell counts the class data doesn't hand over directly: the Arcane Trickster with no cantrip scale,
 * the 2014 known casters whose `preparation.max` derives to 0, the 2014 prepared casters whose
 * level-1 count follows an ability score, and a multiclassed caster whose pooled slots outrank what
 * its own class may learn.
 */

/** A ScaleValue advancement with the given title and sparse `{level: value}` table. */
function scale(title, table) {
  const entries = Object.fromEntries(Object.entries(table).map(([l, v]) => [l, { value: v }]));
  return { type: "ScaleValue", title, configuration: { identifier: "", scale: entries }, value: {} };
}

/** The PHB Arcane Trickster: a Max Prepared scale and no cantrip scale at all. */
const trickster = {
  id: "trickster00000000", type: "subclass", name: "Arcane Trickster",
  system: {
    identifier: "trickster", classIdentifier: "rogue",
    spellcasting: { progression: "third", ability: "int", preparation: { max: 3, value: 0 } },
    advancement: [scale("Max Prepared Spells", { 3: 3, 4: 4, 7: 5 })]
  }
};

/** The 2014 SRD Sorcerer, whose class declares no preparation formula. */
function sorcerer2014(levels, preparedValue) {
  return {
    id: "sorcerer00000000", type: "class", name: "Sorcerer",
    system: {
      identifier: "sorcerer", levels,
      spellcasting: { progression: "full", ability: "cha", preparation: { max: 0, value: preparedValue } },
      advancement: [
        scale("Cantrips Known", { 1: 4, 4: 5, 10: 6 }),
        scale("Spells Known", { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 })
      ]
    }
  };
}

describe("Arcane Trickster cantrips", () => {
  it("reads the fallback table when the subclass carries no cantrip scale", () => {
    expect(cantripsKnownAtLevel(trickster, 2)).toBe(0);
    expect(cantripsKnownAtLevel(trickster, 3)).toBe(2);
    expect(cantripsKnownAtLevel(trickster, 9)).toBe(2);
    expect(cantripsKnownAtLevel(trickster, 10)).toBe(3);
  });

  it("offers the picks on reaching rogue 3, Mage Hand's untagged grant not counted", () => {
    const rogue = {
      id: "rogue00000000000", type: "class", name: "Rogue",
      system: { identifier: "rogue", levels: 3, spellcasting: { progression: "none" }, advancement: [] }
    };
    // Mage Hand as the subclass grants it: no spell configuration, so no sourceItem tag.
    const mageHand = { type: "spell", system: { level: 0, sourceItem: "" } };
    const actor = {
      items: [rogue, trickster, mageHand],
      system: { details: { level: 3 }, spells: { spell1: { max: 2 } } }
    };
    const plan = computeSpellPlan(actor, rogue);
    expect(plan.sourceTag).toBe("subclass:trickster");
    expect(plan.addCantrips).toBe(2);
    expect(plan.addSpells).toBe(3);
  });
});

describe("2014 known casters", () => {
  it("read their Spells Known scale", () => {
    expect(spellsKnownAtLevel(sorcerer2014(5, 0), 5)).toBe(6);
  });

  it("gain spells on level-up although dnd5e derives preparation.max as 0", () => {
    // Sorcerer 5 who knew four spells at 4th level: one more by the Spells Known scale.
    const cls = sorcerer2014(5, 5);
    const actor = { items: [cls], system: { details: { level: 5 }, spells: { spell1: { max: 4 }, spell3: { max: 2 } } } };
    const plan = computeSpellPlan(actor, cls);
    expect(plan.spellTarget).toBe(6);
    expect(plan.addSpells).toBe(1);
  });
});

describe("level-1 counts for 2014 prepared casters", () => {
  // Enough of Foundry's formula helpers to evaluate `@abilities.wis.mod + @classes.cleric.levels`.
  let saved;
  beforeEach(() => {
    saved = { replace: globalThis.Roll.replaceFormulaData, safeEval: globalThis.Roll.safeEval };
    globalThis.Roll.replaceFormulaData = (formula, data) => formula.replace(/@([\w.-]+)/g,
      (_, path) => String(path.split(".").reduce((o, k) => o?.[k], data) ?? 0));
    globalThis.Roll.safeEval = expr => Function(`"use strict"; const floor = Math.floor; return (${expr});`)();
  });
  afterEach(() => {
    globalThis.Roll.replaceFormulaData = saved.replace;
    globalThis.Roll.safeEval = saved.safeEval;
  });

  const scores = (over = {}) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...over });
  const cleric = {
    maxCantrips: 3, maxSpells: 3, classId: "cleric",
    preparedFormula: "@abilities.wis.mod + @classes.cleric.levels", spellbook: false
  };

  it("prepares Wisdom modifier + 1 rather than a flat three", () => {
    expect(levelOneSpellLimits(cleric, scores({ wis: 16 }))).toEqual({ maxCantrips: 3, maxSpells: 4, maxPrepared: 4 });
  });

  it("never drops below one", () => {
    expect(levelOneSpellLimits(cleric, scores({ wis: 6 })).maxSpells).toBe(1);
  });

  it("lets a wizard fill a six-spell book but prepare only its allowance", () => {
    const wizard = {
      maxCantrips: 3, maxSpells: 6, classId: "wizard",
      preparedFormula: "@abilities.int.mod + @classes.wizard.levels", spellbook: true
    };
    expect(levelOneSpellLimits(wizard, scores({ int: 16 }))).toEqual({ maxCantrips: 3, maxSpells: 6, maxPrepared: 4 });
  });

  it("leaves a class without a formula on its table", () => {
    expect(levelOneSpellLimits({ maxCantrips: 4, maxSpells: 2 }, scores()))
      .toEqual({ maxCantrips: 4, maxSpells: 2, maxPrepared: 2 });
  });

  it("only treats an ability formula on a 1st-level caster as one", () => {
    const doc = (progression, formula) => ({ system: { spellcasting: { progression, preparation: { formula } } } });
    expect(abilityPreparationFormula(doc("full", "@abilities.wis.mod + @classes.cleric.levels")))
      .toBe("@abilities.wis.mod + @classes.cleric.levels");
    // 2024: the formula only points at the class's own scale.
    expect(abilityPreparationFormula(doc("full", "@scale.cleric.max-prepared"))).toBe("");
    // The 2014 Paladin learns nothing until 2nd level.
    expect(abilityPreparationFormula(doc("half", "@abilities.cha.mod + floor(@classes.paladin.levels / 2)"))).toBe("");
    expect(abilityPreparationFormula(doc("full", ""))).toBe("");
  });
});

describe("multiclass spell level", () => {
  // The slice of dnd5e the single-class measure calls: a multi-level slot model and the actor's
  // `computeClassProgression`, run as the system runs them for a lone full caster.
  let saved;
  beforeEach(() => {
    saved = { spellcasting: CONFIG.DND5E.spellcasting, Actor: CONFIG.Actor };
    const table = [[2], [3], [4, 2], [4, 3], [4, 3, 2]];
    CONFIG.DND5E.spellcasting = {
      spell: {
        key: "spell", slots: true,
        calculateSlots: level => Object.fromEntries((table[Math.min(level, table.length) - 1] ?? []).map((n, i) => [i + 1, n]))
      }
    };
    CONFIG.Actor = {
      documentClass: {
        computeClassProgression(progression, cls) { progression.spell += cls.spellcasting.levels; }
      }
    };
  });
  afterEach(() => {
    CONFIG.DND5E.spellcasting = saved.spellcasting;
    if ( saved.Actor === undefined ) delete CONFIG.Actor;
    else CONFIG.Actor = saved.Actor;
  });

  it("holds a new Wizard 1 to 1st-level spells beside a Cleric's 3rd-level slots", () => {
    const wizard = {
      id: "wizard0000000000", type: "class", name: "Wizard",
      spellcasting: { type: "spell", progression: "full", levels: 1 },
      system: {
        identifier: "wizard", levels: 1,
        spellcasting: { progression: "full", preparation: { max: 4, value: 0 } },
        advancement: [scale("Cantrips Known", { 1: 3 })]
      }
    };
    const actor = {
      items: [wizard],
      system: { details: { level: 6 }, spells: { spell1: { max: 4 }, spell2: { max: 3 }, spell3: { max: 3 } } }
    };
    expect(computeSpellPlan(actor, wizard).maxSpellLevel).toBe(1);
  });

  it("leaves a single-classed caster at its own slots", () => {
    const wizard = {
      id: "wizard0000000000", type: "class", name: "Wizard",
      spellcasting: { type: "spell", progression: "full", levels: 5 },
      system: {
        identifier: "wizard", levels: 5,
        spellcasting: { progression: "full", preparation: { max: 9, value: 7 } },
        advancement: []
      }
    };
    const actor = {
      items: [wizard],
      system: { details: { level: 5 }, spells: { spell1: { max: 4 }, spell2: { max: 3 }, spell3: { max: 2 } } }
    };
    expect(computeSpellPlan(actor, wizard).maxSpellLevel).toBe(3);
  });
});
