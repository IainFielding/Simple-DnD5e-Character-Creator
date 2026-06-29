// Vendors Cinzel + Spectral (latin + latin-ext) from Google Fonts into ../fonts
// and regenerates ../styles/fonts.css. Run from the repo root: node tools/fetch-fonts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = path.join(root, 'fonts');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' };
const GF = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Spectral:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap';

fs.mkdirSync(fontsDir, { recursive: true });
const css = await (await fetch(GF, { headers: UA })).text();

const parts = css.split(/\/\*\s*([\w-]+)\s*\*\//);
const entries = [];
for (let i = 1; i < parts.length - 1; i += 2) {
  const subset = parts[i].trim();
  const body = parts[i + 1];
  if (subset !== 'latin' && subset !== 'latin-ext') continue;
  entries.push({
    subset,
    fam: body.match(/font-family:\s*'([^']+)'/)[1],
    style: body.match(/font-style:\s*(\w+)/)[1],
    weight: body.match(/font-weight:\s*(\d+)/)[1],
    url: body.match(/src:\s*url\(([^)]+)\)/)[1],
    urange: body.match(/unicode-range:\s*([^;]+);/)[1].trim(),
  });
}

const fname = (e) => {
  const sub = e.subset === 'latin-ext' ? 'latinext' : 'latin';
  if (e.fam.toLowerCase() === 'cinzel') return `cinzel-${sub}.woff2`;
  return `spectral-${e.weight}-${e.style === 'italic' ? 'italic' : 'normal'}-${sub}.woff2`;
};

const done = new Set();
for (const e of entries) {
  e.file = fname(e);
  if (done.has(e.url)) continue;
  done.add(e.url);
  const p = path.join(fontsDir, e.file);
  if (!fs.existsSync(p)) {
    const res = await fetch(e.url, { headers: UA });
    if (!res.ok) throw new Error(`${res.status} for ${e.url}`);
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  console.log(`${e.file.padEnd(34)} ${String(fs.statSync(p).size).padStart(6)} bytes`);
}

const out = [
  "/* Self-hosted Cinzel + Spectral (latin + latin-ext subsets), vendored from",
  "   Google Fonts so the creator renders correctly offline / on a LAN with no",
  "   network round-trip or render-blocking @import. Cinzel ships as a single",
  "   variable file per subset (covers weights 500-700); Spectral is static, one",
  "   file per weight/style. To refresh, re-run tools/fetch-fonts.mjs. */",
  "",
];
const cinzelSeen = new Set();
for (const e of entries.filter(e => e.fam === 'Cinzel')) {
  if (cinzelSeen.has(e.file)) continue;
  cinzelSeen.add(e.file);
  out.push("@font-face {", "  font-family: 'Cinzel';", "  font-style: normal;",
    "  font-weight: 500 700;", "  font-display: swap;",
    `  src: url('../fonts/${e.file}') format('woff2');`,
    `  unicode-range: ${e.urange};`, "}");
}
for (const e of entries.filter(e => e.fam === 'Spectral')) {
  out.push("@font-face {", "  font-family: 'Spectral';", `  font-style: ${e.style};`,
    `  font-weight: ${e.weight};`, "  font-display: swap;",
    `  src: url('../fonts/${e.file}') format('woff2');`,
    `  unicode-range: ${e.urange};`, "}");
}
fs.writeFileSync(path.join(root, 'styles', 'fonts.css'), out.join("\n") + "\n");
console.log("\nWrote styles/fonts.css");
