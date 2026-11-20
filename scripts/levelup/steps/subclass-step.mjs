import { atLevel } from "../levelup-state.mjs";
import { pinContext } from "../../app/compare.mjs";
import { hasSourcePage } from "../../data/journal-source.mjs";
import { recommends, recommendsAny, specializationOf } from "../../data/specializations.mjs";
import { t } from "../../config.mjs";

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

  async sectionsAt({ state, driver, source, app }, level) {
    // A class unlocks its subclass at one level, so a screen surfaces at most one such decision.
    const record = atLevel(state.subclassSteps, level)[0];
    if ( !record ) return null;

    const sub = driver.subclassState(record);
    const identifier = record.advancement.item.identifier;
    // Scoped to the levelling class's own edition: a world can hold both, and a 2024 subclass grants
    // its features on the 2024 progression. See `SourceIndex#subclasses`.
    const rules = record.advancement.item.system?.source?.rules ?? null;
    // A class whose subclass is fixed — a World of Warcraft Death Knight is always Oath of the Ebon
    // Blade — offers only that one; dnd5e's own Subclass advancement refuses any other.
    const fixed = fixedSubclass(record);
    // The subclass the class's World of Warcraft specialization names, badged on its card.
    const spec = await specializationOf(record.advancement.item);
    const suggested = recommendsAny(spec, "subclass") ? t("step.class.spec.recommended", { spec: spec.name }) : null;
    const cards = (await source.subclasses(identifier, { rules }))
      .filter(c => !fixed || (c.uuid === fixed))
      .map(c => ({ ...c, selected: c.uuid === sub.uuid, suggested: recommends(spec, "subclass", c) ? suggested : null }));
    const detail = sub.uuid ? await source.detail(sub.uuid) : null;
    const groups = sub.uuid ? await source.advancementGroups(sub.uuid) : null;

    return {
      index: state.subclassSteps.indexOf(record),
      // The pick this feature exists for. A subclass is a whole progression, and this pane shows
      // one at a time — so the block carries pin-decorated cards and the compare control, exactly
      // as the creation pickers do. Inert without a shell, so the block still builds in tests.
      ...pinContext(app?.pins, "subclass", cards),
      count: cards.length, hasSelection: !!sub.uuid, detail, groups,
      // The subclass's own page from the source book — its full progression through level 20, which
      // this short pane cannot hold. Offered only when the active package ships one.
      sourceUuid: (sub.uuid && await hasSourcePage(sub.uuid)) ? sub.uuid : null,
      // A defining, one-of pick — the largest tier; the header echoes the chosen subclass.
      density: "hero",
      blockStatus: sub.chosen ? sub.name : null,
      // A second header pill naming the sourcebook the chosen subclass comes from (e.g. "Tasha's
      // Cauldron of Everything"), sitting beside the subclass-name pill. Empty when unknown.
      blockSource: sub.chosen ? (detail?.source || null) : null
    };
  },

  async handle(action, el, { state, driver }) {
    if ( action !== "pick-subclass" ) return;
    const record = state.subclassSteps[Number(el.dataset.index)];
    if ( !record || !el.dataset.uuid ) return;
    // A fixed subclass cannot be cleared: re-clicking it would leave a pick nothing else can fill.
    const fixed = fixedSubclass(record);
    if ( fixed && (el.dataset.uuid === fixed) && (record.advancement.value?.uuid === fixed) ) return false;
    await driver.selectSubclass(record, el.dataset.uuid);
  }
};

/** The subclass a class's Subclass advancement is locked to (`suggested.fixed`), or null. */
function fixedSubclass(record) {
  const suggested = record?.advancement?.configuration?.suggested;
  return (suggested?.fixed && suggested.uuid) ? suggested.uuid : null;
}
