/**
 * Probe: build World of Warcraft hero classes both ways (kept) and dump what makes them heroes —
 * class name/img/flag, subclass, and which swapped features each side holds. The hero sweep only
 * says the two sides agree; this shows they agree on the *hero*, not on two plain classes.
 *
 *   node probe-hero.mjs [level]
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

const level = Number(process.argv[2] ?? 5);
ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
try {
  session = await Session.open();
  const out = await session.eval(async ({ level }) => {
    const h = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/harness.mjs?v=${Date.now()}`);
    globalThis.__keepActors = true;
    const want = ["hero:paladin/death-knight", "hero:ranger/demon-hunter", "hero:sorcerer/evoker", "hero:barbarian/shaman"];
    const rows = [];
    for ( const id of want ) {
      const r = await h.sweepOne({ id, level, incremental: true, keep: true, axis: "hero" });
      const actors = game.actors.filter(a => a.name.includes(r.name));
      const describe = a => {
        const cls = a.items.find(i => i.type === "class");
        return {
          side: a.name.includes("[native]") ? "native" : "creator",
          className: cls?.name, img: cls?.img, hero: cls?.flags?.["dnd-world-warcraft"]?.heroClass ?? null,
          suggested: cls?.system?.advancement ? Object.values(cls.toObject().system.advancement).find(x => x.type === "Subclass")?.configuration?.suggested : null,
          subclass: a.items.find(i => i.type === "subclass")?.name ?? null,
          features: a.items.filter(i => i.type === "feat").map(i => i.name).sort()
        };
      };
      rows.push({ id, ok: r.ok, differences: r.differences.length, sides: actors.map(describe) });
      await Actor.implementation.deleteDocuments(actors.map(a => a.id));
    }
    return rows;
  }, { level });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await session?.close?.();
  await server.stop();
}
