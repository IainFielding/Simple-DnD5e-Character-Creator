import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { canBuildInto } from "../scripts/app/blank-build.mjs";
import { CreatorState, isPlaceholderName } from "../scripts/state/creator-state.mjs";
import { importPregen } from "../scripts/data/premades.mjs";
import { t } from "../scripts/config.mjs";

/**
 * Building into a blank character the GM prepared — the creator's way in for a player without the
 * Create Actor permission. The rules that matter: only a character the user owns, only while it has
 * none of the three origin items the assembler writes, and a GM's name for the sheet is kept.
 */
beforeEach(() => {
  installFoundryShims();
  CONFIG.Actor = { typeLabels: { character: "TYPES.Actor.character" } };
  game.i18n.localize = key => (key === "TYPES.Actor.character" ? "Character" : key);
});

function makeActor({ type = "character", isOwner = true, items = [], pack = null, name = "Character" } = {}) {
  return { type, isOwner, pack, name, items };
}

describe("canBuildInto", () => {
  it("accepts an owned character with nothing on it", () => {
    expect(canBuildInto(makeActor(), { enabled: true })).toBe(true);
  });

  // Starting gold, a trinket: anything that isn't an origin stays, and doesn't block the build.
  it("accepts a character holding only non-origin items", () => {
    expect(canBuildInto(makeActor({ items: [{ type: "loot" }, { type: "weapon" }] }), { enabled: true })).toBe(true);
  });

  it("refuses a character that already has a class, species or background", () => {
    for ( const type of ["class", "race", "background"] ) {
      expect(canBuildInto(makeActor({ items: [{ type }] }), { enabled: true }), type).toBe(false);
    }
  });

  it("refuses a sheet the user doesn't own", () => {
    expect(canBuildInto(makeActor({ isOwner: false }), { enabled: true })).toBe(false);
  });

  it("refuses NPCs, compendium actors, and a world where the module doesn't offer creation", () => {
    expect(canBuildInto(makeActor({ type: "npc" }), { enabled: true })).toBe(false);
    expect(canBuildInto(makeActor({ pack: "world.heroes" }), { enabled: true })).toBe(false);
    expect(canBuildInto(makeActor(), { enabled: false })).toBe(false);
    expect(canBuildInto(null, { enabled: true })).toBe(false);
  });
});

describe("isPlaceholderName", () => {
  it("recognises Foundry's default sheet names", () => {
    expect(isPlaceholderName("Character")).toBe(true);
    expect(isPlaceholderName("Character (2)")).toBe(true);
    expect(isPlaceholderName("Character (17)")).toBe(true);
  });

  it("recognises empty names and the creator's own placeholder", () => {
    expect(isPlaceholderName("")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(t("common.newCharacter"))).toBe(true);
  });

  it("keeps a name somebody chose", () => {
    expect(isPlaceholderName("Tom's Character")).toBe(false);
    expect(isPlaceholderName("Character of Tom")).toBe(false);
    expect(isPlaceholderName("Aria")).toBe(false);
  });

  // A GM's blank sheet named "Character (3)" must not arrive on the Details step as a real name.
  it("leaves the Details name empty for a blank sheet with a default name", () => {
    const state = new CreatorState({ ...makeActor({ name: "Character (3)" }), system: {}, items: { find: () => null } });
    expect(state.details.name).toBe("");
    const named = new CreatorState({ ...makeActor({ name: "Aria" }), system: {}, items: { find: () => null } });
    expect(named.details.name).toBe("Aria");
  });
});

describe("importPregen into a blank sheet", () => {
  const pregen = {
    name: "Akra",
    img: "akra.webp",
    system: { details: { level: 1 } },
    prototypeToken: { texture: { src: "akra-token.webp" }, ring: { enabled: true } },
    items: [{ _id: "cls0000000000001", type: "class" }],
    effects: [{ _id: "eff0000000000001" }]
  };

  function blankSheet(name) {
    return {
      name,
      update: vi.fn(async () => {}),
      createEmbeddedDocuments: vi.fn(async () => [])
    };
  }

  beforeEach(() => {
    globalThis.fromUuid = async () => ({ toObject: () => structuredClone(pregen) });
  });

  it("fills the sheet, keeping item and effect ids so advancements still find their grants", async () => {
    const actor = blankSheet("Character (2)");
    const result = await importPregen("Compendium.dnd5e.actors24.Actor.akra", { into: actor });
    expect(result).toBe(actor);
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", pregen.items, { keepId: true });
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", pregen.effects, { keepId: true });
    const update = actor.update.mock.calls[0][0];
    expect(update.system).toEqual(pregen.system);
    expect(update.img).toBe("akra.webp");
    // A placeholder name gives way to the pregen's.
    expect(update.name).toBe("Akra");
  });

  it("keeps a name the GM gave the sheet", async () => {
    const actor = blankSheet("Tom's hero");
    await importPregen("Compendium.dnd5e.actors24.Actor.akra", { into: actor });
    expect(actor.update.mock.calls[0][0].name).toBeUndefined();
  });

  it("never touches the sheet's ownership", async () => {
    const actor = blankSheet("Character");
    await importPregen("Compendium.dnd5e.actors24.Actor.akra", { into: actor });
    expect(actor.update.mock.calls[0][0]).not.toHaveProperty("ownership");
  });
});
