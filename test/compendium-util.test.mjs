import { describe, it, expect, afterEach } from "vitest";
import { getEnabledPacks } from "../scripts/data/compendium-util.mjs";

// Only the globals getEnabledPacks reads: game.packs, game.settings and dnd5e.
const pack = (collection, rulesVersion, documentName = "Item") => ({
  collection, documentName, metadata: { flags: rulesVersion ? { dnd5e: { rulesVersion } } : {} }
});
const PACKS = [
  pack("dnd5e.classes", "legacy"),
  pack("dnd5e.classes24", "modern"),
  pack("world.homebrew", null),
  pack("dnd5e.rules", null, "JournalEntry")
];

function install({ setting = {}, rules = "modern", withIsSourceEnabled = true } = {}) {
  globalThis.game = { packs: PACKS, settings: { get: () => setting } };
  const CompendiumBrowserSettingsConfig = {
    // dnd5e 6.1's rule: an explicit setting wins, otherwise the pack's rules must match the world's.
    isSourceEnabled(p) {
      const s = setting[p.collection];
      if ( s !== undefined ) return s;
      const rv = p.metadata.flags?.dnd5e?.rulesVersion;
      return !rv || (rv === rules);
    }
  };
  globalThis.dnd5e = withIsSourceEnabled ? { applications: { settings: { CompendiumBrowserSettingsConfig } } } : {};
}

afterEach(() => { delete globalThis.game; delete globalThis.dnd5e; });

describe("getEnabledPacks", () => {
  it("on dnd5e 6.1, drops packs for the other rules edition by default", () => {
    install();
    expect([...getEnabledPacks()].sort()).toEqual(["dnd5e.classes24", "world.homebrew"]);
  });

  it("on dnd5e 6.1, keeps an other-edition pack the GM switched on", () => {
    install({ setting: { "dnd5e.classes": true } });
    expect(getEnabledPacks()).toBeNull();   // nothing excluded: don't filter
  });

  it("on dnd5e 6.1, follows a 2014 world the other way round", () => {
    install({ rules: "legacy" });
    expect([...getEnabledPacks()].sort()).toEqual(["dnd5e.classes", "world.homebrew"]);
  });

  it("before 6.1, excludes only what the setting switches off", () => {
    install({ withIsSourceEnabled: false });
    expect(getEnabledPacks()).toBeNull();
    install({ withIsSourceEnabled: false, setting: { "dnd5e.classes24": false } });
    expect([...getEnabledPacks()].sort()).toEqual(["dnd5e.classes", "world.homebrew"]);
  });
});
