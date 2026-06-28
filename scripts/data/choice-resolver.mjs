import { t, log } from "../config.mjs";
import { toolCategoryKey, toolChoices } from "./tool-source.mjs";

/**
 * Resolves the player-facing advancement *choices* a set of origin items presents at
 * level ≤ 1 — skill/tool/language/weapon proficiency picks (with cross-source dedupe),
 * Expertise, Size, ItemChoice (choose N features), spellcasting-ability picks — into
 * flat descriptors the Choices step renders and the assembler applies.
 *
 * Stateless by design: it reads the selected origins and the player's recorded picks
 * (`state.advChoices`) and returns fresh requirements every call, so the step and the
 * build path share one source of truth with no cache to fall stale. It prunes picks
 * that another source now grants outright, mutating `state.advChoices` in place.
 */

const ORIGIN_FIELDS = {
  class: "classUuid", background: "backgroundUuid", species: "speciesUuid"
};

/** Trait categories we surface, mapped to their i18n title keys. */
const TRAIT_TITLE = {
  ci: "traitChoice.ci", di: "traitChoice.di", dr: "traitChoice.dr",
  languages: "traitChoice.languages", weapon: "traitChoice.weapon",
  armor: "traitChoice.armor", saves: "traitChoice.saves",
  skills: "traitChoice.skills", tool: "traitChoice.tool"
};

/** Memo for compendium scans backing `allowDrops` restrictions, keyed by restriction signature. */
const restrictedCache = new Map();

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

/**
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @param {import("./source-index.mjs").SourceIndex} source
 * @returns {Promise<{sources: object[], hasAny: boolean}>}
 */
export async function resolveChoices(state, source) {
  const defs = [];
  for ( const [key, field] of Object.entries(ORIGIN_FIELDS) ) {
    const uuid = state[field];
    defs.push({ key, uuid, doc: uuid ? await fromUuid(uuid).catch(() => null) : null });
  }

  // Acquired trait keys across every source, so each selector can grey out a proficiency
  // or language already granted/chosen elsewhere. Computed before the per-source loop.
  const crossTaken = await collectTakenTraitKeys(defs, state.advChoices);

  // The chosen class's spellcasting ability (and its display name). When a *granted* spell
  // from any origin (species/background) lets the player pick which ability casts it, the
  // class's ability is the recommended pick — so they can align innate casting with the
  // class. Computed once and shared across every source.
  const classDef = defs.find(d => d.key === "class");
  const classAbility = classDef?.doc?.system?.spellcasting?.ability || null;
  const spellAbilityHint = classAbility
    ? { ability: classAbility, className: source.card(classDef.uuid)?.name ?? classDef.doc.name }
    : null;

  const sources = [];
  for ( const d of defs ) {
    if ( !d.doc ) continue;
    let requirements = [];
    try {
      requirements = await prepareRequirements(d.doc, d.key, state.advChoices, crossTaken, spellAbilityHint);
    } catch ( err ) {
      log(`failed to resolve choices for ${d.key}`, err);
    }
    if ( requirements.length ) {
      const card = source.card(d.uuid);
      sources.push({
        key: d.key,
        name: card?.name ?? d.doc.name,
        img: card?.img ?? d.doc.img,
        requirements
      });
    }
  }
  return { sources, hasAny: sources.length > 0 };
}

/**
 * Pre-resolve the advancement choices for every origin in isolation, so the compendium
 * scans they trigger — tool-category expansion ({@link expandToolPool}) and `allowDrops`
 * restriction scans ({@link findRestrictedItems}) — happen once behind the loading spinner
 * rather than on the click that selects a class (which runs {@link resolveChoices} afresh
 * every time). Each origin is resolved against a throwaway state holding only that origin,
 * populating the module-level memo caches the live resolver then reuses. Failures on one
 * origin are swallowed so a bad document can't abort the warm-up.
 * @param {import("./source-index.mjs").SourceIndex} source
 * @param {() => void} [onTick]  Invoked once per origin warmed, for progress reporting.
 */
export async function warmChoices(source, onTick) {
  const groups = [
    ["class", source.classes()],
    ["species", source.species()],
    ["background", source.backgrounds()]
  ];
  for ( const [key, cards] of groups ) {
    const field = ORIGIN_FIELDS[key];
    for ( const card of cards ) {
      const state = { classUuid: null, speciesUuid: null, backgroundUuid: null, advChoices: {}, [field]: card.uuid };
      try {
        await resolveChoices(state, source);
      } catch ( err ) {
        log(`failed to warm choices for ${card.uuid}`, err);
      }
      onTick?.();
    }
  }
}

/** True once every requirement across all sources has enough picks. */
export function choicesComplete(resolved) {
  for ( const src of resolved?.sources ?? [] ) {
    for ( const req of src.requirements ) if ( !req.complete ) return false;
  }
  return true;
}

/* -------------------------------------------- */
/*  Requirement preparation                     */
/* -------------------------------------------- */

/**
 * The origin item plus the level-≤1 features that hang off it, as `{item, ownerUuid}` pairs
 * (ownerUuid null for the origin itself). A feature counts as a nested owner whether it's
 * handed out unconditionally (ItemGrant) or *picked* by the player from an ItemChoice — e.g.
 * the Human "choose a feat" option, where the chosen feat (Crafter) carries its own tool
 * choice. Recurses through both, so a chosen feat's choices surface and feed the same dedupe
 * and apply paths as granted ones. `seen` guards against cycles; depth caps runaway nesting.
 * @param {Item} item
 * @param {object} sel  The source's recorded picks (`advChoices[source]`), to read ItemChoices.
 */
async function levelOneOwners(item, sel = {}, seen = new Set(), ownerUuid = null, depth = 0) {
  const owners = [{ item, ownerUuid }];
  if ( depth > 3 ) return owners;
  for ( const adv of advancementArray(item) ) {
    if ( (adv.level ?? 0) > 1 ) continue;
    let refs = null;
    if ( adv.type === "ItemGrant" ) {
      refs = Array.from(adv.configuration?.items ?? []).map(r => typeof r === "string" ? r : r?.uuid);
    } else if ( adv.type === "ItemChoice" ) {
      refs = itemChoicePicks(adv, sel);
    } else continue;
    for ( const uuid of refs ) {
      if ( !uuid || seen.has(uuid) ) continue;
      seen.add(uuid);
      const doc = await fromUuid(uuid).catch(() => null);
      if ( doc && advancementArray(doc).length ) {
        owners.push(...await levelOneOwners(doc, sel, seen, uuid, depth + 1));
      }
    }
  }
  return owners;
}

/** The UUIDs the player picked for an ItemChoice advancement (stored under its bare id). */
function itemChoicePicks(adv, sel) {
  return Array.from(sel?.[adv._id] ?? []).map(p => typeof p === "string" ? p : p?.uuid).filter(Boolean);
}

/**
 * Gather every trait proficiency/language already acquired across all sources so a key
 * taken once can be greyed out elsewhere. Keys are namespaced `mode|key` so distinct
 * mechanics that reuse keys (weapon mastery vs proficiency) stay independent. Returns the
 * fixed grants and the player's picks keyed by `source:selKey`.
 */
async function collectTakenTraitKeys(defs, advChoices) {
  const grants = new Set();
  const chosenBySelKey = new Map();
  for ( const d of defs ) {
    if ( !d.doc ) continue;
    const bucket = advChoices[d.key] ?? {};
    const owners = await levelOneOwners(d.doc, bucket);
    for ( const { item: owner } of owners ) {
      for ( const adv of advancementArray(owner) ) {
        if ( adv.type !== "Trait" || (adv.level ?? 0) > 1 ) continue;
        const mode = adv.configuration?.mode || "default";
        for ( const g of Array.from(adv.configuration?.grants ?? []) ) grants.add(`${mode}|${g}`);
        const choices = Array.from(adv.configuration?.choices ?? []);
        for ( let ci = 0; ci < choices.length; ci++ ) {
          const picks = bucket[`${adv._id}#${ci}`];
          if ( !picks?.length ) continue;
          chosenBySelKey.set(`${d.key}:${adv._id}#${ci}`, new Set(picks.map(k => `${mode}|${k}`)));
        }
      }
    }
  }
  return { grants, chosenBySelKey };
}

/** Parse one origin item's advancements (and its granted features') into requirements. */
async function prepareRequirements(item, source, advChoices, crossTaken, spellAbilityHint) {
  const sel = advChoices[source] ?? (advChoices[source] = {});
  const reqs = [];
  const owners = await levelOneOwners(item, sel);

  // Skills this source grants — the only valid options for an Expertise choice.
  const expertiseSkillPool = proficientSkillKeys(owners, sel);

  for ( const { item: owner, ownerUuid } of owners ) {
    for ( const adv of advancementArray(owner) ) {
      await parseAdvancementChoice(adv, { source, ownerUuid, sel, reqs, expertiseSkillPool, crossTaken, spellAbilityHint });
    }
  }

  // Expertise depends on the skill picks, so present it after them (stable sort).
  reqs.sort((a, b) => (a.isExpertise ? 1 : 0) - (b.isExpertise ? 1 : 0));

  // Hints carry enricher markup (e.g. "@UUID[…]{Sharp Eye}"); render to real links/text.
  await Promise.all(reqs.map(async req => { if ( req.hint ) req.hint = await enrichHTML(req.hint); }));
  return reqs;
}

/** The skill keys a source grants (fixed + current picks) — eligible Expertise options. */
function proficientSkillKeys(owners, sel) {
  const isSkill = k => typeof k === "string" && k.startsWith("skills:") && k !== "skills:*";
  const keys = new Set();
  for ( const { item: owner } of owners ) {
    for ( const adv of advancementArray(owner) ) {
      if ( adv.type !== "Trait" || (adv.level ?? 0) > 1 ) continue;
      if ( adv.classRestriction === "secondary" || adv.configuration?.mode === "expertise" ) continue;
      for ( const g of adv.configuration?.grants ?? [] ) if ( isSkill(g) ) keys.add(g);
      const choices = Array.from(adv.configuration?.choices ?? []);
      for ( let ci = 0; ci < choices.length; ci++ ) {
        const pool = Array.from(choices[ci].pool ?? []);
        if ( !pool.some(k => typeof k === "string" && k.startsWith("skills:")) ) continue;
        for ( const k of sel[`${adv._id}#${ci}`] ?? [] ) if ( isSkill(k) ) keys.add(k);
      }
    }
  }
  return [...keys].map(k => ({ key: k, label: traitKeyLabel(k) }));
}

/** Parse a single advancement into zero or more requirements, appended to `reqs`. */
async function parseAdvancementChoice(adv, ctx) {
  const { source, ownerUuid, sel, reqs, expertiseSkillPool, crossTaken, spellAbilityHint } = ctx;
  let level = adv.level ?? 0;
  if ( level > 1 || adv.classRestriction === "secondary" ) return;

  if ( adv.type === "Size" ) {
    const sizes = Array.from(adv.configuration?.sizes ?? []);
    if ( sizes.length > 1 ) {
      const options = sizes.map(s => ({ key: s, label: CONFIG.DND5E.actorSizes?.[s]?.label ?? s }));
      reqs.push(buildChoiceReq({
        advId: adv._id, source, ownerUuid, type: "Size", level,
        title: adv.title || t("advancement.size"), hint: adv.hint, count: 1, options, sel, crossTaken
      }));
    }
    return;
  }

  if ( adv.type === "Trait" ) {
    const mode = adv.configuration?.mode || "default";
    const isExpertise = mode === "expertise";
    const choices = Array.from(adv.configuration?.choices ?? []);
    const grants = new Set(adv.configuration?.grants ?? []);
    for ( let ci = 0; ci < choices.length; ci++ ) {
      const c = choices[ci];
      const pool = Array.from(c.pool ?? []);
      const count = c.count ?? 1;
      if ( !count ) continue;
      const selKey = `${adv._id}#${ci}`;

      if ( isExpertise ) {
        const options = expertiseSkillPool;
        const valid = new Set(options.map(o => o.key));
        if ( sel[selKey] ) sel[selKey] = sel[selKey].filter(k => valid.has(k));
        const req = buildChoiceReq({
          advId: adv._id, choiceIndex: ci, source, ownerUuid, type: "Trait", level,
          title: adv.title || t("advancement.expertise"), hint: adv.hint, count, options, sel, crossTaken
        });
        req.isExpertise = true;
        if ( !options.length ) req.emptyNote = t("choice.emptyNoteSkills");
        reqs.push(req);
        continue;
      }

      let options = await expandTraitPool(pool);
      options = options.filter(o => !grants.has(o.key));
      if ( !options.length ) continue;
      // Drop a pick another source now grants for free, reopening the slot.
      const allGrants = crossTaken?.grants;
      if ( allGrants?.size && sel[selKey]?.some(k => allGrants.has(`${mode}|${k}`)) ) {
        sel[selKey] = sel[selKey].filter(k => !allGrants.has(`${mode}|${k}`));
      }
      reqs.push(buildChoiceReq({
        advId: adv._id, choiceIndex: ci, source, ownerUuid, type: "Trait", level,
        title: adv.title || traitChoiceTitle(pool), hint: adv.hint,
        count, options, sel, crossDedupe: true, dedupeGroup: mode, crossTaken
      }));
    }
    return;
  }

  if ( adv.type === "ItemGrant" ) {
    const abilities = Array.from(adv.configuration?.spell?.ability ?? []);
    if ( abilities.length > 1 ) {
      const options = abilities.map(a => {
        const opt = { key: a, label: CONFIG.DND5E.abilities?.[a]?.label ?? a };
        // Mark the class's configured spellcasting ability as the recommended pick.
        if ( spellAbilityHint && a === spellAbilityHint.ability ) {
          opt.recommended = true;
          opt.recommendTip = t("choice.recommendedAbility", { class: spellAbilityHint.className });
        }
        return opt;
      });
      // The advancement's own title is usually the trait name ("Otherworldly Presence"),
      // which doesn't read as an ability choice. Name it for the granted spell instead, so
      // it's plainly a spellcasting-ability pick and several from one source stay distinct.
      const spellNames = [];
      for ( const ref of Array.from(adv.configuration?.items ?? []) ) {
        const uuid = typeof ref === "string" ? ref : ref?.uuid;
        const spell = uuid ? await fromUuid(uuid).catch(() => null) : null;
        if ( spell ) spellNames.push(spell.name);
      }
      const title = spellNames.length
        ? t("advancement.spellAbilityFor", { spell: spellNames.join(", ") })
        : t("advancement.spellAbility");
      reqs.push(buildChoiceReq({
        advId: adv._id, source, ownerUuid, type: "SpellAbility", level,
        title, hint: adv.hint, count: 1, options, sel, crossTaken
      }));
    }
    return;
  }

  if ( adv.type === "ItemChoice" ) {
    const cfg = adv.configuration ?? {};
    // ItemChoice levels live in `choices` keyed by character level; take the lowest ≤ 1.
    const choiceLevel = Object.keys(cfg.choices ?? {})
      .map(Number).filter(l => Number.isFinite(l) && l <= 1).sort((a, b) => a - b)[0];
    if ( choiceLevel === undefined ) return;
    level = choiceLevel;
    const levelChoices = cfg.choices[choiceLevel];
    const count = Number(levelChoices?.count ?? levelChoices ?? 0);
    if ( !count ) return;

    const options = [];
    const seen = new Set();
    for ( const p of Array.from(cfg.pool ?? []) ) {
      const uuid = typeof p === "string" ? p : p?.uuid;
      if ( !uuid || seen.has(uuid) ) continue;
      const doc = await fromUuid(uuid).catch(() => null);
      if ( !doc ) continue;
      seen.add(uuid);
      options.push({ key: uuid, uuid, label: doc.name, img: doc.img });
    }
    if ( cfg.allowDrops && cfg.restriction?.subtype ) {
      for ( const opt of await findRestrictedItems(cfg) ) {
        if ( seen.has(opt.key) ) continue;
        seen.add(opt.key);
        options.push(opt);
      }
    }
    if ( !options.length ) return;
    options.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    reqs.push(buildChoiceReq({
      advId: adv._id, source, ownerUuid, type: "ItemChoice", level,
      title: adv.title || t("advancement.chooseItems"), hint: adv.hint, count, options, sel, crossTaken
    }));
  }
}

/** Assemble one requirement descriptor and merge in the player's current picks. */
function buildChoiceReq({
  advId, choiceIndex = null, source, ownerUuid = null, type, level = 0, title, hint,
  count, options, sel, crossDedupe = false, dedupeGroup = "default", crossTaken
}) {
  const selKey = choiceIndex == null ? advId : `${advId}#${choiceIndex}`;
  const chosen = sel[selKey] ?? [];
  // Stamp the routing attributes onto every option so the template can wire its button
  // without reaching back up through nested `{{#each}}` scopes (flat vs grouped).
  const opts = options.map(o => ({ ...o, isSelected: chosen.includes(o.key), source, selKey, count }));

  // Grey out options granted/chosen elsewhere (never the option's own current selection).
  if ( crossDedupe && crossTaken ) {
    const { grants, chosenBySelKey } = crossTaken;
    const ownSelKey = `${source}:${selKey}`;
    for ( const o of opts ) {
      if ( o.isSelected ) continue;
      const nk = `${dedupeGroup}|${o.key}`;
      let taken = grants.has(nk);
      if ( !taken ) {
        for ( const [gsk, set] of chosenBySelKey ) {
          if ( gsk !== ownSelKey && set.has(nk) ) { taken = true; break; }
        }
      }
      if ( taken ) { o.disabled = true; o.disabledReason = t("choice.alreadyGained"); }
    }
  }

  return {
    advId, choiceIndex, selKey, source, ownerUuid, type, level,
    title, hint: hint || "", count,
    countLabel: count > 1 ? t("choice.chooseCount", { count }) : t("choice.chooseOne"),
    showProgress: count > 1,
    chosenCount: chosen.length,
    complete: chosen.length >= count,
    options: opts,
    groups: groupOptions(opts)
  };
}

/* -------------------------------------------- */
/*  Option helpers                              */
/* -------------------------------------------- */

/** Split weapon-choice options into Simple vs Martial sections; null when not weapons. */
function groupOptions(opts) {
  if ( !opts.length || !opts.every(o => typeof o.key === "string" && o.key.startsWith("weapon:")) ) return null;
  const LABELS = { sim: t("choice.simpleWeapons"), mar: t("choice.martialWeapons") };
  const buckets = new Map();
  for ( const o of opts ) {
    const cat = o.key.split(":")[1] || "other";
    if ( !buckets.has(cat) ) buckets.set(cat, []);
    buckets.get(cat).push(o);
  }
  if ( buckets.size < 2 ) return null;
  const groups = [];
  for ( const cat of ["sim", "mar"] ) {
    if ( buckets.has(cat) ) { groups.push({ label: LABELS[cat], options: buckets.get(cat) }); buckets.delete(cat); }
  }
  for ( const [cat, list] of buckets ) groups.push({ label: LABELS[cat] ?? t("choice.other"), options: list });
  return groups;
}

/** Human title for a trait choice with no advancement title, from its pool type. */
export function traitChoiceTitle(pool = []) {
  const type = (pool[0] ?? "").split(":")[0];
  return TRAIT_TITLE[type] ? t(TRAIT_TITLE[type]) : t("choice.fallback");
}

/** Expand a Trait pool (including `*` wildcards) into concrete `{key,label}` options. */
async function expandTraitPool(pool = []) {
  const Trait = dnd5e.documents.Trait;
  pool = Array.from(pool ?? []);

  // Tool category/wildcard pools (e.g. the Monk's "tool:art:*" + "tool:music:*") expand
  // unreliably through the generic Trait wildcard helper, so resolve them straight from the
  // tool compendium — the same proven source the starting-equipment tool picks use.
  const toolOpts = await expandToolPool(pool);
  if ( toolOpts ) return toolOpts;

  if ( !pool.some(k => k.includes("*")) ) return pool.map(k => ({ key: k, label: traitKeyLabel(k) }));

  const flatten = (sc, out = []) => {
    for ( const [key, entry] of Object.entries(sc ?? {}) ) {
      if ( entry?.children && Object.keys(entry.children).length ) flatten(entry.children, out);
      else out.push({ key, label: entry?.label ?? traitKeyLabel(key) });
    }
    return out;
  };

  try {
    if ( typeof Trait?.mixedChoices === "function" ) {
      const out = flatten(await Trait.mixedChoices(new Set(pool)));
      if ( out.length ) return out;
    }
  } catch ( err ) {
    log("Trait.mixedChoices failed; per-type expansion", err);
  }
  try {
    const out = [];
    for ( const entry of pool ) {
      if ( !entry.includes("*") ) { out.push({ key: entry, label: traitKeyLabel(entry) }); continue; }
      const type = entry.split(":")[0];
      const prefix = entry.replace(/\*+$/, "").replace(/:$/, "");
      const leaves = flatten(await Trait.choices(type, { prefixed: true }));
      for ( const leaf of leaves ) if ( leaf.key.startsWith(prefix) && leaf.key !== prefix ) out.push(leaf);
    }
    if ( out.length ) return out;
  } catch ( err ) {
    log("Trait per-type expansion failed; literal keys", err);
  }
  return pool.filter(k => !k.includes("*")).map(k => ({ key: k, label: traitKeyLabel(k) }));
}

/**
 * Expand a tool-only Trait pool into concrete pick options from the compendium, handling both
 * whole-category wildcards (e.g. "tool:art:*" -> every Artisan's Tool) and pools of specific
 * named tools (e.g. the Crafter feat's eight "tool:art:carpenter"… keys -> just those eight).
 * Returns the options as `{key:"tool:<id>", label, img, uuid}` — dnd5e's Trait apply pops the
 * last `:` segment to reach `system.tools.<id>`, so the bare id key grants the proficiency
 * correctly. Returns null when the pool isn't a tool pool, so the generic expander handles it.
 * @param {string[]} pool
 * @returns {Promise<{key:string,label:string,img?:string,uuid?:string}[]|null>}
 */
async function expandToolPool(pool) {
  if ( !pool.length || !pool.every(k => typeof k === "string" && k.startsWith("tool:")) ) return null;

  const out = [];
  const seen = new Set();
  const push = opt => { if ( !seen.has(opt.key) ) { seen.add(opt.key); out.push(opt); } };
  for ( const entry of pool ) {
    const parts = entry.split(":");
    const wildcard = parts[parts.length - 1] === "*";
    const category = toolPoolCategory(entry);
    if ( category && (wildcard || parts.length <= 2) ) {
      // Whole-category pick ("tool:art:*" or bare "tool:art") — every tool in the category.
      for ( const tool of await toolChoices(category) ) {
        if ( tool.baseItem ) push({ key: `tool:${tool.baseItem}`, label: tool.name, img: tool.img, uuid: tool.uuid });
      }
    } else if ( category ) {
      // A specific tool named within its category ("tool:art:carpenter") — just that one,
      // keyed by its base item so it matches the category-expansion form and applies cleanly.
      const id = parts[parts.length - 1];
      const match = (await toolChoices(category)).find(to => to.baseItem === id);
      if ( match ) push({ key: `tool:${match.baseItem}`, label: match.name, img: match.img, uuid: match.uuid });
      else push({ key: `tool:${id}`, label: traitKeyLabel(`tool:${id}`) });
    } else if ( wildcard ) {
      return null;                          // uncategorisable wildcard — defer to the generic expander
    } else {
      push({ key: entry, label: traitKeyLabel(entry) });
    }
  }
  return out.length ? out : null;
}

/** The pickable tool category in a pool entry ("tool:art:*" -> "art"), or null if specific. */
function toolPoolCategory(entry) {
  const parts = entry.split(":");
  parts.shift();                            // drop the "tool" prefix
  if ( parts[parts.length - 1] === "*" ) parts.pop();
  return parts.length ? toolCategoryKey(parts[0]) : null;
}

/** Scan enabled compendiums for items matching an `allowDrops` restriction, memoised. */
async function findRestrictedItems(cfg) {
  const docType = cfg.type;
  const r = cfg.restriction ?? {};
  const sig = `${docType}|${r.type || ""}|${r.subtype || ""}`;
  if ( restrictedCache.has(sig) ) return restrictedCache.get(sig);

  const results = [];
  for ( const pack of game.packs ) {
    if ( pack.metadata.type !== "Item" ) continue;
    if ( pack.metadata.system && pack.metadata.system !== "dnd5e" ) continue;
    try {
      const index = await pack.getIndex({ fields: ["type", "system.type.value", "system.type.subtype"] });
      for ( const e of index ) {
        if ( docType && e.type !== docType ) continue;
        const ty = e.system?.type ?? {};
        if ( r.type && ty.value !== r.type ) continue;
        if ( r.subtype && ty.subtype !== r.subtype ) continue;
        results.push({ key: e.uuid, uuid: e.uuid, label: e.name, img: e.img });
      }
    } catch ( err ) {
      log(`restricted-item scan failed for ${pack.collection}`, err);
    }
  }
  restrictedCache.set(sig, results);
  return results;
}

/* -------------------------------------------- */
/*  Small utilities                             */
/* -------------------------------------------- */

export const traitKeyLabel = k => dnd5e.documents.Trait?.keyLabel?.(k) ?? k;

function enrichHTML(html) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { secrets: false });
}

/** A document's advancements as a flat array, tolerating dnd5e's various shapes. */
export function advancementArray(doc) {
  const byId = doc.advancement?.byId;
  if ( byId ) return typeof byId.values === "function" ? [...byId.values()] : Object.values(byId);
  const raw = doc.system?.advancement;
  if ( !raw ) return [];
  if ( Array.isArray(raw) ) return raw;
  if ( typeof raw.values === "function" ) return [...raw.values()];
  return Object.values(raw);
}
