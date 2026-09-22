import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QUICK_LEVELS, isQuickLevel, QuickClimbProvider } from "../scripts/data/quick-climb.mjs";
import { QUICK_BUILD } from "../scripts/data/quick-build-data.mjs";

/**
 * Quick Build's headless climb to a higher starting level.
 *
 * The provider is the whole risk here. `LevelUpDriver#autoResolve` reads it **synchronously**, so
 * anything needing a compendium read has to be resolved during the warm — and a method that quietly
 * returns nothing looks exactly like a decision the profile had no opinion on, which is a legal
 * answer. That failure mode is silent by construction, so each accessor is pinned against the real
 * shapes the driver hands it rather than against a shape that seemed likely.
 */
describe("quick climb", () => {

  describe("the rungs", () => {
    it("offers 1, 3 and 5", () => {
      expect([...QUICK_LEVELS]).toEqual([1, 3, 5]);
    });

    it("accepts only those levels", () => {
      for ( const level of [1, 3, 5] ) expect(isQuickLevel(level)).toBe(true);
      for ( const level of [0, 2, 4, 6, 20, null, "x"] ) expect(isQuickLevel(level)).toBe(false);
    });

    it("accepts a level that arrives as a string, as a dataset attribute does", () => {
      expect(isQuickLevel("3")).toBe(true);
    });
  });

  /* -------------------------------------------- */

  describe("every class profile can answer a climb", () => {
    it("names at least one subclass", () => {
      for ( const [cls, profile] of Object.entries(QUICK_BUILD) ) {
        expect(profile.subclasses?.length, `${cls} has no subclass preference`).toBeGreaterThan(0);
      }
    });

    it("names subclasses as non-empty strings, not identifiers", () => {
      for ( const [cls, profile] of Object.entries(QUICK_BUILD) ) {
        for ( const name of profile.subclasses ) {
          expect(typeof name, `${cls}`).toBe("string");
          expect(name.trim().length, `${cls}`).toBeGreaterThan(0);
          // An identifier would be lower-kebab; these are matched against `card.name`.
          expect(name, `${cls} looks like an identifier`).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
      }
    });
  });

  /* -------------------------------------------- */

  describe("resolving the subclass", () => {
    const classItem = { system: { identifier: "monk", source: { rules: "2014" } } };

    it("takes the first preference the world actually installs", async () => {
      // The 2024 name is listed first and is absent here, so the 2014 one must win — the case the
      // list exists for.
      const source = { subclasses: vi.fn(async () => [
        { name: "Way of the Open Hand", uuid: "Compendium.x.Item.open" },
        { name: "Way of Shadow", uuid: "Compendium.x.Item.shadow" }
      ]) };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await p.warm(classItem);
      expect(p.subclass()).toBe("Compendium.x.Item.open");
      expect(source.subclasses).toHaveBeenCalledWith("monk", { rules: "2014" });
    });

    it("falls back to whatever is installed rather than leaving the character subclass-less", async () => {
      const source = { subclasses: async () => [{ name: "Way of the Astral Self", uuid: "Compendium.x.Item.astral" }] };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await p.warm(classItem);
      expect(p.subclass()).toBe("Compendium.x.Item.astral");
    });

    it("declines to answer again once its subclass is applied", async () => {
      // `LevelUpDriver#selectSubclass` is a toggle: it clears what is set, then re-resolves only
      // when the uuid differs. So answering the same uuid twice *removes* the subclass. The climb
      // runs `autoResolve` twice — the second pass answers what the subclass synthesised — and this
      // is what stops that second pass from undoing the first. Found by the e2e check, which
      // reached 3rd level with no subclass and no other sign of trouble.
      const source = { subclasses: async () => [{ name: "Way of the Open Hand", uuid: "Compendium.x.Item.open" }] };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await p.warm(classItem);

      const unanswered = { advancement: { value: {} } };
      expect(p.subclass(unanswered)).toBe("Compendium.x.Item.open");

      const applied = { advancement: { value: { uuid: "Compendium.x.Item.open" } } };
      expect(p.subclass(applied)).toBeNull();
    });

    it("still answers when a different subclass is already set", async () => {
      const source = { subclasses: async () => [{ name: "Way of the Open Hand", uuid: "Compendium.x.Item.open" }] };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await p.warm(classItem);
      const other = { advancement: { value: { uuid: "Compendium.x.Item.shadow" } } };
      expect(p.subclass(other)).toBe("Compendium.x.Item.open");
    });

    it("answers null when the class offers none, rather than throwing", async () => {
      const source = { subclasses: async () => [] };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await p.warm(classItem);
      expect(p.subclass()).toBeNull();
    });

    it("survives a source that throws", async () => {
      const source = { subclasses: async () => { throw new Error("pack offline"); } };
      const p = new QuickClimbProvider(QUICK_BUILD.monk, source);
      await expect(p.warm(classItem)).resolves.toBeUndefined();
      expect(p.subclass()).toBeNull();
    });
  });

  /* -------------------------------------------- */

  describe("spending an ability-score improvement", () => {
    /** An `asiState` as the driver returns one: `available`, `cap` and per-ability rows. */
    function driverWith(abilities, { available = 2, cap = Infinity } = {}) {
      return { asiState: () => ({ available, cap, abilities }) };
    }
    const row = (key, value, over = {}) =>
      ({ key, value, delta: 0, locked: false, canIncrease: true, ...over });

    const rec = { advancement: { configuration: {} } };

    async function providerOn(driver, profile = QUICK_BUILD.fighter) {
      const p = new QuickClimbProvider(profile, { subclasses: async () => [] });
      // `warmDecisions` is what hands the provider its driver; with no decision arrays it does
      // nothing else, which is exactly the seam being used here.
      await p.warmDecisions({ ...driver, traitSteps: [], choiceSteps: [] });
      return p;
    }

    it("spends both points on the class's first priority", async () => {
      // Fighter leads on strength.
      const p = await providerOn(driverWith([row("str", 15), row("con", 14), row("dex", 13)]));
      expect(p.asi(rec)).toEqual({ str: 2 });
    });

    it("moves down the priority order when the first ability is capped", async () => {
      const p = await providerOn(driverWith([row("str", 20, { canIncrease: false }), row("con", 14)]));
      expect(p.asi(rec)).toEqual({ con: 2 });
    });

    it("never raises an ability past 20", async () => {
      const p = await providerOn(driverWith([row("str", 19), row("con", 14)]));
      // One point fits under the 20 cap; the second has to land on the next priority.
      expect(p.asi(rec)).toEqual({ str: 1, con: 1 });
    });

    it("respects a per-ability cap the advancement sets", async () => {
      const p = await providerOn(driverWith([row("str", 15), row("con", 14)], { cap: 1 }));
      expect(p.asi(rec)).toEqual({ str: 1, con: 1 });
    });

    it("skips a locked ability", async () => {
      const p = await providerOn(driverWith([row("str", 15, { locked: true }), row("con", 14)]));
      expect(p.asi(rec)).toEqual({ con: 2 });
    });

    it("answers null when there is nothing to spend", async () => {
      const p = await providerOn(driverWith([row("str", 15)], { available: 0 }));
      expect(p.asi(rec)).toBeNull();
    });

    it("answers null rather than guessing when it has no driver", () => {
      const p = new QuickClimbProvider(QUICK_BUILD.fighter, {});
      expect(p.asi(rec)).toBeNull();
    });
  });

  /* -------------------------------------------- */

  describe("trait picks", () => {
    const opt = (key, over = {}) => ({ key, label: key, selected: false, owned: false, disabled: false, ...over });

    /** A driver exposing one trait decision with the given options and quota. */
    function driverWithTraits(options, { current = 0, max = 2 } = {}) {
      const rec = { advancement: {} };
      return {
        rec,
        driver: {
          traitSteps: [rec],
          choiceSteps: [],
          traitState: () => ({ chosen: new Set(), current, max, full: current >= max }),
          traitOptions: async () => options
        }
      };
    }

    it("prefers the profile's skills, then backfills to the quota", async () => {
      // Rogue prefers stealth then sleight of hand.
      const { rec, driver } = driverWithTraits([
        opt("skills:ath"), opt("skills:slt"), opt("skills:ste"), opt("skills:arc")
      ]);
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      await p.warmDecisions(driver);
      expect(p.traitKeys(rec)).toEqual(["skills:ste", "skills:slt"]);
    });

    it("backfills from the offered list when the profile matches nothing", async () => {
      const { rec, driver } = driverWithTraits([opt("languages:elvish"), opt("languages:orc")]);
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      await p.warmDecisions(driver);
      // Any legal pick beats none: an unanswered trait decision silently costs a proficiency.
      expect(p.traitKeys(rec)).toEqual(["languages:elvish", "languages:orc"]);
    });

    it("never offers an option the driver disabled or already owns", async () => {
      const { rec, driver } = driverWithTraits([
        opt("skills:ste", { disabled: true }), opt("skills:slt", { selected: true }), opt("skills:prc")
      ]);
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      await p.warmDecisions(driver);
      expect(p.traitKeys(rec)).toEqual(["skills:prc"]);
    });

    it("takes nothing when the quota is already full", async () => {
      const { rec, driver } = driverWithTraits([opt("skills:ste")], { current: 2, max: 2 });
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      await p.warmDecisions(driver);
      expect(p.traitKeys(rec)).toEqual([]);
    });

    it("takes only the remaining quota, not the whole pool", async () => {
      const { rec, driver } = driverWithTraits(
        [opt("skills:ste"), opt("skills:slt"), opt("skills:prc")], { current: 1, max: 2 });
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      await p.warmDecisions(driver);
      expect(p.traitKeys(rec)).toHaveLength(1);
    });

    it("answers empty for a decision it never warmed", () => {
      const p = new QuickClimbProvider(QUICK_BUILD.rogue, {});
      expect(p.traitKeys({ advancement: {} })).toEqual([]);
      expect(p.choiceUuids({ advancement: {} })).toEqual([]);
    });
  });

  /* -------------------------------------------- */

  describe("the answers it deliberately declines to give", () => {
    let p;
    beforeEach(() => { p = new QuickClimbProvider(QUICK_BUILD.fighter, {}); });
    afterEach(() => vi.unstubAllGlobals());

    it("takes average hit points, so the same three choices build the same character", () => {
      expect(p.hp()).toBe("avg");
    });

    it("leaves an optional grant seeded — null, not an empty array", () => {
      // `[]` is a real answer meaning "decline every item"; null means "no opinion".
      expect(p.optionalGrant()).toBeNull();
    });

    it("defers spell choices to the spell pass, as creation does", () => {
      expect(p.defer({ advancement: { configuration: { type: "spell" } } })).toBe(true);
      expect(p.defer({ advancement: { configuration: { type: "feature" } } })).toBe(false);
    });

    it("has no opinion on size or a grant's casting ability", () => {
      expect(p.size()).toBeNull();
      expect(p.grantAbility()).toBeNull();
    });
  });
});
