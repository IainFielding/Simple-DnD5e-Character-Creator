import { t } from "../config.mjs";
import { resolveChoices, choicesComplete } from "../data/choice-resolver.mjs";
import { describeOption } from "../data/equipment-source.mjs";

/**
 * The Choices step: every player decision a chosen origin defers to level ≤ 1 —
 * skill/tool/language/weapon proficiencies, Expertise, size, "choose a feature"
 * (ItemChoice), spellcasting-ability picks — grouped under the source that grants them.
 *
 * The advancement engine lives in {@link module:data/choice-resolver}; this step just
 * renders its requirements and records picks into `state.advChoices`. Completion gates
 * the build, so the cached resolution is kept fresh on every pick.
 *
 * The starting-equipment picker is also shown here, but it's purely informational — it
 * never affects whether the step counts as complete.
 */
export const choicesStep = {
  id: "choices",
  icon: "fa-solid fa-list-check",
  labelKey: "step.choices.label",
  template: "steps/choices",

  // Reads the cache the resolver refreshes on every relevant change (sync gate). Only the
  // advancement choices gate the build; the equipment selection is always informational.
  // Until a class is picked the cache is null — treat that as not-yet-complete so the rail
  // doesn't show a tick before any choice has been made.
  isComplete(state) {
    return state.choiceCache ? choicesComplete(state.choiceCache) : false;
  },

  /** Rail summary: "3/4 made" once there's anything to decide. */
  summary(state) {
    const resolved = state.choiceCache;
    if ( !resolved?.hasAny ) return "";
    let total = 0, done = 0;
    for ( const s of resolved.sources ) for ( const r of s.requirements ) { total++; if ( r.complete ) done++; }
    return total ? t("step.choices.progress", { done, total }) : "";
  },

  async handle(action, el, { state, source }) {
    // Switch the visible origin tab. Purely a UI concern; the dispatcher re-renders.
    if ( action === "choice-tab" ) {
      if ( el.dataset.tab ) state.choiceTab = el.dataset.tab;
      return;
    }

    // Equipment picks are informational — they never change completion.
    if ( action === "equip-option" ) {
      const eq = state.equipment[el.dataset.equipSource];
      const idx = Number(el.dataset.index);
      if ( eq && Number.isInteger(idx) ) eq.selectedOption = idx;
      return;
    }
    if ( action === "equip-or" ) {
      const eq = state.equipment[el.dataset.equipSource];
      if ( eq ) eq.orSelections[el.dataset.group] = el.dataset.option;
      return;
    }

    if ( action !== "pick-choice" ) return;
    const { choiceSource, selKey, key } = el.dataset;
    const bucket = state.advChoices[choiceSource];
    if ( !bucket || !selKey || key == null ) return;

    const max = Number(el.dataset.count) || 1;
    const cur = bucket[selKey] ? [...bucket[selKey]] : [];
    const idx = cur.indexOf(key);
    if ( idx >= 0 ) {
      cur.splice(idx, 1);                 // toggle off
    } else if ( max === 1 ) {
      bucket[selKey] = [key];             // single-select: replace
      state.choiceCache = await resolveChoices(state, source);
      return;
    } else {
      if ( cur.length >= max ) cur.shift(); // at cap: drop the oldest pick
      cur.push(key);
    }
    bucket[selKey] = cur;
    state.choiceCache = await resolveChoices(state, source);
  },

  async context({ state, source, equipment }) {
    const resolved = await resolveChoices(state, source);
    state.choiceCache = resolved;

    const loaded = await equipment.load(state, source);
    const equipList = [];
    for ( const key of ["class", "background"] ) {
      if ( loaded[key] ) equipList.push({ key, name: loaded[key].name, img: loaded[key].img, ...describeOption(loaded[key], state.equipment[key]) });
    }
    const hasEquipment = equipList.length > 0;

    // One tab per choice source, plus an equipment tab. Each origin tab carries a
    // done/total progress so its badge can show a tick or a count without re-counting
    // in the template.
    const tabs = resolved.sources.map(s => {
      const total = s.requirements.length;
      const done = s.requirements.filter(r => r.complete).length;
      return { key: s.key, name: s.name, img: s.img, done, total, complete: total > 0 && done === total };
    });
    if ( hasEquipment ) tabs.push({ key: "equipment", name: t("equipment.heading"), isEquipment: true });

    // Resolve the active tab, surviving re-renders. If the remembered tab no longer exists
    // (an origin changed and dropped its choices) fall back to the first available.
    const keys = tabs.map(tb => tb.key);
    if ( !keys.includes(state.choiceTab) ) state.choiceTab = keys[0] ?? null;
    for ( const tb of tabs ) tb.active = tb.key === state.choiceTab;

    return {
      hasChoices: resolved.hasAny,
      sources: resolved.sources.map(s => ({ ...s, active: s.key === state.choiceTab })),
      tabs,
      hasTabs: tabs.length > 1,
      equipment: equipList,
      hasEquipment,
      equipActive: state.choiceTab === "equipment",
      isEmpty: !resolved.hasAny && !hasEquipment
    };
  }
};
