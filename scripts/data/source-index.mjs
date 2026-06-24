import { log } from "../config.mjs";

/**
 * Reads the available origin items (classes, species, backgrounds) out of the
 * enabled compendiums, honouring the dnd5e Compendium Browser's own source
 * configuration. Produces lightweight "card" records for the grids and lazily
 * resolves full documents (with enriched descriptions) when a card is opened.
 *
 * One instance is created per builder session and loaded once.
 */
export class SourceIndex {

  /** type id -> card[] */
  #cards = { class: [], race: [], background: [] };

  /** uuid -> { name, img, enriched } resolved detail, memoised. */
  #details = new Map();

  /** uuid -> ability-score-improvement config (or null), memoised. */
  #asi = new Map();

  /** uuid -> categorized advancement groups (or null), memoised. */
  #groups = new Map();

  /** granted-item uuid -> { name, img, type } metadata (or null), memoised. */
  #meta = new Map();

  loaded = false;

  /**
   * Index every origin type. `onStep` is invoked with a human label before each
   * type so the shell can show progress.
   * @param {(label: string) => Promise<void>|void} [onStep]
   */
  async load(onStep) {
    for ( const type of ["class", "race", "background"] ) {
      await onStep?.(type);
      this.#cards[type] = await this.#index(type);
    }
    this.loaded = true;
    log(`indexed ${this.#cards.class.length} classes, ${this.#cards.race.length} species, ` +
      `${this.#cards.background.length} backgrounds`);
  }

  classes() { return this.#cards.class; }
  species() { return this.#cards.race; }
  backgrounds() { return this.#cards.background; }

  /** Look up a single card across all types by its UUID. */
  card(uuid) {
    if ( !uuid ) return null;
    for ( const list of Object.values(this.#cards) ) {
      const hit = list.find(c => c.uuid === uuid);
      if ( hit ) return hit;
    }
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Fetch the index for one document subtype via the dnd5e Compendium Browser,
   * which already filters by the world's enabled sources. Falls back to a direct
   * pack scan if the browser API is unavailable.
   * @param {string} type
   * @returns {Promise<object[]>}
   */
  async #index(type) {
    const browser = dnd5e.applications?.CompendiumBrowser;
    let entries = [];
    if ( browser?.fetch ) {
      try {
        entries = await browser.fetch(Item, {
          types: new Set([type]),
          indexFields: new Set(["system.identifier"])
        });
      } catch ( err ) {
        log(`Compendium Browser fetch failed for "${type}", scanning packs directly`, err);
      }
    }
    if ( !entries.length ) entries = await this.#scanPacks(type);
    return entries.map(e => this.#toCard(e));
  }

  /** Direct fallback scan when the Compendium Browser is unavailable. */
  async #scanPacks(type) {
    const out = [];
    for ( const pack of game.packs ) {
      if ( pack.metadata.type !== "Item" ) continue;
      try {
        const index = await pack.getIndex({ fields: ["type", "system.identifier"] });
        for ( const e of index ) if ( e.type === type ) out.push(e);
      } catch ( err ) {
        log(`pack scan failed for ${pack.collection}`, err);
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return out;
  }

  /** Map a raw index entry to the minimal shape the grids consume. */
  #toCard(entry) {
    return {
      uuid: entry.uuid,
      name: entry.name,
      img: entry.img || "icons/svg/item-bag.svg",
      identifier: entry.system?.identifier ?? ""
    };
  }

  /**
   * Resolve the full document for a card and return its enriched description for
   * the detail panel. Memoised so repeated expand/collapse is cheap.
   * @param {string} uuid
   * @returns {Promise<{name: string, img: string, enriched: string}|null>}
   */
  async detail(uuid) {
    if ( !uuid ) return null;
    if ( this.#details.has(uuid) ) return this.#details.get(uuid);

    const doc = await fromUuid(uuid);
    if ( !doc ) return null;
    const raw = doc.system?.description?.value ?? "";
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
      relativeTo: doc, secrets: false
    });
    const detail = { name: doc.name, img: doc.img, enriched };
    this.#details.set(uuid, detail);
    return detail;
  }

  /**
   * Resolve an origin item's level-0 Ability Score Improvement advancement into a
   * plain config the Background step uses to drive its allocation panel. Returns
   * null when the item grants no allocatable increase. Memoised per UUID.
   *
   * @param {string} uuid
   * @returns {Promise<{id: string, points: number, cap: number, fixed: Record<string, number>, locked: string[]}|null>}
   */
  async abilityScoreIncrease(uuid) {
    if ( !uuid ) return null;
    if ( this.#asi.has(uuid) ) return this.#asi.get(uuid);

    const doc = await fromUuid(uuid);
    const config = doc ? readAsi(doc) : null;
    this.#asi.set(uuid, config);
    return config;
  }

  /**
   * Resolve an origin item's advancements into the display blocks shown beneath its
   * description: a "Traits" block of proficiency/score tags, then "Features" and
   * "Spells" blocks of granted items (each with its icon, a clickable content-link,
   * and a level tag). Blocks with no content are omitted. Memoised per UUID.
   *
   * @param {string} uuid
   * @returns {Promise<object[]|null>}
   */
  async advancementGroups(uuid) {
    if ( !uuid ) return null;
    if ( this.#groups.has(uuid) ) return this.#groups.get(uuid);

    const doc = await fromUuid(uuid);
    const groups = doc ? await this.#buildGroups(doc) : null;
    this.#groups.set(uuid, groups);
    return groups;
  }

  /** Walk an item's level-1 traits and every granted feature/spell into display blocks. */
  async #buildGroups(doc) {
    // Headings read from the step namespace matching the document type, so a class shows
    // "Class Traits" while a species/background shows its own wording; everything else
    // (trait sub-labels, the level tag) is generic and stays under step.class.
    const ns = { class: "step.class", race: "step.species", background: "step.background" }[doc.type]
      ?? "step.class";
    const head = key => game.i18n.localize(`sogrom-dnd5e-character-creator.${key}`);
    const traits = { key: "traits", order: 1, heading: head(`${ns}.traits`), tags: [], items: [] };
    const features = { key: "features", order: 2, heading: head(`${ns}.features`), tags: [], items: [] };
    const spells = { key: "spells", order: 3, heading: head(`${ns}.spells`), tags: [], items: [] };

    // Lead the Traits block with the class's headline numbers, like the PHB core table.
    // primaryAbility.value is a Set on the prepared model, so normalise via Array.from;
    // fall back to the raw source array in case the prepared field comes back empty.
    const sys = doc.system ?? {};
    const primaryRaw = sys.primaryAbility?.value ?? doc._source?.system?.primaryAbility?.value ?? [];
    const primary = Array.from(primaryRaw).map(a => CONFIG.DND5E.abilities?.[a]?.label ?? a);
    if ( primary.length ) traits.tags.push({ label: head("step.class.trait.primary"), value: primary.join(", ") });
    if ( sys.hd?.denomination ) traits.tags.push({ label: head("step.class.trait.hitDie"), value: sys.hd.denomination });

    for ( const adv of advancementEntries(doc) ) {
      const type = adv.type ?? adv.constructor?.typeName;
      const level = Number(adv.level ?? adv._source?.level ?? 0);

      // The class summary table already lists higher-level proficiency grants; only the
      // level-1 traits describe what the class opens with. Skip multiclass-only entries.
      if ( type === "Trait" ) {
        if ( level > 1 || adv.classRestriction === "secondary" ) continue;
        traits.tags.push(...traitTags(adv));
        continue;
      }

      if ( type === "ItemGrant" ) {
        for ( const ref of adv.configuration?.items ?? [] ) {
          const meta = await this.#resolveMeta(ref.uuid ?? ref);
          if ( !meta ) continue;
          const bucket = meta.type === "spell" ? spells : features;
          bucket.items.push({ name: meta.name, img: meta.img, uuid: meta.uuid, level });
        }
      }
    }

    // Order each list by level then name; drop duplicate grants (same item at same level).
    for ( const block of [features, spells] ) {
      const seen = new Set();
      block.items = block.items
        .sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name, game.i18n.lang))
        .filter(i => { const k = `${i.uuid}:${i.level}`; return seen.has(k) ? false : seen.add(k); });
    }

    return [traits, features, spells]
      .filter(b => b.tags.length || b.items.length)
      .sort((a, b) => a.order - b.order);
  }

  /** Resolve a granted item's UUID to the metadata a feature row needs, memoised.
   *  The row carries the resolved document's *canonical* uuid (`doc.uuid`), not the
   *  raw grant reference: some packs (notably 2024 backgrounds) store legacy
   *  compendium uuids missing the `.Item.` segment, which `fromUuidSync` still
   *  resolves but the async `fromUuid` dnd5e's tooltip handler calls does not — so
   *  feeding the raw form to `data-uuid` leaves the hover tooltip permanently blank. */
  async #resolveMeta(uuid) {
    if ( !uuid ) return null;
    if ( this.#meta.has(uuid) ) return this.#meta.get(uuid);
    let meta = null;
    try {
      const doc = fromUuidSync(uuid) ?? await fromUuid(uuid);
      if ( doc ) meta = { uuid: doc.uuid, name: doc.name, img: doc.img || "icons/svg/item-bag.svg", type: doc.type };
    } catch ( err ) {
      const doc = await fromUuid(uuid).catch(() => null);
      if ( doc ) meta = { uuid: doc.uuid, name: doc.name, img: doc.img || "icons/svg/item-bag.svg", type: doc.type };
    }
    this.#meta.set(uuid, meta);
    return meta;
  }
}

/**
 * Return a document's advancements as a flat array, tolerating every shape dnd5e
 * may hand back. The prepared `doc.advancement` collection is preferred because it
 * is always populated; the raw `system.advancement` is a fallback that may be a
 * plain object, an array, or a Map-like Collection.
 * @param {object} doc
 * @returns {object[]}
 */
function advancementEntries(doc) {
  const byId = doc.advancement?.byId;
  if ( byId ) return typeof byId.values === "function" ? [...byId.values()] : Object.values(byId);
  const raw = doc.system?.advancement;
  if ( !raw ) return [];
  if ( Array.isArray(raw) ) return raw;
  if ( typeof raw.values === "function" ) return [...raw.values()];
  return Object.values(raw);
}

/** Trait categories surfaced in the class "Traits" block, mapped to their i18n keys. */
const TRAIT_LABELS = {
  saves: "step.class.trait.saves", skills: "step.class.trait.skills",
  weapon: "step.class.trait.weapon", armor: "step.class.trait.armor",
  tool: "step.class.trait.tool", languages: "step.class.trait.languages"
};
const traitLabel = type => game.i18n.localize(`sogrom-dnd5e-character-creator.${TRAIT_LABELS[type]}`);

/**
 * Flatten one Trait advancement into `{ label, value }` tags. Fixed `grants` become a
 * single comma-joined tag per category; a `choices` pool becomes a "Skills (2)"-style
 * tag listing the options. Categories outside {@link TRAIT_LABELS} (e.g. damage
 * resistances rarely seen on classes) are ignored.
 * @param {object} adv  A Trait advancement (prepared instance or raw data)
 * @returns {{label: string, value: string}[]}
 */
function traitTags(adv) {
  const out = [];
  const byType = key => key.split(":")[0];
  const label = key => dnd5e.documents.Trait?.keyLabel?.(key) ?? key;

  const grants = {};
  for ( const g of adv.configuration?.grants ?? [] ) {
    const type = byType(g);
    if ( !TRAIT_LABELS[type] ) continue;
    (grants[type] ??= []).push(label(g));
  }
  for ( const [type, values] of Object.entries(grants) ) {
    out.push({ label: traitLabel(type), value: values.join(", ") });
  }

  for ( const choice of adv.configuration?.choices ?? [] ) {
    const pool = choice.pool ?? [];
    const type = pool.length ? byType(pool[0]) : null;
    if ( !type || !TRAIT_LABELS[type] ) continue;
    const options = pool.map(g => g.endsWith(":*") ? game.i18n.localize("DND5E.Any") : label(g));
    const count = choice.count ? ` (${choice.count})` : "";
    out.push({ label: `${traitLabel(type)}${count}`, value: options.join(", ") });
  }
  return out;
}

/**
 * Pull the AbilityScoreImprovement advancement (preferring the level-0 one) off a
 * resolved origin document and flatten its configuration. Kept free of any state
 * or UI concern — just data extraction.
 */
function readAsi(doc) {
  const byType = doc.advancement?.byType?.AbilityScoreImprovement;
  let adv = byType?.length ? (byType.find(a => (a.level ?? 0) === 0) ?? byType[0]) : null;
  if ( !adv ) {
    const raw = Object.values(doc.system?.advancement ?? {});
    adv = raw.find(a => a.type === "AbilityScoreImprovement" && (a.level ?? 0) === 0)
      ?? raw.find(a => a.type === "AbilityScoreImprovement");
  }
  if ( !adv ) return null;

  const config = adv.configuration ?? {};
  const points = Number(config.points ?? 0);
  if ( points <= 0 ) return null;
  return {
    id: adv.id ?? adv._id,
    points,
    cap: Number(config.cap ?? 2),
    fixed: { ...(config.fixed ?? {}) },
    locked: [...(config.locked ?? [])]
  };
}
