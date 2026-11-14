/**
 * The decisions a character already made, read off its advancements, and the matching of each one
 * to the decision that asks the same thing in the new content.
 *
 * Why matching is not a lookup by id: between two versions of the same content an advancement can
 *  - keep its id but move to another item (dnd5e 6.1 and PHB 3.0 moved most class advancements onto
 *    the feature items they describe — 95 and 190 of them respectively);
 *  - keep its id and change its configuration (a pool gains an option, a count changes);
 *  - be recreated on another item under a **new** id (6.1's level-19 Epic Boon increases);
 *  - change type (Heroes of Faerûn 2.0 turned Cold Caster's optional spell grant into a choice).
 * dnd5e's own "drop the new item onto the old one" tool matches by id on the one item and only adds,
 * which is why it cannot follow any of the above.
 *
 * So each recorded decision carries enough to be recognised elsewhere — its type, the class level it
 * was made at, the tree it belongs to (which class, species or background), its title and a
 * signature of what it offered — and {@link matchDecision} scores candidates on all of them, the
 * advancement id being the strongest single signal but not the only one.
 *
 * Pure functions over plain data, so they run in unit tests without Foundry.
 */

/** Types whose recorded answer this feature carries. */
export const CARRIED_TYPES = ["HitPoints", "ItemChoice", "ItemGrant", "Trait", "AbilityScoreImprovement",
  "Subclass", "Size"];

/**
 * The system type an advancement's data stands for. A module can register a type of its own that is
 * a system type underneath: Tasha's turns a 2014 class's plain grant into a `TCOEReplacementGrant`
 * (Favored Enemy *or* Favored Foe). Its recorded answer has the grant's shape, so it is read as one.
 * Mirrors `LevelUpDriver.baseType` for plain data, which has no class to test with `instanceof`.
 * @param {object} adv
 * @returns {string}
 */
export function baseTypeOf(adv) {
  const type = String(adv?.type ?? "");
  if ( CARRIED_TYPES.includes(type) || (type === "ScaleValue") ) return type;
  if ( /Choice$/.test(type) ) return "ItemChoice";
  if ( /Grant$/.test(type) ) return "ItemGrant";
  return type;
}

/** Types that may stand in for one another when nothing of the same type matches. */
const COMPATIBLE = {
  ItemChoice: ["ItemGrant"],
  ItemGrant: ["ItemChoice"]
};

/* -------------------------------------------- */
/*  Small readers                               */
/* -------------------------------------------- */

/** The last segment of a uuid — the document id, which survives a content update far more often than anything else. */
export function uuidTail(uuid) {
  return String(uuid ?? "").split(".").filter(Boolean).at(-1) ?? "";
}

/** Normalise a title for comparison. */
export function normTitle(title) {
  return String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Advancements of plain item data as an array. */
export function advancementList(itemData) {
  const raw = itemData?.system?.advancement;
  if ( !raw ) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/** The pieces of an item's identity used to find it again in another version. */
export function itemIdentity(itemData) {
  if ( !itemData ) return null;
  return {
    uuid: itemData._stats?.compendiumSource ?? itemData.flags?.dnd5e?.sourceId ?? null,
    type: itemData.type ?? null,
    identifier: itemData.system?.identifier ?? null,
    name: itemData.name ?? null
  };
}

/**
 * Whether two identities describe the same thing: the same compendium document id, or the same
 * type and identifier, or the same type and name. Identifiers alone are not enough (PHB 3.0 renamed
 * fifty of them), nor are names (a 2014 and a 2024 item share most names) — so this is only ever
 * used *within* a pool or a tree that has already been narrowed to the right edition.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function sameIdentity(a, b) {
  if ( !a || !b ) return false;
  if ( a.uuid && b.uuid && (uuidTail(a.uuid) === uuidTail(b.uuid)) ) return true;
  if ( a.type && b.type && (a.type !== b.type) ) return false;
  if ( a.identifier && b.identifier && (a.identifier === b.identifier) ) return true;
  return !!(a.name && b.name && (a.name.toLowerCase() === b.name.toLowerCase()));
}

/* -------------------------------------------- */
/*  Trees                                       */
/* -------------------------------------------- */

/** Item types that root a tree of advancements. */
const ROOT_TYPES = ["class", "subclass", "race", "background"];

/**
 * The key of the tree an item belongs to: `class:<identifier>` for a class, its subclass and
 * everything either granted; `race` and `background` for the origins; `item:<name>` for a standalone
 * item with advancements of its own (a feat dropped on the sheet).
 * @param {object} itemData
 * @param {(id: string) => object|undefined} getItem   Looks an item up by id on the same actor.
 * @returns {string}
 */
export function treeKey(itemData, getItem) {
  let cur = itemData;
  for ( let i = 0; (i < 10) && cur && !ROOT_TYPES.includes(cur.type); i++ ) {
    const origin = cur.flags?.dnd5e?.advancementOrigin;
    if ( !origin ) break;
    const next = getItem(String(origin).split(".")[0]);
    if ( !next ) break;
    cur = next;
  }
  if ( !cur ) return "item:?";
  if ( cur.type === "class" ) return `class:${cur.system?.identifier ?? normTitle(cur.name)}`;
  if ( cur.type === "subclass" ) return `class:${cur.system?.classIdentifier ?? "?"}`;
  if ( (cur.type === "race") || (cur.type === "background") ) return cur.type;
  return `item:${normTitle(cur.name)}`;
}

/**
 * The level a feature's "when granted" (level 0) advancement really belongs to: the level of the
 * advancement that granted the feature. PHB 3.0 moved choices from `class @ level 1` to
 * `Fighting Style feature @ level 0`; comparing raw levels would call those different decisions.
 * @param {object} itemData
 * @param {(id: string) => object|undefined} getItem
 * @param {number} [depth]
 * @returns {number}
 */
export function grantedAtLevel(itemData, getItem, depth = 0) {
  const origin = itemData?.flags?.dnd5e?.advancementOrigin;
  if ( !origin || (depth > 4) ) return 0;
  const [ownerId, advId] = String(origin).split(".");
  const owner = getItem(ownerId);
  const adv = advancementList(owner).find(a => a._id === advId);
  if ( !adv ) return 0;
  const added = adv.value?.added ?? {};
  for ( const [key, map] of Object.entries(added) ) {
    if ( map && (typeof map === "object") && (itemData._id in map) && /^\d+$/.test(key) ) return Number(key);
  }
  return adv.level || grantedAtLevel(owner, getItem, depth + 1);
}

/* -------------------------------------------- */
/*  Signatures                                  */
/* -------------------------------------------- */

/**
 * What an advancement offers, as a set of short strings, so two versions of "the same decision" can
 * be recognised by overlap even when the id and the host item both changed.
 * @param {object} adv   Plain advancement data (or a document — only configuration is read).
 * @returns {Set<string>}
 */
export function signature(adv) {
  const cfg = adv?.configuration ?? {};
  const out = new Set();
  const poolOf = list => Array.from(list ?? []).map(p => (typeof p === "string") ? p : p?.uuid).filter(Boolean);
  switch ( baseTypeOf(adv) ) {
    case "ItemChoice":
    case "ItemGrant":
      for ( const uuid of [...poolOf(cfg.pool), ...poolOf(cfg.items)] ) out.add(`item:${uuidTail(uuid)}`);
      if ( cfg.restriction?.type ) out.add(`restriction:${cfg.restriction.type}/${cfg.restriction.subtype ?? ""}`);
      if ( cfg.type ) out.add(`kind:${cfg.type}`);
      break;
    case "Trait": {
      for ( const g of Array.from(cfg.grants ?? []) ) out.add(`grant:${g}`);
      for ( const c of Array.from(cfg.choices ?? []) ) for ( const k of Array.from(c?.pool ?? []) ) out.add(`pool:${k}`);
      if ( cfg.mode ) out.add(`mode:${cfg.mode}`);
      break;
    }
    case "AbilityScoreImprovement":
      out.add(`points:${cfg.points ?? 0}`);
      for ( const [k, v] of Object.entries(cfg.fixed ?? {}) ) if ( v ) out.add(`fixed:${k}${v}`);
      break;
    case "Size":
      for ( const s of Array.from(cfg.sizes ?? []) ) out.add(`size:${s}`);
      break;
    default:
      break;
  }
  return out;
}

/** Jaccard overlap of two sets, 0 when both are empty. */
export function overlap(a, b) {
  if ( !a.size && !b.size ) return 0;
  let shared = 0;
  for ( const x of a ) if ( b.has(x) ) shared++;
  return shared / (a.size + b.size - shared);
}

/* -------------------------------------------- */
/*  Harvest                                     */
/* -------------------------------------------- */

/**
 * @typedef {object} Decision
 * @property {string} key        Unique key, for de-duplicating matches.
 * @property {string} advId      The advancement's id.
 * @property {string} type       Advancement type.
 * @property {string} tree       {@link treeKey} of its host item.
 * @property {number} level      The level the decision was made at (a "when granted" decision is
 *                               moved to the level its feature was granted at).
 * @property {string} title      Normalised title.
 * @property {string} hostName   The item it sat on, for the review page.
 * @property {Set<string>} sig   {@link signature}.
 * @property {*} answer          What was decided (shape per type, see {@link harvestDecisions}).
 */

/**
 * Every decision a character's advancements recorded.
 *
 * Answer shapes:
 *  - `HitPoints`: `"max" | "avg" | number`, one decision per class level.
 *  - `ItemChoice`: `{picks: Identity[]}` per level — only picks still on the character, so a pick
 *    swapped out later is not replayed (the replacement is, at the earliest level with room).
 *  - `ItemGrant`: `{taken: Identity[], ability}` — only recorded for an optional grant or one with
 *    a choosable casting ability; a plain grant has nothing to carry.
 *  - `Trait`: `{chosen: string[]}` — the complete set, grants included, as the driver applies it.
 *  - `AbilityScoreImprovement`: `{assignments}` or `{feat: Identity}`.
 *  - `Subclass`: `{subclass: Identity}`.
 *  - `Size`: `{size}`.
 * @param {object} actorData   `actor.toObject()`.
 * @returns {Decision[]}
 */
export function harvestDecisions(actorData) {
  const items = actorData?.items ?? [];
  const byId = new Map(items.map(i => [i._id, i]));
  const getItem = id => byId.get(id);
  const out = [];

  for ( const item of items ) {
    const advs = advancementList(item);
    if ( !advs.length ) continue;
    const tree = treeKey(item, getItem);
    const grantLevel = grantedAtLevel(item, getItem);
    const base = adv => ({
      advId: adv._id, type: baseTypeOf(adv), tree, title: normTitle(adv.title ?? adv.name),
      hostName: item.name, sig: signature(adv)
    });
    const effLevel = lvl => (Number(lvl) || grantLevel || 0);

    for ( const adv of advs ) {
      const value = adv.value ?? {};
      switch ( baseTypeOf(adv) ) {
        case "HitPoints":
          for ( const [lvl, v] of Object.entries(value) ) {
            if ( !/^\d+$/.test(lvl) || (v === undefined) || (v === null) ) continue;
            out.push({ ...base(adv), key: `${item._id}.${adv._id}.${lvl}`, level: Number(lvl), answer: v });
          }
          break;
        case "ItemChoice": {
          const levels = Object.keys(value.added ?? {}).filter(l => /^\d+$/.test(l)).map(Number).sort((a, b) => a - b);
          const counts = Object.fromEntries(levels.map(l => [l, Number(adv.configuration?.choices?.[l]?.count ?? Infinity)]));
          const perLevel = new Map(levels.map(l => [l, []]));
          const surplus = [];
          for ( const l of levels ) {
            for ( const [id, uuid] of Object.entries(value.added[l] ?? {}) ) {
              const owned = byId.get(id);
              if ( !owned ) continue;                       // swapped out or deleted since
              const ident = { ...itemIdentity(owned), uuid: uuid ?? itemIdentity(owned).uuid };
              const list = perLevel.get(l);
              if ( list.length < counts[l] ) list.push(ident);
              else surplus.push(ident);                    // a replacement taken at this level
            }
          }
          // A replacement fills the earliest level that lost a pick to it.
          for ( const ident of surplus ) {
            const l = levels.find(x => perLevel.get(x).length < counts[x]);
            if ( l !== undefined ) perLevel.get(l).push(ident);
          }
          for ( const l of levels ) {
            if ( !perLevel.get(l).length ) continue;
            out.push({ ...base(adv), key: `${item._id}.${adv._id}.${l}`, level: effLevel(l),
              answer: { picks: perLevel.get(l), ability: value.ability ?? null } });
          }
          break;
        }
        case "ItemGrant": {
          const replacements = adv.configuration?.replacements;
          const optional = Array.from(adv.configuration?.items ?? []).some(i => i?.optional)
            || !!(replacements && Object.keys(replacements).length);
          const ability = value.ability ?? null;
          const abilityChoice = (Array.from(adv.configuration?.spell?.ability ?? []).length > 1);
          if ( !optional && !abilityChoice ) break;
          const taken = Object.entries(value.added ?? {}).map(([id, uuid]) => {
            const owned = byId.get(id);
            return owned ? { ...itemIdentity(owned), uuid } : { uuid };
          });
          out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level),
            answer: { taken, ability, optional } });
          break;
        }
        case "Trait": {
          const chosen = Array.from(value.chosen ?? []);
          if ( !chosen.length ) break;
          out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level), answer: { chosen } });
          break;
        }
        case "AbilityScoreImprovement": {
          if ( value.type === "feat" ) {
            const [id, uuid] = Object.entries(value.feat ?? {})[0] ?? [];
            if ( !id && !uuid ) break;
            const owned = byId.get(id);
            out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level),
              answer: { feat: owned ? { ...itemIdentity(owned), uuid: uuid ?? itemIdentity(owned).uuid } : { uuid } } });
          } else if ( value.assignments && Object.keys(value.assignments).length ) {
            out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level),
              answer: { assignments: { ...value.assignments } } });
          }
          break;
        }
        case "Subclass": {
          const owned = value.document ? byId.get(value.document) : null;
          const sub = owned ?? items.find(i => (i.type === "subclass")
            && (i.system?.classIdentifier === item.system?.identifier));
          if ( !sub && !value.uuid ) break;
          out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level),
            answer: { subclass: sub ? { ...itemIdentity(sub), uuid: value.uuid ?? itemIdentity(sub).uuid } : { uuid: value.uuid } } });
          break;
        }
        case "Size":
          if ( value.size ) out.push({ ...base(adv), key: `${item._id}.${adv._id}`, level: effLevel(adv.level), answer: { size: value.size } });
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

/**
 * @typedef {object} Wanted
 * @property {string} advId
 * @property {string} type     The new advancement's type (normalised to a system type).
 * @property {string} tree     {@link treeKey} of its host item in the new tree.
 * @property {number} level    Effective level (see {@link grantedAtLevel}).
 * @property {string} title    Normalised title.
 * @property {Set<string>} sig
 */

/**
 * How well a recorded decision fits the decision now being asked, or -1 when it cannot.
 *
 * Hard requirements: the same tree, the same level, and the same or a compatible type. Within those,
 * the advancement id dominates (it survives most moves), then the title, then the overlap of what is
 * offered. A candidate with none of the three is not a match — two unrelated choices that happen to
 * sit at the same level must not trade answers.
 * @param {Wanted} wanted
 * @param {Decision} d
 * @returns {number}
 */
export function matchScore(wanted, d) {
  if ( d.tree !== wanted.tree ) return -1;
  const sameType = d.type === wanted.type;
  if ( !sameType && !(COMPATIBLE[wanted.type] ?? []).includes(d.type) ) return -1;
  // Hit points are one per level and need nothing else.
  if ( wanted.type === "HitPoints" ) return (d.level === wanted.level) ? 100 : -1;
  if ( d.level !== wanted.level ) return -1;

  const sameId = d.advId === wanted.advId;
  const sameTitle = !!wanted.title && (d.title === wanted.title);
  const lap = overlap(d.sig, wanted.sig);
  if ( !sameId && !sameTitle && (lap <= 0) ) return -1;
  return (sameId ? 100 : 0) + (sameTitle ? 20 : 0) + Math.round(lap * 10) + (sameType ? 5 : 0);
}

/**
 * The best unused recorded decision for one new decision, or null.
 * @param {Wanted} wanted
 * @param {Decision[]} decisions
 * @param {Set<string>} used    Keys already matched; the winner is added.
 * @returns {Decision|null}
 */
export function matchDecision(wanted, decisions, used) {
  let best = null;
  let bestScore = -1;
  for ( const d of decisions ) {
    if ( used.has(d.key) ) continue;
    const score = matchScore(wanted, d);
    if ( score > bestScore ) { best = d; bestScore = score; }
  }
  if ( !best || (bestScore < 0) ) return null;
  used.add(best.key);
  return best;
}
