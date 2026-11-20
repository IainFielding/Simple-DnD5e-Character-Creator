import { t, MODULE_ID } from "../../config.mjs";
import { setSpecialization, specializationsOfClass } from "../../data/specializations.mjs";

/**
 * The class's World of Warcraft specialization, changeable at level-up — the same choice the
 * creator's Class page offers ("Holy", "Protection", …; see data/specializations.mjs).
 *
 * One optional block at the head of the *first* level screen, so it is settled before the subclass,
 * feats and spells it recommends are picked on that screen and the ones after. It never gates a
 * level. The pick is written straight to the class item on the driver's clone: the other steps read
 * it from there, so their Recommended badges follow at once, and the commit carries it to the
 * character. A class added by multiclassing gets the same choice on its first level.
 *
 * Absent for a class its book describes no specializations for, and for anything without the module.
 */
export const specializationStep = {
  id: "specialization",
  icon: "fa-solid fa-compass",
  labelKey: "levelup.step.specialization.label",
  template: "levelup/specialization",

  isCompleteAt() {
    // Advice, not a decision the level needs.
    return true;
  },

  async sectionsAt({ state }, level) {
    if ( state.committed || !state.classItem ) return null;
    if ( level !== state.gainedLevels()[0] ) return null;
    const specs = await specializationsOfClass(state.classItem);
    if ( !specs.length ) return null;
    const current = state.classItem.flags?.[MODULE_ID]?.specialization ?? null;
    const chosen = specs.find(s => s.id === current) ?? null;
    return {
      blockStatus: chosen?.name ?? t("step.class.spec.none"),
      hint: t("step.class.spec.hint"),
      options: specs.map(s => ({ id: s.id, name: s.name, selected: s.id === chosen?.id })),
      chosen: !!chosen
    };
  },

  handle(action, el, { state }) {
    if ( action !== "specPick" ) return;
    setSpecialization(state.classItem, el.value || null);
  }
};
