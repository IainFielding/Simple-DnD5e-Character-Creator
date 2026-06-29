import {
  abilitiesContext, abilitiesHandle, abilitiesComplete, abilitiesSummary,
  ABILITY_ACTIONS, POINT_BUY_LIVE_ACTIONS, patchPointBuy
} from "./abilities-step.mjs";
import { spellInfoFor } from "./spells-step.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";

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

  async handle(action, el, { state, source, spells, app }) {
    if ( ABILITY_ACTIONS.has(action) ) {
      await abilitiesHandle(action, el, state);
      // Point-buy steppers fire in rapid succession; a full stage re-render would rebuild
      // the class pick-list images and flicker the class icons on every press. Patch the
      // panel and the Next gate in place, refresh only the image-free rail (completion tick
      // + downstream step reachability), and skip the default re-render.
      if ( POINT_BUY_LIVE_ACTIONS.has(action) && state.abilityMethod === "point-buy" ) {
        const stage = el.closest(".creator-stage");
        patchPointBuy(stage, state);
        const next = stage?.querySelector('.creator-stage-foot [data-action="navNext"]');
        if ( next ) next.disabled = !(state.classUuid && abilitiesComplete(state));
        app.render({ parts: ["rail"] });
        return false;
      }
      return;
    }
    if ( action === "pick-class" ) {
      const uuid = el.dataset.uuid;
      // Re-clicking the active card clears it, so a player can back out of a choice.
      state.classUuid = state.classUuid === uuid ? null : uuid;
      // Spells, class advancement picks, and class equipment are all class-specific.
      state.resetClassDependent();
      // Refresh the cached choice requirements so the Choices step's completion gate
      // reflects the new class even before it is visited.
      state.choiceCache = await resolveChoices(state, source);
      // And the spell summary, so the Spells step's gate knows the new class's known counts.
      state.spellInfo = await spellInfoFor(spells, state.classUuid);
    }
  },

  async context({ state, source }) {
    const selected = state.classUuid;
    const detail = selected ? await source.detail(selected) : null;
    const groups = selected ? await source.advancementGroups(selected) : null;
    const cards = source.classes().map(c => ({ ...c, selected: c.uuid === selected }));
    return {
      cards,
      count: cards.length,
      hasSelection: !!selected,
      detail,
      groups,
      abilities: abilitiesContext(state)
    };
  }
};
