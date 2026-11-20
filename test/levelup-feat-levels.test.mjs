import { describe, it, expect } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

/**
 * A feat taken at an ability-score improvement is walked like dnd5e walks any item added mid-flow:
 * from level 0 up to the level-up's final *character* level, because a feat is not class-linked —
 * its advancement levels are character levels.
 *
 * The driver used to walk it at level 0 alone. The PHB's Ritual Caster picks a spell at levels 0, 5,
 * 9, 13 and 17, so a character taking it at 19 (an Elemental Shaman, on the specialization sweep)
 * got two spells natively plus four more, and two from the creator.
 *
 * Screens are class levels, so each revealed decision is mapped back by the character's levels in
 * other classes, and never onto a screen before the improvement that took the feat.
 */
describe("featLevelWindow: a feat taken at an improvement", () => {
  const asi = (level, screenLevel = level) => ({ level, screenLevel });

  it("walks to the final character level of a single-class level-up", () => {
    const { maxLevel } = LevelUpDriver.featLevelWindow(asi(19), 19, 0);
    expect(maxLevel).toBe(19);
  });

  it("puts every earlier-level decision on the improvement's own screen", () => {
    const { screenFor } = LevelUpDriver.featLevelWindow(asi(19), 19, 0);
    // Ritual Caster's level-0, 5, 9, 13 and 17 picks all belong to the level-19 screen.
    expect([0, 5, 9, 13, 17].map(screenFor)).toEqual([19, 19, 19, 19, 19]);
  });

  it("keeps a later decision of a multi-level jump on its own screen", () => {
    // Levelling 4 → 6 and taking the feat at 4: its level-5 pick is the level-5 screen's.
    const { maxLevel, screenFor } = LevelUpDriver.featLevelWindow(asi(4), 6, 0);
    expect(maxLevel).toBe(6);
    expect(screenFor(0)).toBe(4);
    expect(screenFor(5)).toBe(5);
  });

  it("counts a multiclass character's other classes as character levels", () => {
    // Fighter 3 / Wizard 4 → 5, the feat at Wizard 4: character level 7, walked to 8.
    const { maxLevel, screenFor } = LevelUpDriver.featLevelWindow(asi(4), 5, 3);
    expect(maxLevel).toBe(8);
    // Character level 5 is before this improvement: its screen. Character level 8 is Wizard 5.
    expect(screenFor(5)).toBe(4);
    expect(screenFor(8)).toBe(5);
  });

  it("honours a screen the improvement was already moved to", () => {
    const { screenFor } = LevelUpDriver.featLevelWindow(asi(0, 4), 4, 0);
    expect(screenFor(0)).toBe(4);
  });
});
