/**
 * Factory that builds an "origin" selection step (class, species, background).
 *
 * All three present a filterable grid of cards; picking one records its UUID on
 * the state and reveals its enriched description inline. Rather than repeat that
 * across three modules, each step is produced by configuring this factory with
 * the state field it writes and the card list it reads. This composition is the
 * unit of reuse here — there is no shared base Application doing the work.
 *
 * For a junior dev — this is a good place to learn the "step module" shape that EVERY step
 * in scripts/steps/ follows. A step is just a plain object the shell (creator-shell.mjs) calls:
 *   id, icon, labelKey, template  – identity + which rail entry and .hbs template it uses
 *   isComplete(state)             – may the player move past this step? drives the Next gate + tick
 *   incompleteHint(state)         – if not complete, the tooltip explaining what's missing
 *   summary(state, source)        – the short line shown under the step in the rail once chosen
 *   handle(action, el, ctx)       – react to a click/change; mutate state (return false to skip re-render)
 *   context(ctx)                  – build the data object this step's template renders with
 * Optional extras some steps add: onEnter, applicable, hideWhenInapplicable. The shell knows
 * nothing about classes or spells — it just calls these methods, so each step stays self-contained.
 *
 * @param {object} cfg
 * @param {string} cfg.id           Step id (also its rail/template key).
 * @param {string} cfg.icon         FontAwesome classes for the rail.
 * @param {string} cfg.labelKey     i18n key for the step label.
 * @param {string} [cfg.instructionKey]  i18n key for the one-line instruction under the heading.
 * @param {string} cfg.field        CreatorState property holding the chosen UUID.
 * @param {string} [cfg.hintKey]    i18n key for the "nothing picked yet" Next-button hint.
 * @param {string} [cfg.rulesTopic]  Topic key for the "Read the Rules" control (see
 *   {@link module:data/rules-source}). Omit and the step shows no such control.
 * @param {"species"|"background"} [cfg.asiSource]  Compose in the shared ability-increase panel
 *   under this origin key. Set for the species (a 2014 species grants an increase; a 2024 one does
 *   not, and then no aside renders). Omit and the step behaves as a plain grid.
 * @param {boolean} [cfg.lineage]  Ask the origin's lineage beside it — see {@link lineageRequirements}.
 * @param {(src: import("../data/source-index.mjs").SourceIndex,
 *           state: import("../state/creator-state.mjs").CreatorState) => object[]} cfg.cards
 * @returns {object} A step module.
 */
import { resolveChoices } from "../data/choice-resolver.mjs";
import { choicesStep } from "./choices-step.mjs";
import { t } from "../config.mjs";
import { pinContext } from "../app/compare.mjs";
import { hasRulesPage } from "../data/rules-source.mjs";
import {
  ASI_ACTIONS, asiComplete, asiContext, asiHandle, asiHint, asiSummary
} from "./origin-abilities-panel.mjs";

/**
 * The lineage-style choices one origin raises: a choice among species features (an Elf's lineage,
 * a Dragonborn's ancestry, a Tiefling's legacy), flagged `lineage` by the resolver. Only those that
 * have something to offer — an empty pool must never hold the step shut.
 *
 * Nothing here names a species or a lineage. The resolver's pool is the species' own list plus any
 * lineage another module adds whose prerequisite names this species, so new content shows up here
 * without any change to this code.
 * @param {object} state      The creator state.
 * @param {string} sourceKey  The resolver source key, which is the step id ("species").
 * @returns {object[]}        The matching requirements.
 */
export function lineageRequirements(state, sourceKey) {
  return (state.choiceCache?.sources ?? [])
    .filter(s => s.key === sourceKey)
    .flatMap(s => s.requirements)
    .filter(r => r.lineage && (r.options?.length ?? 0) > 0);
}

/* -------------------------------------------- */
/*  Lineage cards                               */
/* -------------------------------------------- */

/** SourceIndex → (species uuid → promise of its card lineage, or null). Per index, so a source change starts over. */
const LINEAGE_MEMO = new WeakMap();

/**
 * The lineage choice a species' grid cards are split by: the first lineage-style choice the resolver
 * raises for that species on its own, with every option it offers (the species' pool plus any
 * lineage another module adds for it). Null for a species with none.
 *
 * Asked of the resolver itself, against a throwaway state holding only the species — the same
 * probe `warmChoices` runs at load, so this is normally a cache hit — so the cards and the side panel
 * can never disagree about what a species' lineages are. Memoised per species.
 * @param {import("../data/source-index.mjs").SourceIndex} source
 * @param {string} speciesUuid
 * @returns {Promise<{selKey: string, title: string, options: {key: string, uuid: string, label: string}[]}|null>}
 */
export function cardLineage(source, speciesUuid) {
  let memo = LINEAGE_MEMO.get(source);
  if ( !memo ) LINEAGE_MEMO.set(source, memo = new Map());
  if ( !memo.has(speciesUuid) ) {
    const promise = (async () => {
      const probe = { classUuid: null, speciesUuid, backgroundUuid: null, advChoices: {} };
      const resolved = await resolveChoices(probe, source);
      const req = (resolved?.sources ?? [])
        .filter(s => s.key === "species")
        .flatMap(s => s.requirements)
        .find(r => r.lineage && (r.options?.length ?? 0) > 0);
      if ( !req ) return null;
      return {
        selKey: req.selKey,
        title: req.title,
        options: req.options.map(o => ({ key: o.key, uuid: o.uuid ?? o.key, label: o.label }))
      };
    })().catch(err => { memo.delete(speciesUuid); throw err; });
    memo.set(speciesUuid, promise);
  }
  return memo.get(speciesUuid);
}

/**
 * Expand a species grid so a species with a lineage shows one card per lineage — "Elf (Drow)",
 * "Elf (Blood Elf)" — rather than one "Elf" card and a choice beside it. Each such card carries the
 * lineage it picks (`lineageKey`) and the decision it answers (`lineageSel`); a species without a
 * lineage keeps its single card. A species whose lineage cannot be resolved also keeps its card,
 * and the side panel asks as before.
 * @param {import("../data/source-index.mjs").SourceIndex} source
 * @param {object[]} cards   The species cards.
 * @returns {Promise<object[]>}
 */
async function lineageCards(source, cards) {
  const out = [];
  for ( const card of cards ) {
    let lineage = null;
    try { lineage = await cardLineage(source, card.uuid); } catch { /* keep the plain card */ }
    if ( !lineage ) { out.push(card); continue; }
    const options = [...lineage.options].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    for ( const opt of options ) {
      out.push({
        ...card,
        name: t("step.species.lineage.card", { species: card.name, lineage: opt.label }),
        lineageKey: opt.key,
        lineageUuid: opt.uuid,
        lineageSel: lineage.selKey
      });
    }
  }
  return out;
}

/** The lineage the player holds for a species-step decision, or null. */
function pickedLineage(state, sourceKey, selKey) {
  const picks = state.advChoices?.[sourceKey]?.[selKey];
  const first = picks ? Array.from(picks)[0] : null;
  return (typeof first === "string") ? first : (first?.uuid ?? null);
}

/** The aside's render data, or null when the origin raises no lineage choice. */
function lineageContext(state, sourceKey, speciesName, carded = null) {
  // The lineage the grid card already chose is not asked again — unless it somehow went unanswered
  // (Quick Build, a draft from before the cards), when the panel is the only place left to answer it.
  const blocks = lineageRequirements(state, sourceKey).filter(r => !(carded && (r.selKey === carded) && r.complete));
  if ( !blocks.length ) return null;
  return {
    blocks,
    prompt: t("step.species.lineage.prompt", { species: speciesName }),
    changeHint: t("step.species.lineage.change")
  };
}

export function originStep({ id, icon, labelKey, instructionKey, field, cards, hintKey, asiSource, rulesTopic, lineage }) {
  return {
    id,
    icon,
    labelKey,
    instructionKey,
    template: "steps/origin",

    isComplete(state) {
      if ( !state[field] ) return false;
      if ( lineage && lineageRequirements(state, id).some(r => !r.complete) ) return false;
      return asiSource ? asiComplete(state, asiSource) : true;
    },

    /** Why Next is blocked: nothing picked yet, or increase points still to spend. */
    incompleteHint(state) {
      if ( !state[field] ) return hintKey ? t(hintKey) : null;
      const open = lineage ? lineageRequirements(state, id).find(r => !r.complete) : null;
      if ( open ) return t("step.species.lineage.hint", { title: open.title });
      return asiSource ? asiHint(state, asiSource) : null;
    },

    /** The dossier line's value once a choice is made, plus any increase it granted. */
    summary(state, source) {
      let name = source.card(state[field])?.name ?? "";
      if ( lineage && name ) {
        const picked = lineageRequirements(state, id).flatMap(r => r.options).find(o => o.isSelected);
        if ( picked ) name = t("step.species.lineage.card", { species: name, lineage: picked.label });
      }
      if ( !name || !asiSource ) return name;
      const line = asiSummary(state, asiSource);
      return line ? `${name} · ${line}` : name;
    },

    async handle(action, el, ctx) {
      const { state, source } = ctx;
      if ( asiSource && ASI_ACTIONS.has(action) ) return asiHandle(action, el, state, asiSource);
      // A lineage pick is the Choices step's own decision, recorded the same way.
      if ( lineage && (action === "pick-choice") ) return choicesStep.handle(action, el, ctx);
      if ( action !== "pick-origin" ) return;
      const uuid = el.dataset.uuid;
      // A lineage card picks the species *and* its lineage — see `lineageCards`.
      const { lineageKey, lineageSel } = el.dataset;
      const same = (state[field] === uuid)
        && (!lineageKey || (pickedLineage(state, id, lineageSel) === lineageKey));
      // Re-clicking the active card clears it, so a player can back out of a choice.
      state[field] = same ? null : uuid;
      // The step id doubles as the advancement-choice source key (e.g. "species"). This also
      // clears any ability increase the previous pick granted — and, for another lineage of the
      // same species, the choices the previous lineage's features raised.
      state.resetSourceChoices(id);
      if ( asiSource && state[field] ) {
        state.originAsi[asiSource] = await source.abilityScoreIncrease(state[field]);
      }
      if ( state[field] && lineageKey && lineageSel ) {
        (state.advChoices[id] ??= {})[lineageSel] = [lineageKey];
      }
      state.choiceCache = await resolveChoices(state, source);
    },

    async context({ state, source, app }) {
      const selected = state[field];
      const detail = selected ? await source.detail(selected) : null;
      const groups = selected ? await source.advancementGroups(selected) : null;
      const base = cards(source, state);
      const expanded = lineage ? await lineageCards(source, base) : base;
      const list = expanded.map(c => ({
        ...c,
        selected: (c.uuid === selected) && (!c.lineageKey || (pickedLineage(state, id, c.lineageSel) === c.lineageKey))
      }));
      // The decision the grid answers for the chosen species, and the lineage it holds.
      const carded = selected ? list.find(c => (c.uuid === selected) && c.lineageSel)?.lineageSel ?? null : null;
      const heldLineage = carded ? pickedLineage(state, id, carded) : null;
      const heldCard = heldLineage ? list.find(c => c.selected) : null;
      // Opting this step's grid into side-by-side comparison. The step id doubles as the compare
      // category ("species", "background"), the same way it doubles as the advancement-choice
      // source key above. Silently inert without a shell, so the step still renders in tests.
      const pins = pinContext(app?.pins, id, list);

      // Resolve (and cache) the increase config for the active pick, so the panel and the
      // synchronous completion check share one source of truth.
      if ( asiSource && selected && state.originAsi[asiSource] === undefined ) {
        state.originAsi[asiSource] = await source.abilityScoreIncrease(selected);
      }

      // The character's edition is the chosen class's; on the class step itself nothing is settled
      // yet, so this falls through to the 2024 default the resolver applies.
      const edition = source.rulesOf(state.classUuid) ?? null;

      const ctx = {
        ...pins,                                  // cards (pin-decorated), compareCategory, compare
        count: list.length,
        hasSelection: !!selected,
        // Null unless the world actually has a book covering this step, so the control is hidden
        // rather than offered as a button that opens nothing.
        rulesTopic: (rulesTopic && await hasRulesPage(rulesTopic, edition)) ? rulesTopic : null,
        rulesEdition: edition,
        // Which step action a drawer card fires, so parts/work-picker.hbs stays step-agnostic.
        pickAction: "pick-origin",
        selectedName: heldCard?.name ?? detail?.name ?? "",
        // The bar and page title name the lineage too ("Elf (Blood Elf)"), and the lineage's own
        // description follows the species' — it is the part that tells one card from its neighbours.
        detail: (detail && heldCard) ? { ...detail, name: heldCard.name } : detail,
        lineageDetail: heldCard?.lineageUuid ? await source.detail(heldCard.lineageUuid).catch(() => null) : null,
        groups,
        // Null unless this origin both composes the panel and actually grants an increase; the
        // work surface simply renders nothing in that case.
        abilities: (asiSource && selected) ? asiContext(state, asiSource) : null,
        // The lineage to choose, for a species that has one; null renders nothing.
        lineage: (lineage && selected) ? lineageContext(state, id, detail?.name ?? "", carded) : null
      };
      ctx.hasSide = !!(ctx.abilities || ctx.lineage);
      return ctx;
    }
  };
}
