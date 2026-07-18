import { describe, expect, it } from "vitest";
import { multiclassBlockers, meetsMulticlassPrereqs, formatBlockers } from "../scripts/levelup/multiclass.mjs";

/**
 * The rules-as-written multiclass prerequisite — 13+ in the primary ability of both the current
 * class(es) and the new one — enforced by the wizard's "prereq" multiclass mode. Class shapes
 * mirror dnd5e's `system.primaryAbility` (`{ value, all }`), which is a prepared Set on a live
 * item but a plain array on compendium item data; both must work.
 */

/** A minimal actor: ability scores plus owned class items. */
function makeActor(scores, classes = []) {
  const abilities = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { value: v }]));
  return { system: { abilities }, items: classes };
}

/** A class item/data stub with a primary-ability requirement. */
function makeClass(name, abilities, { all = true, asSet = false } = {}) {
  const value = asSet ? new Set(abilities) : abilities;
  return { type: "class", name, system: { primaryAbility: { value, all } } };
}

describe("multiclassBlockers", () => {
  it("passes when both classes' requirements are met", () => {
    const actor = makeActor({ str: 15, int: 13 }, [makeClass("Fighter", ["str"])]);
    expect(multiclassBlockers(actor, makeClass("Wizard", ["int"]))).toEqual([]);
    expect(meetsMulticlassPrereqs(actor, makeClass("Wizard", ["int"]))).toBe(true);
  });

  it("blocks on the new class's unmet requirement", () => {
    const actor = makeActor({ str: 15, int: 12 }, [makeClass("Fighter", ["str"])]);
    const blockers = multiclassBlockers(actor, makeClass("Wizard", ["int"]));
    expect(blockers).toEqual([{ className: "Wizard", abilities: ["int"], all: true }]);
  });

  it("blocks on an existing class's unmet requirement too", () => {
    // Str 12 fails the *current* Fighter's requirement even though the new class is fine.
    const actor = makeActor({ str: 12, int: 16 }, [makeClass("Fighter", ["str"])]);
    const blockers = multiclassBlockers(actor, makeClass("Wizard", ["int"]));
    expect(blockers).toEqual([{ className: "Fighter", abilities: ["str"], all: true }]);
  });

  it("requires every listed ability when `all` is set, reporting only the failing ones", () => {
    const actor = makeActor({ str: 13, dex: 13, wis: 11 }, []);
    const blockers = multiclassBlockers(actor, makeClass("Monk", ["dex", "wis"], { all: true }));
    expect(blockers).toEqual([{ className: "Monk", abilities: ["wis"], all: true }]);
  });

  it("accepts any one listed ability when `all` is false, reporting every alternative on failure", () => {
    const anyOf = makeClass("Fighter", ["str", "dex"], { all: false });
    expect(multiclassBlockers(makeActor({ str: 8, dex: 14 }), anyOf)).toEqual([]);
    expect(multiclassBlockers(makeActor({ str: 8, dex: 9 }), anyOf))
      .toEqual([{ className: "Fighter", abilities: ["str", "dex"], all: false }]);
  });

  it("imposes no requirement for a class without primary-ability data (homebrew)", () => {
    const actor = makeActor({ str: 8 }, [{ type: "class", name: "Homebrew", system: {} }]);
    expect(multiclassBlockers(actor, { type: "class", name: "AlsoHomebrew", system: {} })).toEqual([]);
  });

  it("reads a prepared Set (live item) and a raw array (compendium data) alike", () => {
    const actor = makeActor({ int: 10 });
    for ( const asSet of [true, false] ) {
      const blockers = multiclassBlockers(actor, makeClass("Wizard", ["int"], { asSet }));
      expect(blockers).toHaveLength(1);
    }
  });

  it("collects blockers from every failing class", () => {
    const actor = makeActor({ str: 10, int: 10 }, [makeClass("Fighter", ["str"])]);
    const blockers = multiclassBlockers(actor, makeClass("Wizard", ["int"]));
    expect(blockers.map(b => b.className)).toEqual(["Fighter", "Wizard"]);
  });
});

describe("formatBlockers", () => {
  // The shim's format() only echoes key + data; interpolate the two keys under test for real
  // so the assertions read like the message a player sees.
  const STRINGS = {
    "sogrom-dnd5e-character-creator.levelup.multiclass.score": "{ability} {score}",
    "sogrom-dnd5e-character-creator.levelup.multiclass.requires": "{class} requires {abilities}"
  };
  game.i18n.format = (key, data) => Object.entries(data ?? {})
    .reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), STRINGS[key] ?? key);

  it("names the class and each missing ability score", () => {
    const message = formatBlockers([{ className: "Wizard", abilities: ["int"], all: true }]);
    expect(message).toBe("Wizard requires Intelligence 13");
  });

  it("joins an any-one requirement with 'or' and multiple blockers with semicolons", () => {
    const message = formatBlockers([
      { className: "Fighter", abilities: ["str", "dex"], all: false },
      { className: "Monk", abilities: ["wis"], all: true }
    ]);
    expect(message).toContain("Strength 13 or Dexterity 13");
    expect(message.split("; ")).toHaveLength(2);
  });
});
