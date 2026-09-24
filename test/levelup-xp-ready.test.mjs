import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { hasLevelUpXp } from "../scripts/levelup/intercept.mjs";

/**
 * What lights the sheet's Level Up button: XP at or past the next level's threshold, in a world that
 * levels by XP. The button itself shows whenever the character can level; this only decides the glow.
 */
beforeEach(() => installFoundryShims());

const actor = (value, max) => ({ system: { details: { xp: { value, max } } } });

describe("hasLevelUpXp", () => {
  it("lights at the threshold and past it", () => {
    expect(hasLevelUpXp(actor(300, 300), { usesXp: true })).toBe(true);
    expect(hasLevelUpXp(actor(450, 300), { usesXp: true })).toBe(true);
  });

  it("stays unlit below the threshold", () => {
    expect(hasLevelUpXp(actor(299, 300), { usesXp: true })).toBe(false);
  });

  // Milestone levelling has no threshold to reach; the button shows, unlit.
  it("never lights in a world that doesn't level by XP", () => {
    expect(hasLevelUpXp(actor(9999, 300), { usesXp: false })).toBe(false);
  });

  it("stays unlit at the level cap, where the next threshold is Infinity", () => {
    expect(hasLevelUpXp(actor(355000, Infinity), { usesXp: true })).toBe(false);
  });

  it("treats missing XP data as not ready rather than throwing", () => {
    expect(hasLevelUpXp({ system: {} }, { usesXp: true })).toBe(false);
    expect(hasLevelUpXp(null, { usesXp: true })).toBe(false);
  });
});
