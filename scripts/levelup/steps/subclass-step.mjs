import { atLevel } from "../levelup-state.mjs";

/**
 * Subclass — at the level a class unlocks it, choose the subclass. Presented exactly like the
 * creator's class screen: a pick-list of the class's subclasses on the left, the selected
 * subclass's description and features filling the panel to the right.
 *
 * Picking a subclass grants its item and synthesises its features (the driver folds them into the
 * other decisions, so a Features step may appear after this one); re-picking clears it.
 */
export const subclassStep = {
  id: "subclass",
  icon: "fa-solid fa-sitemap",
  labelKey: "levelup.step.subclass.label",
  template: "levelup/subclass",

  isCompleteAt(state, level) {
    const record = atLevel(state.subclassSteps, level)[0];
    return !record || state.driver.subclassState(record).chosen;
  },

  async sectionsAt({ state, driver, source }, level) {
    // A class unlocks its subclass at one level, so a screen surfaces at most one such decision.
    const record = atLevel(state.subclassSteps, level)[0];
    if ( !record ) return null;

    const sub = driver.subclassState(record);
    const identifier = record.advancement.item.identifier;
    const cards = (await source.subclasses(identifier)).map(c => ({ ...c, selected: c.uuid === sub.uuid }));
    const detail = sub.uuid ? await source.detail(sub.uuid) : null;
    const groups = sub.uuid ? await source.advancementGroups(sub.uuid) : null;

    return {
      index: state.subclassSteps.indexOf(record),
      cards, count: cards.length, hasSelection: !!sub.uuid, detail, groups,
      // A defining, one-of pick — the largest tier; the header echoes the chosen subclass.
      density: "hero",
      blockStatus: sub.chosen ? sub.name : null
    };
  },

  async handle(action, el, { state, driver }) {
    if ( action !== "pick-subclass" ) return;
    const record = state.subclassSteps[Number(el.dataset.index)];
    if ( record && el.dataset.uuid ) await driver.selectSubclass(record, el.dataset.uuid);
  }
};
