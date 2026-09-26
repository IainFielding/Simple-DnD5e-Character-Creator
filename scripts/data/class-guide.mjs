import { t } from "../config.mjs";

/**
 * A new player's two questions about a class before they read its page: how hard is it to play,
 * and what does it do? Shown under the class's name in the picker and on the quick screen.
 *
 * The complexity ratings are the 2024 Player's Handbook's own, from its "Class Overview" table in
 * Creating a Character. They are applied to both editions of a class: the rating describes how much
 * a player has to track, and the 2014 and 2024 versions of a class ask much the same of them. The
 * Artificer has no published rating; it is rated high by the module's own call, since it tracks
 * spells, infusions and replicated items on top of its tools.
 *
 * The role lines are the module's own wording, and live in the lang file so they can be translated.
 * A class not listed here (homebrew, a third-party class) gets no guide at all; the card then reads
 * exactly as it did before.
 */

/** Complexity ratings, and the number of pips each shows. */
const LEVELS = { low: 1, average: 2, high: 3 };

/** @type {Record<string, {complexity: keyof LEVELS|null}>} Keyed by class identifier. */
export const CLASS_GUIDE = {
  artificer: { complexity: "high" },
  barbarian: { complexity: "average" },
  bard: { complexity: "high" },
  cleric: { complexity: "average" },
  druid: { complexity: "high" },
  fighter: { complexity: "low" },
  monk: { complexity: "high" },
  paladin: { complexity: "average" },
  ranger: { complexity: "average" },
  rogue: { complexity: "low" },
  sorcerer: { complexity: "high" },
  warlock: { complexity: "high" },
  wizard: { complexity: "average" }
};

/**
 * The guide for one class, ready for a template.
 * @param {string} identifier  The class's `system.identifier`.
 * @returns {{role: string, complexity: string|null, label: string, pips: {on: boolean}[]}|null}
 */
export function classGuide(identifier) {
  const entry = CLASS_GUIDE[identifier];
  if ( !entry ) return null;
  const level = LEVELS[entry.complexity] ?? 0;
  return {
    role: t(`classGuide.role.${identifier}`),
    complexity: entry.complexity,
    label: entry.complexity ? t(`classGuide.complexity.${entry.complexity}`) : "",
    pips: level ? [1, 2, 3].map(n => ({ on: n <= level })) : []
  };
}
