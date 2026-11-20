/**
 * Probe: do a World of Warcraft specialization's spells get their "Recommended" badge on the Spells
 * page? Builds Ranger → Hunter → Marksmanship in the real creator, opens the Spells step, and reports
 * the book's spell links beside the rows the pool offers. Screenshots go to the directory given.
 *
 *   node probe-spec-spells.mjs <outdir> [tag]
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? ".";
const tag = process.argv[3] ?? "before";
mkdirSync(out, { recursive: true });
ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
const report = {};
try {
  session = await Session.open();
  await session.page.setViewportSize({ width: 1600, height: 1000 });
  const ev = (fn, arg) => session.eval(fn, arg);
  const settle = () => new Promise(r => setTimeout(r, 1500));
  const pick = async (selector, value) => { await session.page.locator(selector).first().selectOption(value); await settle(); };

  await ev(async () => {
    globalThis.__shots = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs?v=${Date.now()}`);
    await game.settings.set("sogrom-dnd5e-character-creator", "heroClassDisplay", "detail");
    await globalThis.__shots.openCreator();
    await globalThis.__shots.entryPath("custom");
    await globalThis.__shots.goto("class");
    await globalThis.__shots.choose({ class: "Ranger" });
    await globalThis.__shots.picker(false);
  });
  await settle();
  await session.page.locator(".creator-hero-class summary").first().click();
  await session.page.locator('.creator-hero-class [data-hero="hunter"]').first().click();
  await settle();
  await pick('.creator-specialization select', "marksmanship");
  await session.page.screenshot({ path: join(out, `mm-1-class-${tag}.png`) });

  report.book = await ev(async () => {
    const m = await import(`/modules/sogrom-dnd5e-character-creator/scripts/data/specializations.mjs?v=${Date.now()}`);
    const spec = await m.findSpecialization("ranger", "hunter", "marksmanship");
    const rows = [];
    // The book's spell picks, from the specialization's `refs`.
    for ( const r of (spec?.refs ?? []).filter(x => x.type === "spell") ) {
      const d = await fromUuid(r.uuid);
      rows.push(`${r.name} L${d?.system?.level} ${r.identifier ?? "-"} ${r.uuid}`);
    }
    return rows;
  });

  // The Spells step opens once the class step is complete; Quick Build fills it (and picks spells).
  report.state = await ev(async () => {
    await globalThis.__shots.quickBuild({ seed: 7, goTo: "spells" });
    const s = globalThis.__shots.shellState?.() ?? null;
    return s;
  });
  await settle();
  report.rows = await ev(() => [...document.querySelectorAll(".creator-spellrow")]
    .map(e => `${e.dataset.name}${e.classList.contains("is-recommended") ? " [REC]" : ""}${e.classList.contains("is-selected") ? " [picked]" : ""} ${e.dataset.uuid}`));
  report.badges = await ev(() => [...document.querySelectorAll(".creator-pickrow-rec")].map(b => `${b.closest("[data-uuid]")?.dataset.name}: ${b.dataset.tooltip}`));
  await session.page.screenshot({ path: join(out, `mm-2-spells-${tag}.png`) });
  console.log(JSON.stringify(report, null, 1));
} finally {
  await session?.close?.();
  await server.stop();
}
