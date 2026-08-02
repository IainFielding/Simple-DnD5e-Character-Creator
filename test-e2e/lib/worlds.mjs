/**
 * Create the test worlds on disk.
 *
 * A Foundry world is just a directory under `Data/worlds` containing a `world.json` manifest;
 * Foundry builds the database on first activation and, finding no Gamemaster, creates a
 * passwordless user named "Gamemaster" — which is exactly the account the harness logs in as.
 * So writing the manifest is the whole of world creation; no setup-screen driving required.
 */

import fs from "node:fs";
import path from "node:path";
import { CORE_VERSION, DATA_DIR, SYSTEM, SYSTEM_VERSION, WORLDS } from "../config.mjs";

/** Absolute path of a world directory. */
export function worldDir(worldId) {
  return path.join(DATA_DIR, "worlds", worldId);
}

/** Whether the world already has a database (i.e. has been activated at least once). */
export function worldInitialised(worldId) {
  return fs.existsSync(path.join(worldDir(worldId), "data"));
}

/**
 * Write `world.json` for one of the configured worlds, creating the directory if needed.
 * Existing manifests are left alone unless `force` is set, so re-provisioning never clobbers
 * a world's `lastPlayed`/`playtime` bookkeeping.
 * @param {string} worldId
 * @param {object} [options]
 * @param {boolean} [options.force]   Rewrite the manifest even if it exists.
 * @returns {{created: boolean, dir: string}}
 */
export function ensureWorld(worldId, { force = false } = {}) {
  const spec = WORLDS[worldId];
  if ( !spec ) throw new Error(`Unknown world "${worldId}". Known: ${Object.keys(WORLDS).join(", ")}`);

  const dir = worldDir(worldId);
  const manifestPath = path.join(dir, "world.json");
  fs.mkdirSync(dir, { recursive: true });

  if ( fs.existsSync(manifestPath) && !force ) return { created: false, dir };

  const manifest = {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    system: SYSTEM,
    systemVersion: SYSTEM_VERSION,
    coreVersion: CORE_VERSION,
    compatibility: { minimum: String(Math.trunc(Number(CORE_VERSION))), verified: CORE_VERSION },
    joinTheme: "minimal",
    playtime: 0,
    flags: {}
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { created: true, dir };
}

/**
 * Delete a world's database, keeping the manifest — the nuclear reset for when a run leaves a
 * world in a state that is easier to rebuild than to clean.
 * @param {string} worldId
 */
export function resetWorldData(worldId) {
  const data = path.join(worldDir(worldId), "data");
  if ( fs.existsSync(data) ) fs.rmSync(data, { recursive: true, force: true });
}
