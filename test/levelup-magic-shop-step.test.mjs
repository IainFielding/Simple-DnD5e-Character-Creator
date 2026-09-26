import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { SETTINGS } from "../scripts/config.mjs";
import { lvlMagicShopStep } from "../scripts/levelup/steps/lvl-magic-shop-step.mjs";
import { emptyWealthTable } from "../scripts/data/magic-shop.mjs";

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
const climbing = ({ targetLevel = 5, picks = {}, d10 = 4 } = {}) => ({
  creationState: { targetLevel, magicShop: { d10, picks } },
  driver: { clone: { system: {} } }
});

describe("the Magic Items step on the level-up rail", () => {
  beforeEach(() => installFoundryShims());

  it("applies to a creation climb whose target level earns a wealth band", () => {
    expect(lvlMagicShopStep.applicable(climbing({ targetLevel: 5 }))).toBe(true);
  });

  it("never applies to an ordinary level-up, which carries no creation state", () => {
    expect(lvlMagicShopStep.applicable({ driver: {} })).toBe(false);
  });

  it("does not apply to a character created at level 1 — the DMG's bands start at 2", () => {
    expect(lvlMagicShopStep.applicable(climbing({ targetLevel: 1 }))).toBe(false);
  });

  it("does not apply once the GM has set every level to 0, which is how the shop is switched off", () => {
    game.settings.set("", SETTINGS.magicShopConfig, { inventory: [], wealthTable: emptyWealthTable() });
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

  it("blocks Apply until the player has rolled for the bonus gold", () => {
    expect(lvlMagicShopStep.isComplete(climbing({ d10: null }))).toBe(false);
    expect(lvlMagicShopStep.incompleteHint(climbing({ d10: null }))).toContain("rollFirst");
  });

  it("renders the shelf without rolling — the roll is the player's to make", async () => {
    const state = climbing({ d10: null });
    const ctx = await lvlMagicShopStep.context({ state, app: null });
    expect(state.creationState.magicShop.d10).toBeNull();
    expect(ctx).toMatchObject({ rollable: true, rolled: false, d10: null });
  });

  it("rolls on the button, shows the throw through Dice So Nice, and locks the result", async () => {
    const thrown = [];
    game.dice3d = { showForRoll: async roll => { thrown.push(roll); } };
    const state = climbing({ d10: null });
    await lvlMagicShopStep.handle("magic-roll", { dataset: {} }, { state });
    expect(state.creationState.magicShop.d10).toBe(10);    // the shim's Roll always totals 10
    expect(thrown).toHaveLength(1);
    // A second press is a no-op: the result is locked.
    await lvlMagicShopStep.handle("magic-roll", { dataset: {} }, { state });
    expect(thrown).toHaveLength(1);
    expect(lvlMagicShopStep.isComplete(state)).toBe(true);
  });

  it("asks for no roll when the tier has no d10 in it", () => {
    // The DMG's levels 2–4 band grants an item but no gold, so there is nothing to roll.
    expect(lvlMagicShopStep.isComplete(climbing({ targetLevel: 3, d10: null }))).toBe(true);
  });
});
