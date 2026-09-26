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
