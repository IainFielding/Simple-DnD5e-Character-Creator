import { log } from "../config.mjs";
import { QUICK_BUILD, FEATURE_PREFERENCES } from "./quick-build-data.mjs";
import { LevelUpDriver } from "../levelup/manager-driver.mjs";
import { reconcileGrantedSpells } from "../build/spell-reconcile.mjs";
import { computeSpellPlan, applyLevelUpSpells } from "../levelup/steps/lvl-spells-step.mjs";
import { pickSpells } from "./quick-build.mjs";
import { spellKey, ownedSpellKeys } from "./spell-identity.mjs";

/**
 * Quick Build's climb: carry a filled 1st-level character up to a higher starting level without
 * asking the player anything.
 *
 * The three-card screen promises "three choices, everything else is filled in for you". Starting at
 * 3rd or 5th level has to keep that promise, which rules out the obvious implementation — creating
 * the character and opening the level-up wizard, the way a step-by-step build above 1st level does
 * ({@link module:levelup/intercept.launchLevelUpTo}). That would press Create and immediately hand
 * back a three-level wizard, which is the opposite of what the screen offered.
 *
 * So the climb runs **headless**, through the same `LevelUpDriver` the wizard drives, answered by
 * {@link QuickClimbProvider} from the class's own suggestion profile. It is the same sequence the
 * e2e harness uses to build its reference characters, which is the strongest argument available
 * that it produces what the interactive path would: that sequence is checked against the *native*
 * dnd5e wizard, level by level, across 135 subclasses.
 *
 * ## What it cannot answer, and why that is safe
 *
 * The profile knows about subclasses, ability priorities and feature preferences. It does not know
 * about everything a content module might add. A decision the provider has no opinion on is simply
 * left unanswered — the driver applies the seeded default and moves on — and the character arrives
 * with the **repair wrench** offering exactly those levels. That is a far better failure than
 * guessing, and it is a mechanism that already exists ({@link module:levelup/repair}).
 *
 * ## Why the provider is warmed first
 *
 * `LevelUpDriver#autoResolve` reads its provider **synchronously**, one decision at a time, while
 * resolving a subclass name to a uuid is a compendium read. So every answer the provider could be
 * asked for has to be resolved *before* `autoResolve` runs. {@link QuickClimbProvider.warm} does
 * that, and it is the single ordering constraint in this file.
 */

/** The levels the Quick Build screen offers as starting rungs. 1 is the plain build. */
export const QUICK_LEVELS = Object.freeze([1, 3, 5]);

/**
 * Whether a level is one this feature will climb to.
 *
 * Fixed rungs rather than any level 1–20, and the reason is the profile rather than the code: a
 * suggestion table can stand behind "which subclass suits a new player" and "spend the increase on
 * the class's first priority", and cannot stand behind eleven levels of invocations, metamagic and
 * manoeuvres. 3 is where a 2024 class takes its subclass; 5 is the first big power step (Extra
 * Attack, 3rd-level spells) and the usual "start above 1st" pitch for a new campaign.
 * @param {number} level
 * @returns {boolean}
 */
export function isQuickLevel(level) {
  return QUICK_LEVELS.includes(Number(level));
}

/* -------------------------------------------- */

/**
 * Answers the climb's decisions from a class's Quick Build profile.
 *
 * Implements the same interface as {@link module:build/creation-advancement.CreationChoiceProvider}
 * — `hp`, `size`, `grantAbility`, `subclass`, `traitKeys`, `defer`, `choiceUuids`, `optionalGrant`
 * and `asi` — because that is what `autoResolve` consumes. Every method must be synchronous and
 * must tolerate being asked about an advancement it has never heard of.
 */
export class QuickClimbProvider {

  /** @type {object} The resolved suggestion profile for the character's class. */
  #profile;

  /** @type {import("./source-index.mjs").SourceIndex} */
  #source;

  /** Subclass name → uuid, resolved during {@link warm}. */
  #subclassUuid = null;

  /** decision record → the trait keys chosen for it, filled by {@link warmDecisions}. */
  #traitPicks = new Map();

  /** decision record → the feature uuids chosen for it, filled by {@link warmDecisions}. */
  #choicePicks = new Map();

  /**
   * The driver currently being answered, set by {@link warmDecisions}.
   *
   * Held because two answers cannot be precomputed: `asi` needs the live budget from `asiState`,
   * which changes as earlier decisions apply. Both accessors it serves are synchronous, and so is
   * `asiState`, so this stays inside the contract `autoResolve` requires.
   */
  #driver = null;

  /** Ability keys in the class's priority order. */
  #priorities;

  /**
   * @param {object} profile   A `QUICK_BUILD` entry (or a generic stand-in).
   * @param {import("./source-index.mjs").SourceIndex} source
   */
  constructor(profile, source) {
    this.#profile = profile ?? {};
    this.#source = source;
    this.#priorities = Array.isArray(profile?.abilities) ? [...profile.abilities] : [];
  }

  /**
   * Resolve everything that needs a compendium read, before `autoResolve` starts asking.
   *
   * Only the subclass needs it today. It is resolved against the *class's own* subclass list for
   * the character's rules edition, so a 2014 Monk gets "Way of the Open Hand" and a 2024 one
   * "Warrior of the Open Hand" from the same profile — the two editions almost never share a name.
   * @param {Item5e} classItem   The character's class item.
   */
  async warm(classItem) {
    const names = this.#profile.subclasses ?? [];
    if ( !names.length ) return;

    const identifier = classItem?.system?.identifier ?? "";
    const rules = classItem?.system?.source?.rules ?? null;
    let cards = [];
    try {
      cards = await this.#source.subclasses(identifier, { rules }) ?? [];
    } catch ( err ) {
      log("quick climb: could not list subclasses", err);
      return;
    }
    if ( !cards.length ) return;

    for ( const name of names ) {
      const match = cards.find(c => c.name?.toLowerCase() === String(name).toLowerCase());
      if ( match ) { this.#subclassUuid = match.uuid; return; }
    }
    // Nothing the profile named is installed. Take the first the world offers rather than leaving
    // the character subclass-less: at 3rd level a missing subclass is missing features, spells and
    // proficiencies, which is a much worse answer than an unsuggested one.
    this.#subclassUuid = cards[0].uuid;
    log(`quick climb: none of [${names.join(", ")}] installed for ${identifier}; using ${cards[0].name}`);
  }

  /* -------------------------------------------- */

  /**
   * Hit points: the average, which is what the level-up screen defaults to and what a player who
   * declined to make any decisions should get. Rolling would make the same three choices produce a
   * different character each time, which the screen's "seeded" promise rules out.
   */
  hp() {
    return "avg";
  }

  /** No opinion — a size decision above 1st level is content we have no suggestion for. */
  size() {
    return null;
  }

  /** No opinion; the driver's seeded default stands. */
  grantAbility() {
    return null;
  }

  /**
   * The subclass resolved in {@link warm}, or null when the class offers none — **or when it is
   * already applied**.
   *
   * That last clause is load-bearing. `LevelUpDriver#selectSubclass` is a toggle, not a setter: it
   * clears whatever is set and then re-resolves only `if ( current !== uuid )`. Answering the same
   * uuid a second time therefore *removes* the subclass and does not put it back. The climb runs
   * `autoResolve` twice — the second pass exists to answer decisions the subclass itself
   * synthesised — so without this the character reached 3rd level with no subclass at all, and
   * nothing about the finished sheet said why.
   */
  subclass(rec) {
    const current = rec?.advancement?.value?.uuid ?? null;
    if ( current && (current === this.#subclassUuid) ) return null;
    return this.#subclassUuid;
  }

  /**
   * Spend an ability-score improvement down the class's priority order, +2 then +1.
   *
   * A feat is the other thing this decision can take, and deliberately not offered: choosing a feat
   * well depends on the whole build, a suggestion table cannot do it, and a *wrong* feat is harder
   * for a player to undo later than an ability increase. Increases are also what the 2014 quick-build
   * sidebars themselves recommended.
   *
   * Only the first two priorities are raised, and never past 20 — the cap the driver would enforce
   * anyway, applied here so the allocation it is handed is already legal.
   */
  asi(rec) {
    // Read through the driver's own `asiState` rather than off the record: the record carries no
    // scores, and the budget is not simply `configuration.points` — it discounts fixed and locked
    // abilities, and a capstone's undecided bonus, exactly as the interactive screen does. Deriving
    // it here would be a second, quietly different implementation of that arithmetic.
    const st = this.#driver?.asiState(rec);
    if ( !st ) return null;
    let left = Number(st.available ?? 0);
    if ( left <= 0 ) return null;

    // `asiState` reports `canIncrease` but not the ceiling behind it, so the per-ability room is
    // derived from the two numbers it does give: the 20 cap and this advancement's `cap` on how
    // much one ability may take. Reading a field it does not return would have looked right and
    // silently allocated nothing.
    const perAbility = Number(st.cap ?? Infinity);
    const byKey = new Map((st.abilities ?? []).map(a => [a.key, a]));
    const order = [...this.#priorities, ...[...byKey.keys()].filter(k => !this.#priorities.includes(k))];

    const out = {};
    for ( const key of order ) {
      if ( left <= 0 ) break;
      const a = byKey.get(key);
      if ( !a || a.locked || !a.canIncrease ) continue;
      const toTwenty = Math.max(0, 20 - Number(a.value ?? 0));
      const spare = Math.max(0, perAbility - Number(a.delta ?? 0));
      const take = Math.min(left, 2, toTwenty, spare);
      if ( take <= 0 ) continue;
      out[key] = (out[key] ?? 0) + take;
      left -= take;
    }
    return Object.keys(out).length ? out : null;
  }

  /**
   * Resolve every trait and feature decision the driver has surfaced, into the memo the synchronous
   * accessors read.
   *
   * Called between `prepare()` and `autoResolve()`, and again after it, because choosing a subclass
   * synthesises further decisions that did not exist on the first pass — the same reason the e2e
   * harness warms its answer book twice.
   *
   * The options come from `driver.traitOptions`, the level-up screen's own source, rather than from
   * `configuration.pool`. That distinction is the whole reason this is warmed rather than computed
   * inline: what a character may actually pick is the pool minus everything they already have, and
   * an **expertise** pool is not in the configuration at all — it is "skills this source already made
   * you proficient in". Reading the configuration would offer a Rogue expertise in skills they have
   * no proficiency in, which `TraitAdvancement#apply` then silently discards.
   * @param {import("../levelup/manager-driver.mjs").LevelUpDriver} driver
   */
  async warmDecisions(driver) {
    this.#driver = driver;
    for ( const rec of driver.traitSteps ?? [] ) {
      if ( this.#traitPicks.has(rec) ) continue;
      try {
        const { current, max, full } = driver.traitState(rec);
        if ( full ) { this.#traitPicks.set(rec, []); continue; }
        const options = await driver.traitOptions(rec);
        this.#traitPicks.set(rec, this.#chooseTraits(options, Math.max(0, (max ?? 0) - (current ?? 0))));
      } catch ( err ) {
        log("quick climb: could not read trait options", err);
        this.#traitPicks.set(rec, []);
      }
    }

    for ( const rec of driver.choiceSteps ?? [] ) {
      if ( this.#choicePicks.has(rec) ) continue;
      if ( this.defer(rec) ) { this.#choicePicks.set(rec, []); continue; }
      try {
        this.#choicePicks.set(rec, await this.#chooseFeatures(driver, rec));
      } catch ( err ) {
        log("quick climb: could not read feature options", err);
        this.#choicePicks.set(rec, []);
      }
    }
  }

  /**
   * Take the profile's preferred keys that are actually on offer, then backfill from the top.
   *
   * Backfilling matters more than the preference. An unanswered trait decision leaves the character
   * without a proficiency they are entitled to and no way to see that from the sheet, so any legal
   * pick beats none — the suggestion is a nicety, the filling-in is the promise.
   */
  #chooseTraits(options, wanted) {
    // `disabled` already covers "owned at an earlier level" and "quota full", and `selected` covers
    // this advancement's existing picks — so the option flags are the whole eligibility test and
    // there is nothing to re-derive from the chosen set.
    const remaining = (options ?? []).filter(o => !o.disabled && !o.selected && o.key);
    if ( !remaining.length || !wanted ) return [];

    const prefer = [...(this.#profile.expertise ?? []), ...(this.#profile.skills ?? []),
      ...(this.#profile.masteries ?? []), ...(this.#profile.tools ?? [])]
      .map(k => String(k).toLowerCase());

    const out = [];
    for ( const want of prefer ) {
      if ( out.length >= wanted ) break;
      const hit = remaining.find(o => !out.includes(o.key) && o.key?.split(":").pop().toLowerCase() === want);
      if ( hit ) out.push(hit.key);
    }
    for ( const o of remaining ) {
      if ( out.length >= wanted ) break;
      if ( !out.includes(o.key) ) out.push(o.key);
    }
    return out;
  }


  /**
   * Feature choices — fighting styles, invocations, manoeuvres — by name from the profile, then the
   * shared {@link FEATURE_PREFERENCES} fallback, then whatever the pool offers.
   */
  async #chooseFeatures(driver, rec) {
    const cfg = rec.advancement?.configuration ?? {};
    const st = driver.choiceState(rec);
    if ( st?.full ) return [];
    const wanted = Math.max(0, Number(cfg.count ?? 1) - (st?.selected?.length ?? 0));
    if ( !wanted ) return [];

    const pool = Array.from(cfg.pool ?? []).map(p => p?.uuid ?? p).filter(Boolean);
    if ( !pool.length ) return [];
    const already = new Set(st?.selected ?? []);

    // Names are resolved here, in the async warm, because matching a preference against a pool
    // means reading each document — which the synchronous accessor could never do.
    const named = new Map();
    for ( const uuid of pool ) {
      if ( already.has(uuid) ) continue;
      const doc = await fromUuid(uuid).catch(() => null);
      if ( doc?.name ) named.set(uuid, doc.name.toLowerCase());
    }

    const prefer = [...(this.#profile.features ?? []), ...FEATURE_PREFERENCES]
      .map(n => String(n).toLowerCase());
    const out = [];
    for ( const want of prefer ) {
      if ( out.length >= wanted ) break;
      for ( const [uuid, name] of named ) {
        if ( (name === want) && !out.includes(uuid) ) { out.push(uuid); break; }
      }
    }
    for ( const uuid of named.keys() ) {
      if ( out.length >= wanted ) break;
      if ( !out.includes(uuid) ) out.push(uuid);
    }
    return out;
  }

  /** Spell ItemChoices belong to the spell pass, exactly as they do at creation. */
  defer(rec) {
    return rec?.advancement?.configuration?.type === "spell";
  }

  /** The trait keys warmed for this decision. */
  traitKeys(rec) {
    return this.#traitPicks.get(rec) ?? [];
  }

  /** The feature uuids warmed for this decision. */
  choiceUuids(rec) {
    return this.#choicePicks.get(rec) ?? [];
  }

  /**
   * No opinion, which leaves an optional grant seeded — every item taken, as dnd5e's own manager
   * presents it. `null` rather than `[]`: the empty array is a real answer meaning "decline all".
   */
  optionalGrant() {
    return null;
  }
}

/* -------------------------------------------- */

/**
 * Learn the spells a level entitles the character to.
 *
 * Separate from `autoResolve` because spells are not an advancement decision — the level-up screen
 * owns them, computing a capacity delta from the caster's derived data and staging picks against it.
 * A climb that skipped this produced a *structurally* correct 5th-level Wizard holding only its
 * 1st-level spells, which is the kind of gap that looks fine in an item count and is glaring on the
 * character sheet.
 *
 * The pool is `forClassAtLevel`, not `forClass`: the latter is the creation view and stops at 1st
 * level, so it could never offer the 2nd- and 3rd-level spells a 5th-level caster is owed.
 *
 * Anything already known is excluded by **identity**, not uuid — two installed packages hold two
 * copies of every spell (see {@link module:data/spell-identity}).
 * @param {Actor5e} actor
 * @param {Item5e} classItem
 * @param {object} profile
 * @param {import("./spell-source.mjs").SpellSource} spells
 */
async function learnSpells(actor, classItem, profile, spells) {
  if ( !spells ) return;
  const plan = computeSpellPlan(actor, classItem);
  if ( !plan.isSpellcaster || !plan.hasDelta ) return;

  const pool = await spells.forClassAtLevel(plan.castUuid, plan.maxSpellLevel, plan.listType, {
    doc: plan.castItem
  });
  if ( !pool?.isSpellcaster ) return;

  const known = new Set(ownedSpellKeys(actor));
  const free = list => (list ?? []).filter(s => {
    const key = spellKey(s);
    return !key || !known.has(key);
  });

  // Level-1 suggestions are reused for the higher levels rather than the table growing a
  // per-level list: a name that is not on offer is skipped and the pick backfills from the top of
  // the pool, so the suggestions cost nothing where they do not apply.
  // `forClassAtLevel` indexes everything under `byLevel` — cantrips are level 0, not a separate
  // `cantrips` bucket as the creation view's `forClass` returns.
  const picks = [
    ...pickSpells(free(pool.byLevel?.[0]), profile.cantrips, plan.addCantrips),
    ...pickSpells(free(byLevelUpTo(pool, plan.maxSpellLevel)), profile.spells, plan.addSpells)
  ];
  if ( !picks.length ) return;
  await applyLevelUpSpells(actor, plan.sourceTag, picks, plan.method);
}

/**
 * Every leveled spell the pool offers up to a level, flattened highest-first.
 *
 * Highest first on purpose: a 5th-level Wizard offered its whole list would otherwise fill every
 * new slot with 1st-level spells, which is a legal character and a useless one.
 * @param {object} pool   From `forClassAtLevel`.
 * @param {number} maxSpellLevel
 * @returns {object[]}
 */
function byLevelUpTo(pool, maxSpellLevel) {
  const out = [];
  for ( let lvl = maxSpellLevel; lvl >= 1; lvl-- ) out.push(...(pool.byLevel?.[lvl] ?? []));
  return out;
}

/**
 * Climb a freshly-created 1st-level character to its starting level, answering as it goes.
 *
 * One manager per level rather than one for the whole jump. The level-by-level walk is the one the
 * e2e sweep measures against native, and it is also the only way a decision *unlocked by* an
 * earlier level — a subclass feature choice at 3 raising a trait pick at 3 — is reached at all.
 *
 * Failure is contained per level: a level that throws is logged and the climb stops there rather
 * than unwinding, leaving a valid character at the level it reached. The repair wrench then offers
 * the rest. Throwing away a half-built character would be the worse of the two.
 *
 * @param {Actor5e} actor            The character, freshly created at level 1.
 * @param {number} targetLevel       One of {@link QUICK_LEVELS}.
 * @param {import("./source-index.mjs").SourceIndex} source
 * @param {import("./spell-source.mjs").SpellSource} [spells]  Omit to skip the spell pass.
 * @returns {Promise<{reached: number, levels: number}>}  The level actually attained.
 */
export async function quickClimb(actor, targetLevel, source, spells = null) {
  const classItem = actor.items.find(i => i.type === "class");
  if ( !classItem ) {
    log("quick climb: the build produced no class item");
    return { reached: 1, levels: 0 };
  }

  const max = CONFIG.DND5E?.maxLevel ?? 20;
  const target = Math.min(Number(targetLevel) || 1, max);
  const from = Number(classItem.system?.levels ?? 1);
  if ( target <= from ) return { reached: from, levels: 0 };

  const identifier = classItem.system?.identifier ?? "";
  const profile = QUICK_BUILD[identifier] ?? {};
  const provider = new QuickClimbProvider(profile, source);
  await provider.warm(classItem);

  // Reported back so a caller can say *why* a climb produced no subclass: "the profile named one
  // and nothing raised the decision" and "no subclass was resolvable at all" look identical on the
  // finished character and have completely different causes.
  const diagnostics = { subclassUuid: provider.subclass(), subclassSteps: 0 };

  let reached = from;
  for ( let level = from + 1; level <= target; level++ ) {
    try {
      const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
      const manager = AdvancementManager.forLevelChange(actor, classItem.id, 1);
      // Flagged as ours so the takeover hook cannot claim it if another module forces a render —
      // the same guard the Class step's hand-built manager carries.
      manager._sogromLevelUp = true;
      if ( !LevelUpDriver.canDrive(manager) ) {
        log(`quick climb: level ${level} raised a step the driver cannot drive; stopping here`);
        break;
      }

      const driver = new LevelUpDriver(manager);
      await driver.prepare();
      diagnostics.subclassSteps += (driver.subclassSteps ?? []).length;
      // Warm, resolve, warm, resolve. Choosing a subclass folds its own features into the walk, so
      // the second pass answers decisions that did not exist during the first. `autoResolve` is
      // idempotent over decisions it has already handled, and re-warming skips records already in
      // the memo, so the second pair costs nothing when a level synthesises nothing.
      await provider.warmDecisions(driver);
      await driver.autoResolve(provider);
      await provider.warmDecisions(driver);
      await driver.autoResolve(provider);
      await driver.commit();

      // What the level-up shell's Apply does after the driver commits, and the driver does not do
      // for itself: collapse a spell this level granted always-prepared that the character already
      // had. Any path that drives the driver without the shell has to mirror it.
      await reconcileGrantedSpells(actor);
      await learnSpells(actor, classItem, profile, spells);
      reached = level;
    } catch ( err ) {
      log(`quick climb: level ${level} failed; leaving the character at ${reached}`, err);
      break;
    }
  }

  return { reached, levels: reached - from, ...diagnostics };
}
