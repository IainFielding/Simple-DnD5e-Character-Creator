/**
 * Probe: names rolled for a World of Warcraft lineage, through the real threshold, Quick Build and
 * Details step — and the lineage the threshold settles is the one the built character gets.
 *
 *   node probe-lineage-names.mjs <outdir>
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
let report = {};
try {
  session = await Session.open();
  await session.page.setViewportSize({ width: 1600, height: 1000 });
  const ev = (fn, arg) => session.eval(fn, arg);

  report = await ev(async () => {
    const M = "/modules/sogrom-dnd5e-character-creator/scripts";
    const v = `?v=${Date.now()}`;
    const shots = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs${v}`);
    const th = await import(`${M}/app/threshold.mjs`);
    const { chosenLineage } = await import(`${M}/data/lineage-name.mjs`);
    const { NAME_STYLES } = await import(`${M}/data/name-data.mjs`);
    const { applyQuickBuild } = await import(`${M}/data/quick-build.mjs`);
    const { getSources } = await import(`${M}/data/source-cache.mjs`);
    const pause = ms => new Promise(r => setTimeout(r, ms));

    // Which styles a rolled name could have come from (given name + surname, where it has one).
    const stylesOf = name => {
      const [given, ...rest] = String(name).split(" ");
      const surname = rest.join(" ");
      return Object.entries(NAME_STYLES).filter(([, s]) =>
        [...s.male, ...s.female].includes(given) && (!surname || s.surnames.includes(surname))
      ).map(([k]) => k);
    };
    const EXPECT = {
      "Blood Elf": "blood-elf", "Void Elf": "void-elf", "Night Elf": "night-elf", Nightborne: "nightborne",
      "Zandalari Troll": "zandalari-troll", "Amani Troll": "amani-troll", "Darkspear Troll": "troll",
      "Highmountain Tauren": "highmountain-tauren", "Mulgore Tauren": "tauren", Taunka: "taunka",
      Krokul: "krokul", Draenei: "draenei", Lightforged: "draenei", "Mar'ari": "draenei"
    };

    await shots.openCreator();
    await shots.entryPath("quick");
    await pause(1500);
    const app = [...foundry.applications.instances.values()].find(a =>
      a.element?.classList?.contains("sogrom-creator") || a.element?.querySelector?.(".creator-stage"));
    const ctx = app._ctx();
    const { state } = ctx;
    const { source } = getSources();
    const species = name => source.species().filter(c => c.name === name);
    const r = { threshold: [], quick: [], details: [], build: null, errors: [] };

    // 1. Threshold: select each species many times; the lineage it settles must style the name.
    const targets = [
      ...species("Elf"), ...species("Troll"), ...species("Tauren"), ...species("Draenei")
    ];
    r.speciesFound = targets.map(c => `${c.name} ${c.uuid}`);
    for ( const card of targets ) {
      for ( let i = 0; i < 16; i++ ) {
        await th.thresholdSelect(ctx, "species", card.uuid);
        th.thresholdRollName(ctx);
        const lin = chosenLineage(state);
        const tc = await th.thresholdContext(ctx);
        const shown = tc.cards.find(c => c.category === "species")?.name;
        const name = state.details.name;
        const styles = stylesOf(name);
        const want = EXPECT[lin?.label] ?? null;
        r.threshold.push({ species: card.name, lineage: lin?.label ?? null, shown, name, styles,
          ok: want ? styles.includes(want) : true });
      }
    }

    // 2. Quick Build (the class-step button's path): no lineage pinned; the fill picks it, the name follows.
    state.classUuid = source.classes().find(c => c.name === "Fighter")?.uuid;
    for ( const card of targets ) {
      const res = await applyQuickBuild(ctx, { speciesUuid: card.uuid, rng: Math.random });
      const lin = chosenLineage(state);
      const styles = stylesOf(state.details.name);
      const want = EXPECT[lin?.label] ?? null;
      r.quick.push({ species: card.name, ok: res.ok, lineage: lin?.label ?? null, name: state.details.name, styles,
        styleOk: want ? styles.includes(want) : true });
    }

    // 3. Details step: the real roll button, with the lineage the fill left.
    await shots.goto("details");
    await pause(800);
    for ( let i = 0; i < 6; i++ ) {
      document.querySelector('[data-step-action="generateName"]')?.click();
      await pause(150);
      const lin = chosenLineage(state);
      const styles = stylesOf(state.details.name);
      r.details.push({ lineage: lin?.label ?? null, name: state.details.name, styles,
        ok: EXPECT[lin?.label] ? styles.includes(EXPECT[lin?.label]) : true });
    }

    // 4. Threshold → create → build: the threshold's lineage is the built one, the name is kept.
    const troll = species("Troll")[0];
    state.details.name = "";
    await th.thresholdSelect(ctx, "species", troll.uuid);
    th.thresholdRollName(ctx);
    const before = { lineage: chosenLineage(state)?.label, name: state.details.name };
    const ok = await th.thresholdCreate(ctx);
    const after = { lineage: chosenLineage(state)?.label, name: state.details.name };
    let actorSpecies = null;
    try {
      const actor = await fromUuid(await shots.buildActor());
      actorSpecies = actor?.items.find(i => i.type === "race")?.name ?? null;
      r.actorName = actor?.name ?? null;
      if ( actor ) await actor.delete();
    } catch ( err ) { r.errors.push(`build: ${err.message}`); }
    r.build = { ok, before, after, actorSpecies };
    return r;
  });
} catch ( err ) {
  report.fatal = String(err?.stack ?? err);
} finally {
  writeFileSync(join(out, "lineage-names.json"), JSON.stringify(report, null, 2));
  await session?.close?.();
  await server.stop();
}
console.log(JSON.stringify(report, null, 1).slice(0, 200));
