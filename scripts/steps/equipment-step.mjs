import { t } from "../config.mjs";
import { describeOption } from "../data/equipment-source.mjs";

/**
 * The Equipment step: choose the starting gear each origin (class, background) grants —
 * a bundle of items, an "either/or" swap within a bundle, or a lump of gold to shop with
 * later. Purely informational: it always has a sensible default (the first option), so the
 * step never gates the build — the player can breeze past it and refine the loadout on the
 * sheet. It lives after Choices in the rail because it needs the class and background picked.
 *
 * The option model is resolved by {@link module:data/equipment-source}; this step only renders
 * each source's options and records the player's selection into `state.equipment`.
 */
export const equipmentStep = {
  id: "equipment",
  icon: "fa-solid fa-shield-halved",
  labelKey: "step.equipment.label",
  template: "steps/equipment",

  // Equipment is optional — there's always a default loadout — but its rail tick stays off
  // until the player has actually visited the step. `onEnter` (fired by the shell before
  // navigation is evaluated) flips the flag the moment they arrive, so it's never blocking.
  isComplete(state) {
    return !!state.equipmentVisited;
  },

  onEnter(state) {
    state.equipmentVisited = true;
  },

  async handle(action, el, { state }) {
    if ( action === "equip-option" ) {
      const eq = state.equipment[el.dataset.equipSource];
      const idx = Number(el.dataset.index);
      if ( eq && Number.isInteger(idx) ) eq.selectedOption = idx;
      return;
    }
    if ( action === "equip-or" ) {
      const eq = state.equipment[el.dataset.equipSource];
      if ( eq ) eq.orSelections[el.dataset.group] = el.dataset.option;
    }
  },

  async context({ state, source, equipment }) {
    const loaded = await equipment.load(state, source);
    const sources = [];
    for ( const key of ["class", "background"] ) {
      if ( loaded[key] ) sources.push({ key, name: loaded[key].name, img: loaded[key].img, ...describeOption(loaded[key], state.equipment[key]) });
    }
    return { sources, isEmpty: sources.length === 0 };
  }
};
