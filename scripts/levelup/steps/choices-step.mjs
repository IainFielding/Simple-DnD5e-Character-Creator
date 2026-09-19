import { t, log } from "../../config.mjs";
import { advancementTitle } from "../../data/advancement-util.mjs";
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
/**
 * The option entries for a **spell**-type ItemChoice, whose pickable spells are a named class spell
 * list rather than an authored pool — a Paladin's Blessed Warrior ("learn two Cleric cantrips"), a
 * Ranger's Druidic Warrior, a Magic Initiate variant. The native flow leaves this pool empty and
 * sends the player to the compendium browser instead (filtered by spell list + level), so building
 * the grid ourselves is what keeps the decision inside the wizard.
 *
 * `restriction.list` names the list(s) as `class:<id>`; `restriction.level` fixes the spell level —
 * 0 for cantrips, 1 for first-level spells, and on up: {@link SpellSource#forSpellList} indexes the
 * list by level, so a feature offering a choice of 2nd-level Cleric spells draws from the same
 * place a Blessed Warrior does.
 *
 * `restriction.level` can also be **"available"** or **"availableNoCantrips"**: any spell the
 * character has slots for, from 0 or 1 up to the highest slot level. Arcana Unleashed's Savant
 * features ("add two Conjuration spells to your spellbook, then one more at each new slot level") are
 * all this shape. With no branch for it the list came back empty, the block was marked exhausted and
 * counted as complete, and the Savant pick was silently skipped. Anything else that is not a level
 * yields nothing, leaving the block to the authored pool and drop-scan.
 *
 * A spell choice that names **no** list and authors no pool is "any spell of this level", which is
 * how dnd5e's flow treats it: a browser filtered by level alone. The 2014 SRD Bard's *Magical
 * Secrets* ("two spells from any classes", `available`) and the 2014 Wizard's *Signature Spells*
 * (level 3) are this shape. Returning nothing for them had the same effect as the Savant bug: an
 * empty, "exhausted" block, and a pick the character silently never got.
 * @param {object} cfg                                          The advancement configuration.
 * @param {import("../../data/spell-source.mjs").SpellSource} spells
 * @param {object} [record]   The decision record, for the slot level an "available" restriction needs.
 * @returns {Promise<Map<string, {name: string, img: string}>>}  uuid -> option metadata.
 */
async function spellListOptions(cfg, spells, record = null) {
  const out = new Map();
  const raw = cfg.restriction?.level;
  const lists = Array.from(cfg.restriction?.list ?? []).map(l => String(l).replace(/^class:/, ""));
  // No list: any spell — unless the choice authors its own pool, which is then the whole offer.
  const anySpell = !lists.length && !Array.from(cfg.pool ?? []).length;
  if ( !lists.length && !anySpell ) return out;
  if ( !spells ) {
    log("spell choice: no spell source on this session, so its class list can't be offered");
    return out;
  }
  let levels;
  if ( (raw === "available") || (raw === "availableNoCantrips") ) {
    const max = record ? maxSpellSlotLevel(record) : 0;
    const min = raw === "availableNoCantrips" ? 1 : 0;
    levels = max >= min ? Array.from({ length: max - min + 1 }, (_, i) => min + i) : [];
  } else {
    const level = Number(raw);
    if ( !Number.isInteger(level) || (level < 0) || (level > 9) ) {
      log(`spell choice: no list pool for restriction level "${raw}"`);
      return out;
    }
    levels = [level];
  }
  if ( !levels.length ) return out;
  // `restriction.school` narrows the list to the named schools, as dnd5e's own flow filters its browser
  // and rejects a pick outside them (`ItemChoiceAdvancement#_validateItemType`). Arcana Unleashed's
  // Savants shipped without it, naming the school only in their hint text — raised upstream as
  // foundryvtt-premium-content#1748 — so this is honoured the moment the data carries it.
  const schools = new Set(cfg.restriction?.school ?? []);
  // Fetch the level-≤1 payload whenever the restriction allows it, and pick the bucket out of it:
  // that is the key the session warm-up already fills for the Magic Initiate lists
  // (cleric/druid/wizard), so a Blessed Warrior or Druidic Warrior pick reads a warm cache instead
  // of opening a second, level-0-only one. Only a choice above 1st level pays for its own load.
  const fetchLevel = Math.max(1, ...levels);
  for ( const listId of (anySpell ? [null] : lists) ) {
    try {
      const { byLevel } = listId ? await spells.forSpellList(listId, fetchLevel) : await spells.forAnySpell(fetchLevel);
      for ( const spell of levels.flatMap(l => byLevel?.[l] ?? []) ) {
        if ( !spell?.uuid ) continue;
        if ( schools.size && !schools.has(spell.schoolKey) ) continue;
        out.set(spell.uuid, { name: spell.name, img: spell.img });
      }
    } catch ( err ) {
      log(`spell choice: failed to load the "${listId}" list`, err);
    }
  }
  return out;
}

/**
 * The highest spell-slot level a decision's character has, the bound an "available" spell
 * restriction uses. The same arithmetic as dnd5e's `ItemChoiceFlow#_maxSpellSlotLevel`, with one
 * difference that matters here.
 *
 * The native manager levels its clone one step at a time, so the actor it reads is at the decision's
 * level. The driver walks the whole jump first, so its clone is already at the target level: a
 * 1→5 Wizard reading the actor would offer 3rd-level spells to the level-3 Savant pick, whose own text
 * caps it at 2nd. So with a single spellcasting class, its levels are capped at the decision's level
 * and the slots computed from that. With several classes there is no telling which one the feature
 * belongs to, and the actor's own slots are used, as the native flow does for a non-class item.
 * @param {object} record   A choice decision record.
 * @returns {number}
 */
function maxSpellSlotLevel(record) {
  const adv = record.advancement;
  const Actor5e = globalThis.CONFIG?.Actor?.documentClass;
  const slotsFor = (cls, spellcasting) => {
    const progression = Object.fromEntries(Object.keys(CONFIG.DND5E.spellcasting ?? {}).map(k => [k, 0]));
    const maxSpellLevel = Object.keys(CONFIG.DND5E.spellLevels ?? {}).length - 1;
    const spells = Object.fromEntries(Array.from({ length: Math.max(0, maxSpellLevel) }, (_, i) => [`spell${i + 1}`, {}]));
    Actor5e.computeClassProgression(progression, cls, { spellcasting });
    Actor5e.prepareSpellcastingSlots(spells, spellcasting.type, progression);
    return spells;
  };

  // Cap a class's spellcasting levels at the decision's level (see above). A record without a level
  // (a class-linked granted feature keyed at 0) has nothing to cap against and reads as-is.
  const capped = sc => (record.level ? { ...sc, levels: Math.min(sc.levels ?? record.level, record.level) } : sc);

  let spells;
  try {
    // The advancement's own item casts: a class, or a subclass through dnd5e's `spellcasting` getter,
    // whose `levels` are the parent class's — at the target level on the driver's clone, so capped too.
    if ( adv.item?.spellcasting?.type && Actor5e ) spells = slotsFor(adv.item, capped(adv.item.spellcasting));
    else {
      const casters = Object.values(adv.actor?.classes ?? {}).filter(c => c.spellcasting?.type);
      if ( (casters.length === 1) && record.level && Actor5e ) {
        spells = slotsFor(casters[0], capped(casters[0].spellcasting));
      } else spells = adv.actor?.system?.spells ?? {};
    }
  } catch ( err ) {
    log("spell choice: could not compute the available slot level", err);
    spells = adv.actor?.system?.spells ?? {};
  }
  return Object.values(spells).reduce((slot, s) => (s?.max ? Math.max(slot, s.level || -1) : slot), 0);
}

async function buildOptions(record, st, spells) {
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
  // A spell choice draws on a class spell list, not the (empty) authored pool. Same `meta` channel:
  // the entries carry their own name/img, so no option needs a separate `fromUuid`.
  if ( cfg.type === "spell" ) {
    for ( const [uuid, entry] of await spellListOptions(cfg, spells, record) ) meta.set(uuid, entry);
  }

  const uuids = [...new Set([...pool, ...extraPriors, ...meta.keys()])];
  const docs = await Promise.all(uuids.map(u => meta.has(u) ? meta.get(u) : fromUuid(u).catch(() => null)));
  const options = [];
  // Collapse the same feature carried under different UUIDs (an invocation shared across edition
  // packs) to one card. Owned/prior picks always show and reserve their name; a fresh option whose
  // name is already taken is dropped. `findRestrictedItems` already name-dedupes the scanned pool,
  // so this guards the authored pool vs. scan overlap.
  const seenNames = new Set();
  const nameKey = n => (n ?? "").trim().toLowerCase();
  docs.forEach((doc, i) => {
    if ( !doc ) return;
    const uuid = uuids[i];
    const prior = priorByUuid.get(uuid);
    if ( prior ) {
      seenNames.add(nameKey(doc.name));
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
      const nk = nameKey(doc.name);
      if ( seenNames.has(nk) ) return;   // a same-named copy already listed (another edition pack)
      seenNames.add(nk);
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

  async sectionsAt({ state, driver, spells }, level) {
    const records = atLevel(state.choiceSteps, level);
    if ( !records.length ) return null;
    // One block per decision (see trait-step.mjs for why): each feature pick keeps its own
    // collapsible panel, titled and counted in its header.
    const blocks = [];
    for ( const record of records ) {
      const st = driver.choiceState(record);
      const hasOwned = st.replaceable && st.priorEntries.length > 0;
      const options = await buildOptions(record, st, spells);
      record.exhausted = !st.full && !options.some(o => !o.owned && !o.selected && !o.disabled);
      const section = {
        index: state.choiceSteps.indexOf(record),
        title: advancementTitle(record.advancement) || t("levelup.step.choices.choose"),
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
        // The block header carries the title and count, so the body never repeats them.
        collapsed: true
      };
      blocks.push({
        key: record.advancement.id ?? String(section.index),
        blockLabel: section.title,
        blockStatus: section.count,
        complete: section.complete,
        // A large pool (a long spell/feature list) packs into smaller cards; a short pick stays roomy.
        density: options.length >= 9 ? "compact" : "standard",
        sections: [section]
      });
    }
    return blocks;
  },

  async handle(action, el, { state, driver }) {
    const record = state.choiceSteps[Number(el.dataset.index)];
    if ( !record ) return;
    if ( action === "choiceToggle" && el.dataset.uuid ) await driver.toggleChoice(record, el.dataset.uuid);
    else if ( action === "choiceReplace" && el.dataset.original ) await driver.toggleReplacement(record, el.dataset.original);
  }
};
