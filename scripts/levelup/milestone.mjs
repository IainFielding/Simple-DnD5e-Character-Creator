import { MODULE_ID } from "../config.mjs";

/**
 * Milestone levelling: a GM granting a level instead of the character earning it in XP.
 *
 * In a world on dnd5e's "noxp" leveling mode the XP watcher has nothing to watch, so nothing tells a
 * player their level has arrived. A grant fills that gap. It is a signal, not a gate: the player
 * could level before it and still can, and the grant only lights the sheet's Level Up button and
 * whispers them the ready card.
 *
 * The grant is stored as the level the character has been granted *up to*, not as a count of levels
 * owed. That way nothing has to be decremented on the way out: any level-up — ours, the native
 * sheet's, a GM editing the class — moves the character's level toward the mark, and the signal ends
 * the moment they reach it.
 *
 * This file only reads. The grant itself, and the GM's menus and dialog, are in
 * {@link module:levelup/milestone-grant}, which the sheet code here must not import.
 */

/** Flag holding the character level a GM has granted up to. */
export const MILESTONE_FLAG = "milestoneLevel";

/**
 * Whether the world levels by milestone rather than XP.
 * @returns {boolean}
 */
export function usesMilestones() {
  return game.settings.get("dnd5e", "levelingMode") === "noxp";
}

/**
 * The level a GM has granted this character up to, or null when there is no grant.
 * @param {Actor5e} actor
 * @returns {number|null}
 */
export function grantedLevel(actor) {
  const value = Number(actor?.getFlag?.(MODULE_ID, MILESTONE_FLAG));
  return Number.isFinite(value) && (value > 0) ? value : null;
}

/**
 * Whether a granted level is waiting to be taken: the grant is above the character's level.
 * @param {Actor5e} actor
 * @param {object} [options]
 * @param {boolean} [options.milestones]  Whether the world levels by milestone; injectable for tests.
 * @returns {boolean}
 */
export function hasGrantedLevel(actor, { milestones = usesMilestones() } = {}) {
  if ( !milestones ) return false;
  const granted = grantedLevel(actor);
  return (granted !== null) && (granted > (actor?.system?.details?.level ?? 0));
}

/**
 * The level a new grant raises the mark to: one above the higher of the character's level and any
 * grant still waiting, so granting twice before the player levels owes them two. Null at the cap.
 * @param {Actor5e} actor
 * @param {number} [maxLevel]
 * @returns {number|null}
 */
export function nextGrantTarget(actor, maxLevel = CONFIG.DND5E?.maxLevel ?? 20) {
  const level = actor?.system?.details?.level ?? 0;
  const target = Math.max(level, grantedLevel(actor) ?? 0) + 1;
  return target > maxLevel ? null : target;
}
