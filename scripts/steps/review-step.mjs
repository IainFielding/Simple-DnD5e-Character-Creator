import { ABILITIES, t } from "../config.mjs";

const formatMod = score => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

/**
 * Final review. Read-only: it surfaces every pick and the resolved ability scores
 * so the player can confirm before the actor is built. The "Create" control lives
 * on the shell (it closes the app and runs the assembler), so this step exposes no
 * actions of its own.
 */
export const reviewStep = {
  id: "review",
  icon: "fa-solid fa-clipboard-check",
  labelKey: "step.review.label",
  template: "steps/review",

  // The review itself is never "incomplete"; the shell gates Create on the other steps.
  isComplete() { return true; },

  summary() { return ""; },

  async context({ state, source }) {
    const scores = state.resolvedScores();
    const pick = (uuid, kindKey, emptyKey) => {
      const card = source.card(uuid);
      return {
        kind: t(kindKey),
        empty: t(emptyKey),
        chosen: !!card,
        name: card?.name ?? "",
        img: card?.img ?? "icons/svg/mystery-man.svg"
      };
    };
    const methodKeys = {
      "point-buy": "step.abilities.pointBuy",
      "standard-array": "step.abilities.standardArray",
      "roll": "step.abilities.roll"
    };
    return {
      name: state.actor?.name ?? "",
      origins: [
        pick(state.classUuid, "step.class.label", "step.review.noClass"),
        pick(state.speciesUuid, "step.species.label", "step.review.noSpecies"),
        pick(state.backgroundUuid, "step.background.label", "step.review.noBackground")
      ],
      method: t(methodKeys[state.abilityMethod] ?? "step.abilities.label"),
      abilities: ABILITIES.map(key => ({
        key,
        abbr: CONFIG.DND5E?.abilities?.[key]?.abbreviation ?? key.slice(0, 3).toUpperCase(),
        value: scores[key],
        modifier: formatMod(scores[key])
      }))
    };
  }
};
