/**
 * Release check: the first class click, once the `ready` warm has finished, renders inside
 * {@link BUDGET_MS}. Exits 1 when it does not.
 *
 * Every lookup the Class step awaits should already be warm, so the click costs only a render
 * (~100ms). The World of Warcraft specializations work left its index unwarmed, and that click
 * took 2.3s. test/warm-coverage.test.mjs guards the code shape on every check-in; this times the
 * real thing. Runs in the `playwright` world, which has the World of Warcraft module enabled.
 *
 *   node probe-class-click.mjs
 *
 * (The "cold" Ranger click after clearing two caches is informational only: Foundry's own document
 * cache is warm by then, so it reads fast whatever the module does.)
 */
const BUDGET_MS = 750;
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
const report = {};
try {
  session = await Session.open();
  await session.page.setViewportSize({ width: 1600, height: 1000 });
  const ev = (fn, arg) => session.eval(fn, arg);

  // Wait for the ready warm to settle, and report its phases.
  report.warm = await ev(async () => {
    const M = "/modules/sogrom-dnd5e-character-creator/scripts";
    const { warmSources, warmStatus } = await import(`${M}/data/source-cache.mjs`);
    const t0 = Date.now();
    await warmSources();
    const s = warmStatus();
    return { awaitedMs: Date.now() - t0, totalMs: s?.elapsedMs,
      phases: s?.phases.map(p => `${p.name} ${p.ms}ms${p.error ? ` ERR ${p.error}` : ""}`) };
  });

  await ev(async () => {
    globalThis.__shots = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs?v=${Date.now()}`);
    await globalThis.__shots.openCreator();
    await globalThis.__shots.entryPath("custom");
    await globalThis.__shots.goto("class");
    await globalThis.__shots.picker(true);
  });

  const clickClass = async name => {
    await ev(() => globalThis.__shots.picker(true));
    await new Promise(r => setTimeout(r, 500));
    const t0 = Date.now();
    await session.page.locator(`.creator-pickrow[data-name="${name}"]`).first().click();
    await session.page.waitForFunction(n => [...document.querySelectorAll(".creator-detail-head h2")]
      .some(h => h.textContent.includes(n)), name, { timeout: 120_000 });
    return Date.now() - t0;
  };

  report.firstClickPaladinMs = await clickClass("Paladin");
  report.secondClickWizardMs = await clickClass("Wizard");

  // Simulate the old behaviour: drop the two caches this fix warms, then click a fresh class.
  await ev(async () => {
    const M = "/modules/sogrom-dnd5e-character-creator/scripts";
    (await import(`${M}/data/specializations.mjs`)).resetSpecializations();
    (await import(`${M}/data/art-cache.mjs`)).invalidateArtCache();
  });
  report.coldClickRangerMs = await clickClass("Ranger");
  report.specCount = await ev(async () => {
    const { specializationsFor } = await import("/modules/sogrom-dnd5e-character-creator/scripts/data/specializations.mjs");
    return (await specializationsFor("paladin")).map(s => s.name);
  });
  console.log(JSON.stringify(report, null, 1));
  const worst = Math.max(report.firstClickPaladinMs, report.secondClickWizardMs);
  if ( worst > BUDGET_MS ) {
    console.log(`FAILED: a class click took ${worst}ms after the warm (budget ${BUDGET_MS}ms) — something the Class step awaits is not warmed`);
    process.exitCode = 1;
  } else console.log(`PASSED: class clicks ${report.firstClickPaladinMs}ms / ${report.secondClickWizardMs}ms (budget ${BUDGET_MS}ms)`);
} finally {
  await session?.close?.();
  await server.stop();
}
