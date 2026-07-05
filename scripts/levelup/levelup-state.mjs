/**
 * The character level on whose screen a decision belongs. Usually the decision's own `level`, but
 * a feat's synthesised sub-choices inherit the granting ASI's level (see {@link LevelUpDriver}).
 * @param {{screenLevel?: number, level: number}} record
 * @returns {number}
 */
export function recordLevel(record) {
  return record.screenLevel ?? record.level;
}

/**
 * The subset of `records` that belong to a given level's screen, in their original order (so the
 * array index a record had — which the templates use to address it — is recoverable via indexOf).
 * @param {object[]} records
 * @param {number} level
 * @returns {object[]}
 */
export function atLevel(records, level) {
  return records.filter(r => recordLevel(r) === level);
}

import { computeSpellPlan } from "./steps/lvl-spells-step.mjs";

/**
 * Session record for one level-up. Deliberately thin: it carries the actor, the class being
 * levelled, the from→to character levels for display, and a reference to the {@link LevelUpDriver}
 * that owns the working clone and the hit-point decisions. All mutation of the clone happens
 * through the driver; this object holds no DOM or Application concerns.
 *
 * For a junior dev — the mental model of a level-up:
 *   - The real actor is NOT touched while the player is deciding. The driver holds a "clone" (an
 *     in-memory copy), and every decision is applied to that clone. Cancel = throw the clone away.
 *   - "commit" is the moment the clone's changes are written to the real actor (on Apply). After
 *     that, `committed` is true and the post-commit spell step edits the real actor directly.
 *   - This is the counterpart of CreatorState: it's the "form data" for a level-up. The getters
 *     below (hpSteps, asiSteps, …) just forward to the driver's decision arrays for convenience.
 */
export class LevelUpState {

  /** @type {Actor5e} The real actor being levelled (untouched until the driver commits). */
  actor;
  /** @type {import("./manager-driver.mjs").LevelUpDriver} */
  driver;
  /** @type {Item5e} The class item gaining levels. */
  classItem;
  /** Character level before this level-up. */
  fromLevel;
  /** Character level after this level-up. */
  toLevel;
  /**
   * Keys of the level-screen blocks the player has collapsed. Empty by default, so every block
   * starts expanded (the layout as it was before blocks became collapsible); a key is added when
   * its header is toggled shut. Survives re-renders because the shell rebuilds steps but keeps
   * this state object. See {@link module:levelup/steps/level-step}.
   * @type {Set<string>}
   */
  collapsedBlocks = new Set();

  /**
   * Whether the level grant has been committed to the real actor. The spell step (§3.4) runs
   * *after* commit and edits the actor directly, so the shell flips this on Apply, then locks the
   * level screens and reveals the spell step. Starts false; the level-up decisions drive the clone
   * until it is set.
   */
  committed = false;

  /**
   * Spells chosen on the post-commit spell step, staged here and written to the actor on Finish
   * (mirroring how creation stages picks then grants them). Cleared only by closing the window.
   * @type {{uuid:string, id:string, name:string, img:string, level:number}[]}
   */
  selectedCantrips = [];
  selectedSpells = [];

  /** Transient UI state for the spell step: the active tab and the focused spell's UUID. */
  spellTab = "cantrips";
  focusedSpellUuid = null;

  /**
   * Phase 4b spell swaps: an owned cantrip / leveled spell the player has marked to replace this
   * level-up (the 2024 "swap one spell" rule). Marking one frees a slot in that bucket to learn a
   * different spell; on Finish the marked item is deleted only if the freed slot was actually used.
   * `{ id, name }` of the actor's spell item, or null.
   * @type {{id:string, name:string}|null}
   */
  swapCantrip = null;
  swapSpell = null;

  constructor(actor, driver) {
    this.actor = actor;
    this.driver = driver;
    this.classItem = driver.steps.find(s => s.class)?.class?.item ?? null;
    this.fromLevel = actor.system?.details?.level ?? 0;
    // The trailing marker step carries the final character level the manager is targeting.
    this.toLevel = driver.steps.reduce((max, s) => Math.max(max, s.level ?? 0), this.fromLevel);
  }

  /**
   * The spell capacity this level-up opens up, computed from the driver's clone (whose derived data
   * already reflects the new level). Used to decide whether the spell step exists and, once
   * committed, what the step offers. Sync — the spell *pool* is loaded separately by the step.
   * @returns {import("./steps/lvl-spells-step.mjs").SpellPlan}
   */
  spellPlan() {
    const source = this.committed ? this.actor : this.driver.clone;
    const classItem = this.classItem ? source.items.get(this.classItem.id) : null;
    return computeSpellPlan(source, classItem);
  }

  /**
   * Whether a post-commit spell step should be appended: the leveled class is a caster and this
   * level-up opened new cantrip or prepared-spell capacity.
   * @returns {boolean}
   */
  hasSpellStep() {
    return this.spellPlan().hasDelta;
  }

  /** The hit-point decisions surfaced for this level-up (one per gained level). */
  get hpSteps() {
    return this.driver.hpSteps;
  }

  /** The feature-choice decisions surfaced for this level-up. */
  get choiceSteps() {
    return this.driver.choiceSteps;
  }

  /** The ability-score-improvement decisions surfaced for this level-up. */
  get asiSteps() {
    return this.driver.asiSteps;
  }

  /** The trait decisions (Weapon Mastery, language picks…) surfaced for this level-up. */
  get traitSteps() {
    return this.driver.traitSteps;
  }

  /** The subclass decisions surfaced for this level-up. */
  get subclassSteps() {
    return this.driver.subclassSteps;
  }

  /** The spell-grant ability decisions (a species lineage spell at a class level). */
  get grantSteps() {
    return this.driver.grantSteps;
  }

  /**
   * The gained character levels that each get a screen, in ascending order. Every gained level
   * grants at least hit points, so the decisions across all arrays define the set; a choice
   * revealed later (a subclass feature, a feat's grant) carries the screen level it belongs to and
   * folds into one of these rather than adding a new screen.
   * @returns {number[]}
   */
  gainedLevels() {
    const levels = new Set();
    for ( const arr of [this.hpSteps, this.asiSteps, this.subclassSteps, this.choiceSteps, this.traitSteps, this.grantSteps] ) {
      for ( const record of arr ) levels.add(recordLevel(record));
    }
    return [...levels].sort((a, b) => a - b);
  }
}
