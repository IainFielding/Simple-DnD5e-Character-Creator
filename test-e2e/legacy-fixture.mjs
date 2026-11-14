/**
 * Build a "before" content fixture for the Update to New Content suite from an old copy of a content
 * package, so a character can be built from the old version in a world where the new one is installed.
 *
 *   node legacy-fixture.mjs <package dir> <pack> [<pack> …]
 *   node legacy-fixture.mjs H:/Code/DO-NOT-USE/dnd-players-handbook classes feats origins spells equipment
 *   node legacy-fixture.mjs H:/Code/dnd5e-release-6.0.0 classes24 origins24 feats24 spells24 equipment24 \
 *     classes subclasses classfeatures races backgrounds spells items
 *
 * The package is a module (`module.json`) or a system (`system.json`). Each pack is read from its
 * source YAML when the package has it (`packs/_source/<pack>/**.yml`, as a system's source tree does),
 * and otherwise from its compiled LevelDB pack (`packs/<pack>`), unpacked with the Foundry CLI.
 *
 * Two versions of one package cannot be installed side by side, so the old one is loaded as world
 * compendia instead (`world.legacy-<package>-<pack>`). Every uuid that points into the package
 * (`Compendium.<package>.<pack>.…`) is rewritten to the matching world pack, so the old class's grants
 * and pools resolve to the old features rather than the installed new ones. The in-world suite imports
 * the result and, once a character has been built from it, rewrites the uuids back — which is exactly
 * what a character built before the update looks like.
 *
 * Writes `fixtures/legacy-<package>.json`. The folder is gitignored: it holds pack content, and paid
 * content must never reach this public repository.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";

const [dir, ...packs] = process.argv.slice(2);
if ( !dir || !packs.length ) {
  console.error("usage: node legacy-fixture.mjs <package dir> <pack> [<pack> …]");
  process.exit(2);
}

const manifestFile = ["module.json", "system.json"].map(f => join(dir, f)).find(existsSync);
if ( !manifestFile ) {
  console.error(`${dir} has neither a module.json nor a system.json`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const pkg = manifest.id ?? basename(dir);
const worldPack = pack => `legacy-${pkg}-${pack}`;
const work = join(tmpdir(), `legacy-fixture-${pkg}-${Date.now()}`);
mkdirSync(work, { recursive: true });

/** Every file under a directory. */
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/** A pack's documents from its source YAML, one document per file, as the Foundry CLI compiles them. */
function fromSource(src) {
  return walk(src).filter(f => /\.ya?ml$/.test(f)).map(f => yaml.load(readFileSync(f, "utf8")));
}

/** A pack's documents from its compiled LevelDB, unpacked to JSON with the Foundry CLI. */
function fromLevelDb(pack) {
  const stage = join(work, "stage");
  const unpacked = join(work, "out", pack);
  mkdirSync(join(stage, pack), { recursive: true });
  mkdirSync(unpacked, { recursive: true });
  // Copy rather than read in place: a LevelDB LOCK file may be held, and the CLI wants the parent dir.
  for ( const f of readdirSync(join(dir, "packs", pack)) ) {
    if ( f === "LOCK" ) continue;
    const src = join(dir, "packs", pack, f);
    if ( statSync(src).isFile() ) copyFileSync(src, join(stage, pack, f));
  }
  execFileSync("fvtt", ["package", "unpack", "-n", pack, "--in", stage, "--out", unpacked],
    { stdio: "inherit", shell: true });
  return walk(unpacked).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(f, "utf8")));
}

const out = { package: pkg, version: manifest.version, packs: {} };
for ( const pack of packs ) {
  const meta = (manifest.packs ?? []).find(p => p.name === pack);
  if ( !meta ) {
    console.error(`${pkg} ${manifest.version} declares no pack "${pack}"`);
    process.exit(2);
  }
  const src = join(dir, "packs", "_source", pack);
  const documents = existsSync(src) ? fromSource(src) : fromLevelDb(pack);
  out.packs[pack] = {
    name: worldPack(pack), label: `Legacy ${manifest.title ?? pkg} ${manifest.version}: ${meta.label ?? pack}`,
    type: meta.type ?? "Item",
    // The pack's own flags: dnd5e reads `flags.dnd5e.sourceBook` to fill in an item's `source.book`,
    // so a world copy without it would make every item look changed.
    flags: meta.flags ?? {},
    documents
  };
}

// Point every in-package uuid at its world copy.
let text = JSON.stringify(out);
for ( const pack of packs ) {
  text = text.split(`Compendium.${pkg}.${pack}.`).join(`Compendium.world.${worldPack(pack)}.`);
}
mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
const file = new URL(`./fixtures/legacy-${pkg}.json`, import.meta.url);
writeFileSync(file, text);
rmSync(work, { recursive: true, force: true });
const counts = Object.entries(out.packs).map(([k, v]) => `${k} ${v.documents.length}`).join(", ");
console.log(`${pkg} ${manifest.version}: ${counts} → ${file.pathname}`);
