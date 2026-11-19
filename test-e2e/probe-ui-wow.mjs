/**
 * Probe: the World of Warcraft hero-class pick and the per-lineage species cards, through the real
 * creator UI — clicks, not state writes. Screenshots go to the directory given (default: cwd).
 *
 *   node probe-ui-wow.mjs <outdir>
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
const report = {};
try {
  session = await Session.open();
  await session.page.setViewportSize({ width: 1600, height: 1000 });
  const ev = (fn, arg) => session.eval(fn, arg);
  const shot = name => session.page.screenshot({ path: join(out, `${name}.png`) });
  const settle = () => new Promise(r => setTimeout(r, 1500));

  await ev(async () => {
    globalThis.__shots = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs?v=${Date.now()}`);
    await game.settings.set("sogrom-dnd5e-character-creator", "heroClassDisplay", "detail");
    await globalThis.__shots.openCreator();
    await globalThis.__shots.entryPath("custom");
    await globalThis.__shots.goto("class");
    await globalThis.__shots.picker(true);
  });
  await settle();

  // Pick the PHB Paladin card by clicking it.
  report.paladinCards = await ev(() => [...document.querySelectorAll('.creator-pickrow[data-name="Paladin"]')].length);
  await session.page.locator('.creator-pickrow[data-name="Paladin"]').first().click();
  await settle();
  await ev(() => globalThis.__shots.picker(false));
  await settle();
  report.playAs = await ev(() => [...document.querySelectorAll(".creator-hero-class .creator-choice-card-name")].map(e => e.textContent.trim()));
  await shot("1-class-paladin-play-as");

  await session.page.locator('.creator-hero-class [data-hero="death-knight"]').click();
  await settle();
  report.afterHero = await ev(() => ({
    title: document.querySelector(".creator-detail-head h2")?.textContent.trim(),
    grants: [...document.querySelectorAll(".creator-grant .content-link")].map(a => a.textContent.trim()).slice(0, 12),
    dossierClass: document.querySelector(".creator-dossier")?.textContent.match(/Death Knight/)?.[0] ?? null
  }));
  await shot("2-class-death-knight");

  // Cards mode: the hero classes as cards of their own.
  await ev(async () => {
    await game.settings.set("sogrom-dnd5e-character-creator", "heroClassDisplay", "cards");
    await globalThis.__shots.picker(true);
  });
  await settle();
  report.heroCards = await ev(() => [...document.querySelectorAll(".creator-pickrow[data-hero-class]")].map(b => b.dataset.name));
  await shot("3-class-grid-hero-cards");
  await ev(() => game.settings.set("sogrom-dnd5e-character-creator", "heroClassDisplay", "detail"));

  // Species: Quick Build fills the rest so the step is reachable, then the lineage cards.
  await ev(async () => {
    await globalThis.__shots.quickBuild({ seed: 7, goTo: "species" });
    await globalThis.__shots.picker(true);
  });
  await settle();
  report.elfCards = await ev(() => [...document.querySelectorAll(".creator-pickrow[data-lineage-key]")]
    .map(b => b.dataset.name).filter(n => /^Elf|^Dragonborn|^Draenei/.test(n)));
  await shot("4-species-grid");
  await session.page.locator('.creator-pickrow[data-name="Elf (Blood Elf)"]').first().click();
  await settle();
  await ev(() => globalThis.__shots.picker(false));
  await settle();
  report.afterLineage = await ev(() => ({
    title: document.querySelector(".creator-detail-head h2")?.textContent.trim(),
    lineageDetail: document.querySelector(".creator-lineage-detail h3")?.textContent.trim() ?? null,
    lineagePanel: !!document.querySelector(".creator-origin-lineage"),
    railSpecies: [...document.querySelectorAll(".creator-dossier *")].map(e => e.textContent).find(t => /Blood Elf/.test(t ?? ""))?.trim().slice(0, 60) ?? null
  }));
  await shot("5-species-blood-elf");
  console.log(JSON.stringify(report, null, 1));
} finally {
  await session?.close?.();
  await server.stop();
}
