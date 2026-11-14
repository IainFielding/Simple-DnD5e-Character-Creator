/**
 * Build a "before" content fixture for the Update to New Content suite from an old copy of a content
 * package, so a character can be built from the old version in a world where the new one is installed.
 *
 *   node legacy-fixture.mjs <package dir> <pack> [<pack> …]
 *   node legacy-fixture.mjs H:/Code/DO-NOT-USE/dnd-players-handbook classes feats origins spells equipment
 *
 * Two versions of one package cannot be installed side by side, so the old one is loaded as world
 * compendia instead (`world.legacy-<package>-<pack>`). Each pack is unpacked with the Foundry CLI, and
 * every uuid that points into the package (`Compendium.<package>.<pack>.…`) is rewritten to the
 * matching world pack, so the old class's grants and pools resolve to the old features rather than the
 * installed new ones. The in-world suite imports the result and, once a character has been built from
 * it, rewrites the uuids back — which is exactly what a character built before the update looks like.
 *
 * Writes `fixtures/legacy-<package>.json`. The folder is gitignored: it holds pack content, and paid
 * content must never reach this public repository.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const [dir, ...packs] = process.argv.slice(2);
if ( !dir || !packs.length ) {
  console.error("usage: node legacy-fixture.mjs <package dir> <pack> [<pack> …]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(dir, "module.json"), "utf8"));
const pkg = manifest.id ?? basename(dir);
const worldPack = pack => `legacy-${pkg}-${pack}`;
const work = join(tmpdir(), `legacy-fixture-${pkg}-${Date.now()}`);
mkdirSync(work, { recursive: true });

/** Every file under a directory. */
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const out = { package: pkg, version: manifest.version, packs: {} };
for ( const pack of packs ) {
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
  const meta = (manifest.packs ?? []).find(p => p.name === pack) ?? {};
  out.packs[pack] = {
    name: worldPack(pack), label: `Legacy ${manifest.title ?? pkg} ${manifest.version}: ${meta.label ?? pack}`,
    type: meta.type ?? "Item",
    documents: walk(unpacked).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(f, "utf8")))
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
