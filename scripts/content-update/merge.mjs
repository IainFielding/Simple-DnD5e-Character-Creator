import { getPath, isForeignEffect, isGrantUsesTarget, isGrantedSpell, setPath, statePaths } from "./fingerprint.mjs";

/**
 * Build the refreshed copy of one item: the **definition** from the new source, the **state** from
 * the character's copy. See {@link module:content-update/fingerprint} for where that line is drawn.
 *
 * The result keeps the old item's `_id`. That is what makes an in-place refresh cheap to trust:
 * favourites, ammunition links, container membership, `advancementOrigin` flags, advancement
 * `value.added` maps and effect origins all hold item ids, and with the id unchanged every one of
 * them stays valid without a fix-up pass.
 *
 * Pure function over plain (`toObject()`) data.
 */

/** Deep copy of plain data (structuredClone where available, JSON otherwise). */
function copy(value) {
  if ( value === undefined ) return undefined;
  if ( typeof structuredClone === "function" ) return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Advancements as an id-keyed map, whichever shape the data carries. */
function advancementsById(system) {
  const raw = system?.advancement;
  if ( !raw ) return new Map();
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  return new Map(list.filter(a => a?._id).map(a => [a._id, a]));
}

/**
 * Where each field group lives, for copying a kept group from the old item.
 * `other` is handled separately: it is "the rest of `system`".
 */
const GROUP_PATHS = {
  name: ["name"],
  img: ["img"],
  description: ["system.description"],
  activities: ["system.activities"],
  uses: ["system.uses"],
  damage: ["system.damage"],
  effects: ["effects"],
  advancement: ["system.advancement"]
};

/**
 * The refreshed item.
 * @param {object} oldData      The character's copy (`item.toObject()`).
 * @param {object} sourceData   The new compendium version (`doc.toObject()`).
 * @param {object} [options]
 * @param {string} [options.uuid]       The new source's uuid, recorded as `_stats.compendiumSource`.
 * @param {string[]} [options.keep]     Field groups to keep from the old copy ("Keep mine").
 * @param {boolean} [options.rebuilt]   `sourceData` is the copy a rebuild's walk granted, whose
 *   advancements have already re-applied what they add to other items.
 * @returns {object}   Item data ready for `updateSource`/`update`, with the old `_id`.
 */
export function refreshedItemData(oldData, sourceData, { uuid = null, keep = [], rebuilt = false } = {}) {
  const out = copy(sourceData) ?? {};

  // Document identity and bookkeeping are the character's.
  out._id = oldData._id;
  for ( const key of ["sort", "folder", "ownership"] ) {
    if ( key in oldData ) out[key] = copy(oldData[key]);
    else delete out[key];
  }
  out._stats = { ...(copy(oldData._stats) ?? {}) };
  out._stats.compendiumSource = uuid ?? sourceData?._stats?.compendiumSource ?? oldData?._stats?.compendiumSource ?? null;

  // Flags: the source's, overlaid with the character's (advancement origins, cached-for links,
  // other modules' per-character flags). The caller re-stamps our own afterwards.
  out.flags = mergeFlags(copy(sourceData.flags) ?? {}, copy(oldData.flags) ?? {});

  out.system ??= {};

  // State paths, wholesale from the old copy.
  for ( const path of statePaths(oldData) ) {
    const value = getPath(oldData, path);
    if ( value !== undefined ) setPath(out, path, copy(value));
  }

  // An identifier dnd5e filled in when the copy was created (the source has none) stays.
  if ( !out.system.identifier && oldData.system?.identifier ) out.system.identifier = oldData.system.identifier;

  // A granted spell keeps what its grant wrote onto its activities: a "free casting" forward activity,
  // and the spell's own uses as a consumption target.
  // (A rebuilt copy was just granted afresh, and its grant wrote them again.)
  if ( isGrantedSpell(oldData) && !rebuilt ) {
    out.system.activities ??= {};
    for ( const [id, act] of Object.entries(oldData.system?.activities ?? {}) ) {
      if ( (act?.type === "forward") && !out.system.activities[id] ) out.system.activities[id] = copy(act);
      const now = out.system.activities[id];
      const extra = (act?.consumption?.targets ?? []).filter(isGrantUsesTarget);
      if ( now && extra.length && !(now.consumption?.targets ?? []).some(isGrantUsesTarget) ) {
        now.consumption ??= {};
        now.consumption.targets = [...(now.consumption.targets ?? []), ...copy(extra)];
      }
    }
  }

  // Per-activity usage, matched by activity id.
  const oldActs = oldData.system?.activities ?? {};
  for ( const [id, act] of Object.entries(out.system.activities ?? {}) ) {
    const spent = oldActs[id]?.uses?.spent;
    if ( (spent !== undefined) && act?.uses ) act.uses.spent = spent;
  }

  // What each advancement recorded for this character, matched by advancement id. An advancement
  // the new version dropped simply has nowhere to go; one it added starts empty. Items whose
  // advancement *configuration* changed never come through here — they are rebuilt instead.
  const oldAdvs = advancementsById(oldData.system);
  const raw = out.system.advancement;
  if ( raw ) {
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    for ( const adv of list ) {
      const was = oldAdvs.get(adv?._id);
      if ( was && ("value" in was) ) adv.value = copy(was.value);
    }
  }

  // Effects: the new definitions, with each one's on/off state carried by id; and any effect the
  // character's copy carries from *elsewhere* (an enchantment applied to it, an effect another
  // item's advancement added) kept as-is.
  const oldEffects = new Map((oldData.effects ?? []).map(e => [e._id, e]));
  out.effects = (out.effects ?? []).map(e => {
    const was = oldEffects.get(e._id);
    if ( was && ("disabled" in was) ) e.disabled = was.disabled;
    return e;
  });
  const newIds = new Set(out.effects.map(e => e._id));
  for ( const e of oldData.effects ?? [] ) {
    if ( newIds.has(e._id) ) continue;
    if ( !isForeignEffect(e, oldData) ) continue;
    // An effect another advancement added is added again by a rebuild's walk; carrying it as well
    // would leave two.
    if ( rebuilt && e.flags?.dnd5e?.advancementOrigin ) continue;
    out.effects.push(copy(e));
  }

  // Groups the player chose to keep.
  for ( const group of keep ) {
    if ( group === "other" ) {
      const kept = copy(oldData.system ?? {});
      for ( const g of ["description", "activities", "uses", "damage", "advancement"] ) {
        if ( !keep.includes(g) ) {
          const v = out.system[g];
          if ( v === undefined ) delete kept[g];
          else kept[g] = v;
        }
      }
      out.system = kept;
      continue;
    }
    for ( const path of GROUP_PATHS[group] ?? [] ) {
      const v = getPath(oldData, path);
      if ( v !== undefined ) setPath(out, path, copy(v));
    }
  }
  return out;
}


/** A small recursive merge (b over a), standing in for `foundry.utils.mergeObject` in pure code. */
function mergeFlags(a, b) {
  if ( !b || (typeof b !== "object") || Array.isArray(b) ) return b ?? a;
  const out = (a && (typeof a === "object") && !Array.isArray(a)) ? a : {};
  for ( const [k, v] of Object.entries(b) ) {
    out[k] = (v && (typeof v === "object") && !Array.isArray(v)) ? mergeFlags(out[k], v) : v;
  }
  return out;
}

