import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { MODULE_ID } from "../scripts/config.mjs";
import { MILESTONE_FLAG, grantedLevel, hasGrantedLevel, nextGrantTarget } from "../scripts/levelup/milestone.mjs";
import { canGrantLevel, grantLevels, grantRows, milestonesOffered } from "../scripts/levelup/milestone-grant.mjs";

/**
 * Milestone grants: a GM granting a level in a world that doesn't level by XP. The grant is stored as
 * the level granted *up to*, so it needs no clean-up — reaching that level by any route ends the
 * signal — and granting twice before the player levels owes them two.
 */

/** A character stub with just what the grant code reads and writes. */
function character({ id = "a1", name = "Ash", level = 3, granted = null, classes = 1, playerOwned = true } = {}) {
  const flags = granted === null ? {} : { [MILESTONE_FLAG]: granted };
  return {
    id, name, img: "x.webp", type: "character", hasPlayerOwner: playerOwned,
    system: { details: { level } },
    items: Array.from({ length: classes }, () => ({ type: "class" })),
    getFlag(scope, key) { return scope === MODULE_ID ? flags[key] : undefined; },
    async setFlag(scope, key, value) { if ( scope === MODULE_ID ) flags[key] = value; }
  };
}

beforeEach(() => {
  installFoundryShims();
  ChatMessage.created = [];
  CONFIG.DND5E.maxLevel = 20;
  game.settings._values.levelingMode = "noxp";
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  foundry.applications ??= {};
  foundry.applications.handlebars = { renderTemplate: async (_path, data) => JSON.stringify(data) };
  game.users = [];
});

describe("reading a grant", () => {
  it("reads no grant when the flag is missing or not a positive number", () => {
    expect(grantedLevel(character())).toBeNull();
    expect(grantedLevel(character({ granted: 0 }))).toBeNull();
    expect(grantedLevel(character({ granted: "x" }))).toBeNull();
    expect(grantedLevel(character({ granted: 4 }))).toBe(4);
  });

  it("is waiting only while the grant is above the character's level", () => {
    expect(hasGrantedLevel(character({ level: 3, granted: 4 }))).toBe(true);
    expect(hasGrantedLevel(character({ level: 4, granted: 4 }))).toBe(false);
    expect(hasGrantedLevel(character({ level: 5, granted: 4 }))).toBe(false);
  });

  it("is ignored in a world that levels by XP", () => {
    expect(hasGrantedLevel(character({ level: 3, granted: 4 }), { milestones: false })).toBe(false);
    game.settings._values.levelingMode = "xp";
    expect(hasGrantedLevel(character({ level: 3, granted: 4 }))).toBe(false);
  });
});

describe("the next grant", () => {
  it("is one above the character's level", () => {
    expect(nextGrantTarget(character({ level: 3 }))).toBe(4);
  });

  it("stacks on a grant still waiting, so two grants owe two levels", () => {
    expect(nextGrantTarget(character({ level: 3, granted: 4 }))).toBe(5);
  });

  it("ignores a stale grant the character has already passed", () => {
    expect(nextGrantTarget(character({ level: 6, granted: 4 }))).toBe(7);
  });

  it("stops at the level cap", () => {
    expect(nextGrantTarget(character({ level: 20 }))).toBeNull();
    expect(nextGrantTarget(character({ level: 19, granted: 20 }))).toBeNull();
  });
});

describe("who can grant, and to whom", () => {
  it("is offered only to a GM, in a milestone world, with the level-up flow on", () => {
    game.user = { isGM: true };
    expect(milestonesOffered()).toBe(true);
    game.user = { isGM: false };
    expect(milestonesOffered()).toBe(false);
    game.user = { isGM: true };
    game.settings._values.levelingMode = "xpBoons";
    expect(milestonesOffered()).toBe(false);
  });

  it("needs a character with a class, below the cap", () => {
    expect(canGrantLevel(character())).toBe(true);
    expect(canGrantLevel(character({ classes: 0 }))).toBe(false);
    expect(canGrantLevel(character({ level: 20 }))).toBe(false);
    expect(canGrantLevel({ ...character(), type: "npc" })).toBe(false);
  });
});

describe("granting", () => {
  it("raises each mark and whispers the ready card to the owners and the GM", async () => {
    const ash = character({ id: "a1", name: "Ash", level: 3 });
    const bo = character({ id: "b2", name: "Bo", level: 5, granted: 6 });
    const granted = await grantLevels([ash, bo]);

    expect(granted.map(a => a.id)).toEqual(["a1", "b2"]);
    expect(grantedLevel(ash)).toBe(4);
    expect(grantedLevel(bo)).toBe(7);
    expect(ChatMessage.created).toHaveLength(2);
    const card = ChatMessage.created[0];
    expect(card.flags[MODULE_ID].summary).toBe("levelGranted");
    expect(card.whisper).toContain("gm-user");
    expect(JSON.parse(card.content)).toMatchObject({ actorId: "a1", sub: expect.stringContaining('"level":4') });
  });

  it("skips a character that cannot take a level and grants the rest", async () => {
    const capped = character({ id: "c3", level: 20 });
    const ash = character({ id: "a1", level: 3 });
    const granted = await grantLevels([capped, ash]);
    expect(granted.map(a => a.id)).toEqual(["a1"]);
    expect(grantedLevel(capped)).toBeNull();
    expect(ChatMessage.created).toHaveLength(1);
  });
});

describe("the batch dialog's rows", () => {
  it("lists grantable characters, player-owned first then by name, ticking the preselected", () => {
    const rows = grantRows([
      character({ id: "z", name: "Zed" }),
      character({ id: "n", name: "Npc Ally", playerOwned: false }),
      character({ id: "a", name: "Ash" }),
      character({ id: "c", name: "Capped", level: 20 })
    ], new Set(["z"]));
    expect(rows.map(r => r.id)).toEqual(["a", "z", "n"]);
    expect(rows.map(r => r.checked)).toEqual([false, true, false]);
    expect(rows[0].levelLine).toContain('"target":4');
  });
});
