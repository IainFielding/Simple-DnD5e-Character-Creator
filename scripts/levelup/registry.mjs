import { levelStep } from "./steps/level-step.mjs";
import { lvlReviewStep } from "./steps/lvl-review-step.mjs";
import { lvlSpellsStep } from "./steps/lvl-spells-step.mjs";

/**
 * The ordered steps the level-up shell walks through: one screen per gained character level — each
 * carrying *all* of that level's choices (hit points, subclass, ASI/feat, features, traits) — then
 * a final review. A level-up is a pipeline whose later choices can be revealed by earlier ones
 * (§2.2), so this is rebuilt per render: the level set is the gained levels (every gained level
 * grants at least hit points), and a revealed choice folds into its level's screen rather than
 * adding a new step.
 * @param {import("./levelup-state.mjs").LevelUpState} state
 * @returns {object[]}
 */
export function buildSteps(state) {
  const steps = state.gainedLevels().map(level => levelStep(level));
  steps.push(lvlReviewStep);
  // §3.4: a caster who gained new cantrip/spell capacity gets a post-commit spell step after review.
  if ( state.hasSpellStep() ) steps.push(lvlSpellsStep);
  return steps;
}
