import { t } from "../config.mjs";

/**
 * The Spells step: for a spellcasting class, choose the cantrips and level-1 spells
 * known at level 1. The left column lists the class's spells for the active tab; the
 * right column shows the focused spell with a select/deselect control.
 *
 * Completion gates the build: a spellcaster must choose every cantrip and level-1 spell
 * it knows before the step counts as done. A non-caster has nothing to pick, so the step
 * never blocks — and the rail greys it out via {@link spellsStep.applicable}. The known
 * counts come from {@link spellInfoFor}, cached on `state.spellInfo` so this stays sync.
 */
export const spellsStep = {
  id: "spells",
  icon: "fa-solid fa-wand-magic-sparkles",
  labelKey: "step.spells.label",
  template: "steps/spells",

  isComplete(state) {
    const info = state.spellInfo;
    if ( !info ) return false;            // no class chosen yet — not started, so no tick
    if ( !info.isSpellcaster ) return true; // non-caster: nothing to choose (rail greys it)
    return state.selectedCantrips.length >= info.maxCantrips
        && state.selectedSpells.length >= info.maxSpells;
  },

  // The Spells step only applies to spellcasters; the rail greys it out otherwise.
  applicable(state) {
    return state.spellInfo ? state.spellInfo.isSpellcaster : true;
  },

  /** Rail summary: how many spells are picked (cantrips + level-1). */
  summary(state) {
    const n = state.selectedCantrips.length + state.selectedSpells.length;
    return n ? t("step.spells.picked", { count: n }) : "";
  },

  async handle(action, el, { state, spells }) {
    if ( action === "spell-tab" ) {
      state.spellTab = el.dataset.tab;
      state.focusedSpellUuid = null;
      return;
    }
    if ( action === "focus-spell" ) {
      state.focusedSpellUuid = el.dataset.uuid;
      return;
    }
    if ( action === "pick-spell" ) {
      const data = await spells.forClass(state.classUuid);
      if ( !data.isSpellcaster ) return;
      const uuid = el.dataset.uuid;
      const isCantrip = Number(el.dataset.level) === 0;
      const bucket = isCantrip ? state.selectedCantrips : state.selectedSpells;
      const idx = bucket.findIndex(s => s.uuid === uuid);
      if ( idx >= 0 ) { bucket.splice(idx, 1); return; }
      // Selecting: ignore the click once the known-spell limit is reached.
      const max = isCantrip ? data.maxCantrips : data.maxSpells;
      if ( bucket.length >= max ) return;
      const spell = (isCantrip ? data.cantrips : data.level1).find(s => s.uuid === uuid);
      if ( spell ) bucket.push({ uuid: spell.uuid, id: spell.id, name: spell.name, img: spell.img, level: spell.level });
    }
  },

  async context({ state, spells }) {
    const data = await spells.forClass(state.classUuid);
    // Keep the completion gate's view of the class in sync with what we render.
    state.spellInfo = {
      isSpellcaster: !!data.isSpellcaster,
      maxCantrips: data.maxCantrips ?? 0,
      maxSpells: data.maxSpells ?? 0
    };
    if ( !data.isSpellcaster ) {
      return { isSpellcaster: false, hint: t("step.spells.noCaster") };
    }

    const { cantrips, level1, maxCantrips, maxSpells } = data;
    const picked = new Set([...state.selectedCantrips, ...state.selectedSpells].map(s => s.uuid));

    // Resolve the active tab, falling back when the class lacks that level of spell.
    let tab = state.spellTab;
    if ( tab === "cantrips" && maxCantrips === 0 ) tab = "level1";
    if ( tab === "level1" && maxSpells === 0 ) tab = "cantrips";

    const activeBucket = tab === "cantrips" ? state.selectedCantrips : state.selectedSpells;
    const activeMax = tab === "cantrips" ? maxCantrips : maxSpells;
    const atLimit = activeBucket.length >= activeMax;
    const pool = tab === "cantrips" ? cantrips : level1;

    const list = pool.map(s => ({
      ...s,
      active: picked.has(s.uuid),
      focused: state.focusedSpellUuid === s.uuid,
      disabled: atLimit && !picked.has(s.uuid)
    }));

    // Focused spell detail (with its lazily-enriched description).
    let focused = null;
    const focus = list.find(s => s.uuid === state.focusedSpellUuid)
      ?? cantrips.concat(level1).find(s => s.uuid === state.focusedSpellUuid);
    if ( focus ) {
      focused = {
        ...focus,
        active: picked.has(focus.uuid),
        description: await spells.description(focus.uuid)
      };
    }

    return {
      isSpellcaster: true,
      tab,
      isCantripsTab: tab === "cantrips",
      isLevel1Tab: tab === "level1",
      hasCantrips: maxCantrips > 0,
      hasLevel1: maxSpells > 0,
      maxCantrips,
      maxSpells,
      cantripCount: state.selectedCantrips.length,
      spellCount: state.selectedSpells.length,
      cantripsFull: maxCantrips > 0 && state.selectedCantrips.length >= maxCantrips,
      spellsFull: maxSpells > 0 && state.selectedSpells.length >= maxSpells,
      atLimit,
      list,
      count: list.length,
      focused
    };
  }
};

/**
 * Slim spellcasting summary for the completion gate — caster flag plus the cantrips/spells
 * known at level 1 — read from the (memoised) {@link SpellSource}. Cached on
 * `state.spellInfo` so the synchronous `isComplete`/`applicable` checks can use it.
 */
export async function spellInfoFor(spells, classUuid) {
  if ( !classUuid ) return null;
  const info = await spells.forClass(classUuid);
  return {
    isSpellcaster: !!info.isSpellcaster,
    maxCantrips: info.maxCantrips ?? 0,
    maxSpells: info.maxSpells ?? 0
  };
}
