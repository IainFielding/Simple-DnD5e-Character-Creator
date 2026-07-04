import { t } from "../../config.mjs";
import { atLevel } from "../levelup-state.mjs";
import { findRestrictedItems } from "../../data/choice-resolver.mjs";

/**
 * Feature choices — the `ItemChoice` advancements a level grants (a Fighting Style, a Maneuver,
 * a Metamagic option, …). Each decision is a single selectable list. Picks apply straight to the
 * driver's clone via the advancement's own grant/ungrant, so Review and the committed actor
 * reflect exactly what is shown here.
 *
 * When the level allows replacement and the character already owns a pick, that pick appears in
 * the same list shown as selected: unticking it marks it for replacement (freeing a slot so the
 * other options enable), and ticking a different one swaps it in.
 */

/**
 * Build the unified option list for one decision: the configured pool, with any already-owned
 * pick folded in (and any owned pick that isn't in the pool appended), each flagged as a normal
 * choice or an owned/replaceable one.
 */
async function buildOptions(record, st) {
  const cfg = record.advancement.configuration ?? {};
  const pool = Array.from(cfg.pool ?? []).map(p => p.uuid ?? p);
  const priorByUuid = new Map(st.priorEntries.map(e => [e.uuid, e]));
  const extraPriors = st.priorEntries.filter(e => !pool.includes(e.uuid)).map(e => e.uuid);

  // Drop-restricted choices (e.g. the Artificer's "Replicate Magic Item") carry an empty static
  // pool; their options come from a compendium scan matching the restriction, gated to items the
  // character qualifies for by prerequisite level — mirroring the native ItemChoice flow. We carry
  // the scanned name/img so those items don't each need a separate `fromUuid` load.
  const meta = new Map();
  if ( cfg.allowDrops && (cfg.restriction?.subtype || cfg.restriction?.type) ) {
    // Mirror the native flow's `featureLevel`: the advancement's own level, falling back to the
    // character's total level for a class-linked granted feature whose ItemChoice keys at level 0
    // (otherwise the prerequisite gate would filter out every option).
    const featureLevel = record.level || record.advancement.actor?.system?.details?.level;
    for ( const opt of await findRestrictedItems(cfg, featureLevel ?? null) ) {
      meta.set(opt.uuid, { name: opt.label, img: opt.img });
    }
  }

  const uuids = [...new Set([...pool, ...extraPriors, ...meta.keys()])];
  const docs = await Promise.all(uuids.map(u => meta.has(u) ? meta.get(u) : fromUuid(u).catch(() => null)));
  const options = [];
  docs.forEach((doc, i) => {
    if ( !doc ) return;
    const uuid = uuids[i];
    const prior = priorByUuid.get(uuid);
    if ( prior ) {
      // Owned: selected unless it's currently marked for replacement. Never disabled — unticking
      // it is how the player frees the slot to swap.
      options.push({ uuid, name: doc.name, img: doc.img, owned: true, originalId: prior.id, selected: st.replacing !== prior.id });
    } else {
      const selected = st.selected.has(uuid);
      options.push({ uuid, name: doc.name, img: doc.img, owned: false, selected, disabled: !selected && st.full });
    }
  });
  // A scanned pool has no meaningful authored order, so sort it alphabetically for scanability;
  // a small static pool (fighting styles, maneuvers) keeps its authored order.
  if ( meta.size ) options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  return options;
}

export const choicesStep = {
  id: "choices",
  icon: "fa-solid fa-list-check",
  labelKey: "levelup.step.choices.label",
  template: "levelup/choices",

  isCompleteAt(state, level) {
    return atLevel(state.choiceSteps, level).every(r => state.driver.choiceState(r).full);
  },

  async sectionsAt({ state, driver }, level) {
    const records = atLevel(state.choiceSteps, level);
    if ( !records.length ) return null;
    const single = records.length === 1;
    const sections = [];
    for ( const record of records ) {
      const st = driver.choiceState(record);
      const hasOwned = st.replaceable && st.priorEntries.length > 0;
      sections.push({
        index: state.choiceSteps.indexOf(record),
        title: record.advancement.title || t("levelup.step.choices.choose"),
        count: t("levelup.step.choices.count", { current: st.current, max: st.max }),
        complete: st.full,
        hint: hasOwned ? t("levelup.step.choices.replaceHint") : "",
        options: await buildOptions(record, st),
        // A lone section shows its title/count in the block header instead of repeating it inside.
        collapsed: single
      });
    }
    const maxOptions = Math.max(...sections.map(s => s.options.length));
    return {
      // A large pool (a long spell/feature list) packs into smaller cards; a short pick stays roomy.
      density: maxOptions >= 9 ? "compact" : "standard",
      blockLabel: single ? sections[0].title : null,
      blockStatus: single ? sections[0].count : null,
      sections
    };
  },

  async handle(action, el, { state, driver }) {
    const record = state.choiceSteps[Number(el.dataset.index)];
    if ( !record ) return;
    if ( action === "choiceToggle" && el.dataset.uuid ) await driver.toggleChoice(record, el.dataset.uuid);
    else if ( action === "choiceReplace" && el.dataset.original ) await driver.toggleReplacement(record, el.dataset.original);
  }
};
