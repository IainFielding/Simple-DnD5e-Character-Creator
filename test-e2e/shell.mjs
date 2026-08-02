/**
 * Interactive/diagnostic entry point: bring a world up, join it, dump what the client sees, and
 * (with --hold) leave the browser open so you can poke at it.
 *
 *   node shell.mjs playwright
 *   node shell.mjs playwright --hold
 *   HEADED=1 node shell.mjs playwright --hold
 *   node shell.mjs playwright-ember --serve     # server only — join from your own browser
 */

import { setTimeout as sleep } from "node:timers/promises";
import { BASE_URL, GM_USER, WORLDS } from "./config.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

const argv = process.argv.slice(2);
const hold = argv.includes("--hold");
const serve = argv.includes("--serve");
const worldId = argv.find(a => !a.startsWith("--")) ?? "playwright";
if ( !WORLDS[worldId] ) throw new Error(`Unknown world "${worldId}"`);

ensureWorld(worldId);
const server = await startFoundry(worldId, { verbose: argv.includes("--verbose") });
console.log(`Foundry up at ${BASE_URL} with world "${worldId}"`);

/**
 * `--serve` is for testing by hand, and deliberately opens no browser at all.
 *
 * These worlds have exactly one user — Foundry creates a passwordless "Gamemaster" on first
 * activation and the harness logs in as it. So a held Playwright session *is* that user, and there
 * is nobody left for a person to join as. Serving without joining leaves the seat free.
 */
if ( serve ) {
  console.log(`\nOpen ${BASE_URL} in your browser and join as "${GM_USER}" (no password).`);
  console.log("Nothing else is logged in. Ctrl+C to stop the server.");
  try {
    await sleep(3_600_000);
  } finally {
    await server.stop();
  }
  process.exit(0);
}

let session;
try {
  session = await Session.open();
  const info = await session.eval(() => ({
    world: game.world.id,
    system: `${game.system.id} ${game.system.version}`,
    core: game.version,
    user: `${game.user.name} (${game.user.role})`,
    activeModules: game.modules.filter(m => m.active).map(m => m.id).sort(),
    packs: game.packs.size,
    actors: game.actors.size
  }));
  console.log(JSON.stringify(info, null, 2));
  if ( hold ) {
    console.log("Holding — Ctrl+C to exit.");
    await sleep(3_600_000);
  }
} catch ( err ) {
  console.error(err.message);
  if ( session ) {
    console.error(`URL: ${session.page.url()}`);
    // Full log to disk — the interesting line is often hundreds of entries before the failure.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(new URL("./console.log", import.meta.url), session.consoleLog.join("\n"), "utf8");
    await session.page.screenshot({ path: new URL("./failure.png", import.meta.url).pathname.slice(1) })
      .catch(() => {});
    console.error("wrote console.log and failure.png");
  }
} finally {
  if ( session ) await session.close();
  await server.stop();
}
