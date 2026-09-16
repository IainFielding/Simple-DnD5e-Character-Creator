import { MODULE_ID } from "../config.mjs";
import { PHYSICAL_TYPES } from "./store-source.mjs";
import { normalizeRarity, itemRarity, magicEntryFromItem } from "./magic-shop.mjs";

/**
 * Magic item *templates*, expanded into the finished items a shop stocks.
 *
 * The 2024 Dungeon Master's Guide module doesn't ship a "Wand of the War Mage, +1". It ships
 * "Wand of the War Mage, +1, +2, or +3": a template with an enchant activity, whose enchantment
 * profiles (+1, +2, +3) are meant to be applied to a base item — here a Wand, which the template's
 * description links. Templates are marked by an embed of the module's "Foundry reference" journal
 * page at the foot of their description.
 *
 * Each template is expanded into one shop entry per enchantment per base item: the base the
 * description links (a Wand; Frost Brand's six swords), or, when it names none ("Weapon (Any Simple
 * or Martial)"), every base item dnd5e lists that the description's wording allows. The entries
 * carry a composite id — `template#profile#base` — and are built into real items only when granted:
 * the base item with the template's enchantment embedded, exactly as dnd5e's own enchant activity
 * would leave it, so the system names it, prices it and gives it its bonus.
 *
 * The approach follows sogrom-simple-dnd5e-magic-shop's `data/enchant.mjs`, the same author's
 * module, adapted: that shop asks the GM for one base at a time, where this expands every base.
 *
 * Everything above the "Loading" banner is pure and unit-tested.
 */

/** The DMG module's reference-page embed that marks a template item's description. */
const TEMPLATE_MARKERS = ["JournalEntryPage.Ok4iCgD25ENgoRxE", "dmgFoundryRefere"];

/** Joins the three parts of a variant's id. Foundry uuids never contain it. */
const SEP = "#";

/* -------------------------------------------- */
/*  Variant ids                                 */
/* -------------------------------------------- */

/** The composite id of one enchantment on one base. */
export function variantId(templateUuid, profileId, baseUuid) {
  return [templateUuid, profileId, baseUuid].join(SEP);
}

/**
 * Split a variant id. Null for an ordinary item uuid.
 * @returns {{template: string, profile: string, base: string}|null}
 */
export function parseVariant(id) {
  const parts = String(id ?? "").split(SEP);
  if ( parts.length !== 3 || parts.some(p => !p) ) return null;
  return { template: parts[0], profile: parts[1], base: parts[2] };
}

/**
 * The uuid to link an entry by — its template for a variant (whose description is the item's), the
 * entry itself otherwise.
 */
export function linkUuid(id) {
  return parseVariant(id)?.template ?? id;
}

/* -------------------------------------------- */
/*  Reading a template                          */
/* -------------------------------------------- */

function valuesOf(source) {
  if ( !source ) return [];
  if ( Array.isArray(source) ) return source;
  if ( Array.isArray(source.contents) ) return source.contents;
  if ( source instanceof Map ) return [...source.values()];
  if ( typeof source === "object" ) return Object.values(source);
  return [];
}

function listOf(source) {
  if ( !source ) return [];
  return [...source].filter(v => typeof v === "string" && v);
}

function plain(doc) {
  return typeof doc?.toObject === "function" ? doc.toObject() : doc;
}

function changesOf(effect) {
  return valuesOf(effect?.system?.changes ?? effect?.changes);
}

function changeFor(effect, key) {
  return changesOf(effect).find(change => change?.key === key);
}

/**
 * @typedef {object} TemplateProfile
 * @property {string} activityId
 * @property {string} profileId     The enchantment effect's id on the template.
 * @property {string} name          The effect's name.
 * @property {{value: string, type: string}|null} nameChange
 * @property {string} rarity        Normalised: the profile's own, else the template's.
 * @property {{type: string, categories: string[], allowMagical: boolean}} restrictions
 * @property {{activity: string[], effect: string[]}} riders
 */

/**
 * The enchantments a template turns into items of their own.
 *
 * Skipped:
 *  - **rider activities** — Flame Tongue's "Engulf in Flames" toggles a finished sword alight;
 *  - **add-ons** — an enchantment that neither renames the item nor sets a rarity is a further
 *    option on an item already made (Moonblade's runes, the Hammer's Giant's Bane);
 *  - profiles that **grant items** (Demon Armor's claws), which a shop entry can't carry;
 *  - anything whose effect is missing or isn't an enchantment.
 * @param {object} template  An item document or its data.
 * @returns {TemplateProfile[]}
 */
export function templateProfiles(template) {
  const activities = valuesOf(template?.system?.activities).filter(a => a?.type === "enchant");
  if ( !activities.length ) return [];
  const effects = new Map(valuesOf(template?.effects).map(e => {
    const data = plain(e);
    return [data?._id ?? e?.id, data];
  }));
  const riderActivities = new Set(activities.flatMap(a => valuesOf(a.effects).flatMap(p => listOf(p?.riders?.activity))));
  // A template that sets no rarity of its own may still say it: in `system.rarities` (as Candleflame
  // Bow does) or in its headline.
  const templateRarity = itemRarity(template) || headlineRarity(template);

  const out = [];
  for ( const activity of activities ) {
    const activityId = activity._id ?? activity.id;
    if ( !activityId || riderActivities.has(activityId) ) continue;
    const restrictions = activity.restrictions ?? {};
    for ( const entry of valuesOf(activity.effects) ) {
      const effect = effects.get(entry?._id);
      if ( !effect || (effect.type !== "enchantment" && effect.flags?.dnd5e?.type !== "enchantment") ) continue;
      if ( listOf(entry?.riders?.item).length ) continue;
      const name = changeFor(effect, "name");
      // 6.0.2 migrates a change to `system.rarity` into one to `system.rarities`; read either.
      const rarityChange = changeFor(effect, "system.rarity") ?? changeFor(effect, "system.rarities");
      const rarity = { value: Array.isArray(rarityChange?.value) ? rarityChange.value[0] : rarityChange?.value };
      const nameValue = typeof name?.value === "string" ? name.value : "";
      const renames = !!nameValue && (nameValue.includes("{}") || name.type === "override" || name.mode === 5);
      if ( !renames && !normalizeRarity(rarity?.value) ) continue;
      out.push({
        activityId,
        profileId: entry._id,
        name: effect.name ?? "",
        nameChange: renames ? { value: nameValue, type: name.type ?? "" } : null,
        rarity: normalizeRarity(rarity?.value) || templateRarity,
        restrictions: {
          type: typeof restrictions.type === "string" ? restrictions.type : "",
          categories: listOf(restrictions.categories),
          allowMagical: !!restrictions.allowMagical
        },
        riders: { activity: listOf(entry?.riders?.activity), effect: listOf(entry?.riders?.effect) }
      });
    }
  }
  return out;
}

/** Whether a description carries the DMG module's template marker. */
export function hasTemplateMarker(item) {
  const text = item?.system?.description?.value;
  return typeof text === "string" && TEMPLATE_MARKERS.some(m => text.includes(m));
}

/**
 * Whether an item is a template to expand rather than stock as it is: the DMG's marker, or — for
 * templates from elsewhere — a magical item with no rarity or no subtype of its own; either way with
 * at least one enchantment that makes an item.
 */
export function isTemplate(item) {
  if ( !PHYSICAL_TYPES.includes(item?.type) ) return false;
  const marked = hasTemplateMarker(item);
  const hollow = listOf(item?.system?.properties).includes("mgc")
    && (!itemRarity(item) || !item?.system?.type?.value);
  if ( !marked && !hollow ) return false;
  return templateProfiles(item).length > 0;
}

/**
 * Whether an index entry might be a template, and so needs its full document loaded to tell. Needs
 * `system.description.value` and `system.properties` in the index.
 */
export function mightBeTemplate(entry) {
  if ( !PHYSICAL_TYPES.includes(entry?.type) ) return false;
  if ( hasTemplateMarker(entry) ) return true;
  return listOf(entry?.system?.properties).includes("mgc") && !itemRarity(entry);
}

/** Rarity words as a headline spells them, rarest last so "Very Rare" is tested before "Rare". */
const HEADLINE_RARITY = /\b(very\s+rare|uncommon|common|rare|legendary|artifact|rarity\s+varies)\b/i;

/**
 * The template's own line of type and rarity: "{Wand}, Uncommon (+1)…", "Weapon (Any Simple or
 * Martial), Rare".
 *
 * The DMG sets it as an italic paragraph of its own; other modules open the first paragraph with it
 * and break to the prose with a `<br>` (Candleflame Bow). Either way it is the start of the first
 * paragraph up to the first break — and it only counts when it names a rarity, so a template that
 * opens straight into prose (Ammunition of Slaying) has no headline rather than a sentence of flavour
 * text whose links would be mistaken for bases.
 * @returns {string}  The headline's HTML, or "".
 */
function headline(template) {
  const text = template?.system?.description?.value;
  if ( typeof text !== "string" ) return "";
  const first = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(text)?.[1] ?? "";
  const line = first.split(/<br\s*\/?>/i)[0].replace(/<\/?em>/gi, "").trim();
  return HEADLINE_RARITY.test(line.replace(/@UUID\[[^\]]+\](\{[^}]*\})?/g, "")) ? line : "";
}

/** The rarity a headline names first, normalised; "" when it names none. */
export function headlineRarity(template) {
  const word = HEADLINE_RARITY.exec(headline(template).replace(/@UUID\[[^\]]+\](\{[^}]*\})?/g, ""))?.[1];
  return normalizeRarity(word ?? "");
}

/**
 * The base items the template's headline links, in order: `@UUID[…]{Wand}`. A link written without
 * its document type (`Compendium.pkg.pack.id`, which Foundry still resolves) is read as an Item.
 */
export function linkedBaseUuids(template) {
  return [...headline(template).matchAll(/@UUID\[([^\]]+)\]/g)]
    .map(m => {
      const parts = m[1].split(".");
      return ((parts[0] === "Compendium") && (parts.length === 4)) ? [...parts.slice(0, 3), "Item", parts[3]].join(".") : m[1];
    })
    .filter(uuid => /\.Item\.[^.]+$/.test(uuid) || /^Item\.[^.]+$/.test(uuid));
}

/**
 * @typedef {object} BaseRule
 * @property {"weapon"|"armor"} kind
 * @property {string[]} weaponTypes  dnd5e weapon subtypes (simpleM, martialR…).
 * @property {boolean} ammo
 * @property {string[]} armorTypes   light/medium/heavy/shield.
 * @property {string[]} exclude      Lower-case name prefixes to leave out ("hide").
 */

/**
 * What an unlinked headline allows, from its wording: "Weapon (Any Simple or Martial)", "Weapon (Any
 * Ammunition or Melee Weapon)", "Armor (Any Medium or Heavy, Except Hide Armor)".
 * @param {string} text
 * @returns {BaseRule|null}  Null when the wording names no weapon or armour.
 */
export function baseRuleFromText(text) {
  const plainText = String(text ?? "").replace(/<[^>]+>/g, "").replace(/@UUID\[[^\]]+\]/g, "");
  const match = /^\s*(Weapon|Armou?r)\s*\(([^)]*)\)/i.exec(plainText);
  if ( !match ) return null;
  const inside = match[2].toLowerCase();
  const exclude = [...inside.matchAll(/except\s+([a-z' -]+?)\s+armou?r/g)].map(m => m[1].trim());

  if ( /^weapon/i.test(match[1]) ) {
    const simple = /\bsimple\b/.test(inside);
    const martial = /\bmartial\b/.test(inside);
    const melee = /\bmelee\b/.test(inside);
    const ranged = /\branged\b/.test(inside);
    const ammo = /\bammunition\b/.test(inside);
    const classes = (simple || martial) ? [simple && "simple", martial && "martial"].filter(Boolean) : ["simple", "martial"];
    const reaches = (melee || ranged) ? [melee && "M", ranged && "R"].filter(Boolean) : ["M", "R"];
    const anyWeapon = simple || martial || melee || ranged || !ammo;
    const weaponTypes = anyWeapon ? classes.flatMap(c => reaches.map(r => `${c}${r}`)) : [];
    return { kind: "weapon", weaponTypes, ammo, armorTypes: [], exclude };
  }

  const armorTypes = ["light", "medium", "heavy"].filter(t => new RegExp(`\\b${t}\\b`).test(inside));
  if ( /\bshield\b/.test(inside) ) armorTypes.push("shield");
  return { kind: "armor", weaponTypes: [], ammo: false, armorTypes: armorTypes.length ? armorTypes : ["light", "medium", "heavy"], exclude };
}

/**
 * @typedef {object} BaseSummary
 * @property {string} uuid
 * @property {string} name
 * @property {string} type
 * @property {string} subtype
 * @property {string[]} properties
 */

/** Whether a base fits an unlinked headline's rule. */
export function baseMatchesRule(base, rule) {
  if ( !rule ) return false;
  const name = String(base?.name ?? "").toLowerCase();
  if ( rule.exclude.some(prefix => name.startsWith(prefix)) ) return false;
  if ( rule.kind === "weapon" ) {
    if ( (base.type === "weapon") && rule.weaponTypes.includes(base.subtype) ) return true;
    return rule.ammo && (base.type === "consumable") && (base.subtype === "ammo");
  }
  return (base.type === "equipment") && rule.armorTypes.includes(base.subtype);
}

/**
 * The rule for an unlinked template: its headline's wording, or — when it has no headline, as
 * Ammunition of Slaying doesn't — its own item type (ammunition, any weapon, any body armour).
 * @returns {BaseRule|null}
 */
export function baseRuleFor(template) {
  const fromText = baseRuleFromText(headline(template));
  if ( fromText ) return fromText;
  const subtype = template?.system?.type?.value ?? "";
  if ( (template?.type === "consumable") && (subtype === "ammo") ) {
    return { kind: "weapon", weaponTypes: [], ammo: true, armorTypes: [], exclude: [] };
  }
  if ( template?.type === "weapon" ) return baseRuleFromText("Weapon (Any Simple or Martial)");
  if ( (template?.type === "equipment") && ["", "light", "medium", "heavy"].includes(subtype) ) {
    return baseRuleFromText("Armor (Any Light, Medium, or Heavy)");
  }
  return null;
}

/**
 * Whether an enchantment's own restrictions admit a base, as dnd5e's `canEnchant` reads them. With
 * no type restriction the base must be the template's own kind — Adamantine Ammunition's headline
 * says "Ammunition or Melee Weapon", but it is ammunition.
 * @param {TemplateProfile} profile
 * @param {BaseSummary} base
 * @param {object} [template]
 */
export function profileAllows(profile, base, template) {
  const { categories, allowMagical } = profile.restrictions;
  const type = profile.restrictions.type || template?.type || "";
  if ( type && (base.type !== type) ) return false;
  if ( categories.length && !categories.includes(base.subtype) ) return false;
  if ( !allowMagical && listOf(base.properties).includes("mgc") ) return false;
  return true;
}

/**
 * The name a variant will carry, the way dnd5e's name change reads: `{}` is the base item's name.
 * @param {TemplateProfile} profile
 * @param {object} template
 * @param {BaseSummary} base
 */
export function variantName(profile, template, base) {
  const change = profile.nameChange;
  if ( change?.value.includes("{}") ) return change.value.replaceAll("{}", base.name);
  if ( change?.value ) return change.value;
  return `${profile.name || template?.name || ""} (${base.name})`;
}

/**
 * Every shop entry a template makes.
 * @param {object} params
 * @param {object} params.template       The template document or data.
 * @param {string} params.templateUuid
 * @param {BaseSummary[]} params.linked  The bases its headline links, resolved.
 * @param {BaseSummary[]} params.pool    dnd5e's base weapons, armour and ammunition, for an
 *                                       unlinked headline.
 * @returns {object[]}  Inventory entries, name-sorted; empty when there is no base to put it on.
 */
export function templateVariants({ template, templateUuid, linked = [], pool = [] }) {
  const profiles = templateProfiles(template);
  if ( !profiles.length ) return [];
  const rule = linked.length ? null : baseRuleFor(template);
  const bases = linked.length ? linked : pool.filter(base => baseMatchesRule(base, rule));

  const entries = [];
  for ( const profile of profiles ) {
    for ( const base of bases ) {
      if ( !profileAllows(profile, base, template) ) continue;
      entries.push({
        ...magicEntryFromItem({ name: variantName(profile, template, base), type: base.type,
          system: { rarity: profile.rarity, type: { value: base.subtype } } },
        variantId(templateUuid, profile.profileId, base.uuid)),
        profileName: distinctWords(profile.name, template?.name)
      });
    }
  }
  // Two enchantments that rename alike ("Chain Mail of Vulnerability", three times over) keep
  // their own effect's name alongside, so the shop can tell them apart.
  const byName = new Map();
  for ( const e of entries ) byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
  for ( const e of entries ) {
    if ( (byName.get(e.name) > 1) && e.profileName ) e.name = `${e.name} (${e.profileName})`;
    delete e.profileName;
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The words of a profile's name the template's name doesn't already say: "1st Level Enspelled Armor"
 * on Enspelled Armor is "1st Level", so the entry reads "Enspelled Breastplate (1st Level)".
 */
function distinctWords(profileName, templateName) {
  const shared = new Set(String(templateName ?? "").toLowerCase().split(/[^a-z0-9'+-]+/).filter(Boolean));
  const kept = String(profileName ?? "").split(/\s+/).filter(w => !shared.has(w.toLowerCase().replace(/[^a-z0-9'+-]/g, "")));
  return kept.join(" ").trim() || profileName;
}

/**
 * The creation data for a variant: the base item with the template's enchantment and its riders
 * embedded the way dnd5e's `EnchantActivity#applyEnchantment` builds them.
 *
 * The enchantment's `origin` is left unset. dnd5e re-runs `canEnchant` against it whenever the
 * effect is created, and by then the item is magical, which a "no magic items" enchantment would
 * refuse. The activity and profile are still recorded in `system.origin` and the profile flag.
 * @param {object} params
 * @param {object} params.base          The base item's `toObject()` data.
 * @param {string} params.baseUuid
 * @param {object} params.template      The template's `toObject()` data.
 * @param {string} params.templateUuid
 * @param {TemplateProfile} params.profile
 * @param {() => string} [params.newId]  Injected so a test can pin ids.
 * @returns {object}
 */
export function enchantedItemData({ base, baseUuid, template, templateUuid, profile, newId }) {
  const id = newId ?? (() => foundry.utils.randomID());
  const data = structuredClone(base);
  for ( const field of ["_id", "folder", "sort", "ownership"] ) delete data[field];

  const effects = new Map(valuesOf(template?.effects).map(e => [e._id, e]));
  const enchantId = id();
  const enchantment = structuredClone(effects.get(profile.profileId));
  Object.assign(enchantment, { _id: enchantId, transfer: true, disabled: false });
  delete enchantment.origin;
  enchantment.flags = { ...enchantment.flags, dnd5e: { ...enchantment.flags?.dnd5e, enchantmentProfile: profile.profileId } };
  enchantment.system = {
    ...enchantment.system,
    origin: { activity: `${templateUuid}.Activity.${profile.activityId}`, profile: profile.profileId }
  };

  const riderEffects = profile.riders.effect.map(riderId => {
    const rider = effects.get(riderId);
    if ( !rider ) return null;
    const copy = structuredClone(rider);
    copy._id = id();
    delete copy.origin;
    copy.flags = { ...copy.flags, dnd5e: { ...copy.flags?.dnd5e, dependentOn: enchantId } };
    delete copy.flags.dnd5e.rider;
    return copy;
  }).filter(Boolean);

  const activities = { ...(data.system?.activities ?? {}) };
  const templateActivities = template?.system?.activities ?? {};
  for ( const riderId of profile.riders.activity ) {
    const rider = templateActivities[riderId];
    if ( !rider ) continue;
    const copy = structuredClone(rider);
    copy._id = id();
    copy.flags = { ...copy.flags, dnd5e: { ...copy.flags?.dnd5e, dependentOn: enchantId } };
    activities[copy._id] = copy;
    // The effects a rider activity applies keep their ids: the activity finds them by id, and dnd5e
    // leaves an effect an activity points at unapplied until the activity is used.
    for ( const ref of valuesOf(rider.effects) ) {
      const effect = effects.get(ref?._id);
      const have = [...valuesOf(data.effects), ...riderEffects].some(e => e?._id === ref?._id);
      if ( effect && !have ) riderEffects.push(structuredClone(effect));
    }
  }

  data.system = { ...data.system, activities };
  data.effects = [...valuesOf(data.effects), enchantment, ...riderEffects];
  data._stats = { ...data._stats, compendiumSource: baseUuid ?? null };
  data.flags = {
    ...data.flags,
    [MODULE_ID]: { ...data.flags?.[MODULE_ID], madeFrom: { template: templateUuid, profile: profile.profileId, base: baseUuid ?? "" } }
  };
  return data;
}

/* -------------------------------------------- */
/*  Shells                                      */
/* -------------------------------------------- */

/** The profile part of a shell variant's id. A shell has no enchantment to name; see {@link isShell}. */
export const SHELL_PROFILE = "shell";

/** Weapon headline words that name a family of base weapons rather than one. */
const WEAPON_FAMILIES = {
  sword: /sword|scimitar|rapier/,
  axe: /axe$/,
  bow: /^(long|short)bow$/,
  crossbow: /crossbow/,
  hammer: /hammer/,
  spear: /spear|pike|lance|trident/,
  firearm: /pistol|musket|firearm/
};

/** Adjectives that finish the noun before them: "crossbow, heavy" is a Heavy Crossbow. */
const WEAPON_ADJECTIVES = new Set(["heavy", "light", "hand"]);

/** dnd5e's own keys for the normalised rarities that differ. */
const SYSTEM_RARITY = { veryrare: "veryRare" };

/**
 * Whether an item is a *shell*: a magic weapon or armour written up in full but never given the item
 * underneath it — no base item, no damage, no armour class — so on a sheet it could neither attack
 * nor be worn. The Griffon's Saddlebag work-in-progress pack is almost entirely these ("Bonfire Blade:
 * Weapon (any sword), common"). A shell is expanded like a template, onto every base its headline
 * names, but with nothing to enchant: the base item takes on the shell's name, art, text and rarity.
 * @param {object} item
 * @returns {boolean}
 */
export function isShell(item) {
  if ( !["weapon", "equipment"].includes(item?.type) ) return false;
  if ( item.system?.type?.baseItem ) return false;
  const words = headlineWords(item);
  if ( !words ) return false;
  if ( item.type === "weapon" ) return (words.kind === "weapon") && !item.system?.damage?.base?.denomination;
  return (words.kind === "armor") && !Number(item.system?.armor?.value);
}

/**
 * A headline's kind and its parenthesised wording: "Weapon (any sword)" → weapon, "any sword".
 * @returns {{kind: "weapon"|"armor", inside: string}|null}
 */
function headlineWords(item) {
  const text = headline(item).replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1").replace(/<[^>]+>/g, "");
  const match = /^\s*(Weapon|Armou?r)\s*\(([^)]*)\)/i.exec(text);
  if ( !match ) return null;
  return { kind: /^weapon/i.test(match[1]) ? "weapon" : "armor", inside: match[2].toLowerCase() };
}

/** A name's words, singular: "arrow" matches "Arrows", "firearm bullet" matches "Bullets, Firearm". */
function nameWords(name) {
  return String(name ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean).map(w => w.replace(/s$/, ""));
}

/** dnd5e's weapon property keys, by the word a headline uses. */
const WEAPON_PROPERTIES = {
  thrown: "thr", reach: "rch", heavy: "hvy", "two-handed": "two", special: "spc", finesse: "fin",
  light: "lgt", versatile: "ver", loading: "lod", ammunition: "amm"
};

/**
 * The bases a named token picks out. A base named exactly that ("leather" → Leather Armor, "sling"
 * → Sling) wins over one that merely contains the words (Studded Leather Armor, Sling Bullets).
 */
function namedBases(token, bases) {
  const want = nameWords(token).filter(w => w !== "armor");
  if ( !want.length ) return [];
  const exact = bases.filter(b => {
    const have = nameWords(b.name).filter(w => w !== "armor");
    return (have.length === want.length) && want.every(w => have.includes(w));
  });
  if ( exact.length ) return exact;
  const containing = bases.filter(b => want.every(w => nameWords(b.name).includes(w)));
  if ( containing.length || (want.length < 2) ) return containing;
  // "Blowgun needle" is dnd5e's Needles: fall back on the noun alone.
  return bases.filter(b => nameWords(b.name).includes(want.at(-1)));
}

/** Split a headline's wording into its listed parts. */
function headlineTokens(inside) {
  return inside.split(/,|\bor\b|\band\b|\//).map(t => t.trim()).filter(Boolean);
}

/**
 * The bases a shell's headline names, from dnd5e's base weapons, armour and ammunition.
 *
 * Armour reads "metal" (medium or heavy, but hide), a weight ("light", "any light armor"), named
 * pieces ("half plate or plate"), or nothing but "any". Weapons read a family ("any sword", "any
 * axe", "any bow"), a class or reach ("simple", "martial melee"), "any" alone, or named weapons
 * ("dagger and rapier", "crossbow, heavy or light", "arrow, bolt, or firearm bullet"). "But not hide"
 * and "except hide" leave hide out. Barding matches nothing: dnd5e has no base barding.
 * @param {object} item
 * @param {BaseSummary[]} pool
 * @returns {BaseSummary[]}
 */
export function shellBases(item, pool) {
  const words = headlineWords(item);
  if ( !words ) return [];
  let text = words.inside.replace(/\bhalfplate\b/g, "half plate").replace(/\b(?:a|an|the|piece of)\s+(?!propert)/g, "");
  // "With the thrown property", "without the reach or heavy property".
  const withProps = [];
  const withoutProps = [];
  text = text.replace(/\b(with|without)\s+(?:the\s+)?([a-z\- ]+?)\s+propert(?:y|ies)\b/g, (_, how, list) => {
    const keys = headlineTokens(list).map(p => WEAPON_PROPERTIES[p]).filter(Boolean);
    (how === "with" ? withProps : withoutProps).push(...keys);
    return "";
  });
  // "Any slashing or piercing simple weapon": the damage types, then the rest of the wording.
  const damageTypes = [...text.matchAll(/\b(bludgeoning|piercing|slashing)\b/g)].map(m => m[1]);
  text = text.replace(/\b(bludgeoning|piercing|slashing)\b/g, "").replace(/\bmetal\s+(?=melee|weapon)/g, "");
  const excluded = [...text.matchAll(/\b(?:but not|except)\s+([a-z]+)/g)].map(m => m[1].replace(/s$/, ""));
  const inside = text
    .replace(/\b(?:but not|except)\s+[a-z]+(?:\s+armou?r)?/g, "")
    .replace(/\barmou?r\b/g, "")
    .replace(/\bweapons?\b/g, "");
  const keep = base => {
    if ( excluded.some(x => nameWords(base.name).includes(x)) ) return false;
    const props = listOf(base.properties);
    if ( withProps.some(p => !props.includes(p)) || withoutProps.some(p => props.includes(p)) ) return false;
    return !damageTypes.length || !base.damageTypes || damageTypes.some(t => base.damageTypes.includes(t));
  };

  if ( words.kind === "armor" ) {
    if ( /\bbarding\b/.test(inside) ) return [];
    const armour = pool.filter(b => (b.type === "equipment") && ["light", "medium", "heavy", "shield"].includes(b.subtype));
    if ( /\bmetal\b/.test(inside) ) {
      return armour.filter(b => ["medium", "heavy"].includes(b.subtype) && !nameWords(b.name).includes("hide") && keep(b));
    }
    const weights = ["light", "medium", "heavy", "shield"];
    const tokens = headlineTokens(inside).map(t => t.replace(/\bany\b/g, "").trim()).filter(Boolean);
    const named = tokens.filter(t => !weights.includes(t));
    const weighted = tokens.filter(t => weights.includes(t));
    const found = new Set();
    for ( const b of armour ) if ( weighted.includes(b.subtype) ) found.add(b);
    for ( const t of named ) namedBases(t, armour).forEach(b => found.add(b));
    // "Any", "any armor": everything worn on the body.
    if ( !tokens.length ) armour.filter(b => b.subtype !== "shield").forEach(b => found.add(b));
    return [...found].filter(keep);
  }

  const weapons = pool.filter(b => (b.type === "weapon") || ((b.type === "consumable") && (b.subtype === "ammo")));
  const arms = weapons.filter(b => b.type === "weapon");
  const tokens = headlineTokens(inside);
  const found = new Set();
  let previousNoun = null;
  tokens.forEach((raw, i) => {
    const token = raw.replace(/\bany\b/g, "").trim();
    if ( WEAPON_ADJECTIVES.has(token) && previousNoun ) {
      for ( const b of weapons ) {
        const w = nameWords(b.name);
        if ( w.includes(token) && w.includes(previousNoun) ) found.add(b);
      }
      return;
    }
    previousNoun = nameWords(token).at(-1) ?? previousNoun;
    // A noun followed by its adjective ("crossbow, heavy") names only that version, read above.
    if ( WEAPON_ADJECTIVES.has(tokens[i + 1]) ) return;

    if ( /^ammunition$/.test(token) ) {
      weapons.filter(b => b.type === "consumable").forEach(b => found.add(b));
      return;
    }
    // "Any" on its own is every weapon; beside other words ("any … simple weapon") it adds nothing.
    if ( !token ) {
      if ( tokens.some(t => t.replace(/\bany\b/g, "").trim()) ) return;
      arms.filter(b => /^(simple|martial)[MR]$/.test(b.subtype)).forEach(b => found.add(b));
      return;
    }
    if ( /\b(simple|martial|melee|ranged)\b/.test(token) ) {
      const rule = baseRuleFromText(`Weapon (${token})`);
      arms.filter(b => baseMatchesRule(b, rule)).forEach(b => found.add(b));
      return;
    }
    const family = /\bany\b/.test(raw) && Object.entries(WEAPON_FAMILIES).find(([key]) => nameWords(token).includes(key));
    if ( family ) {
      arms.filter(b => family[1].test(b.name.toLowerCase().replace(/[^a-z]/g, ""))).forEach(b => found.add(b));
      return;
    }
    namedBases(token, weapons).forEach(b => found.add(b));
  });
  return [...found].filter(keep);
}

/**
 * The shop entries a shell makes: one per base its headline names. With one base the entry keeps
 * the shell's name; with several each is told apart by its base, "Bonfire Blade (Longsword)".
 * @param {object} params
 * @param {object} params.item       The shell.
 * @param {string} params.itemUuid
 * @param {BaseSummary[]} params.pool
 * @returns {object[]}
 */
export function shellVariants({ item, itemUuid, pool }) {
  const rarity = itemRarity(item) || headlineRarity(item);
  if ( !rarity ) return [];
  const bases = shellBases(item, pool);
  return bases.map(base => magicEntryFromItem({
    name: shellName(item, base, bases.length),
    type: base.type,
    system: { rarity, type: { value: base.subtype } }
  }, variantId(itemUuid, SHELL_PROFILE, base.uuid))).sort((a, b) => a.name.localeCompare(b.name));
}

/** A shell variant's name: the shell's own, with the base alongside when there is more than one. */
export function shellName(item, base, count) {
  return (count > 1) ? `${item.name} (${base.name})` : item.name;
}

/**
 * The creation data for a shell variant: the base item, renamed and re-described as the shell, made
 * magical at the shell's rarity, carrying the shell's own activities and effects. The base's attack
 * stays; a shell's empty attack (one with no damage of its own) is left out so it isn't listed twice.
 * @param {object} params
 * @param {object} params.base      The base item's `toObject()` data.
 * @param {string} params.baseUuid
 * @param {object} params.shell     The shell's `toObject()` data.
 * @param {string} params.shellUuid
 * @param {string} params.name      The entry's name.
 * @returns {object}
 */
export function shellItemData({ base, baseUuid, shell, shellUuid, name }) {
  const data = structuredClone(base);
  for ( const field of ["_id", "folder", "sort", "ownership"] ) delete data[field];
  const rarity = itemRarity(shell) || headlineRarity(shell);
  const properties = new Set([...(data.system?.properties ?? []), ...(shell.system?.properties ?? []), "mgc"]);
  const activities = { ...(data.system?.activities ?? {}) };
  for ( const [id, activity] of Object.entries(shell.system?.activities ?? {}) ) {
    const emptyAttack = (activity?.type === "attack") && !valuesOf(activity.damage?.parts).length;
    if ( !emptyAttack ) activities[id] = structuredClone(activity);
  }
  data.name = name || shell.name;
  data.img = shell.img || data.img;
  data.system = {
    ...data.system,
    description: { ...data.system?.description, value: shell.system?.description?.value ?? "" },
    identifier: shell.system?.identifier || data.system?.identifier,
    properties: [...properties],
    attunement: shell.system?.attunement || data.system?.attunement || "",
    activities
  };
  // dnd5e 6.0.2 keeps a `rarities` set where earlier versions keep one `rarity`; write the shape the
  // base item's own data uses.
  const key = rarity ? (SYSTEM_RARITY[rarity] ?? rarity) : "";
  if ( "rarities" in (base.system ?? {}) ) data.system.rarities = key ? [key] : [];
  else data.system.rarity = key;
  data.effects = [...valuesOf(data.effects), ...valuesOf(shell.effects).map(e => structuredClone(e))];
  data._stats = { ...data._stats, compendiumSource: shellUuid ?? null };
  data.flags = {
    ...data.flags,
    [MODULE_ID]: { ...data.flags?.[MODULE_ID], madeFrom: { shell: shellUuid, base: baseUuid ?? "" } }
  };
  return data;
}
