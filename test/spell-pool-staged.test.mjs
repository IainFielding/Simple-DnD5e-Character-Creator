import { describe, expect, it, beforeEach } from "vitest";
import { SpellSource } from "../scripts/data/spell-source.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * The level-up spell pool, loaded for a caster whose class item has no compendium entry to fetch.
 *
 * Foundry only stamps `_stats.compendiumSource` when a document is *imported* from a pack, so an
 * item built with `packDoc.toObject()` carries none — which is exactly what Ember's builder stages
 * onto its advancement clone. The pool used to be resolved by `fromUuid` on that source UUID, so
 * for an Ember character it resolved to nothing and the spell step rendered its budget over an
 * empty list. Handing the casting item itself to the pool loader fixes that, and works the same for
 * an ordinary level-up (where the actor's own class item is equally authoritative).
 */
describe("SpellSource#forClassAtLevel for a staged casting item", () => {
  const CANTRIP = "Compendium.dnd-players-handbook.spells.Item.firebolt00000000";
  const SPELL = "Compendium.dnd-players-handbook.spells.Item.magicmissile0000";

  /** The sorcerer class as Ember stages it: real identifier, no compendium source, clone-local uuid. */
  const stagedSorcerer = {
    name: "Sorcerer",
    uuid: "Actor.emberHero0000000.Item.clsSorcerer000000",
    _stats: { compendiumSource: null },
    system: { identifier: "sorcerer", spellcasting: { progression: "full" } }
  };

  beforeEach(() => {
    installFoundryShims();
    // The PHB registers `class:sorcerer`; the spells themselves resolve, the clone's item does not.
    globalThis.dnd5e.registry = {
      spellLists: {
        forType: (type, id) => ((type === "class") && (id === "sorcerer")
          ? { uuids: new Set([CANTRIP, SPELL]) } : null)
      }
    };
    const spells = {
      [CANTRIP]: { type: "spell", name: "Fire Bolt", img: "", system: { level: 0 } },
      [SPELL]: { type: "spell", name: "Magic Missile", img: "", system: { level: 1 } }
    };
    globalThis.fromUuid = async uuid => spells[uuid] ?? null;
  });

  it("loads the class's list from the item itself, with no UUID to fetch", async () => {
    const pool = await new SpellSource().forClassAtLevel(stagedSorcerer.uuid, 1, "class", { doc: stagedSorcerer });
    expect(pool.isSpellcaster).toBe(true);
    expect(pool.classId).toBe("sorcerer");
    expect(pool.byLevel[0].map(s => s.name)).toEqual(["Fire Bolt"]);
    expect(pool.byLevel[1].map(s => s.name)).toEqual(["Magic Missile"]);
  });

  it("comes back empty without it — the regression this guards", async () => {
    const pool = await new SpellSource().forClassAtLevel(stagedSorcerer.uuid, 1, "class");
    expect(pool.isSpellcaster).toBe(false);
  });

  it("keys the memo on the identifier, so two characters share one load", async () => {
    const source = new SpellSource();
    const first = await source.forClassAtLevel(stagedSorcerer.uuid, 1, "class", { doc: stagedSorcerer });
    // A second character's clone gives the same class a different item uuid.
    const other = { ...stagedSorcerer, uuid: "Actor.otherHero000000.Item.clsSorcerer111111" };
    const second = await source.forClassAtLevel(other.uuid, 1, "class", { doc: other });
    expect(second).toBe(first);
  });

  it("still reports a non-caster as one", async () => {
    const fighter = { ...stagedSorcerer, system: { identifier: "fighter", spellcasting: { progression: "none" } } };
    const pool = await new SpellSource().forClassAtLevel(fighter.uuid, 1, "class", { doc: fighter });
    expect(pool.isSpellcaster).toBe(false);
  });
});
