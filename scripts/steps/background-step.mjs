import { ABILITIES, t } from "../config.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";

/**
 * The Background step. Like the Class step, it pairs the origin card grid with a
 * statistics aside: a 2024 background grants an ability-score increase (typically
 * three points spread across a short list of abilities, capped at +2 each), and
 * the player allocates it here rather than later in the advancement prompt.
 *
 * The grid half mirrors the origin factory; the aside half owns the increase
 * allocation. The two are stitched together by this module alone — neither knows
 * about the other's layout.
 */
export const backgroundStep = {
  id: "background",
  icon: "fa-solid fa-feather",
  labelKey: "step.background.label",
  template: "steps/background",

  isComplete(state) {
    if ( !state.backgroundUuid ) return false;
    const asi = state.backgroundAsi;
    // Unresolved (undefined) or no increase to make (null) — selection alone suffices.
    if ( !asi ) return true;
    return pointsRemaining(state, asi) === 0;
  },

  /** Why Next is blocked: no background, or ability-increase points still to spend. */
  incompleteHint(state) {
    if ( !state.backgroundUuid ) return t("step.background.hint");
    const asi = state.backgroundAsi;
    if ( asi && pointsRemaining(state, asi) > 0 ) return t("step.background.hintPoints", { count: pointsRemaining(state, asi) });
    return null;
  },

  /** Rail summary: background name, then the chosen increases beneath it. */
  summary(state, source) {
    const name = source.card(state.backgroundUuid)?.name;
    if ( !name ) return "";
    const line = increaseSummary(state);
    return line ? `${name} · ${line}` : name;
  },

  async handle(action, el, { state, source }) {
    if ( action === "pick-origin" ) {
      const uuid = el.dataset.uuid;
      // Re-clicking the active card clears it, so a player can back out of a choice.
      state.backgroundUuid = state.backgroundUuid === uuid ? null : uuid;
      state.resetBackgroundAbilities();
      state.resetSourceChoices("background");
      if ( state.backgroundUuid ) state.backgroundAsi = await source.abilityScoreIncrease(uuid);
      state.choiceCache = await resolveChoices(state, source);
      return;
    }

    const asi = state.backgroundAsi;
    if ( !asi ) return;
    const ability = el?.dataset?.ability;
    switch ( action ) {
      case "bg-ability-inc":
        if ( canIncrease(state, asi, ability) ) state.backgroundAbilities[ability] += 1;
        break;
      case "bg-ability-dec":
        if ( state.backgroundAbilities[ability] > 0 ) state.backgroundAbilities[ability] -= 1;
        break;
      case "bg-ability-reset":
        state.backgroundAbilities = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        break;
    }
  },

  async context({ state, source }) {
    const selected = state.backgroundUuid;
    const detail = selected ? await source.detail(selected) : null;
    const groups = selected ? await source.advancementGroups(selected) : null;

    // Tag each card with the abilities its increase can raise (space-joined, for the
    // client-side filter's `data-abilities`), drawn from the same cached ASI config the
    // aside panel uses. The ASI records are already warmed, so these resolve instantly.
    const list = await Promise.all(source.backgrounds().map(async c => {
      const asi = await source.abilityScoreIncrease(c.uuid);
      return { ...c, selected: c.uuid === selected, abilities: increasedAbilities(asi).join(" ") };
    }));

    // Resolve (and cache) the increase config for the active background, so the panel
    // and the completion check share one source of truth.
    if ( selected && state.backgroundAsi === undefined ) {
      state.backgroundAsi = await source.abilityScoreIncrease(selected);
    }

    return {
      cards: list,
      count: list.length,
      hasSelection: !!selected,
      detail,
      groups,
      abilityOptions: ABILITIES.map(key => ({ value: key, label: abilityLabel(key) })),
      abilities: abilitiesContext(state)
    };
  }
};

/** The abilities a background's increase can raise: everything not locked out, plus any
 *  score with a fixed bump. Empty for a background that grants no increase. */
function increasedAbilities(asi) {
  if ( !asi ) return [];
  return ABILITIES.filter(k => !asi.locked.includes(k) || Number(asi.fixed?.[k] ?? 0) > 0);
}

/* -------------------------------------------- */
/*  Ability-increase panel                      */
/* -------------------------------------------- */

const abilityLabel = key => CONFIG.DND5E?.abilities?.[key]?.label ?? key.toUpperCase();

/** Points the player has yet to spend out of the increase's budget. */
function pointsRemaining(state, asi) {
  const spent = ABILITIES.reduce((sum, k) => sum + (state.backgroundAbilities[k] ?? 0), 0);
  return Math.max(0, asi.points - spent);
}

/** A locked ability is fixed by the background and may not be hand-allocated. */
function canIncrease(state, asi, ability) {
  if ( !ability || asi.locked.includes(ability) ) return false;
  if ( (state.backgroundAbilities[ability] ?? 0) >= asi.cap ) return false;
  return pointsRemaining(state, asi) > 0;
}

/** "+2 STR · +1 DEX" line for the rail, drawn from fixed + allocated increases. */
function increaseSummary(state) {
  const asi = state.backgroundAsi;
  if ( !asi ) return "";
  const parts = [];
  for ( const key of ABILITIES ) {
    const total = Number(asi.fixed?.[key] ?? 0) + (state.backgroundAbilities[key] ?? 0);
    if ( total > 0 ) parts.push(`+${total} ${key.toUpperCase()}`);
  }
  return parts.join(" · ");
}

/** Template context for the increase-allocation aside (nested under `abilities`). */
function abilitiesContext(state) {
  const asi = state.backgroundAsi;
  const hasAsi = !!asi;
  const base = state.resolvedScores();
  const remaining = hasAsi ? pointsRemaining(state, asi) : 0;

  const rows = ABILITIES.map(key => {
    // A background that grants no increase locks every score; the scores simply
    // display, padlocked, so the step still reads as a deliberate (empty) choice.
    const locked = !hasAsi || asi.locked.includes(key);
    const fixed = hasAsi ? Number(asi.fixed?.[key] ?? 0) : 0;
    const allocated = state.backgroundAbilities[key] ?? 0;
    const bonus = fixed + allocated;
    const total = (base[key] ?? 8) + bonus;
    return {
      key,
      label: abilityLabel(key),
      total,
      bonus,
      // The background increase itself (+1/+2), not the ability modifier — the
      // stepper's `total` already shows the value the score is raised to.
      bonusLabel: bonus > 0 ? `+${bonus}` : "",
      locked,
      canInc: !locked && canIncrease(state, asi, key),
      canDec: !locked && allocated > 0
    };
  });

  return {
    selected: true,
    hasAsi,
    points: hasAsi ? asi.points : 0,
    cap: hasAsi ? asi.cap : 0,
    remaining,
    allSpent: remaining === 0,
    rows
  };
}
