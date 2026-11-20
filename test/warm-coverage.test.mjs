import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every session cache the creator reads is filled by the `ready` warm, so a step never builds one
 * behind a player's click.
 *
 * The rule this enforces: a cache that `invalidateSources()` clears must also be filled by
 * `warmSources()` — by a call into the same module — unless it is listed in {@link INDIRECT} with
 * the warm phase that fills it on another module's behalf. Adding a cache means adding both calls.
 *
 * It exists because the rule was broken once and shipped. The World of Warcraft specialization
 * index was given a reset in `invalidateSources()` but no warm, so the Class step built it (the
 * whole book plus every item it links) on the first class click: 2.3s in the harness world,
 * against under 0.1s once warmed. Unit tests and the e2e sweeps both passed, because neither times
 * a render; reading the text can catch it. The click itself is timed by
 * test-e2e/probe-class-click.mjs.
 */

/**
 * Modules whose cache is cleared but filled by a warm phase calling into *another* module.
 * Each entry names the phase, so a reviewer can check the claim still holds.
 */
const INDIRECT = {
  "./tool-source.mjs": "read by the choice resolver while the `choices` phase (warmChoices) runs",
  "./weapon-source.mjs": "read by the choice resolver while the `choices` phase (warmChoices) runs",
  "./warcraft.mjs": "readableDoc is called by the choice resolver during `choices`; hero-class copies are per-pick memos",
  "./source-index.mjs": "package types are ranked by source.load() in the `index` phase",
  "./compendium-util.mjs": "pack indexes are fetched by every phase, starting with `index`"
};

const SOURCE_CACHE = "scripts/data/source-cache.mjs";
const text = readFileSync(SOURCE_CACHE, "utf8");

/** The body of an exported function, by name: from its signature to the first closing brace at column 0. */
function body(name) {
  const start = text.indexOf(`export function ${name}(`);
  expect(start, `${name} not found in ${SOURCE_CACHE}`).toBeGreaterThan(-1);
  return text.slice(start, text.indexOf("\n}\n", start));
}

/** Imported name → the module it comes from. */
const importedFrom = new Map();
for ( const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g) ) {
  for ( const name of m[1].split(",").map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean) ) {
    importedFrom.set(name, m[2]);
  }
}

/** The modules whose imported functions a body calls. */
function modulesCalledIn(src) {
  const out = new Set();
  for ( const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g) ) {
    const mod = importedFrom.get(m[1]);
    if ( mod ) out.add(mod);
  }
  return out;
}

describe("warm coverage", () => {
  const cleared = [...modulesCalledIn(body("invalidateSources"))];
  const warmed = modulesCalledIn(body("warmSources"));

  it("finds the caches it is checking", () => {
    expect(cleared.length).toBeGreaterThan(8);
  });

  it.each(cleared)("%s is warmed, or warmed indirectly with a stated reason", mod => {
    expect(warmed.has(mod) || (mod in INDIRECT),
      `${mod} is cleared by invalidateSources() but nothing in warmSources() fills it. Warm it there `
      + "(see the bookPages phase), or add it to INDIRECT naming the phase that already does.").toBe(true);
  });

  it.each(Object.keys(INDIRECT))("INDIRECT entry %s is still a cleared cache", mod => {
    expect(cleared).toContain(mod);
  });
});

/**
 * Every module holding a build-once session index (the `let building = null` idiom) is cleared by
 * `invalidateSources()` — and so, by the check above, warmed.
 */
describe("build-once caches are registered", () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const cleared = new Set(modulesCalledIn(body("invalidateSources")));
  const lazy = walk("scripts/data")
    .filter(f => f.endsWith(".mjs") && /^let building\b/m.test(readFileSync(f, "utf8")))
    .map(f => `./${f.split(/[\\/]/).pop()}`);

  it("finds the caches it is checking", () => {
    expect(lazy.length).toBeGreaterThan(0);
  });

  it.each(lazy)("%s is cleared by invalidateSources()", mod => {
    expect(cleared.has(mod), `${mod} builds a session index but invalidateSources() never clears it`).toBe(true);
  });
});
