import { log } from "../config.mjs";

/**
 * Character-creation side of the shared advancement machinery. The creator collects every
 * advancement choice up front in its own steps (species/class/background, abilities, spells); this
 * module turns those recorded picks into the inputs the {@link module:levelup/manager-driver}
 * needs, so a *new* character is built through the exact same clone→apply→commit pipeline a
 * *level-up* uses. There is no second, hand-rolled apply path.
 *
 * Two pieces:
 *   1. {@link buildCreationManager} stages the origin items on a fresh AdvancementManager and
 *      enumerates their level-≤1 advancement steps (never rendering it).
 *   2. {@link CreationChoiceProvider} answers each decision the driver surfaces from the player's
 *      recorded picks (`state.advChoices`, the resolver output, the background ability allocation).
 *
 * For a junior dev: the level-up driver walks a character's new advancements and, for anything that
 * needs a choice, *asks the wizard UI*. At creation we already know every answer, so instead of a UI
 * we hand the driver this "provider" — a lookup table of the player's picks. The driver calls
 * `provider.hp(rec)`, `provider.traitKeys(rec)`, … and applies each answer itself. Same engine, no UI.
 */

/** The level-1 hit-point value: a new character always takes the max of its class hit die. */
const LEVEL_ONE_HP = "max";

/**
 * Stage the origin items on a non-interactive AdvancementManager and enumerate the advancement
 * steps the driver will walk. The class is levelled 0→1 (which builds its own step set); species
 * and background aren't levelled, so their level-0 and level-1 flows are pushed by hand — the only
 * levels a freshly-created character has. The manager is never rendered; the driver drives its clone.
 * @param {Actor} actor          The draft actor (base scores/details already written).
 * @param {object[]} items       The origin item data (species, background, class at level 0).
 * @returns {AdvancementManager}
 */
export function buildCreationManager(actor, items) {
  const manager = new dnd5e.applications.advancement.AdvancementManager(actor, { automaticApplication: true });
  manager.clone.updateSource({ items });

  for ( const itemData of items ) {
    const item = manager.clone.items.get(itemData._id);
    if ( !item ) { log(`creation manager: staged item missing on clone (${itemData._id})`); continue; }
    if ( item.type === "class" ) {
      manager.createLevelChangeSteps(item, 1);
      continue;
    }
    for ( let l = 0; l < 2; l++ ) {
      for ( const flow of manager.constructor.flowsForLevel(item, l) ) {
        manager.steps.push({ type: "forward", flow });
      }
    }
  }
  return manager;
}

/** A recorded pick may be a bare uuid/key string or a `{uuid}` object; normalise to the string. */
function pickValue(p) {
  return (typeof p === "string") ? p : p?.uuid ?? null;
}

/**
 * Answers the driver's decisions from the creator's recorded state — the headless counterpart of the
 * level-up wizard. Constructed from the choice-resolver output (which carries every choice-bearing
 * advancement's `advId`/`selKey`/`type`/`source`) and the {@link CreatorState}.
 */
export class CreationChoiceProvider {

  /** @type {import("../state/creator-state.mjs").CreatorState} */
  #state;

  /** advId → the resolver requirements that reference it (a Trait advancement has one per choice group). */
  #byAdv = new Map();

  /**
   * @param {{sources: object[]}} resolved   The choice-resolver output (`resolveChoices`).
   * @param {import("../state/creator-state.mjs").CreatorState} state
   */
  constructor(resolved, state) {
    this.#state = state;
    for ( const src of resolved?.sources ?? [] ) {
      for ( const req of src.requirements ?? [] ) {
        if ( !req.advId ) continue;
        const list = this.#byAdv.get(req.advId) ?? [];
        list.push(req);
        this.#byAdv.set(req.advId, list);
      }
    }
  }

  /** The requirements referencing an advancement id, optionally filtered by type. */
  #reqs(advId, type = null) {
    const list = this.#byAdv.get(advId) ?? [];
    return type ? list.filter(r => r.type === type) : list;
  }

  /** The player's recorded picks for one requirement, normalised to key/uuid strings. */
  #picks(req) {
    const raw = this.#state.advChoices?.[req.source]?.[req.selKey] ?? [];
    return Array.from(raw).map(pickValue).filter(Boolean);
  }

  /* -------------------------------------------- */

  /** Hit points: a level-1 character always takes max. */
  hp() {
    return LEVEL_ONE_HP;
  }

  /** The chosen size key for a size decision, or null. */
  size(rec) {
    const req = this.#reqs(rec.advancement.id, "Size")[0];
    return req ? this.#picks(req)[0] ?? null : null;
  }

  /** The chosen casting ability for a spell-granting ItemGrant, or null. */
  grantAbility(rec) {
    const req = this.#reqs(rec.advancement.id, "SpellAbility")[0];
    return req ? this.#picks(req)[0] ?? null : null;
  }

  /** Subclasses are chosen later (still interactively), never at level-1 creation. */
  subclass() {
    return null;
  }

  /**
   * The ability-score assignment for the *background* ability increase (the only ASI decision a
   * level-1 build surfaces). `backgroundDeltas()` already sums the advancement's fixed part and the
   * player's allocation into per-ability point totals — exactly the assignment map the ASI apply
   * wants. Any other ASI decision (there shouldn't be one at level 1) is left unallocated.
   */
  asi(rec) {
    const asi = this.#state.backgroundAsi;
    if ( !asi || rec.advancement.id !== asi.id ) return null;
    return this.#state.backgroundDeltas();
  }

  /**
   * The trait keys to apply: the player's recorded picks across every choice group of this
   * advancement. The automatic `configuration.grants` are *not* folded in here — the driver seeds
   * them at ingest exactly as the native manager does, so adding them again would be redundant.
   */
  traitKeys(rec) {
    const keys = [];
    for ( const req of this.#reqs(rec.advancement.id, "Trait") ) keys.push(...this.#picks(req));
    return keys;
  }

  /**
   * Whether a feature choice is deferred out of the driver. Spell-type ItemChoices (Magic Initiate
   * and its variants) are owned by the feat-spells step and applied directly on the actor after
   * commit, so the driver leaves their slot empty.
   */
  defer(rec) {
    return rec.advancement?.configuration?.type === "spell";
  }

  /** The recorded uuids for a (non-spell) feature ItemChoice. */
  choiceUuids(rec) {
    const req = this.#reqs(rec.advancement.id, "ItemChoice")[0];
    return req ? this.#picks(req) : [];
  }
}
