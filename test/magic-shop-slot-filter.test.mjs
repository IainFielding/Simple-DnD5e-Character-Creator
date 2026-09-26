import { describe, expect, it } from "vitest";
import { magicShopStep, slotFilterRank } from "../scripts/steps/magic-shop-step.mjs";
import { rarityRank } from "../scripts/data/magic-shop.mjs";

/**
 * The Magic Items step's slot chips double as a filter, as the level-up's spell-level chips do: a
 * slot holds its own rarity or anything lower, so clicking "Rare 0/1" shows the common, uncommon and
 * rare items — everything that slot could take — and clicking it again shows the whole shelf.
 */

/** Levels 11–16 of the DMG table: two uncommon and one rare slot. */
const TIER = { allowance: { common: 0, uncommon: 2, rare: 1, veryrare: 0, legendary: 0, artifact: 0 } };
const click = (state, rarity) => magicShopStep.handle("magic-slot-filter", { dataset: { rarity } }, { state });

describe("the magic shop's slot filter", () => {
  it("sets the filter to the chip's rarity, and clears it on a second click", async () => {
    const state = { magicShopSlotFilter: "" };
    await click(state, "rare");
    expect(state.magicShopSlotFilter).toBe("rare");
    await click(state, "uncommon");
    expect(state.magicShopSlotFilter).toBe("uncommon");
    await click(state, "uncommon");
    expect(state.magicShopSlotFilter).toBe("");
  });

  it("narrows to the chip's rarity and lower", () => {
    const rank = slotFilterRank({ magicShopSlotFilter: "rare" }, TIER);
    const shelf = ["common", "uncommon", "rare", "veryrare", "legendary"];
    expect(shelf.filter(r => rarityRank(r) <= rank)).toEqual(["common", "uncommon", "rare"]);
  });

  it("filters nothing with no chip chosen", () => {
    expect(slotFilterRank({ magicShopSlotFilter: "" }, TIER)).toBe(-1);
    expect(slotFilterRank({}, TIER)).toBe(-1);
  });

  it("ignores a chip this tier has no slot for, so a level change can't hide the shelf", () => {
    // Chosen at a higher level, then the target level came down to a tier with no very rare slot.
    expect(slotFilterRank({ magicShopSlotFilter: "veryrare" }, TIER)).toBe(-1);
  });
});
