/**
 * Spawn and stop the harness's own Foundry server.
 *
 * Foundry hosts exactly one active world at a time, so a run that touches both test worlds
 * launches the server twice — once per world — rather than trying to switch worlds in place.
 * The instance runs on {@link PORT} (not Foundry's default 30000) against the *same* data path
 * as the user's normal install, so it sees the real systems, modules and compendia.
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { BASE_URL, DATA_PATH, FOUNDRY_ROOT, PORT, SERVER_TIMEOUT_MS } from "../config.mjs";

/** Grace period between the port opening and the first client connection. See `startFoundry`. */
const SETTLE_MS = 3000;

/** Whether something is already listening on our port (usually a leftover from a crashed run). */
export async function portInUse() {
  try {
    await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch Foundry with a world already active.
 * @param {string} worldId              Directory id under `Data/worlds`.
 * @param {object} [options]
 * @param {boolean} [options.verbose]   Mirror Foundry's stdout to ours (useful when debugging).
 * @returns {Promise<{stop: () => Promise<void>, log: string[]}>}
 */
export async function startFoundry(worldId, { verbose = false } = {}) {
  // Foundry locks its *data directory*, so only one instance can use it at a time — including the
  // user's own Foundry. A hard-killed instance leaves a lock that `proper-lockfile` treats as
  // stale after ~10s, so a retry clears the common case (a crashed run) while a genuinely running
  // Foundry still fails, with an explanation.
  for ( let attempt = 1; ; attempt++ ) {
    try {
      return await launch(worldId, { verbose });
    } catch ( err ) {
      if ( !/already locked/i.test(err.message) || (attempt >= 3) ) {
        if ( /already locked/i.test(err.message) ) {
          throw new Error(`Foundry's data directory is locked by another process. Close any `
            + `running Foundry (the desktop app or a previous harness run) and try again.`);
        }
        throw err;
      }
      await sleep(8000);
    }
  }
}

/** One launch attempt. See {@link startFoundry} for the lock retry that wraps this. */
async function launch(worldId, { verbose = false } = {}) {
  if ( await portInUse() ) {
    throw new Error(`Port ${PORT} is already in use. A previous harness run may not have shut `
      + `down — kill the stray node process and retry.`);
  }

  const args = [
    `${FOUNDRY_ROOT}/main.mjs`,
    `--dataPath=${DATA_PATH}`,
    `--port=${PORT}`,
    `--world=${worldId}`,
    "--noupdate",
    // Foundry opens the port *before* it finishes discovering its own IP addresses: the listen
    // callback awaits `getIPAddresses()`, which round-trips to api.foundryvtt.com. Until that
    // resolves, `express.addresses` is null, and a client joining in that window makes the world
    // payload throw in `getInvitationLinks` ("Cannot read properties of null (reading 'local')").
    // The client then receives a world payload with no `release` and dies in `new Game()` with a
    // ReleaseData validation error — a completely misleading symptom of a startup race.
    // `--noipdiscovery` skips the lookup and fills the addresses from the local interface instead,
    // which is all this harness needs. (SETTLE_MS below closes the remaining sliver.)
    "--noipdiscovery"
  ];

  const child = spawn(process.execPath, args, { cwd: FOUNDRY_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  const capture = chunk => {
    const text = chunk.toString();
    log.push(text);
    if ( verbose ) process.stdout.write(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  let exited = null;
  child.on("exit", (code, signal) => { exited = { code, signal }; });

  // Poll until the HTTP server answers. Foundry's own "listening" log line is localised and has
  // moved between releases, so a real request is the more durable readiness signal.
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while ( Date.now() < deadline ) {
    if ( exited ) {
      throw new Error(`Foundry exited before becoming ready (code ${exited.code}).\n${log.join("")}`);
    }
    if ( await portInUse() ) {
      // The port opens a beat before the listen callback finishes wiring up `express.addresses`
      // (see the --noipdiscovery note above); joining inside that window poisons the world payload.
      await sleep(SETTLE_MS);
      return { stop: () => stopFoundry(child), log, child };
    }
    await sleep(500);
  }
  await stopFoundry(child);
  throw new Error(`Foundry did not start within ${SERVER_TIMEOUT_MS}ms.\n${log.join("")}`);
}

/**
 * Terminate the server process.
 *
 * Callers should return the world to setup first (see `session.close()`), which is what actually
 * closes the world database cleanly — Windows has no real SIGTERM, so this is a hard kill.
 * @param {import("node:child_process").ChildProcess} child
 */
export async function stopFoundry(child) {
  if ( !child || child.exitCode !== null ) return;
  const done = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  await Promise.race([done, sleep(10_000)]);
  if ( child.exitCode === null ) child.kill("SIGKILL");
}
