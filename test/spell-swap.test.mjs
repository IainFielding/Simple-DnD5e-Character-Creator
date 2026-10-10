import { describe, expect, it } from "vitest";
import { swapAllowance } from "../scripts/data/spell-swap.mjs";

/**
 * What a caster may replace when it gains a level, by rules edition. Each row below is a rule from
 * the PHB of that edition (see the module doc in spell-swap.mjs); a change here changes what the
 * level-up's Spells step offers a player.
 */

const caster = (identifier, rules) => ({ system: { identifier, source: rules ? { rules } : {} } });

describe("swapAllowance: 2024", () => {
  it("lets a level-gated class replace one cantrip and one spell, worded as known", () => {
    for ( const id of ["bard", "sorcerer", "warlock", "eldritch-knight"] ) {
      expect(swapAllowance(caster(id, "2024"))).toEqual({
        cantrip: true, spell: true, spells: "one", prepared: false, levelGated: true,
        labelKey: "levelup.step.spells.swapHint"
      });
    }
  });

  it("does not level-gate the classes that change a spell on a long rest", () => {
    for ( const id of ["paladin", "ranger", "artificer"] ) {
      expect(swapAllowance(caster(id, "2024"))).toMatchObject({ spells: "one", levelGated: false });
    }
  });

  it("lets the Cleric and Druid change any number, cantrips included", () => {
    for ( const id of ["cleric", "druid"] ) {
      expect(swapAllowance(caster(id, "2024"))).toEqual({
        cantrip: true, spell: true, spells: "any", prepared: true, levelGated: false,
        labelKey: "levelup.step.spells.swapHintAny"
      });
    }
  });
});

describe("swapAllowance: 2014", () => {
  it("never swaps a cantrip, for any class", () => {
    for ( const id of ["bard", "sorcerer", "warlock", "ranger", "cleric", "druid", "paladin", "wizard", "artificer"] ) {
      expect(swapAllowance(caster(id, "2014")).cantrip).toBe(false);
    }
  });

  it("gives a spells-known class one level-gated swap, worded as known", () => {
    for ( const id of ["bard", "sorcerer", "warlock", "ranger"] ) {
      expect(swapAllowance(caster(id, "2014"))).toEqual({
        cantrip: false, spell: true, spells: "one", prepared: false, levelGated: true,
        labelKey: "levelup.step.spells.swapHint"
      });
    }
  });

  it("lets the Cleric, Druid, Paladin and Artificer change any number of prepared spells", () => {
    for ( const id of ["cleric", "druid", "paladin", "artificer"] ) {
      expect(swapAllowance(caster(id, "2014"))).toMatchObject({ spells: "any", prepared: true, levelGated: false });
    }
  });

  it("words the Wizard's swap as preparation, one at a time", () => {
    expect(swapAllowance(caster("wizard", "2014"))).toEqual({
      cantrip: false, spell: true, spells: "one", prepared: true, levelGated: false,
      labelKey: "levelup.step.spells.swapHintPrepared"
    });
  });
});

describe("swapAllowance: unknown content", () => {
  it("treats an item with no rules edition as 2024, the permissive answer", () => {
    expect(swapAllowance(caster("homebrew-mage"))).toMatchObject({ cantrip: true, spell: true, spells: "one" });
  });

  it("does not throw on a missing item", () => {
    expect(swapAllowance(null)).toMatchObject({ cantrip: true, spell: true });
  });
});
