import { log, levelUpHpRollToChat } from "../config.mjs";
import { phbWeaponIcon } from "../data/weapon-source.mjs";

/**
 * Drives a native dnd5e {@link AdvancementManager} from the outside.
 *
 * The system's manager keeps its whole pipeline private (`#forward`, `#synthesizeSteps`,
 * `#complete`), and its `render()` aborts the moment our `preAdvancementManagerRender` hook
 * returns `false` — so we cannot ask it to step for us. Instead we take the manager it has
 * already built (which holds the `actor`, an in-memory `clone`, and a fully-enumerated
 * `steps` array) and re-run the relevant pieces of that pipeline ourselves against the clone.
 *
 * The real actor is never touched until {@link commit}; everything happens on the clone, so a
 * cancelled level-up rolls back for free by simply discarding this driver.
 *
 * Phase 1 supports level-ups whose only player decision is hit points: every other gained
 * advancement (granted features, scale values, fixed traits/size) applies automatically. The
 * synchronous {@link canDrive} gate ensures we only claim such level-ups; anything carrying an
 * ASI, subclass, or feature/trait *choice* is left to the native flow for now.
 *
 * ── For a junior dev: how to read this ~900-line file ──
 * The system's AdvancementManager is a state machine with a private `steps` array and a private
 * cursor. Normally it renders a wizard and walks itself. We can't call its private walk, so we
 * re-implement the walk here against its `clone` (a throwaway copy of the actor). Roughly:
 *   canDrive / isStepSupported  – the GATE: can we handle this whole level-up? If not, bail out.
 *   prepare()                    – WALK every step: auto-apply the ones with no choice, and collect
 *                                  the ones that DO need a choice into the decision arrays (hpSteps,
 *                                  asiSteps, choiceSteps, traitSteps, subclassSteps, grantSteps).
 *   the apply/reverse helpers    – when the player picks in the UI, apply it to the clone (reversible).
 *   commit()                     – write the finished clone onto the real actor.
 * "Synthesis" = choosing something (a subclass, a feat) can spawn NEW advancement steps mid-walk;
 * the code below detects those new items and folds their decisions in. Read prepare() first, then
 * follow one advancement type (e.g. HitPoints) through record -> apply -> commit to see the pattern.
 */
export class LevelUpDriver {

  /** @type {AdvancementManager} The native manager we are wrapping. */
  manager;
  /** @type {Actor5e} The real actor; only written to by {@link commit}. */
  actor;
  /** @type {Actor5e} The manager's in-memory working clone. */
  clone;
  /** @type {object[]} The manager's step array (we mutate it as the native code would). */
  steps;
  /** Our own cursor into {@link steps}, mirroring the manager's private `#stepIndex`. */
  index = 0;

  /**
   * The hit-point decisions surfaced to the wizard, one per gained level:
   * `{ level, screenLevel, advancement, item, average, hitDie, value }`. `value` is the current
   * pick ("avg" | "max" | <rolled number>), already applied to the clone.
   *
   * Every decision array below also carries `screenLevel`: the character level on whose screen the
   * decision appears (the registry groups decisions by it for the one-screen-per-level UI). It is
   * usually the decision's own `level`, but a feat's synthesised sub-choices come off level-0 flows
   * and inherit the granting ASI's level instead, so they land on the right screen.
   */
  hpSteps = [];

  /**
   * The feature decisions surfaced to the wizard, one per `ItemChoice` advancement gained this
   * level: `{ level, advancement, item }`. Unlike hit points these are left unselected until the
   * player picks in the UI, which applies straight to the clone via the advancement's own apply.
   */
  choiceSteps = [];

  /**
   * The ability-score-improvement decisions, one per `AbilityScoreImprovement` advancement gained
   * this level: `{ level, advancement, item }`. Defaulted to the "improve abilities" mode so the
   * distribution UI is ready; the player may switch to a feat.
   */
  asiSteps = [];

  /**
   * The trait decisions, one per choice-bearing `Trait` advancement gained this level (Weapon
   * Mastery being the common one): `{ level, advancement, item }`. Like feature choices these are
   * left unpicked until the player selects in the UI, which applies straight to the clone via the
   * advancement's own apply/reverse. Pure-grant traits (no choice) apply automatically instead.
   */
  traitSteps = [];

  /**
   * The subclass decisions, one per `Subclass` advancement gained this level:
   * `{ level, classLevel, advancement, item, featSynth }`. Choosing the subclass adds its item and
   * synthesises its features into the other decision arrays; `featSynth` tracks what was added so
   * the choice can be cleanly reversed. See {@link resolveSubclass}.
   */
  subclassSteps = [];

  /**
   * The spell-grant decisions, one per `ItemGrant` advancement that grants a spell with a choosable
   * casting ability (a species lineage's Int/Wis/Cha spell, granted at a class level):
   * `{ level, screenLevel, advancement, item }`. The spell is granted to the clone immediately with a
   * sensible default ability so the clone stays valid; the wizard surfaces the ability picker, and
   * changing it re-points the granted spell's ability via {@link applyGrantAbility}. Plain grants
   * (no ability choice) apply automatically instead and never appear here.
   */
  grantSteps = [];

  /** Snapshot of the clone's items before a step, used to detect synthesised additions. */
  #preItems = null;

  constructor(manager) {
    this.manager = manager;
    this.actor = manager.actor;
    this.clone = manager.clone;
    this.steps = manager.steps;
  }

  /** The static AdvancementManager class, for its `flowsForLevel` helper. */
  get #AdvancementManager() {
    return this.manager.constructor;
  }

  /** The step currently at the cursor (mirrors `manager.step`). */
  get #step() {
    return this.steps[this.index] ?? null;
  }

  /* -------------------------------------------- */
  /*  Claim gate                                  */
  /* -------------------------------------------- */

  /**
   * Synchronous test of whether this driver can fully own a manager — used by the intercept
   * to decide whether to suppress the native UI. Conservative by design: it claims only
   * genuine level-*increases* of an existing class whose every renderable step is hit points.
   * A step that might need a choice we don't yet re-skin (ASI, subclass, feature/trait choice)
   * makes the whole level-up ineligible, so it falls through to the native manager untouched.
   * @param {AdvancementManager} manager
   * @returns {boolean}
   */
  static canDrive(manager) {
    const steps = manager?.steps ?? [];
    if ( !steps.length ) return false;

    // Reversals mean a level-*down* or a choice-modify/delete flow — never our concern.
    if ( steps.some(s => s.type === "reverse" || s.type === "delete") ) return false;

    // The level-up must raise an existing class (the class item is already on the real actor).
    // A brand-new class drop (multiclassing) is Phase 5; leave it to the native flow.
    const classItem = steps.find(s => s.class)?.class?.item;
    if ( !classItem || !manager.actor?.items?.get(classItem.id) ) return false;

    const actorLevel = manager.actor.system?.details?.level ?? 0;
    const raisesLevel = steps.some(s => s.type === "forward" && s.class && (s.level ?? 0) > actorLevel);
    if ( !raisesLevel ) return false;

    // Every renderable step must be one we can present. `automatic` steps and structurally
    // forced advancements need no input; anything else (ASI, ItemChoice, Subclass, a real
    // Trait/Size/ItemGrant choice) blocks the claim.
    return steps.every(s => s.automatic || this.isStepSupported(s));
  }

  /**
   * Whether a single step is supported without user choice beyond hit points. Mirrors each
   * advancement type's `automaticApplicationValue` structurally (so it stays in step with the
   * driver's async classification) and treats hit points as the one renderable type we own.
   */
  static isStepSupported(step) {
    const adv = step.flow?.advancement;
    if ( !adv ) return true;                       // marker steps with no flow are inert
    switch ( adv.type ) {
      case "HitPoints":  return true;              // the hit-point decision the wizard presents
      case "ItemChoice": return true;              // a feature/spell choice the wizard presents
      case "AbilityScoreImprovement": return true; // the ASI / feat decision the wizard presents
      case "Subclass":   return true;              // the subclass pick the wizard presents
      case "ScaleValue": return true;              // always automatic
      case "Size":       return (adv.configuration?.sizes?.size ?? 0) <= 1;
      case "Trait":      return true;              // grants apply automatically; choices the wizard presents
      // Plain grants apply automatically; a spell grant with a choosable casting ability (a species
      // lineage's Int/Wis/Cha spell at a class level) is presented as the ability picker. Only a
      // truly *optional* grant (skippable config or optional items) is still beyond us.
      case "ItemGrant":  return !(adv.configuration?.optional
        || Array.from(adv.configuration?.items ?? []).some(i => i?.optional));
      default:           return false;             // (no renderable types left)
    }
  }

  /* -------------------------------------------- */
  /*  Pipeline                                    */
  /* -------------------------------------------- */

  /**
   * Walk every step the manager enumerated, applying the automatic ones to the clone and
   * recording the hit-point decisions for the wizard (each seeded with its average so the
   * clone is always valid). Replicates the manager's private forward loop, including the
   * mid-flight step synthesis that granted items with their own advancements trigger.
   */
  async prepare() {
    while ( this.#step ) {
      await this.#processStep(this.#step);
    }
    return this.hpSteps;
  }

  /** Process the step at the cursor, then advance — mirrors one iteration of `#forward`. */
  async #processStep(step) {
    const flow = step.flow;
    const type = step.type;
    this.#preItems ??= Array.from(this.clone.items);

    if ( type === "delete" && step.item ) {
      this.clone.items.delete(step.item.id);
    } else if ( type === "delete" && step.advancement ) {
      step.advancement.item.deleteAdvancement(step.advancement.id, { source: true });
    } else if ( type === "restore" ) {
      await flow.advancement.restore(flow.level, flow.retainedData);
    } else if ( type === "reverse" ) {
      await flow.retainData(await flow.advancement.reverse(flow.level));
    } else if ( flow ) {
      await this.#ingestFlow(flow, step);
    }

    delete step.error;
    this.#synthesizeSteps();
    this.#preItems = null;
    this.index++;

    // Keep the class item's level in step with the next step, exactly as the manager does.
    if ( this.#step?.class ) {
      let level = this.#step.class.level;
      if ( this.#step.type === "reverse" ) level -= 1;
      this.#step.class.item.updateSource({ "system.levels": level });
    }
    this.clone.reset();
  }

  /**
   * Classify and process one forward flow: apply the automatic advancements straight to the clone,
   * and record the renderable ones (hit points, feature/spell choices, ASI, subclass) as decisions
   * for the wizard. Shared by the main walk and the subclass synthesis so both stay consistent.
   * @param {AdvancementFlow} flow
   * @param {object} [step]   The owning step, when called from the main walk (carries class level).
   */
  async #ingestFlow(flow, step) {
    const adv = flow.advancement;
    switch ( adv?.type ) {
      case "HitPoints":
        // Always a player decision, even on a multi-level jump — the native flow would silently
        // inherit a prior "avg" choice, but we want every gained level's hit points chosen here.
        return this.#recordHitPoints(flow);
      case "ItemChoice":
        // Record the decision but leave it unselected; the wizard applies the picks later.
        this.choiceSteps.push({ level: flow.level, screenLevel: flow.level, advancement: adv, item: adv.item });
        return;
      case "AbilityScoreImprovement": {
        // A class ASI (points to spend) is a player decision; a feat's *fixed* increase (a
        // half-feat's set +1) has no choice and must just apply, or the bonus is silently lost.
        const cfg = adv.configuration ?? {};
        const fixed = cfg.fixed ?? {};
        const hasFixed = Object.values(fixed).some(v => v);
        const data = hasFixed ? { type: "asi", assignments: { ...fixed } } : { type: "asi" };
        if ( (cfg.points ?? 0) > 0 ) {
          // Real points to distribute — surface the decision (its fixed part is pre-applied).
          this.asiSteps.push({ level: flow.level, screenLevel: flow.level, advancement: adv, item: adv.item });
        }
        return adv.apply(flow.level, data);
      }
      case "Trait": {
        // A real choice (Weapon Mastery, a "choose a language", …) is surfaced for the player;
        // a pure grant (one forced option) applies straight away via its automatic value.
        const auto = await flow.getAutomaticApplicationValue();
        if ( auto !== false ) return adv.apply(flow.level, auto, { automatic: true });
        this.traitSteps.push({ level: flow.level, screenLevel: flow.level, advancement: adv, item: adv.item });
        return;
      }
      case "Subclass":
        // Record only; choosing the subclass (in the UI) adds its item and synthesises its
        // features via {@link resolveSubclass}.
        this.subclassSteps.push({
          level: flow.level, screenLevel: flow.level, classLevel: step?.class?.level ?? flow.level,
          advancement: adv, item: adv.item, featSynth: null
        });
        return;
      case "ItemGrant": {
        // A plain grant applies automatically; a spell grant that lets the player choose its casting
        // ability (a species lineage spell at a class level) is granted now with a default ability —
        // so the clone stays valid — and surfaced as the ability picker.
        const auto = await flow.getAutomaticApplicationValue();
        if ( auto !== false ) return adv.apply(flow.level, auto, { automatic: true });
        if ( this.#isAbilityGrant(adv) ) {
          this.grantSteps.push({ level: flow.level, screenLevel: flow.level, advancement: adv, item: adv.item });
          return adv.apply(flow.level, { ability: this.#defaultGrantAbility(adv), selected: this.#grantUuids(adv) });
        }
        // An optional grant we don't re-skin; canDrive() would have rejected the level-up.
        log("skipping unsupported optional ItemGrant", adv?.id);
        return;
      }
      default: {
        const auto = await flow.getAutomaticApplicationValue();
        if ( auto !== false ) return adv.apply(flow.level, auto, { automatic: true });
        // Should be unreachable on the main walk: canDrive() rejects unsupported renderable steps.
        // Reachable for a subclass feature we don't yet re-skin — skip it rather than break.
        log("skipping unsupported renderable advancement", adv?.type);
      }
    }
  }

  /** Seed a hit-point decision with its average and apply it so the clone stays valid. */
  #recordHitPoints(flow) {
    const adv = flow.advancement;
    const record = {
      level: flow.level,
      screenLevel: flow.level,
      advancement: adv,
      item: adv.item,
      average: adv.average,
      hitDie: adv.hitDie,
      value: "avg",
      // Which control the value came from: "avg" | "roll" | "manual". Drives the UI highlight.
      mode: "avg"
    };
    this.hpSteps.push(record);
    // apply() reverses any prior value first, so re-applying on every change is safe.
    return adv.apply(flow.level, { [flow.level]: "avg" });
  }

  /**
   * Re-apply a hit-point decision to the clone after the player changes it.
   * @param {object} record   One of {@link hpSteps}.
   * @param {"avg"|"max"|number} value
   * @param {"avg"|"roll"|"manual"} [mode]   How the value was chosen (defaults from the value).
   */
  async applyHitPoints(record, value, mode = value === "avg" ? "avg" : "manual") {
    record.value = value;
    record.mode = mode;
    await record.advancement.apply(record.level, { [record.level]: value });
    this.clone.reset();
  }

  /**
   * Roll this class's hit die on the clone and return the rolled total, leaving the decision
   * applied. Mirrors {@link HitPointsFlow}, but the chat card is the GM's call (the
   * `levelUpHpRollToChat` world setting): off by default so the wizard shows the result inline
   * without mid-flow chat noise, on when the table wants the roll visible to everyone.
   * @param {object} record   One of {@link hpSteps}.
   * @returns {Promise<number>}
   */
  async rollHitPoints(record) {
    const toChat = levelUpHpRollToChat();
    const roll = await this.clone.rollClassHitPoints(record.item, { chatMessage: toChat });
    // Without a chat card, show the Dice So Nice 3D animation (if installed) ourselves; with one,
    // Dice So Nice already animates the message's roll. Awaiting lets the dice settle before the
    // value updates on screen.
    if ( roll && game.dice3d && !toChat ) {
      try { await game.dice3d.showForRoll(roll, game.user, true); } catch ( err ) { log("dice animation failed", err); }
    }
    const total = roll?.total ?? record.average;
    await this.applyHitPoints(record, total, "roll");
    return total;
  }

  /* -------------------------------------------- */
  /*  Feature choices (ItemChoice)                */
  /* -------------------------------------------- */

  /**
   * Current selection state of an {@link choiceSteps} decision, mirroring the native
   * ItemChoiceFlow: how many of how many are chosen, which pool UUIDs are picked, and (when the
   * level allows it) which earlier pick is currently marked for replacement.
   * @param {object} record   One of {@link choiceSteps}.
   * @returns {{ current: number, max: number, full: boolean, selected: Set<string>,
   *            replaceable: boolean, replacing: string|null, priorEntries: {id: string, uuid: string}[] }}
   */
  choiceState(record) {
    const adv = record.advancement;
    const level = record.level;
    const { current, max, full } = adv.getCounts(level);
    const added = adv.value.added?.[level] ?? {};

    // Originals swapped out at an *earlier* level-up are still listed in `value.added` (dnd5e keeps
    // them, tracked via `value.replaced`), but their items were removed — so they must not reappear
    // as pickable "owned" choices. We keep the one being replaced *this* level so it can be unticked.
    const replacedElsewhere = new Set();
    for ( const [rl, r] of Object.entries(adv.value.replaced ?? {}) ) {
      if ( (Number(rl) !== level) && r?.original ) replacedElsewhere.add(r.original);
    }

    // Earlier-level picks of this same advancement — candidates the player may swap out.
    const priorEntries = [];
    for ( const [lvl, map] of Object.entries(adv.value.added ?? {}) ) {
      if ( Number(lvl) >= level ) continue;
      for ( const [id, uuid] of Object.entries(map ?? {}) ) {
        if ( !replacedElsewhere.has(id) ) priorEntries.push({ id, uuid });
      }
    }

    return {
      current, max, full,
      selected: new Set(Object.values(added)),
      replaceable: !!adv.configuration?.choices?.[level]?.replacement,
      replacing: adv.value.replaced?.[level]?.original ?? null,
      priorEntries
    };
  }

  /**
   * Add or remove one item from a feature choice, applied straight to the clone via the
   * advancement's own apply/reverse (which create or delete the granted item). Selecting beyond
   * the limit is ignored, matching the native flow.
   * @param {object} record   One of {@link choiceSteps}.
   * @param {string} uuid     Source UUID of the pool item being toggled.
   */
  async toggleChoice(record, uuid) {
    const { selected, full } = this.choiceState(record);
    if ( selected.has(uuid) ) await record.advancement.reverse(record.level, { uuid });
    else if ( !full ) await record.advancement.apply(record.level, { selected: [uuid] });
    this.clone.reset();
  }

  /**
   * Mark (or unmark) an earlier pick for replacement. Marking it removes that item from the clone
   * and frees a slot so the player can choose a different option; clicking the marked one again —
   * or another — clears the previous mark first. The system recreates a cleared item from its
   * recorded source UUID, so nothing needs caching here.
   * @param {object} record       One of {@link choiceSteps}.
   * @param {string} originalId    Embedded id of the earlier pick being toggled.
   */
  async toggleReplacement(record, originalId) {
    const adv = record.advancement;
    const level = record.level;
    const { replacing } = this.choiceState(record);

    if ( replacing ) {
      // Drop any pick made to fill the freed slot before restoring the original, so we never keep
      // both. The first `count` entries are the level's own grants; anything beyond is the swap-in.
      const baseCount = adv.configuration?.choices?.[level]?.count ?? 0;
      for ( const uuid of Object.values(adv.value.added?.[level] ?? {}).slice(baseCount) ) {
        await adv.reverse(level, { uuid });
      }
      await adv.reverse(level, { clearReplacement: true });
    }
    // Clicking the already-marked item just clears it; clicking a different one marks that instead.
    if ( replacing !== originalId ) await adv.apply(level, { replace: originalId });
    this.clone.reset();
  }

  /* -------------------------------------------- */
  /*  Trait choices (Weapon Mastery, languages…)  */
  /* -------------------------------------------- */

  /**
   * Current selection state of a {@link traitSteps} decision: how many of how many keys are picked
   * and whether the quota is filled. Mirrors the native TraitFlow's slot count (grants + the sum of
   * each choice's `count`), reading the running picks off the advancement's own `value.chosen`.
   * @param {object} record   One of {@link traitSteps}.
   * @returns {{ chosen: Set<string>, current: number, max: number, full: boolean }}
   */
  traitState(record) {
    const adv = record.advancement;
    const chosen = new Set(adv.value.chosen ?? []);
    const max = adv.maxTraits;
    return { chosen, current: chosen.size, max, full: chosen.size >= max };
  }

  /**
   * The full option list for a trait decision. Shows the whole pool this advancement draws from
   * (intersected with the mode's eligibility — for mastery, weapons the character is proficient
   * with), so keys taken at an earlier level appear too: those are flagged `owned` and locked
   * (selected, not toggleable, like the fighting-style screen shows the current pick), this
   * advancement's own picks are toggleable, and the rest disable once the quota is full.
   *
   * The mastered/eligible split comes from the system's {@link actorSelected} (reading the clone),
   * so the mode rules are the system's, not ours; we only scope it to this advancement's pool.
   * Each option also carries its category (`groupKey`/`groupLabel` — e.g. Simple vs Martial Weapons)
   * so the step can group them under headers.
   * @param {object} record   One of {@link traitSteps}.
   * @returns {Promise<{ key: string, label: string, img: string|null, selected: boolean, owned: boolean,
   *                     disabled: boolean, groupKey: string, groupLabel: string }[]>}
   */
  async traitOptions(record) {
    const adv = record.advancement;
    const Trait = dnd5e.documents.Trait;
    const { chosen, full } = this.traitState(record);

    // This advancement's pool (its grants + every choice pool), expanded to concrete prefixed keys.
    const poolKeys = new Set(adv.configuration.grants ?? []);
    for ( const c of adv.configuration.choices ?? [] ) for ( const k of c.pool ) poolKeys.add(k);
    const expanded = (await Trait.mixedChoices(poolKeys)).asSet();

    // `selected` = keys already taken on the clone (this advancement's picks plus any from earlier
    // levels); `available` = eligible but not yet taken. Scope both to this advancement's pool.
    const { selected, available } = await adv.actorSelected();
    const keys = new Set([...selected, ...available, ...chosen].filter(k => expanded.has(k)));

    // Keys are prefixed (e.g. "weapon:mar:longsword"), so keyLabel/keyIcon derive the trait type,
    // and the prefix-minus-leaf ("weapon:mar") labels the category the option belongs to. For weapon
    // picks (Weapon Mastery) we prefer the Player's Handbook item art when that pack is active,
    // matching the creator's grids, and fall back to the system's generic icon otherwise.
    const options = await Promise.all([...keys].map(async key => {
      const isChosen = chosen.has(key);
      const owned = !isChosen && selected.has(key);   // taken earlier — shown selected but locked
      const parts = key.split(":");
      const groupKey = parts.length > 2 ? parts.slice(0, -1).join(":") : parts[0];
      return {
        key,
        label: Trait.keyLabel(key),
        img: (await phbWeaponIcon(key)) ?? Trait.keyIcon(key),
        selected: isChosen || owned,
        owned,
        disabled: owned || (!isChosen && full),
        groupKey,
        groupLabel: Trait.keyLabel(groupKey)
      };
    }));
    options.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    return options;
  }

  /**
   * Add or remove one trait key, applied straight to the clone via the advancement's own
   * apply/reverse (which write the proficiency/mastery onto the actor). Selecting beyond the quota
   * is ignored; unselecting a pick frees a slot, which is also how the player swaps a choice.
   * @param {object} record   One of {@link traitSteps}.
   * @param {string} key      The trait key being toggled.
   */
  async toggleTrait(record, key) {
    const adv = record.advancement;
    const { chosen, full } = this.traitState(record);
    if ( chosen.has(key) ) await adv.reverse(record.level, { key });
    else if ( !full ) await adv.apply(record.level, { key });
    this.clone.reset();
  }

  /* -------------------------------------------- */
  /*  Spell grants with a choosable ability       */
  /* -------------------------------------------- */

  /** The source UUIDs an ItemGrant grants. */
  #grantUuids(adv) {
    return Array.from(adv.configuration?.items ?? []).map(i => (typeof i === "string") ? i : i?.uuid).filter(Boolean);
  }

  /**
   * Whether an ItemGrant is non-automatic *only* because it lets the player choose the casting
   * ability for a granted spell — the case the wizard re-skins. A grant that is optional, or has
   * optional items, is excluded (canDrive() leaves those to the native flow).
   */
  #isAbilityGrant(adv) {
    const cfg = adv.configuration ?? {};
    if ( cfg.optional || Array.from(cfg.items ?? []).some(i => i?.optional) ) return false;
    return (cfg.spell?.ability?.size ?? 0) > 1;
  }

  /**
   * The ability to seed a spell grant with. Reuses an ability already chosen for a sibling grant on
   * the same item — a species lineage picks one ability at level 1 and reuses it for its later
   * spells — reading it from the sibling's recorded value or, failing that, the spell it granted on
   * the clone; otherwise falls back to the first allowed ability (matching the native default).
   */
  #defaultGrantAbility(adv) {
    const abilities = Array.from(adv.configuration?.spell?.ability ?? []);
    for ( const sib of Object.values(adv.item?.advancement?.byId ?? {}) ) {
      if ( sib === adv ) continue;
      if ( sib.value?.ability && abilities.includes(sib.value.ability) ) return sib.value.ability;
      for ( const id of Object.keys(sib.value?.added ?? {}) ) {
        const ability = this.clone.items.get(id)?.system?.ability;
        if ( ability && abilities.includes(ability) ) return ability;
      }
    }
    return adv.value?.ability ?? abilities[0] ?? null;
  }

  /**
   * Current state of a {@link grantSteps} decision: the chosen casting ability, the allowed
   * abilities, and the granted spell(s) read off the clone (so Review and the picker agree).
   * @param {object} record   One of {@link grantSteps}.
   * @returns {{ ability: string|null, abilities: string[], spells: {name: string, img: string, uuid: string}[] }}
   */
  grantState(record) {
    const adv = record.advancement;
    const spells = Object.keys(adv.value?.added ?? {}).reduce((arr, id) => {
      const item = this.clone.items.get(id);
      if ( item ) arr.push({ name: item.name, img: item.img, uuid: item._stats?.compendiumSource ?? item.uuid });
      return arr;
    }, []);
    return { ability: adv.value?.ability ?? null, abilities: Array.from(adv.configuration?.spell?.ability ?? []), spells };
  }

  /**
   * Re-point a granted spell to a different casting ability. The native apply updates the
   * already-created spell items in place when handed a new ability, so the spell is not re-granted;
   * passing `selected` again is harmless (existing items are skipped).
   * @param {object} record   One of {@link grantSteps}.
   * @param {string} ability  One of the allowed ability keys.
   */
  async applyGrantAbility(record, ability) {
    const adv = record.advancement;
    if ( !adv.configuration?.spell?.ability?.has?.(ability) ) return;
    await adv.apply(record.level, { ability, selected: this.#grantUuids(adv) });
    this.clone.reset();
  }

  /* -------------------------------------------- */
  /*  Ability Score Improvement / feat            */
  /* -------------------------------------------- */

  /**
   * Current state of an {@link asiSteps} decision: the chosen mode, the point budget and what is
   * spent, the per-ability rows (with current score, this-ASI delta, and whether +/- is allowed),
   * and the chosen feat if any. Mirrors the native AbilityScoreImprovementFlow.
   * @param {object} record   One of {@link asiSteps}.
   */
  asiState(record) {
    const adv = record.advancement;
    const cfg = adv.configuration;
    const value = adv.value;
    const total = cfg.points ?? 0;
    const cap = cfg.cap ?? Infinity;
    const assignments = value.assignments ?? {};
    const isLocked = key => !!cfg.locked?.has?.(key);
    const fixedFor = key => cfg.fixed?.[key] ?? 0;

    // Spent points exclude both fixed and locked abilities, mirroring the native flow.
    const assigned = Object.keys(CONFIG.DND5E.abilities).reduce((n, key) => {
      if ( !adv.canImprove(key) || isLocked(key) ) return n;
      return n + Math.max(0, (assignments[key] ?? 0) - fixedFor(key));
    }, 0);
    const available = total - assigned;

    const abilities = [];
    for ( const [key, data] of Object.entries(CONFIG.DND5E.abilities) ) {
      if ( !adv.canImprove(key) ) continue;
      const abil = this.clone.system.abilities[key];
      const sourceValue = this.clone.system._source.abilities[key]?.value ?? abil.value;
      const assignment = assignments[key] ?? 0;
      const fixed = fixedFor(key);
      const locked = isLocked(key);
      const initial = sourceValue - assignment;          // the score before this ASI touched it
      const abilityMax = Math.max(abil.max, cfg.max ?? -Infinity);
      const floor = Math.min(initial + fixed, abilityMax);
      const ceil = locked ? floor : Math.min(sourceValue + available, abilityMax);
      abilities.push({
        key,
        label: data.label,
        abbr: data.abbreviation ?? key.slice(0, 3).toUpperCase(),
        value: sourceValue,
        delta: assignment,
        locked,
        canIncrease: !locked && (sourceValue < ceil) && (assignment < cap),
        canDecrease: !locked && (sourceValue > floor)
      });
    }

    return { type: value.type ?? null, total, cap, assigned, available, abilities, feat: this.#asiFeat(adv), allowFeat: adv.allowFeat };
  }

  /** The chosen feat for an ASI decision, or null. */
  #asiFeat(adv) {
    const [id, uuid] = Object.entries(adv.value.feat ?? {})[0] ?? [];
    const item = this.clone.items.get(id);
    return item ? { id, uuid, name: item.name, img: item.img } : null;
  }

  /**
   * The six current ability scores as read-only rows (background-panel shape) — used to fill the
   * ability aside beside a chosen feat that carries no ability choice of its own, so the feat screen
   * still shows the stacked scores it doesn't change.
   * @returns {{key: string, label: string, total: number, bonusLabel: string, locked: boolean, canInc: boolean, canDec: boolean}[]}
   */
  currentAbilityRows() {
    return Object.entries(CONFIG.DND5E.abilities).map(([key, data]) => ({
      key,
      label: data.label,
      total: this.clone.system.abilities[key]?.value ?? 10,
      bonusLabel: "",
      locked: false,
      canInc: false,
      canDec: false
    }));
  }

  /**
   * Raise or lower one ability by a point. Re-applies the whole assignment from scratch
   * (reverse → apply) so the additive native apply stays idempotent across edits.
   * @param {object} record   One of {@link asiSteps}.
   * @param {string} key      Ability key.
   * @param {number} dir      +1 or -1.
   */
  async adjustAsi(record, key, dir) {
    const adv = record.advancement;
    const abil = this.asiState(record).abilities.find(a => a.key === key);
    if ( !abil || (dir > 0 && !abil.canIncrease) || (dir < 0 && !abil.canDecrease) ) return;

    const assignments = { ...(adv.value.assignments ?? {}) };
    assignments[key] = (assignments[key] ?? 0) + dir;
    if ( assignments[key] <= 0 ) delete assignments[key];

    await adv.reverse(record.level);
    await adv.apply(record.level, { type: "asi", assignments });
    this.clone.reset();
  }

  /** The clone's chosen feat item for an ASI decision, or null. */
  #asiFeatItem(adv) {
    const id = Object.keys(adv.value.feat ?? {})[0];
    return id ? this.clone.items.get(id) : null;
  }

  /** Switch an ASI decision back to the ability-improvement mode (clearing any chosen feat). */
  async useAsiAbilities(record) {
    const adv = record.advancement;
    if ( record.featSynth ) { await this.#reverseSynth(record.featSynth); record.featSynth = null; }
    if ( adv.value.type ) await adv.reverse(record.level);
    await adv.apply(record.level, { type: "asi" });
    this.clone.reset();
  }

  /**
   * Open the system's compendium browser to pick a feat for an ASI decision, then grant it and
   * fold in the feat's *own* advancements — so a half-feat's fixed ability bonus actually applies,
   * granted features/proficiencies land, and any sub-choice surfaces as a further decision.
   * @param {object} record   One of {@link asiSteps}.
   * @returns {Promise<boolean>}  Whether a feat was chosen.
   */
  async chooseAsiFeat(record) {
    const browser = dnd5e.applications?.CompendiumBrowser;
    if ( !browser ) return false;
    const level = this.clone.system.details.level ?? 0;
    const filters = { locked: {
      additional: { category: { feat: 1 } },
      arbitrary: [{ k: "system.prerequisites.level", o: "lte", v: level }],
      types: new Set(["feat"])
    } };

    const uuid = await browser.selectOne({ filters, tab: "feats" }).catch(() => null);
    if ( !uuid ) return false;
    const item = await fromUuid(uuid).catch(() => null);
    if ( !item ) return false;
    if ( item.system.validatePrerequisites?.(this.clone, { showMessage: true }) !== true ) return false;

    // Drop any previous feat's synthesised features, then the ASI value itself, before re-granting.
    if ( record.featSynth ) { await this.#reverseSynth(record.featSynth); record.featSynth = null; }
    if ( record.advancement.value.type ) await record.advancement.reverse(record.level);
    await record.advancement.apply(record.level, { type: "feat", uuid });
    this.clone.reset();

    // Run the feat's own advancements (fixed ASI bonus, granted features, sub-choices).
    const featItem = this.#asiFeatItem(record.advancement);
    if ( featItem ) {
      record.featSynth = await this.#ingestItemFeatures(featItem, 0);
      // The feat's own advancements come off level-0 flows; surface any choices they reveal on the
      // same screen as the granting ASI rather than a phantom "level 0" screen.
      for ( const r of [...record.featSynth.choices, ...record.featSynth.asi, ...record.featSynth.traits, ...record.featSynth.grants] ) {
        r.screenLevel = record.level;
      }
    }
    this.clone.reset();
    return true;
  }

  /* -------------------------------------------- */
  /*  Synthesised sub-features (subclass / feat)  */
  /* -------------------------------------------- */

  /**
   * Fold an item's own advancements into the clone: enumerate its flows up to `maxLevel` and ingest
   * each (auto-apply the automatic ones, surface any renderable ones as new decisions). Returns the
   * flows it ran and the decision records it added, so the caller can reverse them cleanly later.
   * @param {Item5e} item
   * @param {number} maxLevel
   * @returns {Promise<{flows: object[], choices: object[], asi: object[], traits: object[]}>}
   */
  async #ingestItemFeatures(item, maxLevel) {
    const beforeChoices = this.choiceSteps.length;
    const beforeAsi = this.asiSteps.length;
    const beforeTraits = this.traitSteps.length;
    const beforeGrants = this.grantSteps.length;
    const flows = [];
    for ( let l = 0; l <= maxLevel; l++ ) {
      for ( const flow of this.#AdvancementManager.flowsForLevel(item, l) ) {
        flows.push(flow);
        await this.#ingestFlow(flow);
      }
    }
    return {
      flows,
      choices: this.choiceSteps.slice(beforeChoices),
      asi: this.asiSteps.slice(beforeAsi),
      traits: this.traitSteps.slice(beforeTraits),
      grants: this.grantSteps.slice(beforeGrants)
    };
  }

  /**
   * Reverse what {@link #ingestItemFeatures} applied: undo each synthesised advancement and drop the
   * decisions it added. Best-effort — reversing a flow the player never touched is a no-op.
   * @param {{flows: object[], choices: object[], asi: object[], traits: object[], grants: object[]}} synth
   */
  async #reverseSynth(synth) {
    if ( !synth ) return;
    for ( const flow of [...(synth.flows ?? [])].reverse() ) {
      try { await flow.advancement.reverse(flow.level); } catch ( err ) { log("synth feature reverse failed", err); }
    }
    if ( synth.choices?.length ) this.choiceSteps = this.choiceSteps.filter(c => !synth.choices.includes(c));
    if ( synth.asi?.length ) this.asiSteps = this.asiSteps.filter(a => !synth.asi.includes(a));
    if ( synth.traits?.length ) this.traitSteps = this.traitSteps.filter(tr => !synth.traits.includes(tr));
    if ( synth.grants?.length ) this.grantSteps = this.grantSteps.filter(g => !synth.grants.includes(g));
    this.clone.reset();
  }

  /* -------------------------------------------- */
  /*  Subclass                                    */
  /* -------------------------------------------- */

  /**
   * The clone's subclass item for a decision, or null. `value.document` is a LocalDocumentField,
   * so it resolves to the embedded Item directly; we fall back to the source id just in case.
   */
  #subclassDoc(record) {
    const val = record.advancement.value;
    let doc = val?.document ?? null;
    if ( typeof doc === "string" ) doc = this.clone.items.get(doc);
    if ( !doc && val?._source?.document ) doc = this.clone.items.get(val._source.document);
    return doc ?? null;
  }

  /** The chosen subclass for a decision, or null. */
  subclassState(record) {
    const doc = this.#subclassDoc(record);
    return {
      chosen: !!doc,
      name: doc?.name ?? "",
      img: doc?.img ?? "",
      uuid: record.advancement.value?.uuid ?? null
    };
  }

  /**
   * Select a subclass by UUID from the wizard's own picker (no compendium browser). Clicking the
   * already-selected subclass clears it; clicking a different one swaps it, reversing everything the
   * previous subclass brought in first.
   * @param {object} record   One of {@link subclassSteps}.
   * @param {string} uuid     Source UUID of the subclass.
   */
  async selectSubclass(record, uuid) {
    const current = record.advancement.value?.uuid ?? null;
    if ( current ) await this.clearSubclass(record);
    if ( current !== uuid ) await this.resolveSubclass(record, uuid);
  }

  /**
   * Grant the chosen subclass to the clone and fold its features in: enumerate the subclass's
   * advancement flows up to the current class level and ingest each (auto-apply the automatic ones,
   * surface any renderable ones as new decisions). Records what was synthesised on the step so it
   * can be reversed if the player changes their mind.
   * @param {object} record   One of {@link subclassSteps}.
   * @param {string} uuid     Source UUID of the subclass.
   */
  async resolveSubclass(record, uuid) {
    await record.advancement.apply(record.level, { uuid });
    // Reset so the freshly-added subclass item is fully prepared (its advancement.byLevel ready)
    // before we enumerate its flows.
    this.clone.reset();
    const subclassItem = this.#subclassDoc(record);
    if ( !subclassItem ) return;

    record.featSynth = await this.#ingestItemFeatures(subclassItem, record.classLevel);
    this.clone.reset();
  }

  /**
   * Undo a subclass choice: reverse its synthesised feature advancements, drop the decisions they
   * added, then reverse the subclass itself (removing its item). Best-effort — reversing a flow the
   * player never touched is a no-op.
   * @param {object} record   One of {@link subclassSteps}.
   */
  async clearSubclass(record) {
    if ( record.featSynth ) { await this.#reverseSynth(record.featSynth); record.featSynth = null; }
    try { await record.advancement.reverse(record.level); } catch ( err ) { log("subclass reverse failed", err); }
    this.clone.reset();
  }

  /* -------------------------------------------- */
  /*  Step synthesis (mirror of #synthesizeSteps) */
  /* -------------------------------------------- */

  /**
   * Add synthetic steps for items the just-applied step added that carry their own
   * advancement (e.g. a granted feature). Faithful port of the manager's private
   * `#synthesizeSteps`, restricted to additions — Phase 1 never reverses or deletes.
   */
  #synthesizeSteps() {
    const initialIds = this.steps.reduce((ids, step) => {
      if ( step.synthetic || !step.flow?.item ) return ids;
      ids.add(step.flow.item.id);
      return ids;
    }, new Set());

    const preIds = new Set(this.#preItems.map(i => i.id));
    const postIds = new Set(this.clone.items.map(i => i.id));
    const addedIds = postIds.difference(preIds).difference(initialIds);

    for ( const addedId of addedIds ) {
      const item = this.clone.items.get(addedId);
      if ( !item?.hasAdvancement ) continue;

      let handledLevel = 0;
      for ( let idx = this.index; idx < this.steps.length; idx++ ) {
        const getLevel = step => (item.system.advancementClassLinked ? undefined : step?.level)
          ?? step?.flow?.level ?? step?.class?.level ?? step?.level;
        const thisLevel = getLevel(this.steps[idx]);
        const nextLevel = getLevel(this.steps[idx + 1]);
        if ( (thisLevel < handledLevel) || (thisLevel >= nextLevel) ) continue;

        const steps = Array.fromRange(thisLevel - handledLevel + 1, handledLevel)
          .flatMap(l => this.#AdvancementManager.flowsForLevel(item, l, { findExisting: this.steps }))
          .map(flow => ({ type: "forward", flow, synthetic: true }));

        this.steps.splice(idx + 1, 0, ...steps);
        idx += steps.length;
        handledLevel = nextLevel ?? handledLevel;
      }
    }
  }

  /* -------------------------------------------- */
  /*  Commit (mirror of #complete)                */
  /* -------------------------------------------- */

  /**
   * Persist the driven clone onto the real actor — a port of the manager's private `#complete`:
   * diff the clone's items into create/update/delete sets and write everything with
   * `isAdvancement: true`, then fire the system's completion hook so other modules react exactly
   * as they would after a native level-up.
   *
   * Two deliberate departures from the native code, both for Apply speed:
   *  - The native manager re-writes *every* item the actor owns (`diff: false` over the full
   *    list), so applying scales with inventory size. Untouched items are byte-identical between
   *    the clone and the actor, so they are compared and skipped here — only what the level-up
   *    actually changed is written.
   *  - The four writes suppress their per-operation renders (each would re-render the open
   *    character sheet behind the wizard); the sheet is re-rendered once at the end instead.
   * @returns {Promise<Actor5e>}  The updated real actor.
   */
  async commit() {
    const updates = this.clone.toObject();
    const items = updates.items;
    delete updates.items;

    const { toCreate, toUpdate, toDelete } = items.reduce((obj, item) => {
      const existing = this.actor.items.get(item._id);
      if ( !existing ) obj.toCreate.push(item);
      else {
        if ( !foundry.utils.equals(existing.toObject(), item) ) obj.toUpdate.push(item);
        obj.toDelete.findSplice(id => id === item._id);
      }
      return obj;
    }, { toCreate: [], toUpdate: [], toDelete: this.actor.items.map(i => i.id) });

    if ( Hooks.call("dnd5e.preAdvancementManagerComplete", this.manager, updates, toCreate, toUpdate, toDelete) === false ) {
      log("level-up completion prevented by preAdvancementManagerComplete hook");
      return this.actor;
    }

    await Promise.all([
      this.actor.update(updates, { isAdvancement: true, render: false }),
      this.actor.createEmbeddedDocuments("Item", toCreate, { keepId: true, isAdvancement: true, render: false }),
      this.actor.updateEmbeddedDocuments("Item", toUpdate, { diff: false, recursive: false, isAdvancement: true, render: false }),
      this.actor.deleteEmbeddedDocuments("Item", toDelete, { isAdvancement: true, render: false })
    ]);

    Hooks.callAll("dnd5e.advancementManagerComplete", this.manager);
    // The one render the four suppressed ops deferred to: surface the new level on the sheet.
    if ( this.actor.sheet?.rendered ) this.actor.sheet.render();
    return this.actor;
  }
}
