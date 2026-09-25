import { MODULE_ID, SETTINGS, levelUpEnabled, log } from "../config.mjs";
import {
  RARITIES, normalizeRarity, itemRarity, rarityLabel, sanitizeMagicEntry, sanitizeWealthTable, tierFor,
  tierGrantsAnything,
  descendantFolderIds, filterMagicIndex, countPicks, withinAllowance, bonusGoldCp, attunementRestriction
} from "./magic-shop.mjs";
import { createItemData } from "./item-factory.mjs";
// The shop now sells as well as grants, so it shares the Store's money maths rather than
// growing its own: one set of conversion rates, one definition of what an item costs.
import { priceCp, totalCp, fromCopper, formatCp } from "./store-source.mjs";
import {
  parseVariant, linkUuid, isTemplate, mightBeTemplate, linkedBaseUuids, templateVariants, templateProfiles,
  isShell, shellVariants, shellItemData, SHELL_PROFILE,
  enchantedItemData
} from "./magic-templates.mjs";

/**
 * The Foundry-facing half of the Magic Items step: reading the GM's settings, resolving the
 * stocked items when a player first opens the shelf, reading a dropped folder or pack, and
 * granting the picks on Create. The rules themselves are in {@link module:data/magic-shop}.
 */

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

/**
 * The GM's Magic Item Shop configuration, guarded.
 * @returns {{inventory: object[], wealthTable: object}}
 */
export function magicShopConfig() {
  let raw = null;
  try {
    raw = game.settings.get(MODULE_ID, SETTINGS.magicShopConfig);
  } catch {
    raw = null;
  }
  if ( !raw || typeof raw !== "object" ) raw = {};
  const inventory = Array.isArray(raw.inventory)
    ? raw.inventory.map(sanitizeMagicEntry).filter(e => e.uuid && e.rarity)
    : [];
  return { inventory, wealthTable: sanitizeWealthTable(raw.wealthTable) };
}

/**
 * Everything the character can spend in the shop, in copper: the tier's bonus gold plus the coin
 * they are already carrying.
 *
 * Both, because "spend their money" means their money. The bonus gold alone would make the purse
 * they earned from their starting equipment unspendable for no reason a player could explain, and
 * the purse alone would ignore the roll the step just made them do.
 *
 * The actor is optional: the step renders before one exists in some flows, and a budget of just
 * the bonus gold is the right answer then rather than a crash.
 * @param {object} state
 * @param {object|null} tier
 * @param {Actor|null} [actor]
 * @returns {number}
 */
export function magicShopBudgetCp(state, tier, actor = null) {
  const bonus = tier ? bonusGoldCp(tier, state?.magicShop?.d10) : 0;
  return bonus + totalCp(actor?.system?.currency ?? {});
}

/** What the cart in the magic shop costs, in copper. */
export function magicCartCp(state) {
  return Object.values(state?.magicShop?.cart ?? {})
    .reduce((sum, line) => sum + ((Number(line?.cp) || 0) * (Number(line?.qty) || 0)), 0);
}

/** The purchases as a list, for review screens and the grant. */
export function cartList(state) {
  return Object.entries(state?.magicShop?.cart ?? {})
    .filter(([, line]) => (Number(line?.qty) || 0) > 0)
    .map(([uuid, line]) => ({
      uuid, link: linkUuid(uuid), name: line.name ?? "", img: line.img ?? "",
      qty: Number(line.qty), cp: Number(line.cp) || 0
    }));
}

/**
 * The Magic Items step for a review page: the free picks coloured by rarity, anything bought, and
 * the bonus gold. Null wherever the step had nothing to offer.
 *
 * Lives here rather than on either review step because both need it. A character starting above
 * 1st level picks on the climb's rail and one starting at 1st picks on the creation rail, and the
 * same summary has to appear either way.
 *
 * Purchases are listed apart from the picks and carry what they cost. They are a different kind of
 * thing — a slot spent against coin spent — and a player checking this page before they commit
 * should see the bill, not just the haul.
 * @param {object|null} state  The creator state.
 * @returns {{items: object[], bought: object[], gold: string|null, spent: string|null,
 *            hasItems: boolean, hasBought: boolean}|null}
 */
export function magicShopReview(state) {
  if ( !state ) return null;
  const { tier, goldCp } = magicShopGrant(state, magicShopConfig());
  if ( !tier ) return null;

  const items = pickList(state)
    .map(p => ({ ...p, count: p.qty > 1 ? p.qty : null, rarityLabel: rarityLabel(p.rarity) }));
  const bought = cartList(state).map(p => ({ ...p, count: p.qty > 1 ? p.qty : null }));
  const spentCp = magicCartCp(state);
  const gold = (goldRolled(state, tier) && goldCp > 0) ? formatCp(goldCp) : null;
  if ( !items.length && !bought.length && !gold ) return null;

  return {
    items, bought, gold,
    spent: spentCp > 0 ? formatCp(spentCp) : null,
    hasItems: items.length > 0,
    hasBought: bought.length > 0
  };
}

/**
 * The wealth tier this build is owed, or null when the step doesn't apply: the creator isn't
 * climbing past level 1 (which needs the level-up mode), or the target level's row grants nothing.
 * There is no separate on/off switch — a GM turns the step off by setting a level's gold and item
 * counts to 0 (the config window's "Set all to 0" does every level at once).
 * @param {object} state  The creator state.
 * @param {object} [config]  A {@link magicShopConfig} result, to save re-reading it.
 */
export function magicShopTier(state, config = magicShopConfig()) {
  if ( !levelUpEnabled() ) return null;
  const tier = tierFor(state?.targetLevel ?? 1, config.wealthTable);
  return tierGrantsAnything(tier) ? tier : null;
}

/* -------------------------------------------- */
/*  Resolving the stock                         */
/* -------------------------------------------- */

/** Index fields the shelf needs beyond name/img/type, which every index carries. */
// Both rarity shapes: dnd5e 6.0.2 migrated `rarity` into a `rarities` set, and packs may hold either.
// `system.strength` is armour's minimum Strength score, and `system.type` carries the category and
// base item — between them, what the shelf needs to say whether the character can use an item.
// The description is read for one phrase, who the item's attunement is limited to ("Requires
// Attunement by a Bard"), which dnd5e keeps nowhere else. It is the heaviest field here, paid once per
// session on the first visit; only the parsed phrase is kept on the stock row.
// `system.price` is what the shop charges. The stock is built from a compendium *index*, and an
// index carries only the fields asked for here — so leaving it out did not make items free, it made
// them unpriced, and every row on the shelf read "Not for sale".
export const INDEX_FIELDS = ["system.rarity", "system.rarities", "system.type", "system.container",
  "system.strength", "system.price", "system.description.value"];

/**
 * Split a uuid into where it lives. `Compendium.<pkg>.<pack>.Item.<id>` names a pack;
 * `Item.<id>` a world item. Anything else can't be resolved from an index.
 * @returns {{pack: string|null, id: string}|null}
 */
export function locateUuid(uuid) {
  // A template variant lives where its template does.
  const parts = String(linkUuid(uuid) ?? "").split(".");
  if ( (parts[0] === "Compendium") && (parts.length >= 5) ) return { pack: `${parts[1]}.${parts[2]}`, id: parts.at(-1) };
  if ( (parts[0] === "Item") && (parts.length === 2) ) return { pack: null, id: parts[1] };
  return null;
}

/**
 * The shelf's stock, resolved lazily the first time a player opens the step and kept for the
 * session.
 *
 * Nothing here runs at `ready` or when the creator opens: a shop can hold thousands of items, and
 * a player who never reaches the step shouldn't pay for them. The first visit reads each source
 * pack's index — not the documents — once, which both confirms every entry still exists (a
 * disabled module's items drop out) and supplies its current art and name. Progress is reported
 * pack by pack, weighted by how many entries each pack holds, so the step can show a percentage.
 *
 * Concurrent loads of the same inventory share one promise. Saving the GM window clears the cache
 * (see the setting's `onChange` in main.mjs), so the next visit reads the new list.
 */
export class MagicShopSource {

  /**
   * @param {object} [resolvers]  Injected for tests.
   * @param {(collection: string) => Promise<Map<string, object>|null>} [resolvers.packIndex]
   * @param {(id: string) => object|null} [resolvers.worldItem]
   */
  constructor({ packIndex, worldItem } = {}) {
    this.#packIndex = packIndex ?? MagicShopSource.#defaultPackIndex;
    this.#worldItem = worldItem ?? (id => game.items?.get(id) ?? null);
  }

  #packIndex;
  #worldItem;
  #signature = null;
  #stock = null;
  #pending = null;

  /** How far the current load has got, 0–100. */
  percent = 0;

  static async #defaultPackIndex(collection) {
    const pack = game.packs?.get(collection);
    if ( pack?.documentName !== "Item" ) return null;
    return pack.getIndex({ fields: INDEX_FIELDS });
  }

  static #signatureOf(entries) {
    return entries.map(e => e.uuid).join("|");
  }

  /** The resolved stock for these entries, or null when it still needs loading. */
  peek(entries) {
    return (this.#stock && (this.#signature === MagicShopSource.#signatureOf(entries))) ? this.#stock : null;
  }

  /** Forget everything, so the next visit reads the inventory afresh. */
  clear() {
    this.#signature = null;
    this.#stock = null;
    this.#pending = null;
    this.percent = 0;
  }

  /**
   * Resolve entries into shelf stock.
   * @param {object[]} entries  Sanitised inventory entries (hidden ones already removed).
   * @param {(percent: number) => void} [onProgress]
   * @returns {Promise<object[]>}  `{uuid, name, img, type, subtype, rarity}`, name-sorted.
   */
  load(entries, onProgress) {
    const signature = MagicShopSource.#signatureOf(entries);
    const ready = this.peek(entries);
    if ( ready ) return Promise.resolve(ready);
    if ( this.#pending && (this.#pending.signature === signature) ) {
      if ( onProgress ) this.#pending.listeners.add(onProgress);
      return this.#pending.promise;
    }
    const listeners = new Set(onProgress ? [onProgress] : []);
    const pending = { signature, listeners, promise: null };
    this.#pending = pending;
    this.percent = 0;
    pending.promise = this.#resolve(entries, pct => {
      if ( this.#pending !== pending ) return;
      this.percent = pct;
      for ( const fn of listeners ) {
        try { fn(pct); } catch ( err ) { log("magic shop progress listener threw", err); }
      }
    }).then(stock => {
      if ( this.#pending === pending ) {
        this.#signature = signature;
        this.#stock = stock;
        this.#pending = null;
      }
      return stock;
    }, err => {
      // Forget a failed load, so the next visit tries again instead of joining a dead promise.
      if ( this.#pending === pending ) this.#pending = null;
      throw err;
    });
    return pending.promise;
  }

  /**
   * Fill in the base item and Strength requirement of every template or shell variant on the shelf.
   *
   * A variant's row is built from its *template* — "+1 Plate Armor" is the Plate the enchantment went
   * on — so the two fields that decide whether the character can use it live on the base instead. The
   * bases are read the same way the stock is, one index per pack, and a base that cannot be read
   * simply leaves the fields empty: the row then reports on its category alone, which is what it did
   * before these fields existed.
   * @param {object[]} stock  Rows, mutated in place.
   */
  async #fillVariantBases(stock) {
    const wanted = stock.filter(s => s.baseUuid);
    if ( !wanted.length ) return;
    const byPack = new Map();
    for ( const row of wanted ) {
      const where = locateUuid(row.baseUuid);
      if ( !where ) continue;
      const key = where.pack ?? "";
      if ( !byPack.has(key) ) byPack.set(key, []);
      byPack.get(key).push({ row, id: where.id });
    }
    for ( const [pack, rows] of byPack ) {
      let lookup = null;
      if ( pack ) {
        try {
          lookup = await this.#packIndex(pack);
        } catch ( err ) {
          log(`magic shop could not read the bases in ${pack}`, err);
        }
      }
      for ( const { row, id } of rows ) {
        const base = pack ? lookup?.get?.(id) : this.#worldItem(id);
        if ( !base ) continue;
        row.baseItem = base.system?.type?.baseItem ?? "";
        row.strength = base.system?.strength ?? null;
      }
    }
  }

  async #resolve(entries, report) {
    const total = entries.length;
    const groups = new Map();
    for ( const entry of entries ) {
      const where = locateUuid(entry.uuid);
      if ( !where ) continue;
      const key = where.pack ?? "";
      if ( !groups.has(key) ) groups.set(key, []);
      groups.get(key).push({ entry, id: where.id });
    }
    const stock = [];
    let done = total - [...groups.values()].reduce((n, g) => n + g.length, 0);
    report(total ? Math.floor((done / total) * 100) : 100);
    for ( const [pack, group] of groups ) {
      let lookup = null;
      if ( pack ) {
        try {
          lookup = await this.#packIndex(pack);
        } catch ( err ) {
          log(`magic shop could not read ${pack}`, err);
        }
      }
      for ( const { entry, id } of group ) {
        const found = pack ? lookup?.get?.(id) : this.#worldItem(id);
        if ( !found ) continue;
        // A variant is its own item, not its template: only the template's art is borrowed.
        const variant = parseVariant(entry.uuid);
        stock.push({
          uuid: entry.uuid,
          link: linkUuid(entry.uuid),
          name: variant ? entry.name : (found.name || entry.name),
          img: found.img || "icons/svg/item-bag.svg",
          type: variant ? entry.type : (found.type || entry.type),
          subtype: variant ? entry.subtype : (found.system?.type?.value ?? entry.subtype),
          rarity: variant ? entry.rarity : (itemRarity(found) || entry.rarity),
          // What it costs to buy outright, on top of the free picks the tier allows.
          //
          // Read from the item itself; the shop's inventory entries carry no price of their own
          // (unlike the Store's, where the GM sets one per item). Most magic items have one — 379
          // of 401 in the Dungeon Master's Guide — and the ones that do not are artifacts and a
          // handful of uniques. Those come out as 0 and are simply not purchasable, which is the
          // right answer for Blackrazor: it is a free pick or it is nothing.
          //
          // A variant is a GM-built enchantment over a base item, and what that should cost is a
          // judgement no data here can make, so it stays a free pick too.
          priceCp: variant ? 0 : priceCp(found.system?.price),
          // What {@link itemUsability} reads. A variant takes these from the base it is built on
          // rather than from the template, which is filled in below.
          baseItem: variant ? "" : (found.system?.type?.baseItem ?? ""),
          strength: variant ? null : (found.system?.strength ?? null),
          // A variant's limit is its template's: the enchantment is what is attuned to, not the base.
          attunement: attunementRestriction(found.system?.description?.value),
          baseUuid: variant?.base ?? null
        });
      }
      done += group.length;
      report(Math.floor((done / total) * 100));
    }
    await this.#fillVariantBases(stock);
    const lang = globalThis.game?.i18n?.lang;
    return stock
      .filter(s => RARITIES.includes(s.rarity))
      .sort((a, b) => a.name.localeCompare(b.name, lang));
  }
}

/** The one session cache the step and the setting's onChange share. */
export const magicShopSource = new MagicShopSource();

/* -------------------------------------------- */
/*  Dropping a folder or a pack                 */
/* -------------------------------------------- */

/** A folder as {@link descendantFolderIds} wants it. `_source` because `folder` is the resolved parent. */
function folderLink(folder) {
  return { id: folder.id, parent: folder._source?.folder ?? null };
}

/**
 * Index fields a drop reads. The description is what marks a DMG template (the shelf reads it too, for
 * the attunement limit), and the properties what marks a template from elsewhere — those only here.
 */
const DROP_INDEX_FIELDS = [
  ...INDEX_FIELDS, "system.properties",
  // What tells a shell (see magic-templates.mjs#isShell) from a finished weapon or armour.
  "system.damage.base", "system.armor.value"
];

/**
 * @typedef {object} DroppedItems
 * @property {string} name       The folder's or pack's name.
 * @property {object[]} entries  Inventory entries: plain magic items and every template variant.
 * @property {number} mundane    Physical items with no rarity.
 * @property {number} other      Non-physical items.
 * @property {number} templates  Templates expanded.
 * @property {number} shells     Shells expanded.
 * @property {number} unbased    Templates and shells with no base item to go on.
 */

/**
 * Resolve a dropped folder or pack to the magic items inside it — every one, however deeply nested
 * in subfolders — with every DMG template expanded into its finished items.
 *
 * Takes a folder inside an Item compendium, a whole Item compendium, or a world Item folder. A pack
 * is read through its index; only the entries that might be templates are loaded as documents, since
 * a template's enchantments live on the document.
 * @param {object} data  Drop data of type "Folder" or "Compendium".
 * @returns {Promise<DroppedItems|null>}  Null when the drop isn't a folder or pack of items.
 */
export async function droppedMagicItems(data) {
  if ( data?.type === "Compendium" ) {
    const pack = game.packs.get(data.collection ?? data.id);
    if ( pack?.documentName !== "Item" ) return null;
    return { name: pack.title, ...await readPack(pack, () => true) };
  }

  if ( data?.type !== "Folder" ) return null;
  const folder = await fromUuid(data.uuid).catch(() => null);
  if ( folder?.type !== "Item" ) return null;

  if ( folder.pack ) {
    const pack = game.packs.get(folder.pack);
    if ( !pack ) return null;
    const ids = descendantFolderIds(folder.id, pack.folders.map(folderLink));
    return { name: folder.name, ...await readPack(pack, e => ids.has(e.folder)) };
  }

  const ids = descendantFolderIds(folder.id, game.folders.filter(f => f.type === "Item").map(folderLink));
  const items = game.items.filter(item => ids.has(item.folder?.id));
  return { name: folder.name, ...await sortItems(items, items.filter(isTemplate), items.filter(isPlainShell)) };
}

/**
 * The magic items a single dropped item stands for: itself, or — for a template — its variants.
 * @param {Item5e} item
 * @returns {Promise<DroppedItems>}
 */
export async function droppedMagicItem(item) {
  return { name: item.name, ...await sortItems([item], isTemplate(item) ? [item] : [], isPlainShell(item) ? [item] : []) };
}

/** A shell that isn't also a template — a template's enchantment is the better description of it. */
function isPlainShell(item) {
  return isShell(item) && !isTemplate(item);
}

async function readPack(pack, include) {
  const index = withUuids(pack, await pack.getIndex({ fields: DROP_INDEX_FIELDS })).filter(include);
  const candidates = index.filter(e => mightBeTemplate(e) || isShell(e));
  const docs = candidates.length ? await pack.getDocuments({ _id__in: candidates.map(e => e._id) }) : [];
  const templates = docs.filter(isTemplate);
  const shells = docs.filter(isPlainShell);
  const templateIds = new Set([...templates, ...shells].map(t => t.id));
  // Everything that isn't a template is read from the index as before; loaded non-templates are
  // swapped for their documents so nothing is counted twice.
  const loaded = new Map(docs.map(d => [d.id, d]));
  const items = index.map(e => (templateIds.has(e._id) ? loaded.get(e._id) : e));
  return sortItems(items, templates, shells);
}

/**
 * Split items into plain stock, expanded templates and expanded shells.
 * @param {object[]} items      Index entries or documents, templates and shells included.
 * @param {object[]} templates  The documents among them to expand by their enchantments.
 * @param {object[]} [shells]   The documents among them to expand onto their headline's bases.
 */
async function sortItems(items, templates, shells = []) {
  const templateUuids = new Set([...templates, ...shells].map(t => t.uuid));
  const plain = filterMagicIndex(items.filter(i => !templateUuids.has(i.uuid)));
  const entries = [...plain.entries];
  let unbased = 0;
  const pool = (templates.length || shells.length) ? await basePool() : [];
  for ( const template of templates ) {
    const linked = await baseSummaries(linkedBaseUuids(template));
    const variants = templateVariants({ template, templateUuid: template.uuid, linked, pool });
    if ( variants.length ) entries.push(...variants);
    else unbased++;
  }
  let unbasedShells = 0;
  for ( const shell of shells ) {
    const variants = shellVariants({ item: shell, itemUuid: shell.uuid, pool });
    if ( variants.length ) entries.push(...variants);
    else unbasedShells++;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  return {
    entries, mundane: plain.mundane, other: plain.other,
    templates: templates.length - unbased, shells: shells.length - unbasedShells, unbased: unbased + unbasedShells
  };
}

/** Index fields a base item needs to be matched against an enchantment. */
const BASE_FIELDS = ["system.type", "system.properties", "system.damage.base.types"];

/**
 * Summaries of base items by uuid, read from their packs' indexes a pack at a time.
 * @param {string[]} uuids
 * @returns {Promise<import("./magic-templates.mjs").BaseSummary[]>}  In the order given; missing ones left out.
 */
async function baseSummaries(uuids) {
  const out = [];
  const indexes = new Map();
  for ( const uuid of uuids ) {
    const where = locateUuid(uuid);
    let found = null;
    if ( where?.pack ) {
      if ( !indexes.has(where.pack) ) {
        const pack = game.packs.get(where.pack);
        indexes.set(where.pack, pack ? await pack.getIndex({ fields: BASE_FIELDS }).catch(() => null) : null);
      }
      found = indexes.get(where.pack)?.get(where.id);
    } else if ( where ) {
      found = game.items.get(where.id);
    }
    if ( !found ) continue;
    out.push({
      uuid,
      name: found.name,
      type: found.type,
      subtype: found.system?.type?.value ?? "",
      properties: [...(found.system?.properties ?? [])],
      damageTypes: [...(found.system?.damage?.base?.types ?? [])]
    });
  }
  return out;
}

/** Session cache of dnd5e's base weapons, armour, shields and ammunition. */
let basePoolCache = null;

/**
 * The base items an unlinked template ("Weapon (Any Simple or Martial)") can go on: every item dnd5e
 * names in `CONFIG.DND5E.weaponIds`, `armorIds`, `shieldIds` and `ammoIds`. The system swaps those
 * tables under legacy rules, so a world gets the Longsword that matches its rules.
 */
async function basePool() {
  if ( basePoolCache ) return basePoolCache;
  const config = globalThis.CONFIG?.DND5E ?? {};
  const itemsPack = config.sourcePacks?.ITEMS;
  const uuids = ["weaponIds", "armorIds", "shieldIds", "ammoIds"]
    .flatMap(table => Object.values(config[table] ?? {}))
    .filter(v => typeof v === "string" && v)
    .map(v => (v.includes(".") ? v : `Compendium.${itemsPack}.Item.${v}`));
  basePoolCache = await baseSummaries([...new Set(uuids)]);
  return basePoolCache;
}

/** Index entries with their uuid filled in (older cores leave it off the index). */
function withUuids(pack, index) {
  return [...index].map(e => (e.uuid ? e : { ...e, uuid: pack.getUuid?.(e._id) ?? `Compendium.${pack.collection}.Item.${e._id}` }));
}

/* -------------------------------------------- */
/*  Usability                                   */
/* -------------------------------------------- */

/**
 * What {@link itemUsability} needs to know about the character: the proficiencies they hold and
 * their Strength. Read off whichever actor the step was given — during a creation climb that is the
 * driver's clone, which already carries everything the levels just granted.
 *
 * Also who the character is, for {@link unmetAttunement}: their classes and species (identifier and
 * lower-cased name both, so a limit matches either), and whether any class casts. "Spellcaster" is
 * read as the rules define it, a Spellcasting or Pact Magic feature — a class or subclass with a
 * progression, so an Eldritch Knight counts and a Fighter with Magic Initiate does not.
 * @param {Actor5e|null} actor
 * @returns {{armorProf: Set<string>, weaponProf: Set<string>, strength: number,
 *   classes: Set<string>, species: Set<string>, spellcaster: boolean}|null}
 */
export function usabilityProfile(actor) {
  if ( !actor ) return null;
  const traits = actor.system?.traits ?? {};
  const classes = Object.values(actor.classes ?? {});
  const species = actor.itemTypes?.race ?? [];
  const keys = items => new Set(items.flatMap(i => [i.identifier ?? i.system?.identifier, i.name?.toLowerCase()]).filter(Boolean));
  return {
    armorProf: new Set(traits.armorProf?.value ?? []),
    weaponProf: new Set(traits.weaponProf?.value ?? []),
    strength: Number(actor.system?.abilities?.str?.value ?? 0),
    classes: keys(classes),
    species: keys(species),
    spellcaster: classes.some(c => {
      const progression = c.spellcasting?.progression ?? c.system?.spellcasting?.progression;
      return !!progression && (progression !== "none");
    })
  };
}

/**
 * The system's category → proficiency-key maps, as {@link itemUsability} expects them, and every
 * class and species it knows, as {@link unmetAttunement} expects them.
 */
export function proficiencyMaps() {
  // dnd5e's item registries: identifier → name for every class and species in the world and its packs.
  const lookup = registry => {
    const map = new Map();
    for ( const [id, name] of Object.entries(registry?.choices ?? {}) ) {
      map.set(id.toLowerCase(), id);
      if ( name ) map.set(String(name).toLowerCase(), id);
    }
    return map;
  };
  return {
    armor: CONFIG.DND5E?.armorProficienciesMap ?? {},
    weapon: CONFIG.DND5E?.weaponProficienciesMap ?? {},
    known: {
      classes: lookup(globalThis.dnd5e?.registry?.classes),
      species: lookup(globalThis.dnd5e?.registry?.species)
    }
  };
}

/* -------------------------------------------- */
/*  Review and grant                            */
/* -------------------------------------------- */

/** The picks as a list, name-sorted. */
export function pickList(state) {
  return Object.entries(state?.magicShop?.picks ?? {})
    .filter(([, p]) => (Number(p?.qty) || 0) > 0)
    .map(([uuid, p]) => ({ uuid, link: linkUuid(uuid), name: p.name ?? "", img: p.img ?? "", rarity: normalizeRarity(p.rarity), qty: Number(p.qty) }))
    .sort((a, b) => a.name.localeCompare(b.name, globalThis.game?.i18n?.lang));
}

/**
 * What Create should grant: the picks and the bonus gold. Nothing when the step doesn't apply,
 * and no items when the picks no longer fit the allowance (the player picked, then lowered their
 * level) — the step blocks Create in that case, so this is only a backstop.
 * @returns {{tier: object|null, items: object[], goldCp: number}}
 */
export function magicShopGrant(state, config = magicShopConfig()) {
  const tier = magicShopTier(state, config);
  if ( !tier ) return { tier: null, items: [], goldCp: 0 };
  const items = pickList(state);
  const fits = withinAllowance(countPicks(state.magicShop?.picks), tier.allowance);
  return { tier, items: fits ? items : [], goldCp: bonusGoldCp(tier, state.magicShop?.d10) };
}

/**
 * Whether a tier's bonus gold depends on the d10. A tier with a flat amount (or no gold at all) has
 * nothing to roll, so the step neither shows the button nor waits for it.
 * @param {object|null} tier
 */
export function goldNeedsRoll(tier) {
  return (Number(tier?.perD10Gp) || 0) > 0;
}

/**
 * Whether a state's bonus gold is settled: rolled, or a tier with nothing to roll. The step gates on
 * it, and the review and rail show the gold only once it holds.
 * @param {object} state
 * @param {object|null} tier
 */
export function goldRolled(state, tier) {
  return !goldNeedsRoll(tier) || Number.isInteger(state?.magicShop?.d10);
}

/**
 * The roll in flight for a state, so a double-click (or two renders) before the first result lands
 * shares one d10 instead of rolling twice with the later one winning. Kept off the state itself
 * because the state is written to drafts, and a promise has no business in one.
 * @type {WeakMap<object, Promise<number>>}
 */
const pendingRolls = new WeakMap();

/**
 * Roll the step's bonus-gold d10 if it hasn't been rolled. The player rolls it from the step, like a
 * hit-point roll, so the throw is seen (Dice So Nice animates it when installed) and the result is
 * then locked: stored on the state, it survives revisits and a restored draft, and a change of level
 * re-prices the gold rather than re-rolling it.
 * @param {object} state
 * @param {object} [options]
 * @param {boolean} [options.animate=true]  Show the Dice So Nice throw. Off only for the grant's
 *   backstop, which Apply's completion gate means should never actually roll.
 * @returns {Promise<number>}
 */
export async function ensureMagicShopRoll(state, { animate = true } = {}) {
  if ( !state.magicShop ) state.magicShop = { d10: null, picks: {} };
  if ( Number.isInteger(state.magicShop.d10) ) return state.magicShop.d10;
  let pending = pendingRolls.get(state);
  if ( !pending ) {
    pending = (async () => {
      const roll = await new Roll("1d10").evaluate();
      // Await the animation so the number appears as the die settles, as the hit-point roll does.
      if ( animate && game.dice3d ) {
        try { await game.dice3d.showForRoll(roll, game.user, true); } catch ( err ) { log("dice animation failed", err); }
      }
      state.magicShop.d10 = Math.min(10, Math.max(1, Math.floor(Number(roll.total) || 1)));
      return state.magicShop.d10;
    })().finally(() => pendingRolls.delete(state));
    pendingRolls.set(state, pending);
  }
  return pending;
}

/**
 * Give the actor its picked magic items and the bonus gold. Separate from the equipment grant,
 * which returns early when no class or background equipment is loaded.
 *
 * Returns what was granted, as plain data, so the creation chat card can put the d10 and the picks
 * on the record: a GM auditing a 2,500 gp swing needs to see the roll behind it.
 * @param {Actor5e} actor
 * @param {object} state
 * @returns {Promise<{d10: number, baseGp: number, perD10Gp: number, gp: number,
 *   items: {name: string, uuid: string, qty: number}[]}|null>}  Null when the step didn't apply.
 */
export async function grantMagicItems(actor, state) {
  const config = magicShopConfig();
  const tier = magicShopTier(state, config);
  if ( !tier ) return null;
  const d10 = goldNeedsRoll(tier) ? await ensureMagicShopRoll(state, { animate: false }) : 0;
  const { items, goldCp } = magicShopGrant(state, config);

  const data = [];
  for ( const pick of items ) {
    if ( parseVariant(pick.uuid) ) data.push(...await variantItemData(pick.uuid, pick.qty, pick.name));
    else data.push(...await createItemData(pick.uuid, { qty: pick.qty, stampSource: true, context: "magic item" }));
  }
  if ( data.length ) await actor.createEmbeddedDocuments("Item", data, { keepId: true, render: false });

  // Purchases, on top of the free picks. Created the same way, so a bought item and a granted one
  // are indistinguishable on the sheet — which they should be.
  const bought = cartList(state);
  const boughtData = [];
  for ( const line of bought ) {
    if ( parseVariant(line.uuid) ) boughtData.push(...await variantItemData(line.uuid, line.qty, line.name));
    else boughtData.push(...await createItemData(line.uuid, { qty: line.qty, stampSource: true, context: "magic item" }));
  }
  if ( boughtData.length ) {
    await actor.createEmbeddedDocuments("Item", boughtData, { keepId: true, render: false });
  }

  // Pay for it. The bonus gold goes in first and the bill comes out of the total, so a cart can be
  // funded by either purse or roll without the order mattering. Guarded against going negative:
  // the step's own gate keeps the cart inside the budget, so a shortfall here means stale state,
  // and a character who ends the build owing money is a worse outcome than one who got a discount.
  const spentCp = Math.min(magicCartCp(state), goldCp + totalCp(actor.system?.currency ?? {}));
  const purseCp = totalCp(actor.system?.currency ?? {}) + goldCp - spentCp;
  await actor.update({ "system.currency": fromCopper(purseCp) }, { render: false });

  const gp = Math.floor(goldCp / 100);
  return {
    d10, baseGp: tier.baseGp, perD10Gp: tier.perD10Gp, gp,
    items: items.map(p => ({ name: p.name, uuid: p.link, qty: p.qty })),
    bought: bought.map(p => ({ name: p.name, uuid: p.link, qty: p.qty })),
    spentCp
  };
}

/**
 * Build a template variant for the actor: the base item with the enchantment embedded, equipped
 * like any other weapon or armour, at the picked quantity. A missing template, profile or base is
 * logged and skipped rather than failing the build.
 * A shell variant is the base item dressed as the shell instead; see magic-templates.mjs#shellItemData.
 * @param {string} id    A variant id.
 * @param {number} qty
 * @param {string} name  The name the shop showed, which a shell variant keeps.
 * @returns {Promise<object[]>}
 */
async function variantItemData(id, qty, name) {
  const parts = parseVariant(id);
  try {
    const [template, base] = await Promise.all([fromUuid(parts.template), fromUuid(parts.base)]);
    if ( (parts.profile === SHELL_PROFILE) && template && base ) {
      const data = shellItemData({ base: base.toObject(), baseUuid: parts.base, shell: template.toObject(), shellUuid: parts.template, name });
      if ( (qty > 1) && (data.system?.quantity !== undefined) ) data.system.quantity = qty;
      if ( ["weapon", "equipment"].includes(data.type) ) data.system.equipped = true;
      return [data];
    }
    const profile = template && templateProfiles(template).find(p => p.profileId === parts.profile);
    if ( !template || !base || !profile ) {
      log(`magic item template variant not found: ${id}`);
      return [];
    }
    const data = enchantedItemData({
      base: base.toObject(), baseUuid: parts.base, template: template.toObject(), templateUuid: parts.template, profile
    });
    if ( (qty > 1) && (data.system?.quantity !== undefined) ) data.system.quantity = qty;
    if ( ["weapon", "equipment"].includes(data.type) ) data.system.equipped = true;
    return [data];
  } catch ( err ) {
    log(`magic item template variant failed: ${id}`, err);
    return [];
  }
}
