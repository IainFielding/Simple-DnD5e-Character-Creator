import { originStep } from "./origin-step.mjs";
import { abilitiesStep } from "./abilities-step.mjs";
import { reviewStep } from "./review-step.mjs";

/**
 * The ordered list of steps the shell walks through. Order is data here, not
 * hard-coded control flow: insert, remove, or reorder steps by editing this array.
 * Later phases (spells, equipment, advancements, identity) slot in as more entries.
 */
export const STEPS = [
  originStep({
    id: "class",
    icon: "fa-solid fa-chess-rook",
    labelKey: "step.class.label",
    field: "classUuid",
    cards: src => src.classes()
  }),
  abilitiesStep,
  originStep({
    id: "species",
    icon: "fa-solid fa-paw",
    labelKey: "step.species.label",
    field: "speciesUuid",
    cards: src => src.species()
  }),
  originStep({
    id: "background",
    icon: "fa-solid fa-feather",
    labelKey: "step.background.label",
    field: "backgroundUuid",
    cards: src => src.backgrounds()
  }),
  reviewStep
];

/** Steps that must be complete before the character may be built (everything but review). */
export const REQUIRED_STEPS = STEPS.filter(s => s.id !== "review");
