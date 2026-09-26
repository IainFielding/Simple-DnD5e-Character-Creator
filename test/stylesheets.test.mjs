import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The creator's stylesheet is cut into numbered files under `styles/creator/`, and module.json
 * loads them in number order — which is the cascade order. A file that exists but isn't listed is
 * simply never loaded, and nothing on screen says why; a list out of number order silently changes
 * which of two equal-specificity rules wins.
 */
describe("module.json styles", () => {
  const listed = JSON.parse(readFileSync("module.json", "utf8")).styles;
  const onDisk = readdirSync("styles/creator").filter(f => f.endsWith(".css")).sort()
    .map(f => `styles/creator/${f}`);

  it("lists every creator stylesheet, in number order", () => {
    expect(listed.filter(f => f.startsWith("styles/creator/"))).toEqual(onDisk);
  });

  it("loads the fonts first and the Ember skin last", () => {
    expect(listed[0]).toBe("styles/fonts.css");
    expect(listed.at(-1)).toBe("styles/ember-skin.css");
  });
});

/**
 * A relative `url()` resolves against the stylesheet's own served path, so moving a file a
 * directory deeper silently breaks every `../` in it. Splitting creator.css into `styles/creator/`
 * did exactly that to the dnd5e ampersand: `../../../systems/…` began resolving to
 * `/modules/systems/…` and 404'd, which no e2e run notices because a missing background paints
 * nothing. Each relative url must land in this module's folder, the system's, or another module's.
 */
describe("stylesheet urls", () => {
  const listed = JSON.parse(readFileSync("module.json", "utf8")).styles;
  const base = "http://host/modules/sogrom-dnd5e-character-creator/";

  it.each(listed)("%s resolves every relative url inside the Data folder", file => {
    const css = readFileSync(file, "utf8");
    const bad = [];
    for ( const [, raw] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g) ) {
      if ( /^(data:|https?:|\/|#)/.test(raw) ) continue;
      const path = new URL(raw, base + file).pathname;
      const own = path.startsWith("/modules/sogrom-dnd5e-character-creator/");
      const system = path.startsWith("/systems/");
      const other = /^\/modules\/(?!systems\/|modules\/)[^/]+\/./.test(path);
      if ( !own && !system && !other ) bad.push(`${raw} → ${path}`);
    }
    expect(bad).toEqual([]);
  });
});
