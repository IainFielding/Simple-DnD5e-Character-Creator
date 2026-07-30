import { describe, expect, it, beforeEach } from "vitest";
import { spellListFor } from "../scripts/data/spell-source.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * Which spell list a caster draws from. Most casters use the list registered under their own
 * identifier, but the third-caster subclasses have none: the PHB registers `class:wizard` and a
 * `subclass:` list for every domain/Circle/Oath, yet nothing for the Eldritch Knight or the Arcane
 * Trickster — their Spellcasting feature only says "the Wizard spell list" in prose. Resolving
 * those to `subclass:eldritch-knight` yields an empty pool, which is what left the level-up spell
 * page blank after picking Eldritch Knight at Fighter 3.
 */
describe("spellListFor", () => {
  /** Stand in for dnd5e's registry, holding exactly the lists the PHB module registers. */
  function registerLists(keys) {
    globalThis.dnd5e.registry = {
      spellLists: {
        forType(type, identifier) {
          return keys.includes(`${type}:${identifier}`) ? { uuids: new Set(["Compendium.x.spells.Item.a"]) } : null;
        }
      }
    };
  }

  const PHB = ["class:wizard", "class:cleric", "class:druid", "subclass:moon", "subclass:trickery"];
  const subclass = (identifier, classIdentifier) => ({ system: { identifier, classIdentifier } });

  beforeEach(() => {
    installFoundryShims();
    registerLists(PHB);
  });

  it("borrows the Wizard list for an Eldritch Knight, which registers none of its own", () => {
    expect(spellListFor(subclass("eldritch-knight", "fighter"), "eldritch-knight", "subclass"))
      .toEqual({ id: "wizard", type: "class" });
  });

  it("borrows the Wizard list for the Arcane Trickster under either identifier", () => {
    // The PHB subclass item calls itself "trickster"; other data spells it out.
    expect(spellListFor(subclass("trickster", "rogue"), "trickster", "subclass"))
      .toEqual({ id: "wizard", type: "class" });
    expect(spellListFor(subclass("arcane-trickster", "rogue"), "arcane-trickster", "subclass"))
      .toEqual({ id: "wizard", type: "class" });
  });

  it("keeps a subclass that has its own registered list", () => {
    expect(spellListFor(subclass("moon", "druid"), "moon", "subclass"))
      .toEqual({ id: "moon", type: "subclass" });
  });

  it("falls back to the parent class's list for an unmapped subclass caster", () => {
    // A homebrew casting subclass of a casting class: the class list is the right pool.
    expect(spellListFor(subclass("stargazer", "druid"), "stargazer", "subclass"))
      .toEqual({ id: "druid", type: "class" });
  });

  it("leaves a class caster alone", () => {
    expect(spellListFor({ system: { identifier: "wizard" } }, "wizard", "class"))
      .toEqual({ id: "wizard", type: "class" });
  });

  it("keeps the subclass's own key when nothing is registered, so the pack scans still run", () => {
    registerLists([]);
    expect(spellListFor(subclass("eldritch-knight", "fighter"), "eldritch-knight", "subclass"))
      .toEqual({ id: "eldritch-knight", type: "subclass" });
  });

  it("survives a registry that isn't loaded yet", () => {
    globalThis.dnd5e.registry = undefined;
    expect(spellListFor(subclass("eldritch-knight", "fighter"), "eldritch-knight", "subclass"))
      .toEqual({ id: "eldritch-knight", type: "subclass" });
  });
});
