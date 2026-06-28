import { originStep } from "./origin-step.mjs";
import { classStep } from "./class-step.mjs";
import { backgroundStep } from "./background-step.mjs";
import { detailsStep } from "./details-step.mjs";
import { spellsStep } from "./spells-step.mjs";
import { choicesStep } from "./choices-step.mjs";
import { equipmentStep } from "./equipment-step.mjs";
import { reviewStep } from "./review-step.mjs";

/**
 * The ordered list of steps the shell walks through, top to bottom. The order lives
 * in this array as plain data rather than being hard-coded into the navigation logic,
 * so you add, remove, or reorder steps just by editing this list — the shell reads its
 * length and contents to drive the stepper, the Back/Next buttons, and completion.
 */
export const STEPS = [
  classStep,
  backgroundStep,
  originStep({
    id: "species",
    icon: "fa-solid fa-paw",
    labelKey: "step.species.label",
    field: "speciesUuid",
    cards: src => src.species()
  }),
  detailsStep,
  spellsStep,
  choicesStep,
  equipmentStep,
  reviewStep
];

/** Steps that must be complete before the character may be built (everything but review). */
export const REQUIRED_STEPS = STEPS.filter(s => s.id !== "review");
