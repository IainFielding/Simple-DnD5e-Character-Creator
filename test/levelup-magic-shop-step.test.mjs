import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { SETTINGS } from "../scripts/config.mjs";
import { lvlMagicShopStep } from "../scripts/levelup/steps/lvl-magic-shop-step.mjs";

/**
 * The Magic Items step on the level-up rail.
 *
 * It used to sit in the creation rail, which meant a player chose what a 5th-level character starts
 * with while their character was still 1st level — before the proficiencies and ability scores that
 * decide whether an item is any use had been granted, and with nothing to stop an abandoned climb
 * leaving a 1st-level character holding a 5th-level hoard. It is now the last step of the climb that
 * *makes* them 5th level, reading the creator's state through a wrapper so there is still one shop.
 */

/** A level-up state as a creation climb presents one. */
const climbing = ({ targetLevel = 5, picks = {} } = {}) => ({
  creationState: { targetLevel, magicShop: { d10: 4, picks } },
  driver: { clone: { system: {} } }
});

describe("the Magic Items step on the level-up rail", () => {
  beforeEach(() => {
    installFoundryShims();
    game.settings.set("", SETTINGS.magicShopEnabled, true);
  });

  it("applies to a creation climb whose target level earns a wealth band", () => {
    expect(lvlMagicShopStep.applicable(climbing({ targetLevel: 5 }))).toBe(true);
  });

  it("never applies to an ordinary level-up, which carries no creation state", () => {
    expect(lvlMagicShopStep.applicable({ driver: {} })).toBe(false);
  });

  it("does not apply to a character created at level 1 — the DMG's bands start at 2", () => {
    expect(lvlMagicShopStep.applicable(climbing({ targetLevel: 1 }))).toBe(false);
  });

  it("does not apply while the GM has the shop switched off", () => {
    game.settings.set("", SETTINGS.magicShopEnabled, false);
    expect(lvlMagicShopStep.applicable(climbing())).toBe(false);
  });

  it("is complete without being visited, since the level-up shell never fires onEnter", () => {
    // The creation step required a visit; here that could never become true and would block Apply.
    expect(lvlMagicShopStep.isComplete(climbing())).toBe(true);
  });

  it("blocks Apply while the picks outgrow the allowance", () => {
    // Levels 5–10 allow one common and one uncommon; three commons is over.
    const picks = {
      a: { qty: 3, rarity: "common", name: "Potion", img: "" }
    };
    expect(lvlMagicShopStep.isComplete(climbing({ picks }))).toBe(false);
  });

  it("is complete for an ordinary level-up, which has no picks to make", () => {
    expect(lvlMagicShopStep.isComplete({ driver: {} })).toBe(true);
  });
});
