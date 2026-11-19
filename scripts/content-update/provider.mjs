import { log } from "../config.mjs";
import { packIndex } from "../data/compendium-util.mjs";
import { findByIdentity } from "./scan.mjs";
import { LevelUpDriver } from "../levelup/manager-driver.mjs";
import { withItemSegment } from "../data/advancement-util.mjs";
import {
  grantedAtLevel, itemIdentity, matchDecision, normTitle, sameIdentity, signature, treeKey, uuidTail
} from "./answers.mjs";

/** Trait modes whose options depend on proficiencies the character already has (see the driver). */
const PROFICIENCY_MODES = ["expertise", "forcedExpertise", "upgrade"];

/**
 * Whether a trait key falls inside one configured pool entry: the key itself, a wildcard over its
 * category (`skills:*`, `tool:art:*`), or a category the key sits under (`weapon:mar`).
 * @param {string} key
 * @param {string} entry
 * @returns {boolean}
 */
export function keyInPool(key, entry) {
  if ( key === entry ) return true;
  if ( entry.endsWith(":*") ) return key.startsWith(entry.slice(0, -1));
  return key.startsWith(`${entry}:`);
}

/**
 * Answers a rebuild's decisions from the decisions the character already made.
 *
 * Implements the interface `LevelUpDriver#autoResolve` consumes — `hp`, `size`, `grantAbility`,
 * `subclass`, `traitKeys`, `defer`, `choiceUuids`, `optionalGrant`, `asi` — the same one Quick Build
 * and character creation use. Every accessor is synchronous, so {@link warm} does the matching and
 * every compendium read first, and is called again after each `autoResolve` pass to pick up the
 * decisions a subclass or a picked feature synthesised.
 *
 * Nothing is guessed. A decision with no recorded answer, or whose answer no longer fits the new
 * content, is left as the driver seeds it and listed as "to choose" — the repair wrench then offers
 * exactly those levels.
 */
export class UpdateAnswerProvider {

  /** @type {import("./answers.mjs").Decision[]} */
  #decisions;

  /** Decision keys already matched. */
  #used = new Set();

  /** record → resolved answer (shape per accessor). */
  #answers = new Map();

  /** record → report line. */
  #report = new Map();

  /** `tree|advId|level` → the decision matched to it, so a record made afresh for it reuses it. */
  #slots = new Map();

  /** uuid → identity of the document behind it (or null), shared across warm passes. */
  #docs = new Map();

  /** The driver being answered. */
  #driver = null;

  /**
   * @param {import("./answers.mjs").Decision[]} decisions   From {@link harvestDecisions}.
   */
  /**
   * @param {object[]} decisions   What the character decided (see `harvestDecisions`).
   * @param {object} [options]
   * @param {{uuid: string, name: string, from: string}[]} [options.lineages]  Lineages the scan worked
   *   out for a species that became a species and a lineage (`scan.mjs#findSplitSpecies`). They answer
   *   that species' lineage choice, which the character never had a record for.
   */
  constructor(decisions, { lineages = [] } = {}) {
    this.#decisions = decisions;
    this.#lineages = lineages;
  }

  #lineages;

  /** The pool entry a recorded lineage answers, for a lineage choice; null for anything else. */
  #lineageFor(adv) {
    const cfg = adv?.configuration ?? {};
    if ( (cfg.restriction?.type !== "race") || (cfg.restriction?.subtype !== "lineage") ) return null;
    for ( const lineage of this.#lineages ) {
      const entry = Array.from(cfg.pool ?? []).map(p => p?.uuid ?? p).find(u => uuidTail(u) === uuidTail(lineage.uuid));
      if ( entry ) return { uuid: entry, lineage };
    }
    return null;
  }

  /** Every decision record the driver currently holds. */
  static records(driver) {
    return [
      ...(driver.hpSteps ?? []).map(r => ["hp", r]),
      ...(driver.sizeSteps ?? []).map(r => ["size", r]),
      ...(driver.grantSteps ?? []).map(r => ["grant", r]),
      ...(driver.subclassSteps ?? []).map(r => ["subclass", r]),
      ...(driver.optionalGrantSteps ?? []).map(r => ["optional", r]),
      ...(driver.asiSteps ?? []).map(r => ["asi", r]),
      ...(driver.traitSteps ?? []).map(r => ["trait", r]),
      ...(driver.choiceSteps ?? []).map(r => ["choice", r])
    ];
  }

  /**
   * What the review page lists: one line per decision the rebuild asked.
   * @returns {{kind: string, title: string, level: number, status: string, detail: string}[]}
   */
  get report() {
    return [...this.#report.values()];
  }

  /**
   * Match and resolve every decision the driver has surfaced that has not been seen yet.
   * @param {LevelUpDriver} driver
   */
  async warm(driver) {
    this.#driver = driver;
    const clone = driver.clone;
    const getItem = id => clone.items.get(id)?.toObject();
    const fresh = [];
    for ( const [kind, rec] of UpdateAnswerProvider.records(driver) ) {
      if ( this.#report.has(rec) ) continue;
      const adv = rec.advancement;
      const item = adv?.item;
      if ( !adv || !item ) continue;
      const itemData = item.toObject();
      const type = LevelUpDriver.baseType(adv);
      const level = Number(rec.level) || grantedAtLevel(itemData, getItem) || 0;
      const wanted = {
        advId: adv.id, type, tree: treeKey(itemData, getItem), level,
        title: normTitle(adv.title ?? adv.name), sig: signature({ type, configuration: adv.configuration })
      };
      fresh.push({ kind, rec, adv, item, type, level, wanted, slot: `${wanted.tree}|${adv.id}|${level}` });
    }

    // Exact advancement ids first, across every new record, then everything else. Matching in record
    // order let a same-titled decision at the same level take an answer that belonged, by id, to a
    // record further down the list.
    const byId = d => fresh.find(f => !f.decision && (f.wanted.advId === d.advId) && (f.wanted.tree === d.tree)
      && ((f.wanted.level === d.level) || (f.type === "HitPoints")));
    for ( const f of fresh ) f.decision = this.#slots.get(f.slot) ?? null;
    for ( const d of this.#decisions ) {
      if ( this.#used.has(d.key) ) continue;
      const f = byId(d);
      if ( f && (f.type !== "HitPoints") ) { f.decision = d; this.#used.add(d.key); }
    }
    // Two records on one advancement and level (a spell choice and its casting-ability picker) share it.
    const share = () => {
      for ( const f of fresh ) f.decision ??= fresh.find(o => (o !== f) && (o.slot === f.slot) && o.decision)?.decision ?? null;
    };
    share();
    for ( const f of fresh ) f.decision ??= matchDecision(f.wanted, this.#decisions, this.#used);
    share();

    for ( const { kind, rec, adv, item, type, level, wanted, slot, decision } of fresh ) {
      const line = { kind, title: adv.title || adv.name || type, level, host: item.name, status: "ask", detail: "" };
      // A record the driver made afresh for a decision already seen (a feature re-granted between
      // passes, or a grant's ability picker beside its own choice) replaces the earlier line.
      for ( const [other, l] of this.#report ) {
        if ( (other !== rec) && (other._contentUpdateSlot === slot) && (l.kind === kind) ) this.#report.delete(other);
      }
      rec._contentUpdateSlot = slot;
      this.#report.set(rec, line);
      // A tier that only offers to swap an earlier pick owes nothing: not a decision to carry.
      if ( (kind === "choice") && !Number(adv.configuration?.choices?.[rec.level]?.count) ) {
        line.status = "none";
        continue;
      }
      // A species that split: its lineage was the species itself, so it wins over any record.
      const preset = (kind === "choice") ? this.#lineageFor(adv) : null;
      if ( preset ) {
        this.#answers.set(rec, [preset.uuid]);
        line.status = "carried";
        line.detail = `${preset.lineage.name} (${preset.lineage.from})`;
        continue;
      }
      if ( !decision ) {
        line.candidates = this.#decisions.filter(d => (d.type === type) && !this.#used.has(d.key))
          .map(d => `${d.hostName}/${d.title || d.advId}@${d.level} [${d.tree}]`).slice(0, 6);
        line.wanted = `${wanted.tree} @${wanted.level} id ${wanted.advId}`;
        continue;
      }
      this.#slots.set(slot, decision);
      try {
        await this.#resolve(kind, rec, decision, line);
      } catch ( err ) {
        log("content update: could not carry a decision", line.title, err);
        line.status = "ask";
      }
    }
  }

  /** The identity behind a uuid, cached. */
  async #identityOf(uuid) {
    const key = withItemSegment(uuid);
    if ( this.#docs.has(key) ) return this.#docs.get(key);
    let ident = null;
    try {
      const doc = await fromUuid(key);
      if ( doc ) ident = { ...itemIdentity(doc.toObject()), uuid: doc.uuid };
    } catch {
      ident = null;
    }
    this.#docs.set(key, ident);
    return ident;
  }

  /**
   * The new uuid for a recorded pick: its own uuid when that still resolves (a redirect included),
   * else the pool entry with the same identity.
   * @param {object} pick          A recorded identity.
   * @param {string[]} pool        The new advancement's pool (may be empty: a browse-only choice).
   * @returns {Promise<string|null>}
   */
  async #resolvePick(pick, pool, adv = null) {
    const poolSet = new Set(pool.map(withItemSegment));
    const inPool = ident => poolSet.has(withItemSegment(ident.uuid)) || pool.some(p => uuidTail(p) === uuidTail(ident.uuid));
    const browsable = UpdateAnswerProvider.#browsable(adv);
    if ( pick.uuid ) {
      const direct = await this.#identityOf(pick.uuid);
      if ( direct && (!pool.length || inPool(direct) || browsable?.(direct)) ) {
        // Prefer the pool's own spelling of the uuid when it lists the same document.
        return pool.find(p => uuidTail(p) === uuidTail(direct.uuid)) ?? direct.uuid;
      }
    }
    for ( const uuid of pool ) {
      const ident = await this.#identityOf(uuid);
      if ( ident && sameIdentity(pick, ident) ) return uuid;
    }
    // A choice that also lets the player browse for anything its restriction allows (PHB 3.0's
    // Fighting Style lists one style and allows the rest): find the pick again by identity — it may
    // have moved to another pack under another id — and take it if the restriction admits it.
    if ( browsable && pick.name ) {
      const found = await findByIdentity({ type: pick.type ?? "feat", name: pick.name,
        system: { identifier: pick.identifier, source: { rules: pick.rules } } }, null);
      const ident = found?.doc ? { ...itemIdentity(found.doc.toObject()), uuid: found.doc.uuid } : null;
      if ( ident && browsable(ident) ) return ident.uuid;
    }
    return null;
  }

  /**
   * For a choice that accepts anything its restriction allows (`allowDrops` with a restriction, or an
   * empty pool), a test of whether a document qualifies; null for a fixed list.
   * @param {Advancement|null} adv
   * @returns {((ident: object) => boolean)|null}
   */
  static #poolOf(adv) {
    const cfg = adv?.configuration ?? {};
    return [...Array.from(cfg.grants ?? []), ...Array.from(cfg.choices ?? []).flatMap(c => Array.from(c?.pool ?? []))];
  }

  static #browsable(adv) {
    const cfg = adv?.configuration;
    if ( !cfg ) return null;
    const pool = Array.from(cfg.pool ?? []);
    const restriction = cfg.restriction ?? {};
    if ( pool.length && !cfg.allowDrops ) return null;
    // What the restriction names, the pick must have. An empty kind or subtype does not pass: PHB
    // 2.1.0's "Acid Breath Weapon" (race, no subtype) otherwise filled PHB 3.0.0's Dragonborn lineage
    // slot (race/lineage), so the character kept the old item, gained no lineage, and the choice
    // looked answered, so nothing asked it again.
    return ident => {
      if ( cfg.type && ident.type && (ident.type !== cfg.type) ) return false;
      if ( restriction.type && ((ident.kind ?? "") !== restriction.type) ) return false;
      if ( restriction.subtype && ((ident.subtype ?? "") !== restriction.subtype) ) return false;
      return true;
    };
  }

  /** Resolve one matched decision into the answer the accessor will return. */
  async #resolve(kind, rec, decision, line) {
    const adv = rec.advancement;
    const answer = decision.answer;
    const carried = (detail = "") => { line.status = "carried"; line.detail = detail; };
    const partial = (detail = "") => { line.status = "partial"; line.detail = detail; };

    switch ( kind ) {
      case "hp":
        this.#answers.set(rec, answer);
        carried(String(answer));
        return;
      case "size":
        if ( answer?.size ) { this.#answers.set(rec, answer.size); carried(answer.size); }
        return;
      case "grant":
        if ( answer?.ability ) { this.#answers.set(rec, answer.ability); carried(answer.ability); }
        return;
      case "subclass": {
        const ident = answer?.subclass;
        if ( !ident ) return;
        let uuid = null;
        if ( ident.uuid ) uuid = (await this.#identityOf(ident.uuid))?.uuid ?? null;
        if ( !uuid ) {
          // Moved or renamed: find it among the class's subclasses by name.
          uuid = await this.#findSubclass(rec, ident);
        }
        if ( uuid ) { this.#answers.set(rec, uuid); carried(ident.name ?? ""); }
        return;
      }
      case "optional": {
        const options = this.#driver.optionalGrantState(rec).options.map(o => o.uuid);
        const keep = [];
        for ( const t of answer?.taken ?? [] ) {
          const uuid = await this.#resolvePick(t, options);
          if ( uuid ) keep.push(uuid);
        }
        this.#answers.set(rec, keep);
        carried((answer?.taken ?? []).map(t => t.name).filter(Boolean).join(", "));
        return;
      }
      case "asi": {
        if ( answer?.assignments ) {
          this.#answers.set(rec, { ...answer.assignments });
          carried(Object.entries(answer.assignments).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(", "));
          return;
        }
        if ( answer?.feat ) {
          let uuid = answer.feat.uuid ? (await this.#identityOf(answer.feat.uuid))?.uuid : null;
          if ( !uuid ) {
            const listed = await this.#driver.asiFeatOptions(rec).catch(() => null);
            for ( const o of listed?.options ?? [] ) {
              if ( sameIdentity(answer.feat, { name: o.name, uuid: o.uuid, type: "feat" }) ) { uuid = o.uuid; break; }
            }
          }
          if ( uuid ) { this.#answers.set(rec, { feat: uuid }); carried(answer.feat.name ?? ""); }
        }
        return;
      }
      case "trait": {
        const chosen = answer?.chosen ?? [];
        let offered = null;
        try {
          offered = new Set((await this.#driver.traitOptions(rec)).map(o => o.key));
        } catch {
          offered = null;
        }
        const grants = new Set(Array.from(adv.configuration?.grants ?? []));
        const current = new Set(Array.from(adv.value?.chosen ?? []));
        // Expertise (and its kin) offers only skills the character is already proficient in, and the
        // provider warms before the walk has applied the earlier levels' proficiency picks. Asking
        // the clone now would drop every expertise built on a class skill (dnd5e 6.1.0's Bard, Rogue
        // and Ranger lost theirs). Those keys are checked against the configured pool instead; the
        // driver applies them in its last trait pass, once the proficiencies are in.
        const pool = UpdateAnswerProvider.#poolOf(adv);
        const allowed = PROFICIENCY_MODES.includes(adv.configuration?.mode)
          ? k => pool.some(p => keyInPool(k, p))
          : k => !offered || offered.has(k);
        const keys = chosen.filter(k => allowed(k) || grants.has(k) || current.has(k));
        this.#answers.set(rec, keys);
        if ( keys.length === chosen.length ) carried(keys.join(", "));
        else partial(keys.join(", "));
        return;
      }
      case "choice": {
        const picks = answer?.picks ?? answer?.taken ?? [];
        const pool = Array.from(adv.configuration?.pool ?? []).map(p => p?.uuid ?? p).filter(Boolean);
        const count = Number(adv.configuration?.choices?.[rec.level]?.count ?? picks.length);
        const uuids = [];
        for ( const pick of picks ) {
          if ( uuids.length >= count ) break;
          const uuid = await this.#resolvePick(pick, pool, adv);
          if ( uuid && !uuids.includes(uuid) ) uuids.push(uuid);
        }
        this.#answers.set(rec, uuids);
        const names = picks.map(p => p.name).filter(Boolean).join(", ");
        if ( uuids.length && (uuids.length === Math.min(count, picks.length)) ) carried(names);
        else if ( uuids.length ) partial(names);
        return;
      }
      default:
        return;
    }
  }

  /** A subclass of the record's class with the same name, from the class's own subclass list. */
  async #findSubclass(rec, ident) {
    const classIdentifier = rec.advancement?.item?.system?.identifier;
    if ( !classIdentifier || !ident?.name ) return null;
    for ( const pack of game.packs ) {
      if ( pack.documentName !== "Item" ) continue;
      let index;
      try {
        index = await packIndex(pack, { fields: ["system.classIdentifier"] });
      } catch {
        continue;
      }
      const hit = index.find(e => (e.type === "subclass") && (e.system?.classIdentifier === classIdentifier)
        && (String(e.name).toLowerCase() === ident.name.toLowerCase()));
      if ( hit ) return hit.uuid ?? `Compendium.${pack.collection}.Item.${hit._id}`;
    }
    return null;
  }

  /* -------------------------------------------- */
  /*  The accessors autoResolve calls             */
  /* -------------------------------------------- */

  /**
   * Hit points exactly as recorded. With no record (the level was skipped), the average — the
   * driver needs a value — and the line says so.
   */
  hp(rec) {
    if ( this.#answers.has(rec) ) return this.#answers.get(rec);
    const line = this.#report.get(rec);
    if ( line ) { line.status = "default"; line.detail = "avg"; }
    return "avg";
  }

  size(rec) {
    return this.#answers.get(rec) ?? null;
  }

  grantAbility(rec) {
    return this.#answers.get(rec) ?? null;
  }

  /** The subclass uuid, unless it is already applied (`selectSubclass` is a toggle). */
  subclass(rec) {
    const uuid = this.#answers.get(rec) ?? null;
    const current = rec?.advancement?.value?.uuid ?? null;
    if ( !uuid || (current && (withItemSegment(current) === withItemSegment(uuid))) ) return null;
    return uuid;
  }

  traitKeys(rec) {
    return this.#answers.get(rec) ?? [];
  }

  defer() {
    return false;
  }

  /** The picks still to make: the resolved uuids minus anything already selected. */
  choiceUuids(rec) {
    const wanted = this.#answers.get(rec) ?? [];
    const selected = this.#driver?.choiceState(rec)?.selected ?? new Set();
    return wanted.filter(u => !selected.has(u));
  }

  optionalGrant(rec) {
    return this.#answers.has(rec) ? this.#answers.get(rec) : null;
  }

  asi(rec) {
    return this.#answers.get(rec) ?? null;
  }
}
