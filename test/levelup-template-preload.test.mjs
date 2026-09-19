import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every level-up step's template must be in `registerLevelUp`'s preload. The stage renders a step
 * through a dynamic Handlebars partial, and a partial that was never loaded does not fail quietly:
 * the whole level-up window closes on render ("The partial … could not be found").
 *
 * That has now happened twice — the Magic Items step when it moved out of the creator's list, and
 * the native-flow step (Potent Dragonmark) when it was added — and the e2e harness drives the wizard
 * headlessly, so it never renders a step and cannot catch it. Read as text so the check needs no
 * Foundry at all.
 */
describe("level-up template preload", () => {
  const root = new URL("../scripts/levelup/", import.meta.url);
  const intercept = readFileSync(new URL("intercept.mjs", root), "utf8");
  const stepsDir = new URL("steps/", root);
  const templates = readdirSync(stepsDir)
    .filter(f => f.endsWith(".mjs"))
    .flatMap(f => [...readFileSync(join(stepsDir.pathname.replace(/^\/([A-Za-z]:)/, "$1"), f), "utf8")
      .matchAll(/template:\s*"([^"]+)"/g)].map(m => ({ file: f, template: m[1] })));

  it("finds the step templates it is checking", () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  it.each(templates)("$file's $template is preloaded", ({ template }) => {
    expect(intercept).toContain(`tpl("${template}.hbs")`);
  });
});
