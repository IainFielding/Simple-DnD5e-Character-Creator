import { ABILITIES } from "../config.mjs";

/**
 * The single source of truth for every choice the player makes in the creator.
 *
 * This is a plain data record: it holds values and performs only the data
 * derivations that several layers need (resolved ability scores). All UI
 * concerns live in the step modules; all persistence lives in the assembler.
 * Nothing here imports an Application or touches the DOM.
 */
export class CreatorState {

  /** @type {Actor} The draft actor being built. */
  actor;

  /** Origin selections, stored as source-compendium UUIDs. */
  classUuid = null;
  speciesUuid = null;
  backgroundUuid = null;

  /** "point-buy" | "standard-array" | "roll" */
  abilityMethod = "point-buy";

  /** Point-buy working values (8..15 per ability). */
  pointBuy = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

  /** array/roll: ability key -> index into the value pool, or null when unassigned. */
  assignment = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

  /** Dice results for the "roll" method, in roll order. */
  rolledPool = [];

  constructor(actor) {
    this.actor = actor;
    this.#prefillFromActor(actor);
  }

  /* -------------------------------------------- */
  /*  Derived data                                */
  /* -------------------------------------------- */

  /**
   * The pool of assignable values for the current method, or null for point-buy.
   * Standard array is fixed; roll uses whatever was rolled.
   * @returns {number[]|null}
   */
  abilityPool() {
    if ( this.abilityMethod === "standard-array" ) return [15, 14, 13, 12, 10, 8];
    if ( this.abilityMethod === "roll" ) return this.rolledPool;
    return null;
  }

  /**
   * Final base ability scores (before species/background bonuses), resolved for
   * whichever method is active. Unassigned slots resolve to 8.
   * @returns {Record<string, number>}
   */
  resolvedScores() {
    if ( this.abilityMethod === "point-buy" ) return { ...this.pointBuy };
    const pool = this.abilityPool() ?? [];
    const out = {};
    for ( const key of ABILITIES ) {
      const idx = this.assignment[key];
      out[key] = (idx != null && pool[idx] != null) ? pool[idx] : 8;
    }
    return out;
  }

  /* -------------------------------------------- */
  /*  Prefill                                     */
  /* -------------------------------------------- */

  /**
   * Seed the draft from an actor that already carries choices, so re-opening the
   * builder resumes rather than restarts. Only fields we can confidently round-trip
   * are read; everything else keeps its default.
   */
  #prefillFromActor(actor) {
    if ( !actor ) return;

    const source = item => item?._stats?.compendiumSource ?? null;
    this.classUuid = source(actor.items?.find(i => i.type === "class"));
    this.backgroundUuid = source(actor.items?.find(i => i.type === "background"));
    this.speciesUuid = source(actor.items?.find(i => i.type === "race"));

    const abil = actor.system?.abilities ?? {};
    const values = ABILITIES.map(k => abil[k]?.value ?? 10);
    // A fresh character defaults every score to 10; only adopt non-default values.
    if ( values.some(v => v !== 10) ) {
      for ( const key of ABILITIES ) {
        this.pointBuy[key] = Math.min(15, Math.max(8, abil[key]?.value ?? 8));
      }
    }
  }
}
