import { t } from "../../config.mjs";
import { atLevel, advancementHint } from "../levelup-state.mjs";
import { choiceBlurb, findRestrictedItems, evalItemPrereq, groupRecommended } from "../../data/choice-resolver.mjs";

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

  // Feature level for the prerequisite gate below: the advancement's own level, falling back to the
  // character's total level for a class-linked granted feature whose ItemChoice keys at level 0
  // (otherwise the gate would filter out every option).
  const featureLevel = record.level || record.advancement.actor?.system?.details?.level || null;

  // Feat/feature identifiers the clone already holds, matched against a feat's item prerequisites
  // (a Warlock's Improved Pact Weapon needing Pact of the Blade). The map is keyed by identifier
  // slug, exactly what `evalItemPrereq` compares against.
  const owned = new Set(record.advancement.actor?.identifiedItems?.keys() ?? []);

  // Drop-restricted choices (e.g. the Artificer's "Replicate Magic Item") carry an empty static
  // pool; their options come from a compendium scan matching the restriction, gated to items the
  // character qualifies for by prerequisite level — mirroring the native ItemChoice flow. We carry
  // the scanned name/img (and item prerequisites) so those items don't each need a separate
  // `fromUuid` load.
  const meta = new Map();
  if ( cfg.allowDrops && (cfg.restriction?.subtype || cfg.restriction?.type) ) {
    for ( const opt of await findRestrictedItems(cfg, featureLevel) ) {
      meta.set(opt.uuid, { name: opt.label, img: opt.img, prereqItems: opt.prereqItems });
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
      // Prerequisite gate for a fresh (non-owned) option. Owned picks are folded in above and never
      // gated. A static-pool option is gated by both its level and its item prerequisites; a scanned
      // (meta) option is already level-gated by the scan, so only its item prerequisites remain. An
      // option whose item prerequisite the build satisfies is flagged `recommended` — the build
      // unlocked it, so it earns the "recommended" panel.
      const prereq = meta.has(uuid)
        ? { items: doc.prereqItems }
        : (doc.system?.prerequisites ?? {});
      if ( !meta.has(uuid) && featureLevel != null && Number(prereq.level ?? 0) > featureLevel ) return;
      const { hasReq, met } = evalItemPrereq(prereq.items, owned);
      if ( hasReq && !met ) return;
      const selected = st.selected.has(uuid);
      // Already held from another source (e.g. the base Fighting Style when picking a Champion's
      // extra one): show it enumerated but as taken, not a fresh pick — it can't be chosen twice.
      const taken = !selected && !!st.ownedElsewhere?.has(uuid);
      options.push({ uuid, name: doc.name, img: doc.img, owned: false, selected, taken,
        disabled: taken || (!selected && st.full), recommended: hasReq && met });
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
    // `exhausted` is the escape hatch for a quota the pool can no longer fill ("pick 2" with only
    // one option left because the rest are already owned): refreshed by sectionsAt each render —
    // the shell builds the active screen before it reads these flags — it counts as settled.
    return atLevel(state.choiceSteps, level).every(r => state.driver.choiceState(r).full || r.exhausted);
  },

  async sectionsAt({ state, driver }, level) {
    const records = atLevel(state.choiceSteps, level);
    if ( !records.length ) return null;
    const single = records.length === 1;
    const sections = [];
    for ( const record of records ) {
      const st = driver.choiceState(record);
      const hasOwned = st.replaceable && st.priorEntries.length > 0;
      const options = await buildOptions(record, st);
      record.exhausted = !st.full && !options.some(o => !o.owned && !o.selected && !o.disabled);
      sections.push({
        index: state.choiceSteps.indexOf(record),
        title: record.advancement.title || t("levelup.step.choices.choose"),
        count: t("levelup.step.choices.count", { current: st.current, max: st.max }),
        complete: st.full || record.exhausted,
        // The authored description when there is one; otherwise the creator's generated blurb, so
        // every decision reads with a sentence telling the player what the pick is.
        hint: (await advancementHint(record)) || choiceBlurb({ type: "ItemChoice", count: st.max }),
        replaceHint: hasOwned ? t("levelup.step.choices.replaceHint") : "",
        options,
        // A "Recommended" + "Other" split when the build unlocked any option (an item prerequisite
        // it satisfies, e.g. an invocation needing Pact of the Blade); null leaves the flat grid.
        groups: groupRecommended(options),
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
