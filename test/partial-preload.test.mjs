import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every partial a template includes by path is in main.mjs's preload list.
 *
 * Handlebars resolves `{{> "…/parts/x.hbs"}}` from its registry at render time, and a partial that
 * was never registered does not fail quietly: the window closes on render ("The partial … could not
 * be found"). The e2e harness drives the wizards headlessly and never renders a step, so it cannot
 * catch this; reading the text can. The level-up step templates themselves have their own check,
 * test/levelup-template-preload.test.mjs.
 */
const MODULE = "sogrom-dnd5e-character-creator";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe("partial preload", () => {
  const main = readFileSync("scripts/main.mjs", "utf8");
  const include = new RegExp(`\\{\\{>\\s*"modules/${MODULE}/templates/([^"]+)"`, "g");
  const included = [...new Set(walk("templates")
    .flatMap(file => [...readFileSync(file, "utf8").matchAll(include)].map(m => m[1])))].sort();

  it("finds the partials it is checking", () => {
    expect(included.length).toBeGreaterThan(10);
  });

  it.each(included)("%s is preloaded", partial => {
    expect(main).toContain(`tpl("${partial}")`);
  });
});
