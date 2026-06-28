import { ABILITIES, t } from "../config.mjs";

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

  /**
   * Identity & biography fields. `name` mirrors the actor name (the only mandatory
   * field); the rest are optional and written to `actor.system.details` on build.
   */
  details = {
    name: "", alignment: "", faith: "", gender: "", eyes: "", hair: "", skin: "",
    height: "", weight: "", age: "", trait: "", ideals: "", bonds: "", flaws: "",
    appearance: "", biography: ""
  };

  /** Portrait / prototype-token visual settings, applied to the actor on build. */
  portrait = "icons/svg/mystery-man.svg";
  tokenImg = "icons/svg/mystery-man.svg";
  tokenRingImg = "icons/svg/mystery-man.svg";
  tokenRingEnabled = false;
  tokenLockRotation = false;

  /** Transient Details-step UI: which token image tab is shown ("token"|"ring"). Not persisted. */
  tokenTab = "token";

  /**
   * Level-1 spell picks (spellcaster classes only), each `{uuid, id, name, img, level}`.
   * Cleared whenever the class selection changes — a spell list is class-specific.
   */
  selectedCantrips = [];
  selectedSpells = [];

  /**
   * Advancement choices made on the Choices step: source -> selKey -> chosen key/uuid[].
   * Each source's bucket is cleared when that origin selection changes.
   */
  advChoices = { class: {}, background: {}, species: {} };

  /**
   * Transient Choices-step UI: which decision row of the guided checklist is expanded.
   * `undefined` = auto (open the first unfinished decision); a decision key = that row;
   * `""` = the player collapsed everything. Not persisted; resolved against the available
   * decisions on each render, so a stale key falls back to the first unfinished decision.
   */
  openDecision = undefined;

  /** Starting-equipment selection per source: { selectedOption, orSelections }. */
  equipment = {
    class: { selectedOption: 0, orSelections: {} },
    background: { selectedOption: 0, orSelections: {} }
  };

  /**
   * Transient: set once the player has opened the (optional) Equipment step, so its rail tick
   * stays off until then rather than reading complete from the start. Not persisted.
   */
  equipmentVisited = false;

  /** Transient Spells-step UI: which tab is shown and which spell is focused. Not persisted. */
  spellTab = "cantrips";
  focusedSpellUuid = null;

  /**
   * Slim spellcasting summary for the current class — `{isSpellcaster, maxCantrips, maxSpells}`
   * — so the (synchronous) completion gate can tell whether the Spells step applies and
   * whether every known spell has been chosen. Refreshed whenever the class changes. Null
   * until a class is picked.
   */
  spellInfo = null;

  /**
   * The most recently resolved advancement-choice requirements (from the choice
   * resolver). Cached so the synchronous `isComplete` check — and the assembler — can
   * read completion without re-resolving documents. Refreshed whenever an origin
   * selection or a choice pick changes. `undefined` until first resolved.
   * @type {{sources: object[], hasAny: boolean}|undefined}
   */
  choiceCache;

  /** "point-buy" | "standard-array" | "roll" */
  abilityMethod = "point-buy";

  /** Point-buy working values (8..15 per ability). */
  pointBuy = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

  /** array/roll: ability key -> index into the value pool, or null when unassigned. */
  assignment = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

  /** Dice results for the "roll" method, in roll order. */
  rolledPool = [];

  /**
   * Player-allocated ability increases granted by the chosen background, on top of
   * any the background fixes itself. Reset whenever the background selection changes.
   */
  backgroundAbilities = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

  /**
   * The selected background's ability-score-improvement config, cached so the
   * synchronous completion check can see it without re-resolving the document.
   * `undefined` = not yet resolved; `null` = background grants no increase.
   * @type {{id: string, points: number, cap: number, fixed: object, locked: string[]}|null|undefined}
   */
  backgroundAsi;

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

  /**
   * The ability increase the chosen background confers per ability: the fixed part
   * plus whatever the player allocated in the wizard. Only abilities with a non-zero
   * increase are present, so callers can treat a missing key as "no bonus".
   * @returns {Record<string, number>}
   */
  backgroundDeltas() {
    const asi = this.backgroundAsi;
    if ( !asi ) return {};
    const out = {};
    for ( const key of ABILITIES ) {
      const total = Number(asi.fixed?.[key] ?? 0) + (this.backgroundAbilities[key] ?? 0);
      if ( total ) out[key] = total;
    }
    return out;
  }

  /**
   * Forget the current background's ability allocation and cached config. Called
   * when the background selection changes so a previous choice never leaks across.
   */
  resetBackgroundAbilities() {
    this.backgroundAbilities = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    this.backgroundAsi = undefined;
  }

  /**
   * Forget everything keyed to the class: its level-1 spell picks, its advancement
   * choices, and its equipment selection. Called when the class selection changes so
   * a spell list or skill pick never carries over to a different class.
   */
  resetClassDependent() {
    this.selectedCantrips = [];
    this.selectedSpells = [];
    this.advChoices.class = {};
    this.equipment.class = { selectedOption: 0, orSelections: {} };
  }

  /**
   * Forget one origin source's advancement choices (and equipment, where it has any).
   * Called when that source's selection changes.
   * @param {"class"|"background"|"species"} source
   */
  resetSourceChoices(source) {
    this.advChoices[source] = {};
    if ( this.equipment[source] ) this.equipment[source] = { selectedOption: 0, orSelections: {} };
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

    // Identity & biography — round-trip whatever the actor already carries. `ideals`,
    // `bonds`, `flaws` map to the singular dnd5e keys; biography is a rich-text object.
    const d = actor.system?.details ?? {};
    // The draft is created with a placeholder name; don't treat that as a real entry,
    // so the Details step stays incomplete until the player actually names the character.
    const placeholder = t("common.newCharacter");
    this.details = {
      name: (actor.name && actor.name !== placeholder) ? actor.name : "",
      alignment: d.alignment ?? "", faith: d.faith ?? "", gender: d.gender ?? "",
      eyes: d.eyes ?? "", hair: d.hair ?? "", skin: d.skin ?? "",
      height: d.height ?? "", weight: d.weight ?? "", age: d.age ?? "",
      trait: d.trait ?? "", ideals: d.ideal ?? "", bonds: d.bond ?? "",
      flaws: d.flaw ?? "", appearance: d.appearance ?? "",
      biography: d.biography?.value ?? ""
    };

    // Portrait & prototype-token visuals.
    const token = actor.prototypeToken ?? {};
    if ( actor.img ) this.portrait = actor.img;
    if ( token.texture?.src ) this.tokenImg = token.texture.src;
    if ( token.ring?.subject?.texture ) this.tokenRingImg = token.ring.subject.texture;
    this.tokenRingEnabled = !!token.ring?.enabled;
    this.tokenLockRotation = !!token.lockRotation;
  }
}
