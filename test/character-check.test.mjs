import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { checkCharacter, canCheckCharacter } from "../scripts/levelup/character-check.mjs";
import { wizard } from "./fixtures/dnd5e-5.3.3.mjs";

/**
 * Check Character reads the live actor with rules the module already applies elsewhere: Repair's
 * unanswered decisions and the level-up Spells step's plan. These tests pin that each rule reports
 * what it should, how it ranks it, and that the report survives a rule that throws.
 */

/** A spell item as the check reads it. */
function spell(level, sourceItem, identifier = `spell-${Math.random()}`) {
  return { type: "spell", name: identifier, system: { level, sourceItem, identifier, prepared: 1 } };
}

/** A level-4 wizard on the real 5.3.3 class data, with the derived fields a live actor would carry. */
function wizardActor({ items = [], prepared = { max: 7, value: 5 }, xp = { value: 2700, min: 2700, max: 6500 } } = {}) {
  const cls = structuredClone(wizard);
  cls.id = cls._id;
  cls.system.levels = 4;
  cls.system.spellcasting.preparation = prepared;
  return {
    type: "character", isOwner: true, name: "Ash",
    items: [cls, ...items],
    system: { details: { level: 4, xp }, spells: { spell1: { max: 4 }, spell2: { max: 3 } } }
  };
}

const keys = findings => findings.map(f => f.text.split(":")[0].replace("sogrom-dnd5e-character-creator.", ""));

beforeEach(() => {
  installFoundryShims();
  game.settings._values.levelingMode = "xp";
});

describe("checkCharacter", () => {
  it("reports each unanswered level as a problem with a Repair action, ahead of every note", () => {
    const findings = checkCharacter(wizardActor());
    const unanswered = findings.filter(f => f.text.includes("check.unanswered"));
    expect(unanswered.length).toBeGreaterThan(0);
    for ( const f of unanswered ) {
      expect(f.kind).toBe("problem");
      expect(f.action).toMatchObject({ type: "repair", classId: wizard._id });
    }
    const firstNote = findings.findIndex(f => f.kind === "note");
    expect(findings.slice(firstNote).every(f => f.kind === "note")).toBe(true);
  });

  it("counts unpicked cantrips as a problem", () => {
    const three = [0, 0, 0].map(() => spell(0, "class:wizard"));
    const short = checkCharacter(wizardActor({ items: three }));
    expect(short.find(f => f.text.includes("check.cantrips"))).toMatchObject({ kind: "problem" });
    expect(short.find(f => f.text.includes("check.cantrips")).text).toContain('"count":1');
    const full = checkCharacter(wizardActor({ items: [...three, spell(0, "class:wizard")] }));
    expect(keys(full)).not.toContain("check.cantrips");
  });

  it("treats spells over the prepared limit as a problem and room under it as a note", () => {
    expect(checkCharacter(wizardActor({ prepared: { max: 7, value: 9 } }))
      .find(f => f.text.includes("check.spellsOver"))).toMatchObject({ kind: "problem" });
    expect(checkCharacter(wizardActor({ prepared: { max: 7, value: 5 } }))
      .find(f => f.text.includes("check.spellsUnder"))).toMatchObject({ kind: "note" });
    const exact = keys(checkCharacter(wizardActor({ prepared: { max: 7, value: 7 } })));
    expect(exact).not.toContain("check.spellsOver");
    expect(exact).not.toContain("check.spellsUnder");
  });

  it("notes the free spellbook picks a wizard is still owed", () => {
    expect(checkCharacter(wizardActor()).find(f => f.text.includes("check.bookOwed"))).toMatchObject({ kind: "note" });
  });

  it("flags the same spell twice from the same source, but not one spell from two sources", () => {
    const twice = checkCharacter(wizardActor({ items: [spell(1, "class:wizard", "shield"), spell(1, "class:wizard", "shield")] }));
    expect(twice.find(f => f.text.includes("check.duplicate"))).toMatchObject({ kind: "problem" });
    const twoSources = checkCharacter(wizardActor({ items: [spell(1, "class:wizard", "shield"), spell(1, "feat:magic-initiate", "shield")] }));
    expect(keys(twoSources)).not.toContain("check.duplicate");
  });

  it("notes XP below the current level in an XP world, and not in a milestone world", () => {
    const behind = wizardActor({ xp: { value: 100, min: 2700, max: 6500 } });
    expect(checkCharacter(behind).find(f => f.text.includes("check.xpBehind"))).toMatchObject({ kind: "note" });
    game.settings._values.levelingMode = "noxp";
    expect(keys(checkCharacter(behind))).not.toContain("check.xpBehind");
  });

  it("offers Level Up when the XP for the next level is there", () => {
    const ready = wizardActor({ xp: { value: 6500, min: 2700, max: 6500 } });
    expect(checkCharacter(ready).find(f => f.text.includes("check.levelWaiting")))
      .toMatchObject({ kind: "note", action: { type: "levelUp" } });
  });

  it("keeps reporting when one rule throws", () => {
    const actor = wizardActor();
    // A spell whose identifier read throws takes the duplicate rule down, and only that rule.
    actor.items.push({ type: "spell", system: { level: 1, sourceItem: "class:wizard", prepared: 1,
      get identifier() { throw new Error("bad data"); } } });
    const findings = checkCharacter(actor);
    expect(keys(findings)).toContain("check.unanswered");
  });
});

describe("canCheckCharacter", () => {
  it("needs an owned character with a class", () => {
    expect(canCheckCharacter(wizardActor())).toBe(true);
    expect(canCheckCharacter({ ...wizardActor(), isOwner: false })).toBe(false);
    expect(canCheckCharacter({ ...wizardActor(), type: "npc" })).toBe(false);
    expect(canCheckCharacter({ ...wizardActor(), items: [] })).toBe(false);
  });
});
