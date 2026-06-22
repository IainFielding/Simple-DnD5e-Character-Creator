import { originStep } from "./origin-step.mjs";
import { classStep } from "./class-step.mjs";
import { backgroundStep } from "./background-step.mjs";
import { detailsStep } from "./details-step.mjs";
import { spellsStep } from "./spells-step.mjs";
import { choicesStep } from "./choices-step.mjs";
import { reviewStep } from "./review-step.mjs";

/**
 * The ordered list of steps the shell walks through. Order is data here, not
 * hard-coded control flow: insert, remove, or reorder steps by editing this array.
 * Later phases (spells, equipment, advancements, identity) slot in as more entries.
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
  reviewStep
];

/** Steps that must be complete before the character may be built (everything but review). */
export const REQUIRED_STEPS = STEPS.filter(s => s.id !== "review");
