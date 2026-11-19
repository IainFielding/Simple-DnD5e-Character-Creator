/**
 * What an item *is* versus what has *happened to it*, and a short fingerprint of the first.
 *
 * A character's items are copies of compendium entries. When the content behind them gets a new
 * version, the copy's **definition** (rules text, activities, damage, advancement configuration…)
 * should follow the new version, while its **state** (uses spent, equipped, prepared, which
 * container it sits in, what its advancements recorded) belongs to the character and must survive.
 * Everything in the content-update feature leans on that split, so it is drawn once, here.
 *
 * The definition is further cut into **field groups** — name, icon, description, activities, uses,
 * damage, effects, advancement and "everything else" — because the review page reasons about them
 * separately: a renamed sword keeps its name while taking the new damage, and a player-edited
 * description is shown beside the new one instead of being silently replaced.
 *
 * {@link sourceStamp} records one short hash per group at the moment an item is created from a
 * compendium. A later update can then compare three things — the stamped source, the player's copy
 * and the new source — and tell a player's edit from a content change. Without a stamp only the
 * last two can be compared, and every difference reads as "possibly customised".
 *
 * Pure functions over plain item data (`toObject()` shape). Nothing here touches Foundry.
 */

/** The stamp's version. A stamp of another version is ignored rather than misread. */
export const STAMP_VERSION = 1;

/** The flag key (under the module's scope) the stamp lives at. */
export const STAMP_FLAG = "source";

/**
 * Dotted paths of **state** — written by play or by advancement, never by the content author. These
 * are taken from the character's copy on a refresh and ignored when comparing definitions.
 *
 * Spell paths deserve a word: an advancement that grants a spell writes its casting ability,
 * preparation and (for "once per long rest" grants) its uses onto the copy. Those differ from the
 * compendium by design, so on a spell they are state, or every granted spell would look edited.
 */
const STATE_PATHS = [
  "system.uses.spent",
  "system.quantity",
  "system.equipped",
  "system.attuned",
  "system.container",
  "system.identified",
  "system.prepared",
  "system.method",
  "system.sourceClass",
  "system.sourceItem",
  "system.levels",
  "system.hd.spent",
  "system.recharge.charged",
  "system.proficient",
  "system.crewed",
  "system.cover"
];

/**
 * What dnd5e's `SourceField.prepareData` writes onto `system.source`. Prepared values, never
 * authored, but dnd5e also runs it on raw source data (the compendium browser's cached entries), so
 * a pack document's `toObject()` can carry them while a stored copy never does.
 */
const DERIVED_SOURCE_KEYS = ["bookPlaceholder", "label", "value", "slug"];

/** Extra state paths on spells (see {@link STATE_PATHS}). */
const SPELL_STATE_PATHS = ["system.ability", "system.uses", "system.preparation", "system.linkedActivity"];


/**
 * The field groups, in the order the review page lists them. `other` is the remainder of
 * `system` once every named group and every state path is taken out.
 */
export const FIELD_GROUPS = ["name", "img", "description", "activities", "uses", "damage", "effects",
  "advancement", "other"];

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** A deep copy that also turns Sets and Maps into sorted arrays / plain objects. */
function plain(value) {
  if ( value instanceof Set ) return [...value].map(plain).sort(compareValues);
  if ( value instanceof Map ) return Object.fromEntries([...value].map(([k, v]) => [k, plain(v)]));
  if ( Array.isArray(value) ) return value.map(plain);
  if ( value && (typeof value === "object") ) {
    const out = {};
    for ( const [k, v] of Object.entries(value) ) out[k] = plain(v);
    return out;
  }
  return value;
}

function compareValues(a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : (sa > sb ? 1 : 0);
}

/**
 * JSON with object keys sorted at every depth, so two equal objects always serialise the same
 * whatever order their keys were written in. `undefined` and empty values are dropped: a field the
 * new schema adds with an empty default must not make every item look changed.
 * @param {*} value
 * @returns {string}
 */
export function stableStringify(value) {
  return JSON.stringify(canonical(value)) ?? "null";
}

/** Void elements, whose self-closing slash (`<br />`) an HTML serialiser drops. */
const VOID_TAG = /<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)(\s[^<>]*?)?\s*\/>/gi;

/** Memo for {@link normalizeHtml}: descriptions repeat across a scan, and parsing is the slow part. */
const htmlMemo = new Map();

/**
 * HTML as Foundry stores it. A pack compiled from source keeps the author's markup (`<br />`,
 * `<hr />`), but every document written through Foundry has its HTML re-serialised by the browser's
 * parser (`<br>`, `<hr>`). Comparing raw strings would make every such item look changed, forever:
 * a refresh writes the pack's markup and Foundry turns it back. So both sides go through the same round
 * trip. Measured on dnd5e 6.1.0: the stored text equals `DOMParser` → `body.innerHTML` of the pack's
 * exactly. The same goes for a bare `&` (stored as `&amp;`), even in a string with no markup, such
 * as an advancement hint. Outside a browser (unit tests) only those two rewrites are made.
 * @param {string} text
 * @returns {string}
 */
export function normalizeHtml(text) {
  if ( !/[<&]/.test(text) ) return text;
  let out = htmlMemo.get(text);
  if ( out !== undefined ) return out;
  if ( typeof DOMParser === "function" ) {
    out = new DOMParser().parseFromString(text, "text/html").body.innerHTML;
  } else {
    out = text.replace(VOID_TAG, (_, tag, attrs = "") => `<${tag}${attrs.trimEnd()}>`)
      .replace(/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/gi, "&amp;");
  }
  if ( htmlMemo.size > 5000 ) htmlMemo.clear();
  htmlMemo.set(text, out);
  return out;
}

function canonical(value) {
  if ( typeof value === "string" ) return normalizeHtml(value);
  if ( value instanceof Set || value instanceof Map ) return canonical(plain(value));
  if ( Array.isArray(value) ) return value.map(canonical);
  if ( value && (typeof value === "object") ) {
    const out = {};
    for ( const key of Object.keys(value).sort() ) {
      const v = canonical(value[key]);
      if ( isEmpty(v) ) continue;
      out[key] = v;
    }
    return out;
  }
  return value;
}

function isEmpty(v) {
  if ( (v === undefined) || (v === null) || (v === "") ) return true;
  if ( Array.isArray(v) ) return v.length === 0;
  if ( v && (typeof v === "object") ) return Object.keys(v).length === 0;
  return false;
}

/**
 * FNV-1a, 32-bit, as 8 hex characters. Not cryptographic and does not need to be: it only has to
 * tell "same" from "different" for one item's group, and it has to be synchronous and dependency-free.
 * @param {string} text
 * @returns {string}
 */
export function hashString(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for ( let i = 0; i < s.length; i++ ) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Read a dotted path. */
export function getPath(obj, path) {
  let cur = obj;
  for ( const part of path.split(".") ) {
    if ( (cur === null) || (cur === undefined) ) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Write a dotted path, creating objects on the way. */
export function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for ( let i = 0; i < parts.length - 1; i++ ) {
    if ( !cur[parts[i]] || (typeof cur[parts[i]] !== "object") ) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

/** Remove a dotted path. */
function deletePath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for ( let i = 0; i < parts.length - 1; i++ ) {
    cur = cur?.[parts[i]];
    if ( !cur || (typeof cur !== "object") ) return;
  }
  if ( cur ) delete cur[parts.at(-1)];
}

/** The state paths that apply to an item of this type. */
export function statePaths(itemData) {
  return (itemData?.type === "spell") ? [...STATE_PATHS, ...SPELL_STATE_PATHS] : [...STATE_PATHS];
}

/* -------------------------------------------- */
/*  Definition groups                           */
/* -------------------------------------------- */

/** Activities without their per-character usage. */
function activityDefinition(activities, itemData) {
  const granted = isGrantedSpell(itemData);
  const out = {};
  for ( const [id, act] of Object.entries(plain(activities) ?? {}) ) {
    if ( granted && (act?.type === "forward") ) continue;
    const a = { ...act };
    if ( a.uses ) { a.uses = { ...a.uses }; delete a.uses.spent; }
    if ( granted && a.consumption?.targets ) {
      a.consumption = { ...a.consumption, targets: a.consumption.targets.filter(t => !isGrantUsesTarget(t)) };
    }
    out[id] = a;
  }
  return out;
}

/**
 * A spell an advancement granted. dnd5e's spell configuration writes onto such a copy (`applySpellChanges`):
 * a limited-use grant adds a "free casting" forward activity, or an item-uses consumption target on the
 * spell's own activity. Those are the grant's, not the spell's definition.
 * @param {object} itemData
 */
export function isGrantedSpell(itemData) {
  return (itemData?.type === "spell") && !!itemData?.flags?.dnd5e?.advancementOrigin;
}

/** The consumption target a limited-use spell grant adds: the spell's own uses, one at a time. */
export function isGrantUsesTarget(target) {
  return (target?.type === "itemUses") && !target?.target;
}

/**
 * Whether an effect on an item came from somewhere other than the item's own definition: its origin
 * names another document (an enchantment applied to it, an effect another item's advancement added).
 * Such an effect belongs to the character, not to the definition.
 * @param {object} effect
 * @param {object} itemData
 * @returns {boolean}
 */
export function isForeignEffect(effect, itemData) {
  // Added by another item's advancement (dnd5e's ModifyItem marks its copies both ways).
  if ( effect?.flags?.dnd5e?.advancementOrigin || effect?.system?.origin?.item ) return true;
  const origin = effect?.origin;
  if ( !origin ) return false;
  // Compared by the last uuid segment: dnd5e's 2014 packs write a relative origin
  // (`Item.<pack id>`), which names the pack entry's own id but neither the copy's id nor, as a
  // string, its full compendium source.
  const tail = s => String(s).split(".").pop();
  const own = [itemData?._stats?.compendiumSource, itemData?._id].filter(Boolean).map(tail);
  return !own.includes(tail(origin));
}

/** Effects without on/off state, origin or bookkeeping, and without effects applied from elsewhere. */
function effectDefinition(effects, itemData) {
  return (plain(effects) ?? []).filter(e => !isForeignEffect(e, itemData)).map(e => {
    const rest = { ...(e ?? {}) };
    for ( const key of ["disabled", "origin", "_stats", "sort", "flags"] ) delete rest[key];
    return rest;
  }).sort((a, b) => String(a._id ?? a.name).localeCompare(String(b._id ?? b.name)));
}

/** Advancements without what they recorded for this character (`value`). */
export function advancementDefinition(advancement) {
  const list = Array.isArray(advancement) ? advancement : Object.values(plain(advancement) ?? {});
  return list.map(a => {
    const rest = { ...(plain(a) ?? {}) };
    delete rest.value;
    return rest;
  }).sort((a, b) => String(a._id).localeCompare(String(b._id)));
}

/**
 * An item's definition, cut into {@link FIELD_GROUPS}, each as a canonical string.
 * @param {object} itemData   Plain item data.
 * @returns {Record<string, string>}
 */
export function definitionGroups(itemData) {
  const data = plain(itemData ?? {});
  const system = { ...(data.system ?? {}) };
  for ( const path of statePaths(data) ) deletePath(system, path.replace(/^system\./, ""));

  const groups = {
    name: data.name ?? "",
    img: data.img ?? "",
    description: system.description ?? null,
    activities: activityDefinition(system.activities, data),
    uses: system.uses ?? null,
    damage: system.damage ?? null,
    effects: effectDefinition(data.effects, data),
    advancement: advancementDefinition(system.advancement)
  };
  for ( const key of ["description", "activities", "uses", "damage", "advancement"] ) delete system[key];
  if ( system.source && (typeof system.source === "object") ) {
    const source = { ...system.source };
    for ( const key of DERIVED_SOURCE_KEYS ) delete source[key];
    system.source = source;
  }
  groups.other = { type: data.type, system };

  const out = {};
  for ( const key of FIELD_GROUPS ) out[key] = stableStringify(groups[key]);
  return out;
}

/**
 * One hash per field group.
 * @param {object} itemData
 * @returns {Record<string, string>}
 */
export function groupHashes(itemData) {
  const groups = definitionGroups(itemData);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, hashString(v)]));
}

/**
 * The groups in which two items' definitions differ.
 * @param {object} a
 * @param {object} b
 * @returns {string[]}
 */
export function changedGroups(a, b) {
  // dnd5e fills an empty identifier from the name when an item is created, so a compendium entry with
  // none and its copy with one are the same definition.
  if ( !a?.system?.identifier !== !b?.system?.identifier ) {
    a = { ...a, system: { ...a?.system, identifier: "" } };
    b = { ...b, system: { ...b?.system, identifier: "" } };
  }
  // The same preparation fills an empty `source.book` from the pack's placeholder, on whichever side
  // it ran. An empty book and the placeholder are the same book.
  const placeholder = a?.system?.source?.bookPlaceholder || b?.system?.source?.bookPlaceholder;
  if ( placeholder ) {
    const fill = d => (d?.system?.source && !d.system.source.book)
      ? { ...d, system: { ...d.system, source: { ...d.system.source, book: placeholder } } } : d;
    a = fill(a);
    b = fill(b);
  }
  const ga = definitionGroups(a);
  const gb = definitionGroups(b);
  return FIELD_GROUPS.filter(k => ga[k] !== gb[k]);
}

/**
 * Whether an item's advancement *configuration* differs from another's — the test that sends an item
 * to the rebuild rather than the in-place refresh. What the advancements recorded is ignored.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function advancementChanged(a, b) {
  return stableStringify(advancementDefinition(a?.system?.advancement))
    !== stableStringify(advancementDefinition(b?.system?.advancement));
}

/* -------------------------------------------- */
/*  The stamp                                   */
/* -------------------------------------------- */

/**
 * The package a compendium uuid belongs to: `Compendium.<package>.<pack>…` → `<package>`. The
 * system's own packs answer with the system id.
 * @param {string} uuid
 * @returns {string|null}
 */
export function packageOfUuid(uuid) {
  const parts = String(uuid ?? "").split(".");
  return (parts[0] === "Compendium") && parts[1] ? parts[1] : null;
}

/**
 * The stamp to store on an item created from a compendium: which package and version it came from,
 * and the hash of each definition group *as it arrived*.
 * @param {object} itemData           Item data as created (fresh from the compendium).
 * @param {object} source
 * @param {string} source.uuid        The compendium uuid it came from.
 * @param {string} [source.version]   That package's version.
 * @returns {{v: number, uuid: string, package: string|null, version: string|null, groups: Record<string,string>}}
 */
export function sourceStamp(itemData, { uuid, version = null }) {
  return {
    v: STAMP_VERSION,
    uuid,
    package: packageOfUuid(uuid),
    version: version ?? null,
    groups: groupHashes(itemData)
  };
}

/**
 * A stamp, if the item carries a usable one.
 * @param {object} itemData
 * @param {string} moduleId
 * @returns {object|null}
 */
export function readStamp(itemData, moduleId) {
  const stamp = itemData?.flags?.[moduleId]?.[STAMP_FLAG];
  if ( !stamp || (stamp.v !== STAMP_VERSION) || !stamp.groups ) return null;
  return stamp;
}

/**
 * Which groups the player changed since the item was created, when a stamp says so. Null when there
 * is no stamp, meaning "unknown" — not "nothing".
 * @param {object} itemData
 * @param {object|null} stamp
 * @returns {string[]|null}
 */
export function editedGroups(itemData, stamp) {
  if ( !stamp?.groups ) return null;
  const now = groupHashes(itemData);
  return FIELD_GROUPS.filter(k => (k in stamp.groups) && (stamp.groups[k] !== now[k]));
}
