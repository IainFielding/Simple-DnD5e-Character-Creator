import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `lang/en.json` and the code agree, in both directions.
 *
 * Every key the module asks for exists: a missing key doesn't throw in Foundry, it shows the raw
 * key string to the player, which is easy to miss in review and obvious on screen. This reads the
 * literal keys out of the scripts (`t("…")`) and the templates (`sogrom-dnd5e-character-creator.…`),
 * plus the families built at runtime from a fixed set of words ({@link RUNTIME}).
 *
 * And every key in the file is still asked for: when a template block or a step is reworked, the
 * strings it used to show are left behind, and each one is a line a translator would still work on.
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

  it("has every key that is built at runtime", () => {
    const missing = RUNTIME.flatMap(({ keys }) => keys).filter(k => !has(k));
    expect(missing).toEqual([]);
  });

  it("still has the code that builds each runtime key family", () => {
    // Without this, deleting a builder would leave its keys excused below forever.
    const gone = RUNTIME.filter(({ file, builds }) => !readFileSync(file, "utf8").includes(builds))
      .map(({ file, builds }) => `${file}: ${builds}`);
    expect(gone).toEqual([]);
  });

  it("defines no key twice in the same block", () => {
    // JSON.parse keeps the last of two same-named keys without a word, so the first wording is
    // silently lost to whichever code expected it. Two features once each added a `grantedTip`
    // to the spells block, and one of them showed the other's text. The file is pretty-printed
    // with one key per line, so each open object's keys can be tracked by indentation alone.
    const lines = readFileSync("lang/en.json", "utf8").split(/\r?\n/);
    const stack = [{ path: "", keys: new Set() }];
    const dupes = [];
    for ( const line of lines ) {
      const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:\s*(.*)$/);
      if ( m ) {
        const top = stack.at(-1);
        const path = top.path ? `${top.path}.${m[1]}` : m[1];
        if ( top.keys.has(m[1]) ) dupes.push(path);
        top.keys.add(m[1]);
        if ( m[2].startsWith("{") && !m[2].includes("}") ) stack.push({ path, keys: new Set() });
      } else if ( /^\s*\}/.test(line) ) stack.pop();
    }
    expect(dupes).toEqual([]);
  });

  it("has no key that nothing uses", () => {
    // A key counts as used when its full path appears as a quoted string in a script, or with the
    // module prefix anywhere (templates, module.json, and the `${MODULE_ID}.…` window titles the
    // framework localizes itself). Keys assembled from parts can't be found that way, so they are
    // listed in RUNTIME instead.
    const sources = [...walk("scripts"), ...walk("templates"), "module.json"]
      .map(file => readFileSync(file, "utf8")).join("\n");
    const quoted = new Set([...sources.matchAll(/["'`]([\w.]+)["'`]/g)].map(([, s]) => s));
    const prefix = new RegExp(`(?:${MODULE}|\\$\\{MODULE_ID\\})\\.([\\w.]+)`, "g");
    const prefixed = new Set([...sources.matchAll(prefix)].map(([, s]) => s));
    const runtime = new Set(RUNTIME.flatMap(({ keys }) => keys));
    const unused = leafKeys(lang).filter(k => !quoted.has(k) && !prefixed.has(k) && !runtime.has(k));
    expect(unused).toEqual([]);
  });
});

/** Every leaf key under a lang node, as a dotted path. */
function leafKeys(node, prefix = "") {
  return Object.entries(node).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return (v && (typeof v === "object")) ? leafKeys(v, key) : [key];
  });
}

/** `prefix.word.suffix` for each word. */
const each = (prefix, words, suffix = "") => words.map(w => `${prefix}.${w}${suffix}`);

/**
 * The key families the code assembles from parts, each with the file and the verbatim snippet that
 * builds it. The words are spelled out rather than matched by pattern on purpose: a pattern such as
 * `step.details.placeholder.*` would also excuse a key whose field has been removed from the form.
 * When a builder gains or loses a word, update its list here.
 */
const RUNTIME = [
  { file: "scripts/data/class-guide.mjs", builds: "classGuide.role.${identifier}",
    keys: each("classGuide.role", ["artificer", "barbarian", "bard", "cleric", "druid", "fighter", "monk",
      "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]) },
  { file: "scripts/data/class-guide.mjs", builds: "classGuide.complexity.${entry.complexity}",
    keys: each("classGuide.complexity", ["low", "average", "high"]) },
  { file: "scripts/app/compare.mjs", builds: "compare.title.${category}",
    keys: each("compare.title", ["class", "species", "background", "subclass", "spell"]) },
  { file: "scripts/app/entry-chooser.mjs", builds: "entry.${p.id}.point${n}",
    keys: ["custom", "quick", "premade"].flatMap(id =>
      each(`entry.${id}`, ["tagline", "go", "point1", "point2", "point3"])) },
  { file: "scripts/app/house-rules.mjs", builds: "settings.allowMulticlass.${value}",
    keys: each("settings.allowMulticlass", ["off", "prereq", "free"]) },
  { file: "scripts/app/levelup-options.mjs", builds: "settings.levelUpHpMode.${hpLabel[v]}",
    keys: each("settings.levelUpHpMode", ["choice", "averageRoll", "average", "max"]) },
  { file: "scripts/app/levelup-options.mjs", builds: "settings.levelUpSummary.${v}",
    keys: each("settings.levelUpSummary", ["public", "gm", "off"]) },
  { file: "scripts/app/levelup-options.mjs", builds: "settings.levelUpReadyNotice.${v}",
    keys: each("settings.levelUpReadyNotice", ["public", "gm", "off"]) },
  { file: "scripts/data/choice-resolver.mjs", builds: "choice.blurb.${key}",
    keys: each("choice.blurb", ["weapon", "skills", "tool", "languages", "armor", "saves", "resist", "trait"]) },
  { file: "scripts/data/source-index.mjs", builds: "heading: head(`${ns}.traits`)",
    keys: ["class", "species", "background"].flatMap(ns => each(`step.${ns}`, ["traits", "features", "spells"])) },
  { file: "scripts/levelup/levelup-shell.mjs", builds: "\"levelup.emberCancel\" : \"levelup.cancel\"",
    keys: ["levelup.cancel", "levelup.emberCancel"].flatMap(k => each(k, ["title", "body"])) },
  { file: "scripts/levelup/steps/lvl-class-step.mjs", builds: "levelup.step.class.add.${",
    keys: each("levelup.step.class.add", ["first", "second", "third", "more"]) },
  { file: "scripts/levelup/steps/lvl-review-step.mjs", builds: "levelup.step.review.${kindKey}",
    keys: each("levelup.step.review", ["kindSpecies", "kindBackground"]) },
  { file: "scripts/levelup/steps/lvl-review-step.mjs", builds: "levelup.step.review.${tipKey}",
    keys: each("levelup.step.review", ["abilityTip", "abilityTipCreation"]) },
  { file: "scripts/levelup/steps/lvl-spells-step.mjs", builds: "levelup.step.spells.${prepared ? prepKey : known}",
    keys: each("levelup.step.spells", ["ownedTag", "ownedTagPrepared", "ownedTip", "ownedTipPrepared",
      "ownedNote", "ownedNotePrepared"]) },
  { file: "scripts/levelup/steps/lvl-spells-step.mjs", builds: "levelup.step.spells.${key}Tip",
    keys: ["flagPrepared", "flagBook", "flagAlways", "flagNew"]
      .flatMap(f => each("levelup.step.spells", [f, `${f}Tip`])) },
  { file: "scripts/steps/spells-step.mjs", builds: "step.spells.flagPreparedTip",
    keys: ["flagPrepared", "flagBook"].flatMap(f => each("step.spells", [f, `${f}Tip`])) },
  { file: "scripts/steps/details-step.mjs", builds: "step.details.field.${key}",
    keys: each("step.details.field", ["faith", "gender", "eyes", "hair", "skin", "height", "weight", "age",
      "trait", "ideals", "bonds", "flaws", "appearance", "biography"]) },
  { file: "scripts/steps/details-step.mjs", builds: "step.details.placeholder.${key}",
    keys: each("step.details.placeholder", ["faith", "gender", "eyes", "hair", "skin", "height", "weight", "age",
      "trait", "ideals", "bonds", "flaws", "appearance", "biography"]) },
  { file: "scripts/steps/details-step.mjs", builds: "step.details.nameGender.${key}",
    keys: each("step.details.nameGender", ["any", "male", "female"]) },
  { file: "scripts/steps/review-step.mjs", builds: "step.review.bonusFrom.${source}",
    keys: each("step.review.bonusFrom", ["species", "background"]) },
  { file: "scripts/steps/origin-abilities-panel.mjs", builds: "step.${source}.hintPoints",
    keys: ["species", "background"].map(s => `step.${s}.hintPoints`) },
  { file: "scripts/steps/origin-abilities-panel.mjs", builds: "step.originAbilities.fixed.${source}",
    keys: each("step.originAbilities.fixed", ["species", "background"]) },
  { file: "scripts/steps/origin-abilities-panel.mjs", builds: "step.originAbilities.locked.${source}",
    keys: each("step.originAbilities.locked", ["species", "background"]) }
];
