import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { MODULE_ID, SETTINGS } from "../scripts/config.mjs";
import { WHATS_NEW, cardDue, newerThan, postWelcomeIfDue } from "../scripts/app/welcome.mjs";

/**
 * The GM's welcome card: once on a world's first run, a "what's new" note after a release that adds
 * features, silence for a patch, and nothing at all with the setting off.
 */

const entries = [
  { version: "3.4.0", lines: () => ["a"] },
  { version: "3.5.0", lines: () => ["b"] }
];

describe("newerThan", () => {
  it("compares segment by segment as numbers", () => {
    expect(newerThan("3.10.0", "3.9.0")).toBe(true);
    expect(newerThan("3.4.0", "3.4.0")).toBe(false);
    expect(newerThan("3.4", "3.4.0")).toBe(false);
    expect(newerThan("3.4.1", "3.4")).toBe(true);
    expect(newerThan("2.9.9", "3.0.0")).toBe(false);
  });
});

describe("cardDue", () => {
  it("welcomes a world that has never had a card, at the latest feature release", () => {
    expect(cardDue("", entries)).toEqual({ kind: "welcome", version: "3.5.0" });
  });

  it("lists every feature release since the last one announced", () => {
    expect(cardDue("3.4.0", entries)).toMatchObject({ kind: "whatsNew", version: "3.5.0" });
    expect(cardDue("3.3.0", entries).entries.map(e => e.version)).toEqual(["3.4.0", "3.5.0"]);
  });

  it("says nothing once the latest has been announced", () => {
    expect(cardDue("3.5.0", entries)).toBeNull();
  });

  it("has a feature release to announce in the shipped table", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
    for ( const e of WHATS_NEW ) expect(e.lines().length).toBeGreaterThan(0);
  });
});

describe("postWelcomeIfDue", () => {
  beforeEach(() => {
    installFoundryShims();
    ChatMessage.created = [];
    game.user = { isActiveGM: true, isGM: true };
    game.modules = { get: () => ({ title: "Simple D&D Character Creator", readme: "https://example.test/readme" }) };
    game.settings._values[SETTINGS.welcomeCards] = true;
    game.settings._values[SETTINGS.welcomeVersion] = "";
    foundry.applications.handlebars = { renderTemplate: async (_path, data) => JSON.stringify(data) };
  });

  it("uses setting keys that exist", () => {
    expect(SETTINGS.welcomeCards).toBeTruthy();
    expect(SETTINGS.welcomeVersion).toBeTruthy();
  });

  it("whispers the welcome to the GMs once, recording what it announced", async () => {
    await postWelcomeIfDue();
    expect(ChatMessage.created).toHaveLength(1);
    const card = ChatMessage.created[0];
    expect(card.whisper).toEqual(["gm-user"]);
    expect(card.flags[MODULE_ID].summary).toBe("welcome");
    expect(JSON.parse(card.content).places.length).toBeGreaterThan(0);
    expect(game.settings._values[SETTINGS.welcomeVersion]).toBe(WHATS_NEW.at(-1).version);

    await postWelcomeIfDue();
    expect(ChatMessage.created).toHaveLength(1);
  });

  it("posts nothing with the setting off, and nothing from a client that isn't the active GM", async () => {
    game.settings._values[SETTINGS.welcomeCards] = false;
    await postWelcomeIfDue();
    game.settings._values[SETTINGS.welcomeCards] = true;
    game.user = { isActiveGM: false, isGM: true };
    await postWelcomeIfDue();
    expect(ChatMessage.created).toHaveLength(0);
    expect(game.settings._values[SETTINGS.welcomeVersion]).toBe("");
  });

  it("posts a what's-new card, without the welcome's places, to a world that saw an older release", async () => {
    game.settings._values[SETTINGS.welcomeVersion] = "3.3.0";
    await postWelcomeIfDue();
    const data = JSON.parse(ChatMessage.created[0].content);
    expect(ChatMessage.created[0].flags[MODULE_ID].summary).toBe("whatsNew");
    expect(data.places).toBeUndefined();
    expect(data.newLines.length).toBeGreaterThan(0);
  });
});
