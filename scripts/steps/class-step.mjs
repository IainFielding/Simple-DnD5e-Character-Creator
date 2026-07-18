import {
  abilitiesContext, abilitiesHandle, abilitiesComplete, abilitiesSummary, abilitiesHint,
  ABILITY_ACTIONS, POINT_BUY_LIVE_ACTIONS, patchPointBuy
} from "./abilities-step.mjs";
import { spellInfoFor } from "./spells-step.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";
import { applyQuickBuild } from "../data/quick-build.mjs";
import { t, log, levelUpEnabled, heroMancerActive } from "../config.mjs";

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

  /** Why Next is blocked: no class, or ability scores still to finish. */
  incompleteHint(state) {
    if ( !state.classUuid ) return t("step.class.hint");
    return abilitiesHint(state);
  },

  /** Rail summary: class name, then the resolved score line beneath it. */
  summary(state, source) {
    const name = source.card(state.classUuid)?.name;
    if ( !name ) return "";
    return `${name} · ${abilitiesSummary(state)}`;
  },

  async handle(action, el, { state, source, spells, equipment, app }) {
    if ( action === "quick-build" ) {
      if ( !state.classUuid ) return;
      // Filling replaces existing picks, so confirm first when the player has already made some.
      if ( hasMeaningfulPicks(state) ) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: t("quickBuild.confirmTitle"), icon: "fa-solid fa-bolt" },
          content: `<p>${t("quickBuild.confirmBody")}</p>`,
          modal: true,
          rejectClose: false
        });
        if ( !ok ) return false;
      }
      // The fill awaits several compendium reads; latch the button so a double-click can't
      // start a second fill over the first (same hardening as the Create button).
      el.disabled = true;
      el.classList.add("is-busy");
      try {
        const result = await applyQuickBuild({ state, source, spells, equipment });
        if ( !result.ok ) ui.notifications?.warn(t("quickBuild.partial"));
      } catch ( err ) {
        log("quick build failed", err);
        ui.notifications?.error(t("quickBuild.failed"));
        el.disabled = false;
        el.classList.remove("is-busy");
        return;                                   // re-render shows whatever state remains
      }
      // Lands on Review when every gate passed; otherwise on the first incomplete step.
      app.gotoStep("review");
      return false;                               // gotoStep rendered; skip the dispatch render
    }
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
    if ( action === "target-level" ) {
      state.targetLevel = clampLevel(el.dataset.level);
      return;
    }
    if ( action === "target-level-custom" ) {
      state.targetLevel = clampLevel(el.value);
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
      abilities: abilitiesContext(state),
      targetLevel: targetLevelContext(state)
    };
  }
};

/* -------------------------------------------- */
/*  Target level                                */
/* -------------------------------------------- */

/** The levels offered as one-click presets, alongside the custom entry. */
const LEVEL_PRESETS = [1, 3, 5];

/** Coerce any user-supplied level to a whole number within 1…the system's cap. */
function clampLevel(value) {
  const max = CONFIG.DND5E?.maxLevel ?? 20;
  const level = Math.floor(Number(value));
  if ( !Number.isFinite(level) ) return 1;
  return Math.min(Math.max(level, 1), max);
}

/**
 * View-model for the target-level picker: the preset chips plus a custom field that only shows a
 * value when the pick isn't one of the presets (so the field reads as "or something else" rather
 * than duplicating the active chip).
 * @param {import("../state/creator-state.mjs").CreatorState} state
 */
function targetLevelContext(state) {
  // Everything above level 1 is delivered by the level-up wizard, so the picker only exists where
  // that wizard does: a world that left the module on creation-only (or handed level-ups to Hero
  // Mancer) has no way to reach level 5 from here, and shouldn't be offered it.
  if ( !levelUpEnabled() || heroMancerActive() ) return null;
  const value = clampLevel(state.targetLevel);
  const isPreset = LEVEL_PRESETS.includes(value);
  return {
    value,
    max: CONFIG.DND5E?.maxLevel ?? 20,
    presets: LEVEL_PRESETS.map(level => ({ level, active: level === value })),
    custom: !isPreset,
    customValue: isPreset ? "" : value,
    // The picker's "you'll finish in the level-up wizard" note only applies above level 1.
    aboveOne: value > 1
  };
}

/**
 * Whether the player has made picks beyond this step that Quick Build would overwrite —
 * origins, a name, spells, or any advancement choice. Class + ability tinkering alone
 * doesn't count: quick build re-derives those, and prompting there would nag the exact
 * player the button is for.
 */
function hasMeaningfulPicks(state) {
  return !!(
    state.backgroundUuid
    || state.speciesUuid
    || state.details.name?.trim()
    || state.selectedCantrips.length
    || state.selectedSpells.length
    || Object.values(state.advChoices).some(bucket => Object.keys(bucket).length)
  );
}
