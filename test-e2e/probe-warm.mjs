/**
 * Temporary probe: where does the creator's warm-up spend its time? Times the pregen load and the
 * source-journal scan in isolation (current code vs a batched read), and records every getIndex
 * call with its caller during a re-warm.
 */
import { writeFileSync } from "node:fs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

const worldId = "playwright";
ensureWorld(worldId);
const server = await startFoundry(worldId);
let session;
try {
  session = await Session.open({ canvas: false });
  const out = await session.eval(async () => {
    const M = "/modules/sogrom-dnd5e-character-creator/scripts";
    const cache = await import(`${M}/data/source-cache.mjs`);
    const pre = await import(`${M}/data/premades.mjs`);
    const journal = await import(`${M}/data/journal-source.mjs`);
    const util = await import(`${M}/data/compendium-util.mjs`);
    const res = {};
    const time = async (label, fn) => { const t = performance.now(); const r = await fn(); res[label] = Math.round(performance.now() - t); return r; };

    await time("firstWarm(await)", () => cache.warmSources());
    res.firstWarmPhases = cache.warmStatus().phases.map(p => `${p.name} ${p.ms}ms`);

    // Pregens: current code, then one batched read per pack.
    pre.invalidatePregenCache();
    const groups = await time("pregens.current", () => pre.foundryPregens());
    res.pregenCount = groups.map(g => `${g.pack}:${g.entries.length}`);
    await time("pregens.batched", () => Promise.all(pre.PREGEN_SOURCES.map(async s => {
      const pack = game.packs.get(s.pack); if ( !pack ) return [];
      const idx = await util.packIndex(pack);
      const ids = [...idx].filter(e => (!s.idHint || s.idHint.test(e._id)) && (!e.type || e.type === "character")).map(e => e._id);
      return pack.getDocuments({ _id__in: ids });
    })));

    // Journal scan: current (sequential, one getDocument per entry), then parallel + batched.
    journal.invalidateJournalIndex();
    await time("journal.current", () => journal.sourcePageFor({ uuid: "x" }));
    const jpacks = game.packs.filter(p => p.documentName === "JournalEntry" && (!p.metadata.system || p.metadata.system === "dnd5e"));
    res.journalPacks = jpacks.length;
    let pages = 0;
    await time("journal.batched", () => Promise.all(jpacks.map(async pack => {
      const idx = await util.packIndex(pack);
      const ids = [...idx].filter(e => Array.isArray(e.pages) && e.pages.some(p => p.type === "class" || p.type === "subclass")).map(e => e._id);
      if ( !ids.length ) return;
      const docs = await pack.getDocuments({ _id__in: ids });
      for ( const d of docs ) for ( const p of d.pages ) if ( p.type === "class" || p.type === "subclass" ) pages++;
    })));
    res.journalPagesBatched = pages;

    // Re-warm with every getIndex call recorded against its caller.
    const calls = [];
    const orig = foundry.documents.collections.CompendiumCollection.prototype.getIndex;
    foundry.documents.collections.CompendiumCollection.prototype.getIndex = function(opts) {
      const stack = (new Error().stack ?? "").split("\n").slice(2, 7)
        .map(l => l.trim().replace(/https?:\/\/[^/]+\//, "").replace(/\?[^:]*/, "")).join(" < ");
      calls.push({ pack: this.collection, fields: (opts?.fields ?? []).length, stack });
      return orig.call(this, opts);
    };
    cache.invalidateSources();
    await time("rewarm", () => cache.warmSources());
    res.rewarmPhases = cache.warmStatus().phases.map(p => `${p.name} ${p.ms}ms`);
    foundry.documents.collections.CompendiumCollection.prototype.getIndex = orig;
    const byPack = {};
    for ( const c of calls ) (byPack[c.pack] ??= []).push(c);
    res.getIndexCalls = calls.length;
    res.multiCallPacks = Object.fromEntries(Object.entries(byPack).filter(([, v]) => v.length > 1)
      .map(([k, v]) => [k, v.map(c => `${c.fields}f ${c.stack}`)]));
    return res;
  });
  writeFileSync(new URL("./probe-warm.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  if ( session ) await session.close();
  await server.stop();
}
process.exit(0);
