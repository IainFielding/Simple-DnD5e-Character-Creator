import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { levelUpWindowId, focusOpenLevelUp } from "../scripts/levelup/levelup-shell.mjs";
import { launchCreator } from "../scripts/api.mjs";
import { CreatorShell } from "../scripts/app/creator-shell.mjs";

/**
 * One window per job. Foundry inserts a window by swapping out any element that already has its id,
 * so a second creator, or a second level-up for the same character, used to take the first one's
 * place on screen and leave the first running unseen. These pin the guard: the id is per character
 * for a level-up, and an open window is brought forward instead of a second being built.
 */

/** A stand-in for an open window, recording what the guard did to it. */
function openWindow({ minimized = false } = {}) {
  return {
    rendered: true, minimized, calls: [],
    bringToFront() { this.calls.push("front"); },
    maximize() { this.calls.push("maximize"); }
  };
}

let notices;
beforeEach(() => {
  installFoundryShims();
  notices = [];
  globalThis.ui = { notifications: { info: m => notices.push(m), warn() {}, error() {} } };
  foundry.applications.instances = new Map();
});

describe("the level-up window", () => {
  it("has an id of its own for each character", () => {
    expect(levelUpWindowId({ id: "abc" })).toBe("sogrom-levelup-abc");
    expect(levelUpWindowId({ id: "xyz" })).not.toBe(levelUpWindowId({ id: "abc" }));
    expect(levelUpWindowId(null)).toBe("sogrom-levelup");
  });

  it("brings a character's open level-up forward and says so", () => {
    const win = openWindow({ minimized: true });
    foundry.applications.instances.set("sogrom-levelup-abc", win);
    expect(focusOpenLevelUp({ id: "abc", name: "Ash" })).toBe(true);
    expect(win.calls).toEqual(["maximize", "front"]);
    expect(notices).toHaveLength(1);
  });

  it("leaves another character's level-up alone", () => {
    foundry.applications.instances.set("sogrom-levelup-abc", openWindow());
    expect(focusOpenLevelUp({ id: "xyz", name: "Bo" })).toBe(false);
    expect(notices).toHaveLength(0);
  });

  it("ignores a window that is registered but no longer rendered", () => {
    foundry.applications.instances.set("sogrom-levelup-abc", { ...openWindow(), rendered: false });
    expect(focusOpenLevelUp({ id: "abc" })).toBe(false);
  });
});

describe("the creator window", () => {
  it("returns the open creator instead of building a second", async () => {
    const win = openWindow();
    foundry.applications.instances.set(CreatorShell.DEFAULT_OPTIONS.id, win);
    game.user = { can: () => true };
    const app = await launchCreator();
    expect(app).toBe(win);
    expect(win.calls).toEqual(["front"]);
    expect(notices).toHaveLength(1);
  });
});
