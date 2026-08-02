/**
 * Answers the level-up driver's decisions from the shared {@link AnswerBook}.
 *
 * `LevelUpDriver#autoResolve` is written against a provider interface rather than against the
 * creator's state: it calls `provider.hp(rec)`, `provider.traitKeys(rec)`, … for each decision it
 * surfaced and applies the answers itself. The creator supplies a `CreationChoiceProvider` built
 * from the player's recorded picks; the wizard supplies the UI. This supplies the book.
 *
 * That is what makes a level 3 build testable at all. The creator hands 1→N off to the interactive
 * `LevelUpShell` (see `intercept.mjs#launchLevelUpTo`), so there is no headless creator path to
 * call — but the shell is only a way of filling this same interface, so answering it directly
 * exercises the whole driver (`prepare` → `resolveSubclass` → `#ingestItemFeatures` → `commit`)
 * with only the UI left out.
 *
 * Every accessor here is **synchronous**, because `autoResolve` calls them synchronously. Generating
 * an answer is not — it reads compendium indexes — so the caller warms the book over the driver's
 * decision records first (see `creator.mjs#warmDecisions`) and these only ever read the memo. The
 * native adapter asked the same book the same questions, so both sides consume identical answers.
 */

export class ScenarioChoiceProvider {

  /** @type {import("./answers.mjs").AnswerBook} */
  #book;

  /** Ids an answer was actually read for, so the caller can catch answers that went nowhere. */
  consumed = new Set();

  constructor(book) {
    this.#book = book;
  }

  /** The settled answer for a decision, marked as consumed. */
  #answer(rec) {
    const adv = rec?.advancement;
    if ( !adv ) return undefined;
    const value = this.#book.peek(adv, rec.level, "creator");
    if ( value !== undefined ) this.consumed.add(adv.id);
    return value;
  }

  /* -------------------------------------------- */

  /** Hit points for one gained level. Defaults to the average so a scenario need not state it. */
  hp(rec) {
    return this.#answer(rec) ?? "avg";
  }

  /** The chosen size key, or null to leave the decision alone. */
  size(rec) {
    const value = this.#answer(rec);
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  /** The casting ability for a spell-granting ItemGrant. */
  grantAbility(rec) {
    const value = this.#answer(rec);
    return (typeof value === "string") ? value : value?.ability ?? null;
  }

  /** The chosen subclass's source uuid. */
  subclass(rec) {
    const value = this.#answer(rec);
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  /**
   * An ability-score improvement: either a per-ability allocation (`{ int: 2 }`) or
   * `{ feat: "<uuid>" }` to take a feat in its place — the two modes the interactive screen
   * offers, and the only route to a half-feat.
   */
  asi(rec) {
    const value = this.#answer(rec);
    return (value && (typeof value === "object") && !Array.isArray(value)) ? value : null;
  }

  /**
   * The trait picks. The advancement's automatic grants are not included: the driver seeds them at
   * ingest exactly as the native manager's pre-render `apply(level, {}, { initial: true })` does, so
   * both sides start from the same granted state and only the picks differ.
   */
  traitKeys(rec) {
    const value = this.#answer(rec);
    return Array.isArray(value) ? value : [value].filter(Boolean);
  }

  /**
   * Spell-type `ItemChoice`s are deferred, matching the creator: it owns those in its feat-spells
   * step and applies them to the actor after commit rather than through the driver. The book decides
   * which those are, so this side and the native side agree on the category.
   */
  defer(rec) {
    return this.#book.isDeferred(rec?.advancement);
  }

  /** The chosen uuids for a feature `ItemChoice`. */
  choiceUuids(rec) {
    const value = this.#answer(rec);
    if ( Array.isArray(value) ) return value;
    return value?.uuids ?? (typeof value === "string" ? [value] : []);
  }
}
