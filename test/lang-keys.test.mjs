import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every translation key the module asks for exists in `lang/en.json`. A missing key doesn't throw
 * in Foundry; it shows the raw key string to the player, which is easy to miss in review and
 * obvious on screen. This reads the literal keys out of the scripts (`t("…")`) and the templates
 * (`sogrom-dnd5e-character-creator.…`), plus the few built at runtime from a fixed set of words.
 */

const MODULE = "sogrom-dnd5e-character-creator";
const lang = JSON.parse(readFileSync("lang/en.json", "utf8"))[MODULE];
const has = key => key.split(".").reduce((node, part) => node?.[part], lang) !== undefined;

/** Every file under a directory, recursively. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe("lang/en.json", () => {
  it("has every key the scripts use literally", () => {
    const missing = [];
    for ( const file of walk("scripts") ) {
      for ( const [, key] of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g) ) {
        if ( !has(key) ) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has every key the templates use", () => {
    const missing = [];
    const pattern = new RegExp(`${MODULE}\\.([\\w.]+)`, "g");
    for ( const file of walk("templates") ) {
      for ( const [, key] of readFileSync(file, "utf8").matchAll(pattern) ) {
        if ( !has(key) ) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has the spellbook flag words and their tooltips, which are built at runtime", () => {
    const flags = ["flagPrepared", "flagBook", "flagAlways", "flagNew"];
    const keys = [
      ...flags.flatMap(f => [`levelup.step.spells.${f}`, `levelup.step.spells.${f}Tip`]),
      ...["flagPrepared", "flagBook"].flatMap(f => [`step.spells.${f}`, `step.spells.${f}Tip`])
    ];
    expect(keys.filter(k => !has(k))).toEqual([]);
  });
});
