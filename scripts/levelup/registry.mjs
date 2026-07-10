import { levelStep } from "./steps/level-step.mjs";
import { lvlReviewStep } from "./steps/lvl-review-step.mjs";
import { lvlSpellsStep } from "./steps/lvl-spells-step.mjs";

/**
 * The ordered steps the level-up shell walks through: one screen per gained character level — each
 * carrying *all* of that level's choices (hit points, subclass, ASI/feat, features, traits) — then,
 * for a caster who gained new cantrip/spell capacity, the spell picks, then a final review of
 * everything (spell choices included). A level-up is a pipeline whose later choices can be
 * revealed by earlier ones (§2.2), so this is rebuilt per render: the level set is the gained
 * levels (every gained level grants at least hit points), a revealed choice folds into its
 * level's screen rather than adding a new step, and the spell step appears the moment a choice
 * makes the class a caster (an Eldritch Knight-style subclass pick).
 * @param {import("./levelup-state.mjs").LevelUpState} state
 * @returns {object[]}
 */
export function buildSteps(state) {
  // On a multiclass character the screens are class levels, not character levels — name the
  // class on each ("Wizard 3") so the labels can't be misread as the character's level.
  const className = state.isMulticlassed ? (state.classItem?.name ?? "") : "";
  const steps = state.gainedLevels().map(level => levelStep(level, className));
  if ( state.hasSpellStep() ) steps.push(lvlSpellsStep);
  steps.push(lvlReviewStep);
  return steps;
}
