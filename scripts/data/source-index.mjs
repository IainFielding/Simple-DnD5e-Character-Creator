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
