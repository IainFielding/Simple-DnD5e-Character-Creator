import { t } from "../../config.mjs";
import { atLevel } from "../levelup-state.mjs";

/**
 * Trait choices — the choice-bearing `Trait` advancements a level grants. Weapon Mastery is the
 * common one (choose N weapons to master), but the same screen serves any trait pick (a bonus
 * language, an extra skill, …). Each decision is a single selectable grid; picks apply straight to
 * the driver's clone via the advancement's own apply/reverse, so Review and the committed actor
 * reflect exactly what is shown here.
 *
 * Unselecting a pick frees a slot and re-enables the pool — which is also how the player swaps one
 * choice for another before applying.
 */

/**
 * Bucket trait options by their category (Simple vs Martial Weapons, …), preserving the options'
 * existing sort within each. A single category yields one unlabelled group, so non-weapon traits
 * (or pools that don't split) render as a plain grid.
 * @param {object[]} options   The flat option list from {@link LevelUpDriver#traitOptions}.
 * @returns {{ key: string, label: string, options: object[] }[]}
 */
function groupOptions(options) {
  const groups = new Map();
  for ( const opt of options ) {
    if ( !groups.has(opt.groupKey) ) groups.set(opt.groupKey, { key: opt.groupKey, label: opt.groupLabel, options: [] });
    groups.get(opt.groupKey).options.push(opt);
  }
  const list = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  // A lone group needs no header — drop its label so the template skips it.
  if ( list.length === 1 ) list[0].label = "";
  return list;
}

export const traitStep = {
  id: "traits",
  icon: "fa-solid fa-khanda",
  labelKey: "levelup.step.traits.label",
  template: "levelup/trait",

  isCompleteAt(state, level) {
    // `exhausted` is the escape hatch for a quota the pool can no longer fill ("pick 2 weapons"
    // when the character already masters all but one): refreshed by sectionsAt each render — the
    // shell builds the active screen before it reads these flags — it counts as settled.
    return atLevel(state.traitSteps, level).every(r => state.driver.traitState(r).full || r.exhausted);
  },

  async sectionsAt({ state, driver }, level) {
    const records = atLevel(state.traitSteps, level);
    if ( !records.length ) return null;
    const single = records.length === 1;
    const sections = [];
    for ( const record of records ) {
      const st = driver.traitState(record);
      const options = await driver.traitOptions(record);
      record.exhausted = !st.full && !options.some(o => !o.owned && !o.selected && !o.disabled);
      sections.push({
        index: state.traitSteps.indexOf(record),
        title: record.advancement.title || t("levelup.step.traits.choose"),
        count: t("levelup.step.traits.count", { current: st.current, max: st.max }),
        complete: st.full || record.exhausted,
        groups: groupOptions(options),
        // A lone section shows its title/count in the block header instead of repeating it inside.
        collapsed: single
      });
    }
    // Density from the busiest section: art-less keyword pools (languages) become inline chips; a
    // big iconned pool (Weapon Mastery's many weapons) packs into compact cards.
    const counts = sections.map(s => s.groups.reduce((n, g) => n + g.options.length, 0));
    const anyImg = sections.some(s => s.groups.some(g => g.options.some(o => o.img)));
    return {
      density: !anyImg ? "chip" : (Math.max(...counts) >= 9 ? "compact" : "standard"),
      blockLabel: single ? sections[0].title : null,
      blockStatus: single ? sections[0].count : null,
      sections
    };
  },

  async handle(action, el, { state, driver }) {
    const record = state.traitSteps[Number(el.dataset.index)];
    if ( !record ) return;
    if ( action === "traitToggle" && el.dataset.key ) await driver.toggleTrait(record, el.dataset.key);
  }
};
