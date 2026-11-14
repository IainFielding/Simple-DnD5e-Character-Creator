import { log } from "../config.mjs";
import { LevelUpDriver } from "../levelup/manager-driver.mjs";
import { withItemSegment } from "../data/advancement-util.mjs";
import {
  grantedAtLevel, itemIdentity, matchDecision, normTitle, sameIdentity, signature, treeKey, uuidTail
} from "./answers.mjs";

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

  /** uuid → identity of the document behind it (or null), shared across warm passes. */
  #docs = new Map();

  /** The driver being answered. */
  #driver = null;

  /**
   * @param {import("./answers.mjs").Decision[]} decisions   From {@link harvestDecisions}.
   */
  constructor(decisions) {
    this.#decisions = decisions;
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
      // A grant's ability picker and an optional grant are two records for one advancement; both
      // read the same recorded answer, so only the first may consume it.
      const shared = this.#sharedDecision(rec);
      const decision = shared ?? matchDecision(wanted, this.#decisions, this.#used);
      const line = { kind, title: adv.title || adv.name || type, level, host: item.name, status: "ask", detail: "" };
      this.#report.set(rec, line);
      if ( !decision ) continue;
      rec._contentUpdateDecision = decision;
      try {
        await this.#resolve(kind, rec, decision, line);
      } catch ( err ) {
        log("content update: could not carry a decision", line.title, err);
        line.status = "ask";
      }
    }
  }

  /** The decision already matched for another record on the same advancement and level. */
  #sharedDecision(rec) {
    for ( const [other] of this.#report ) {
      if ( (other !== rec) && (other.advancement === rec.advancement) && (other.level === rec.level)
        && other._contentUpdateDecision ) return other._contentUpdateDecision;
    }
    return null;
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
  async #resolvePick(pick, pool) {
    const poolSet = new Set(pool.map(withItemSegment));
    if ( pick.uuid ) {
      const direct = await this.#identityOf(pick.uuid);
      if ( direct && (!pool.length || poolSet.has(withItemSegment(direct.uuid))
        || pool.some(p => uuidTail(p) === uuidTail(direct.uuid))) ) {
        // Prefer the pool's own spelling of the uuid when it lists the same document.
        return pool.find(p => uuidTail(p) === uuidTail(direct.uuid)) ?? direct.uuid;
      }
    }
    for ( const uuid of pool ) {
      const ident = await this.#identityOf(uuid);
      if ( ident && sameIdentity(pick, ident) ) return uuid;
    }
    return null;
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
        const keys = chosen.filter(k => !offered || offered.has(k) || grants.has(k) || current.has(k));
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
          const uuid = await this.#resolvePick(pick, pool);
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
        index = await pack.getIndex({ fields: ["system.classIdentifier"] });
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
