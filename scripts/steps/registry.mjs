import { originStep } from "./origin-step.mjs";
import { classStep } from "./class-step.mjs";
import { backgroundStep } from "./background-step.mjs";
import { detailsStep } from "./details-step.mjs";
import { spellsStep } from "./spells-step.mjs";
import { choicesStep } from "./choices-step.mjs";
import { featSpellsStep } from "./feat-spells-step.mjs";
import { equipmentStep } from "./equipment-step.mjs";
import { storeStep } from "./store-step.mjs";
import { creationMagicShopStep } from "./magic-shop-step.mjs";
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
    instructionKey: "step.species.instruction",
    field: "speciesUuid",
    hintKey: "step.species.hint",
    rulesTopic: "species",
    // A 2014 species carries the ability-score increase its edition's backgrounds don't; the panel
    // renders only when the chosen species actually grants one, so 2024 species are unaffected.
    asiSource: "species",
    // Scoped to the chosen class's edition — class is the first step, so it is always known by
    // the time this grid renders. See `SourceIndex#matchesRules`.
    cards: (src, state) => src.species({ rules: src.rulesOf(state.classUuid) })
  }),
  detailsStep,
  spellsStep,
  choicesStep,
  featSpellsStep,
  equipmentStep,
  // The Store must follow Equipment: its budget is the currency the finished equipment
  // choice yields. Hidden (like Feat-Spells) until the GM enables it and gold exists.
  storeStep,
  // Magic Items, for a character who starts at 1st level and so has no climb to hand it to. A
  // character starting higher picks theirs on the level-up rail instead
  // ({@link module:levelup/steps/lvl-magic-shop-step}), against the row for the level they start
  // at; this step stands down in that case so nothing is asked or granted twice.
  //
  // It was absent entirely until the wealth table gained a 1st-level row. The old reasoning — "the
  // DMG's bands start at level 2, so this rail could never offer anything" — was true of the book
  // and is no longer true of the table a GM can edit.
  creationMagicShopStep,
  reviewStep
];

/** Steps that must be complete before the character may be built (everything but review). */
export const REQUIRED_STEPS = STEPS.filter(s => s.id !== "review");
