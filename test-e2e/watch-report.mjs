/**
 * Keep `sweep-report.html` current while a sweep is running.
 *
 *   node watch-report.mjs                 # every 30s, expecting 122 scenarios
 *   node watch-report.mjs --expect 15 --every 15
 *
 * A sweep streams each result into `sweep-results.jsonl` as it lands, so a report built mid-run is
 * simply a report of what has finished so far. This re-runs `report.mjs` on a timer and stops once
 * the expected count is reached; the page it writes carries its own 30-second meta-refresh while
 * incomplete, so an open browser tab follows along without anything else running.
 *
 * A separate script rather than a `--watch` flag inside `report.mjs`, because that file computes its
 * whole report at module top level — re-running it as a child process is honest about what "refresh"
 * means here and keeps the report itself a single-shot transform.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const expect = Number(value("expect", 122));
const every = Number(value("every", 30)) * 1000;
const results = new URL("./sweep-results.jsonl", import.meta.url);
const report = new URL("./report.mjs", import.meta.url);

const count = () => existsSync(results)
  ? readFileSync(results, "utf8").split("\n").filter(Boolean).length
  : 0;

console.log(`watching sweep-results.jsonl → sweep-report.html every ${every / 1000}s `
  + `(expecting ${expect})\nopen test-e2e/sweep-report.html — it refreshes itself\n`);

let last = -1;
for (;;) {
  const n = count();
  if ( n !== last ) {
    // Quiet: the report's own terminal summary would repeat the whole cause ranking every tick.
    const r = spawnSync(process.execPath, [report.pathname, "--expect", String(expect)],
      { stdio: ["ignore", "ignore", "inherit"] });
    if ( r.status !== 0 ) console.error(`report.mjs exited ${r.status}`);
    const done = n >= expect;
    console.log(`  ${new Date().toTimeString().slice(0, 8)}  ${n}/${expect} recorded`
      + `${done ? " — complete" : ""}`);
    last = n;
    if ( done ) break;
  }
  await new Promise(r => setTimeout(r, every));
}

console.log("\nsweep complete — sweep-report.html is final (auto-refresh off)");
