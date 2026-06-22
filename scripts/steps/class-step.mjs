import {
  abilitiesContext, abilitiesHandle, abilitiesComplete, abilitiesSummary, ABILITY_ACTIONS
} from "./abilities-step.mjs";

/**
 * The Class step. Class selection and ability scores share one step: the class
 * card grid fills the main column and the ability panel sits in a fixed aside on
 * the right, so a player sees how a class frames their scores while choosing both.
 *
 * It is built by composition, not inheritance — it owns the class-grid context and
 * routes ability clicks to the standalone ability panel (abilities-step.mjs). The
 * two halves stay independent; this module only stitches their context, handling,
 * and completion together.
 */
export const classStep = {
  id: "class",
  icon: "fa-solid fa-chess-rook",
  labelKey: "step.class.label",
  template: "steps/class",

  isComplete(state) {
    return !!state.classUuid && abilitiesComplete(state);
  },

  /** Rail summary: class name, then the resolved score line beneath it. */
  summary(state, source) {
    const name = source.card(state.classUuid)?.name;
    if ( !name ) return "";
    return `${name} · ${abilitiesSummary(state)}`;
  },

  async handle(action, el, { state }) {
    if ( ABILITY_ACTIONS.has(action) ) return abilitiesHandle(action, el, state);
    if ( action === "pick-class" ) {
      const uuid = el.dataset.uuid;
      // Re-clicking the active card clears it, so a player can back out of a choice.
      state.classUuid = state.classUuid === uuid ? null : uuid;
    }
  },

  async context({ state, source }) {
    const selected = state.classUuid;
    const detail = selected ? await source.detail(selected) : null;
    const cards = source.classes().map(c => ({ ...c, selected: c.uuid === selected }));
    return {
      cards,
      count: cards.length,
      hasSelection: !!selected,
      detail,
      abilities: abilitiesContext(state)
    };
  }
};
