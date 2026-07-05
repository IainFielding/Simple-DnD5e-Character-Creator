import { t } from "../config.mjs";
import { advancementArray } from "../data/choice-resolver.mjs";

/**
 * The Feat Spells step: the spell picks a feat defers to the player — the Magic Initiate shape and
 * its single-class variants. It replicates the creation Spells page (a filtered spell browser with a
 * running tally), scoped to the class list the feat draws from.
 *
 * Detection is deliberately **not** advancement-based. The dnd5e *system* ships Magic Initiate with
 * spell `ItemChoice` advancements, but the D&D Player's Handbook module ships it with **no
 * advancements at all** (its own text says "the spells have to be added manually"). So we detect it
 * by identity — an origin that grants (or lets you pick) a feat whose identifier/name is Magic
 * Initiate — and read the spell list from the granting background's own description, e.g. Acolyte's
 * "Magic Initiate (Cleric)". The feat's fixed shape (2 cantrips + 1 level-1 spell, cast off
 * Int/Wis/Cha) is applied by {@link module:build/actor-assembler} creating the spells directly.
 *
 * Where the feat *does* carry spell `ItemChoice` advancements (the system copy), we read the counts,
 * list, and abilities from them instead — so both forms funnel through the same step and apply path.
 */

// Key term used throughout this file: a "grant" is our normalised description of one feat's spell
// choice — `{ key, source, featUuid, featName, classList, abilityKeys, cantripCount, spellCount,
// spellLevel, mode }`. resolveFeatSpells() produces one per applicable feat; every helper below
// takes a grant plus the state and reads/writes the player's picks in state.featSpells[grant.key].

/** Magic Initiate's identity and fixed shape, used when the feat carries no advancement data. */
const MI_IDENTIFIER = /magic-initiate/i;
const MI_NAME = /magic initiate/i;
const MI_DEFAULTS = { cantripCount: 2, spellCount: 1, spellLevel: 1, abilityKeys: ["int", "wis", "cha"] };
const CLASS_LISTS = ["cleric", "druid", "wizard"];

export const featSpellsStep = {
  id: "featSpells",
  icon: "fa-solid fa-hand-sparkles",
  labelKey: "step.featSpells.label",
  template: "steps/feat-spells",

  // Unlike the always-present steps, this one is dropped from the rail entirely (not just greyed)
  // until an origin grants a Magic Initiate-style feat — the shell reads this flag to hide/skip it.
  hideWhenInapplicable: true,

  // Applies once an origin grants a Magic Initiate-style feat.
  applicable(state) {
    return (state.featSpellCache ?? []).length > 0;
  },

  isComplete(state) {
    const grants = state.featSpellCache ?? [];
    if ( !grants.length ) return true;            // nothing to choose — never blocks the build
    return grants.every(g => grantComplete(state, g));
  },

  /** Why Next is blocked: how many feat spells are still to be chosen. */
  incompleteHint(state) {
    const grants = state.featSpellCache ?? [];
    let picked = 0, total = 0;
    for ( const g of grants ) {
      const b = state.featSpells[g.key];
      picked += (b?.cantrips.length ?? 0) + (b?.spells.length ?? 0);
      total += g.cantripCount + g.spellCount;
    }
    const remain = Math.max(0, total - picked);
    return remain ? t("step.featSpells.hint", { count: remain }) : null;
  },

  /** Rail summary: how many of the feats' spells are chosen in total. */
  summary(state) {
    const grants = state.featSpellCache ?? [];
    if ( !grants.length ) return "";
    let picked = 0, total = 0;
    for ( const g of grants ) {
      const b = state.featSpells[g.key];
      picked += (b?.cantrips.length ?? 0) + (b?.spells.length ?? 0);
      total += g.cantripCount + g.spellCount;
    }
    return total ? t("step.featSpells.picked", { count: picked, total }) : "";
  },

  async handle(action, el, { state }) {
    if ( action === "switch-feat" ) {
      state.activeFeatKey = el.dataset.key;
      state.focusedFeatSpellUuid = null;
      state.featSpellTab = "cantrips";
      return;
    }
    if ( action === "choose-list" ) return chooseList(el, state);
    if ( action === "choose-ability" ) return chooseAbility(el, state);
    if ( action === "spell-tab" ) {
      state.featSpellTab = el.dataset.tab;
      state.focusedFeatSpellUuid = null;
      return;
    }
    if ( action === "focus-spell" ) {
      state.focusedFeatSpellUuid = el.dataset.uuid;
      return;
    }
    if ( action === "pick-spell" ) return pickSpell(el, state);
  },

  async context({ state, source, spells }) {
    // Refresh the grant cache so applicable/complete (which read it) and this render agree.
    const grants = await resolveFeatSpells(state, source);
    state.featSpellCache = grants;
    if ( !grants.length ) return { applicable: false, hint: t("step.featSpells.none") };

    // Resolve the active grant, surviving re-renders; a stale/absent key falls back to the first.
    if ( !grants.some(g => g.key === state.activeFeatKey) ) state.activeFeatKey = grants[0].key;
    const grant = grants.find(g => g.key === state.activeFeatKey);

    const cards = grants.map(g => ({
      key: g.key, featName: g.featName, featImg: g.featImg,
      active: g.key === grant.key, complete: grantComplete(state, g)
    }));

    // The recommended casting ability is the chosen class's — so feat magic can align with the class.
    const classDoc = state.classUuid ? await fromUuid(state.classUuid).catch(() => null) : null;
    const classAbility = classDoc?.system?.spellcasting?.ability || null;

    const listId = grantList(state, grant);
    const ctx = {
      applicable: true,
      grants: cards,
      hasMultipleGrants: cards.length > 1,
      featName: grant.featName,
      featImg: grant.featImg,
      intro: t("step.featSpells.intro", { feat: grant.featName }),

      setupNeeded: grant.classList.length > 1 || grant.abilityKeys.length > 1,
      showListPicker: grant.classList.length > 1,
      listOptions: grant.classList.map(id => {
        const card = source.classes().find(c => c.identifier === id);
        return { id, label: card?.name ?? capitalize(id), img: card?.img ?? "icons/svg/book.svg", selected: id === listId };
      }),
      listChosen: !!listId,

      showAbilityPicker: grant.abilityKeys.length > 1,
      abilityChosen: !!grantAbility(state, grant),
      abilityOptions: grant.abilityKeys.map(key => ({
        key,
        label: CONFIG.DND5E.abilities?.[key]?.label ?? key.toUpperCase(),
        selected: key === grantAbility(state, grant),
        recommended: key === classAbility
      })),
      abilityRecommendTip: classAbility ? t("step.featSpells.recommendAbility", { class: classDoc?.name ?? "" }) : ""
    };

    if ( !listId ) return { ...ctx, hasList: false };
    const owned = await knownSpellUuids(state, grant.key);
    return { ...ctx, hasList: true, ...await spellBrowser(state, grant, listId, spells, owned) };
  }
};

/* -------------------------------------------- */
/*  Detection                                   */
/* -------------------------------------------- */

/**
 * Scan the selected origins for granted (or player-picked) Magic Initiate-style feats and turn each
 * into a spell-choice *grant*. Detection is by feat identity (not advancement data), so it catches
 * the Player's Handbook module's advancement-less feat as well as the system's advancement-carrying
 * one. Keyed `${source}:${featUuid}` so a feat grantable from two origins stays distinct.
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @param {import("../data/source-index.mjs").SourceIndex} source
 * @returns {Promise<object[]>}
 */
export async function resolveFeatSpells(state, source) {
  const grants = [];
  const seen = new Set();
  for ( const [key, field] of [["class", "classUuid"], ["background", "backgroundUuid"], ["species", "speciesUuid"]] ) {
    const originUuid = state[field];
    if ( !originUuid ) continue;
    const originDoc = await fromUuid(originUuid).catch(() => null);
    if ( !originDoc ) continue;
    const sel = state.advChoices?.[key] ?? {};
    for ( const featUuid of grantedFeatUuids(originDoc, sel) ) {
      const gk = `${key}:${featUuid}`;
      if ( seen.has(gk) ) continue;
      const featDoc = await fromUuid(featUuid).catch(() => null);
      if ( !featDoc || featDoc.type !== "feat" ) continue;
      const grant = magicInitiateGrant(featDoc, originDoc, key, featUuid);
      if ( grant ) { seen.add(gk); grants.push(grant); }
    }
  }
  return grants;
}

/** UUIDs of the feats an origin grants outright or lets the player pick, at level ≤ 1. */
function grantedFeatUuids(doc, sel) {
  const out = [];
  for ( const adv of advancementArray(doc) ) {
    if ( (adv.level ?? 0) > 1 ) continue;
    if ( adv.type === "ItemGrant" ) {
      for ( const ref of Array.from(adv.configuration?.items ?? []) ) {
        const uuid = typeof ref === "string" ? ref : ref?.uuid;
        if ( uuid ) out.push(uuid);
      }
    } else if ( adv.type === "ItemChoice" ) {
      for ( const p of Array.from(sel[adv._id] ?? []) ) {
        const uuid = typeof p === "string" ? p : p?.uuid;
        if ( uuid ) out.push(uuid);
      }
    }
  }
  return out;
}

/** The feat's spell-type `ItemChoice` advancements (the system copy carries these; the PHB one doesn't). */
function spellItemChoiceAdvs(featDoc) {
  return advancementArray(featDoc).filter(a =>
    a.type === "ItemChoice" && (a.level ?? 0) <= 1 && a.configuration?.type === "spell");
}

/**
 * Build a grant for a Magic Initiate-style feat, or null if it isn't one. When the feat carries
 * spell advancements, its parameters are read from them; otherwise Magic Initiate's fixed shape is
 * assumed and the class list is parsed from the granting origin's (then the feat's) description.
 */
function magicInitiateGrant(featDoc, originDoc, sourceKey, featUuid) {
  const identifier = featDoc.system?.identifier ?? "";
  const spellAdvs = spellItemChoiceAdvs(featDoc);
  const isMI = MI_IDENTIFIER.test(identifier) || MI_NAME.test(featDoc.name ?? "") || spellAdvs.length > 0;
  if ( !isMI ) return null;

  const base = {
    key: `${sourceKey}:${featUuid}`, source: sourceKey, featUuid,
    featName: featDoc.name, featImg: featDoc.img || "icons/svg/upgrade.svg",
    featIdentifier: identifier || "magic-initiate"
  };

  if ( spellAdvs.length ) {
    // Advancement-carrying (system) feat — read the shape from its own ItemChoices.
    const classList = new Set(), abilityKeys = new Set();
    let cantripCount = 0, spellCount = 0, spellLevel = 1;
    for ( const adv of spellAdvs ) {
      const cfg = adv.configuration;
      const choiceLevel = Object.keys(cfg.choices ?? {}).map(Number).filter(l => l <= 1).sort((a, b) => a - b)[0] ?? 0;
      const count = Number(cfg.choices?.[choiceLevel]?.count ?? cfg.choices?.[choiceLevel] ?? 0);
      const restrictLevel = Number(cfg.restriction?.level ?? 0);
      if ( restrictLevel === 0 ) cantripCount = count;
      else { spellCount = count; spellLevel = restrictLevel; }
      for ( const c of Array.from(cfg.restriction?.list ?? []) ) classList.add(String(c).replace(/^class:/, ""));
      for ( const a of Array.from(cfg.spell?.ability ?? []) ) abilityKeys.add(a);
    }
    return {
      ...base, mode: "advancement",
      classList: [...classList], abilityKeys: abilityKeys.size ? [...abilityKeys] : [...MI_DEFAULTS.abilityKeys],
      cantripCount, spellCount, spellLevel
    };
  }

  // Advancement-less (PHB) feat — fixed Magic Initiate shape, class list from the descriptions.
  return {
    ...base, mode: "manual",
    classList: parseClassList(originDoc, featDoc),
    abilityKeys: [...MI_DEFAULTS.abilityKeys],
    cantripCount: MI_DEFAULTS.cantripCount, spellCount: MI_DEFAULTS.spellCount, spellLevel: MI_DEFAULTS.spellLevel
  };
}

/** The class list a Magic Initiate feat draws from: the origin's "(Cleric)" parenthetical, then the
 *  feat's named lists, defaulting to all three. */
function parseClassList(originDoc, featDoc) {
  const inParens = classInParens(originDoc?.system?.description?.value ?? "");
  if ( inParens.length ) return inParens;
  const named = classesNamed(featDoc?.system?.description?.value ?? "");
  return named.length ? named : [...CLASS_LISTS];
}

const stripHtml = h => String(h).replace(/<[^>]+>/g, " ").replace(/[{}]/g, " ");
/** A single class named in a "Magic Initiate (Cleric)"-style parenthetical, or []. */
function classInParens(html) {
  const m = stripHtml(html).match(/magic initiate\s*\((cleric|druid|wizard)\)/i);
  return m ? [m[1].toLowerCase()] : [];
}
/** Every class list the text names (base Magic Initiate names all three). */
function classesNamed(html) {
  const text = stripHtml(html);
  return CLASS_LISTS.filter(c => new RegExp(`\\b${c}\\b`, "i").test(text));
}

/**
 * The spells an origin grants outright — an ItemGrant of a spell item at level ≤ 1 (e.g. a species
 * that hands out a cantrip). Returned as lightweight cards for the review summary and the "already
 * known" marking on the feat browser. Shared with [review-step.mjs](scripts/steps/review-step.mjs).
 * @param {Item5e|object} doc
 * @returns {Promise<{uuid:string, name:string, img:string, level:number}[]>}
 */
export async function grantedSpellCards(doc) {
  const out = [];
  for ( const adv of advancementArray(doc) ) {
    if ( (adv.level ?? 0) > 1 || adv.type !== "ItemGrant" ) continue;
    for ( const ref of Array.from(adv.configuration?.items ?? []) ) {
      const uuid = typeof ref === "string" ? ref : ref?.uuid;
      if ( !uuid ) continue;
      const d = await fromUuid(uuid).catch(() => null);
      if ( d?.type === "spell" ) out.push({ uuid, name: d.name, img: d.img || "icons/svg/daze.svg", level: d.system?.level ?? 0 });
    }
  }
  return out;
}

/**
 * The spell uuids the character already knows from other sources, so the feat browser can show them
 * as already chosen rather than letting the player waste a pick re-learning one: the class Spells
 * step picks, any origin-granted spells, and the spells chosen for the character's *other* feats.
 */
async function knownSpellUuids(state, currentGrantKey) {
  const set = new Set();
  for ( const s of state.selectedCantrips ) set.add(s.uuid);
  for ( const s of state.selectedSpells ) set.add(s.uuid);
  for ( const field of ["classUuid", "backgroundUuid", "speciesUuid"] ) {
    const uuid = state[field];
    if ( !uuid ) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if ( doc ) for ( const sp of await grantedSpellCards(doc) ) set.add(sp.uuid);
  }
  for ( const [key, b] of Object.entries(state.featSpells) ) {
    if ( key === currentGrantKey ) continue;
    for ( const u of [...(b.cantrips ?? []), ...(b.spells ?? [])] ) set.add(u);
  }
  return set;
}

/* -------------------------------------------- */
/*  Pick state                                  */
/* -------------------------------------------- */

/** The mutable pick bucket for a grant, created on first use. */
function bucket(state, grant) {
  return (state.featSpells[grant.key] ??= { list: null, ability: null, cantrips: [], spells: [] });
}

/** The chosen list id — implied when the feat names a single class, else the player's pick. */
function grantList(state, grant) {
  if ( grant.classList.length === 1 ) return grant.classList[0];
  return state.featSpells[grant.key]?.list ?? null;
}

/** The chosen casting ability (implied when the feat fixes a single one). */
function grantAbility(state, grant) {
  if ( grant.abilityKeys.length === 1 ) return grant.abilityKeys[0];
  return state.featSpells[grant.key]?.ability ?? null;
}

/** Picked spell uuids for a grant's cantrip (0) or spell (1) bucket. */
function picked(state, grant, spellLevel) {
  const b = state.featSpells[grant.key];
  if ( !b ) return [];
  return spellLevel === 0 ? b.cantrips : b.spells;
}

/** A grant is complete once its list, ability, and every cantrip/spell slot are chosen. */
function grantComplete(state, grant) {
  if ( !grantList(state, grant) ) return false;
  if ( grant.abilityKeys.length > 1 && !grantAbility(state, grant) ) return false;
  return picked(state, grant, 0).length >= grant.cantripCount
      && picked(state, grant, 1).length >= grant.spellCount;
}

/* -------------------------------------------- */
/*  Handlers                                    */
/* -------------------------------------------- */

/** The active grant from the cache, for a handler. */
function activeGrant(state) {
  const grants = state.featSpellCache ?? [];
  return grants.find(g => g.key === state.activeFeatKey) ?? grants[0] ?? null;
}

/** Pick a spell list; switching lists clears the now-invalid picks so nothing leaks across lists. */
function chooseList(el, state) {
  const grant = activeGrant(state);
  if ( !grant ) return;
  const b = bucket(state, grant);
  if ( b.list === el.dataset.id ) return;
  b.list = el.dataset.id;
  b.cantrips = [];
  b.spells = [];
  state.focusedFeatSpellUuid = null;
  state.featSpellTab = "cantrips";
}

/** Record the casting ability for the active grant. */
function chooseAbility(el, state) {
  const grant = activeGrant(state);
  if ( !grant ) return;
  bucket(state, grant).ability = el.dataset.ability;
}

/** Toggle a spell into/out of its bucket, capped at the feat's per-bucket count. */
function pickSpell(el, state) {
  const grant = activeGrant(state);
  if ( !grant ) return;
  const b = bucket(state, grant);
  const isCantrip = Number(el.dataset.level) === 0;
  const list = isCantrip ? b.cantrips : b.spells;
  const uuid = el.dataset.uuid;
  const idx = list.indexOf(uuid);
  if ( idx >= 0 ) { list.splice(idx, 1); return; }
  const max = isCantrip ? grant.cantripCount : grant.spellCount;
  if ( list.length >= max ) return;               // ignore the click once the bucket is full
  list.push(uuid);
}

/* -------------------------------------------- */
/*  Spell browser                               */
/* -------------------------------------------- */

/** Build the filtered spell-browser context for the active grant's chosen list. */
async function spellBrowser(state, grant, listId, spells, owned = new Set()) {
  const { cantrips, level1 } = await spells.forSpellList(listId, Math.max(1, grant.spellLevel));

  let tab = state.featSpellTab;
  if ( tab === "cantrips" && grant.cantripCount === 0 ) tab = "spells";
  if ( tab === "spells" && grant.spellCount === 0 ) tab = "cantrips";
  const isCantrips = tab === "cantrips";

  const pool = isCantrips ? cantrips : level1;
  const budget = isCantrips ? grant.cantripCount : grant.spellCount;
  const chosen = picked(state, grant, isCantrips ? 0 : 1);
  const chosenSet = new Set(chosen);
  const atLimit = chosen.length >= budget;

  const list = pool.map(s => {
    // A spell already known from the class Spells step or a granted origin can't be re-learnt here.
    const isOwned = owned.has(s.uuid) && !chosenSet.has(s.uuid);
    return {
      ...s,
      active: chosenSet.has(s.uuid),
      owned: isOwned,
      focused: state.focusedFeatSpellUuid === s.uuid,
      disabled: isOwned || (atLimit && !chosenSet.has(s.uuid))
    };
  });

  let focused = null;
  const focus = list.find(s => s.uuid === state.focusedFeatSpellUuid);
  if ( focus ) focused = { ...focus, description: await spells.description(focus.uuid) };

  const levelOptions = [...new Set(list.filter(s => s.level > 0).map(s => s.level))]
    .sort((a, b) => a - b)
    .map(level => ({ value: level, label: t("levelup.step.spells.levelTag", { level }) }));
  const schoolOptions = [...new Set(list.map(s => s.school).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, game.i18n.lang))
    .map(school => ({ value: school, label: school }));

  const toChip = async uuids => Promise.all(uuids.map(async uuid => {
    const doc = await fromUuid(uuid).catch(() => null);
    return { uuid, name: doc?.name ?? "", img: doc?.img ?? "icons/svg/daze.svg" };
  }));
  const byName = (a, b) => a.name.localeCompare(b.name, game.i18n.lang);
  const selectedCantrips = (await toChip(picked(state, grant, 0))).sort(byName);
  const selectedSpells = (await toChip(picked(state, grant, 1))).sort(byName);

  return {
    hasCantrips: grant.cantripCount > 0,
    hasSpells: grant.spellCount > 0,
    isCantripsTab: isCantrips,
    isSpellsTab: !isCantrips,
    cantripCount: grant.cantripCount,
    spellCount: grant.spellCount,
    cantripHave: picked(state, grant, 0).length,
    spellHave: picked(state, grant, 1).length,
    cantripsFull: grant.cantripCount > 0 && picked(state, grant, 0).length >= grant.cantripCount,
    spellsFull: grant.spellCount > 0 && picked(state, grant, 1).length >= grant.spellCount,
    needLabel: t("levelup.step.spells.need", { count: Math.max(0, budget - chosen.length) }),
    atLimit,
    list,
    count: list.length,
    levelOptions,
    schoolOptions,
    focused,
    selectedCantrips,
    selectedSpells,
    hasSelected: selectedCantrips.length + selectedSpells.length > 0
  };
}

const capitalize = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
