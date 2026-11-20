/**
 * Probe: every spell on the newest Hunter and Paladin characters in the playwright world, with what
 * granted it — to see why a granted spell and a chosen copy were not merged.
 *
 *   node probe-dupes.mjs
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
try {
  session = await Session.open();
  const out = await session.eval(async () => {
    const res = {};
    for ( const cls of ["Hunter", "Paladin"] ) {
      const a = game.actors.filter(x => x.items.some(i => i.type === "class" && i.name === cls && i.system.levels >= 5)).sort((p, q) => (p._stats.createdTime ?? 0) - (q._stats.createdTime ?? 0)).at(-1);
      if ( !a ) continue;
      res[cls] = a.items.filter(i => i.type === "spell" && ["Hunter's Mark", "Cure Wounds"].includes(i.name)).map(i => ({
        name: i.name, id: i.id, ident: i.system.identifier, level: i.system.level, prepared: i.system.prepared,
        method: i.system.method, sourceItem: i.system.sourceItem, origin: i.flags?.dnd5e?.advancementOrigin ?? null,
        cachedFor: i.flags?.dnd5e?.cachedFor ?? null, ability: i.system.ability, alsoChosen: i.flags?.['sogrom-dnd5e-character-creator']?.alsoChosen ?? null,
        src: i._stats?.compendiumSource, flags: Object.keys(i.flags ?? {})
      }));
      res[cls + "_owners"] = a.items.filter(i => res[cls].some(s => s.origin?.startsWith(i.id))).map(i => i.name);
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await session?.close?.();
  await server.stop();
}
