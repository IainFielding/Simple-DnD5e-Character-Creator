import { describe, it, expect, beforeEach } from "vitest";
import { spellMethodFor } from "../scripts/build/actor-assembler.mjs";

/**
 * `spellMethodFor` decides which casting `method` a class's chosen spells are stamped with, which in
 * turn selects the slot pool they draw from: a pact caster (Warlock) must land in Pact Magic slots
 * ("pact"), every other caster in ordinary spell slots ("spell"). The mapping comes from dnd5e's
 * `CONFIG.DND5E.spellProgression[progression].type`, so the test seeds that config the way the
 * system builds it at runtime (see SpellcastingModel.fromConfig).
 */
describe("spellMethodFor", () => {
  beforeEach(() => {
    CONFIG.DND5E.spellProgression = {
      none: { label: "None" },
      full: { type: "spell" },
      half: { type: "spell" },
      third: { type: "spell" },
      artificer: { type: "spell" },
      pact: { type: "pact" }
    };
  });

  const classWith = progression => ({ system: { spellcasting: { progression } } });

  it("routes a Warlock (pact progression) to the pact method", () => {
    expect(spellMethodFor(classWith("pact"))).toBe("pact");
  });

  it("routes full/half/third/artificer casters to the standard spell method", () => {
    expect(spellMethodFor(classWith("full"))).toBe("spell");
    expect(spellMethodFor(classWith("half"))).toBe("spell");
    expect(spellMethodFor(classWith("third"))).toBe("spell");
    expect(spellMethodFor(classWith("artificer"))).toBe("spell");
  });

  it("falls back to the standard spell method for a missing or unrecognised progression", () => {
    expect(spellMethodFor(null)).toBe("spell");
    expect(spellMethodFor({})).toBe("spell");
    expect(spellMethodFor(classWith("none"))).toBe("spell");
    expect(spellMethodFor(classWith("mystery"))).toBe("spell");
  });
});
