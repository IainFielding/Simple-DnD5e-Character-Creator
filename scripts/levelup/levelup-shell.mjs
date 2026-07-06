import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { buildSteps } from "./registry.mjs";
import { getSources, isStale, invalidateSources } from "../data/source-cache.mjs";
import { forEachLimit, WARM_CONCURRENCY } from "../data/concurrency.mjs";
import { applyLevelUpSpells, spellChanges } from "./steps/lvl-spells-step.mjs";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The level-up window. Like the creator's shell it is deliberately thin — it owns navigation
 * and a single event dispatcher, delegating per-step data and behaviour to the step modules —
 * but it drives a {@link LevelUpDriver} (the wrapped native AdvancementManager) instead of the
 * creation state, and it commits the driver's clone rather than assembling a new actor.
 *
 * It shares the creator's rail/stage chrome by reusing those templates as its PARTS; §3.1 of
 * the plan extracts a common base mixin once a second shell exists, which is now.
 *
 * For a junior dev: this is the same ApplicationV2 pattern as creator-shell.mjs (see the big
 * teaching note there for DEFAULT_OPTIONS/PARTS/actions/_prepareContext). Two things are specific
 * to level-up:
 *   1. The step list is REBUILT every render (buildSteps), because choices reveal more choices —
 *      e.g. picking a subclass adds its feature steps. So the rail can grow between renders.
 *   2. Nothing touches the real actor until the single Apply on the review step: the level
 *      decisions live on the driver's clone, the spell picks are staged on the state, and
 *      {@link #applyLevelUp} writes both in one go before closing.
 */
export class LevelUpShell extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sogrom-levelup",
    classes: ["sogrom-creator"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      goto: LevelUpShell.#onGoto,
      navNext: LevelUpShell.#onNext,
      navBack: LevelUpShell.#onBack,
      stepAction: LevelUpShell.#onStepAction,
      finish: LevelUpShell.#onFinish,
      cancel: LevelUpShell.#onCancel
    }
  };

  static PARTS = {
    rail: { id: "rail", template: `modules/${MODULE_ID}/templates/rail.hbs` },
    stage: {
      id: "stage",
      template: `modules/${MODULE_ID}/templates/stage.hbs`,
      // Preserve scroll across re-renders for the body and the subclass picker's independently
      // scrolling list/detail columns (which reuse the creator's pick layout).
      scrollable: [".creator-stage-body", ".creator-picklist", ".creator-pick-desc"]
    }
  };

  /** @type {import("./levelup-state.mjs").LevelUpState} */
  state;
  /** @type {object[]} The per-session step set (built from the driver's surfaced decisions). */
  #steps;
  #current = 0;
  /** The shared compendium index (subclass picker, origin details) — see {@link getSources}. */
  #source;
  /** The shared spell source; the post-commit spell step's pool persists across windows. */
  #spells;

  constructor(state, options = {}) {
    super(options);
    this.state = state;
    this.#steps = buildSteps(state);
    // Reuse the world's shared, warm-once compendium caches (read-only — no session state): the
    // level-up benefits from the background warm at `ready`, and its own loads (the subclass
    // index, the spell pool) stay cached for the next level-up instead of dying with this window.
    // A changed enabled-source set means those caches no longer reflect the world; rebuild first.
    if ( isStale() ) invalidateSources();
    const { source, spells } = getSources();
    this.#source = source;
    this.#spells = spells;
    // Subclass decisions are fixed once the driver has prepared, so their data can start
    // loading immediately — long before the player scrolls down to the subclass block.
    this.#warmSubclasses();
  }

  /**
   * Start loading the subclass picker's data in the background while the player is still on the
   * earlier decisions: the world's subclass index, then the detail panel and feature groups of
   * this class's own subclasses. Fire-and-forget — everything lands in the shared source cache's
   * promise-memos, so the subclass block reads it back instantly (or joins the tail of this same
   * work). A single card's failure only costs that card its warmth.
   */
  async #warmSubclasses() {
    try {
      for ( const record of this.state.subclassSteps ) {
        const identifier = record.advancement?.item?.identifier;
        if ( !identifier ) continue;
        const cards = await this.#source.subclasses(identifier);
        await forEachLimit(cards, WARM_CONCURRENCY, async card => {
          try {
            await this.#source.detail(card.uuid);
            await this.#source.advancementGroups(card.uuid);
          } catch ( err ) {
            log(`failed to warm subclass ${card.uuid}`, err);
          }
        });
      }
    } catch ( err ) {
      log("subclass warm-up failed", err);
    }
  }

  get title() {
    return t("levelup.window.title", { name: this.state.actor?.name ?? "", level: this.state.toLevel });
  }

  get #activeStep() {
    return this.#steps[this.#current];
  }

  /** Steps that must be complete before the level-up may be applied (everything but review). */
  get #requiredSteps() {
    return this.#steps.filter(s => s.id !== "review");
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    // A level-up is a pipeline: choosing a subclass reveals its feature steps. Rebuild the step
    // set each render so the rail grows (or shrinks) with the decisions the driver has surfaced,
    // keeping the active index in range.
    this.#steps = buildSteps(this.state);
    this.#current = Math.min(this.#current, this.#steps.length - 1);
    const flags = this.#steps.map(s => s.isComplete(this.state));
    const step = this.#activeStep;
    const stepContext = await step.context(this.#ctx());

    return {
      loading: false,
      version: game.modules.get(MODULE_ID)?.version ?? "",
      cancelLabel: t("nav.cancel"),
      rail: this.#railContext(flags),
      step: {
        id: step.id,
        template: tpl(`${step.template}.hbs`),
        // Per-level steps carry a resolved label ("Level 4"); the review step uses its labelKey.
        label: step.label ?? t(step.labelKey),
        ...stepContext
      },
      // The finish button (Apply) replaces Next in the footer on the review step only.
      isReview: step.id === "review",
      nav: {
        index: this.#current,
        total: this.#steps.length,
        position: t("nav.position", { current: this.#current + 1, total: this.#steps.length }),
        canBack: this.#current > 0,
        canNext: this.#current < this.#steps.length - 1 && flags[this.#current]
          && this.#reachable(this.#current + 1, flags),
        backLabel: t("nav.back"),
        nextLabel: t("nav.next")
      },
      canFinish: this.#requiredSteps.every(s => s.isComplete(this.state)),
      finishLabel: t("levelup.nav.apply")
    };
  }

  #railContext(flags) {
    return this.#steps.map((s, i) => ({
      index: i,
      id: s.id,
      label: s.label ?? t(s.labelKey),
      icon: s.icon,
      ordinal: i + 1,
      active: i === this.#current,
      applicable: true,
      complete: flags[i] && s.id !== "review",
      reachable: this.#reachable(i, flags),
      summary: s.summary?.(this.state) ?? ""
    }));
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#warmSpellPool();
    for ( const el of this.element.querySelectorAll("[data-step-change]") ) {
      el.addEventListener("change", ev => this.#dispatch(el.dataset.stepChange, ev.currentTarget));
    }
    // Client-side spell-list filters on the spell step — search box plus the level/school
    // dropdowns. All filter in the DOM without a re-render, so the search field keeps focus
    // while typing; their values live on the state so the re-render a spell click causes
    // restores them (a rebuilt control would otherwise reset to "show everything").
    const filters = [
      [this.element.querySelector("[data-creator-search]"), "spellSearch", "input"],
      [this.element.querySelector("[data-spell-filter-level]"), "spellLevelFilter", "change"],
      [this.element.querySelector("[data-spell-filter-school]"), "spellSchoolFilter", "change"]
    ].filter(([el]) => el);
    for ( const [el, key, event] of filters ) {
      el.value = this.state[key];
      el.addEventListener(event, () => {
        this.state[key] = el.value;
        this.#applySpellFilters();
      });
    }
    if ( filters.length ) this.#applySpellFilters();
  }

  /**
   * Start loading the level-up spell pool in the background while the player is still making
   * level decisions, so reaching the post-commit spell step doesn't stall on the compendium
   * fetch. Fire-and-forget: the pool is memoised per class/level key inside {@link SpellSource}
   * (as an in-flight promise, so the spell step's own load joins this one rather than racing it),
   * which also makes re-running on every render free — and re-running matters, because the plan
   * can change mid-wizard: picking an Eldritch Knight-style subclass turns the class into a
   * caster only after that pick, and this warms the new key the render after it happens.
   */
  #warmSpellPool() {
    const plan = this.state.spellPlan();
    if ( !plan.isSpellcaster || !plan.hasDelta || !plan.castUuid ) return;
    this.#spells.forClassAtLevel(plan.castUuid, plan.maxSpellLevel, plan.listType)
      .catch(err => log("level-up spell pool warm-up failed", err));
  }

  /**
   * Hide pick-rows that don't match the active spell filters — the name search, spell level, and
   * spell school — combined (a row must satisfy all three to show). Each control reads its current
   * value straight from the DOM so any of them can drive the same pass. Mirrors the creator's list
   * filter, extended for the level-up spell browser's dropdowns.
   */
  #applySpellFilters() {
    const root = this.element;
    const needle = (root.querySelector("[data-creator-search]")?.value ?? "").trim().toLowerCase();
    const level = root.querySelector("[data-spell-filter-level]")?.value ?? "";
    const school = root.querySelector("[data-spell-filter-school]")?.value ?? "";
    for ( const row of root.querySelectorAll(".creator-pickrow") ) {
      const matchesName = !needle || (row.dataset.name ?? "").toLowerCase().includes(needle);
      const matchesLevel = !level || (row.dataset.level ?? "") === level;
      const matchesSchool = !school || (row.dataset.school ?? "") === school;
      const show = matchesName && matchesLevel && matchesSchool;
      (row.closest("li") ?? row).classList.toggle("is-hidden", !show);
    }
  }

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  /** A step is reachable once every step before it is complete. */
  #reachable(index, flags = this.#steps.map(s => s.isComplete(this.state))) {
    return index === 0 || flags.slice(0, index).every(Boolean);
  }

  #ctx() {
    return { state: this.state, driver: this.state.driver, source: this.#source, spells: this.#spells, app: this };
  }

  async #dispatch(action, el) {
    const step = this.#activeStep;
    const handled = step?.handle ? await step.handle(action, el, this.#ctx()) : undefined;
    if ( handled === false ) return;
    this.render();
  }

  static #onStepAction(event, target) {
    return this.#dispatch(target.dataset.stepAction, target);
  }

  static #onGoto(event, target) {
    const index = Number(target.dataset.index);
    if ( Number.isInteger(index) && this.#reachable(index) ) {
      this.#current = index;
      this.render();
    }
  }

  static #onNext() {
    const next = this.#current + 1;
    if ( next < this.#steps.length && this.#reachable(next) && this.#activeStep.isComplete(this.state) ) {
      this.#current = next;
      this.render();
    }
  }

  static #onBack() {
    if ( this.#current > 0 ) {
      this.#current -= 1;
      this.render();
    }
  }

  static async #onFinish() {
    return this.#applyLevelUp();
  }

  /** Re-entrancy guard: a second Apply click while the first is writing must be a no-op. */
  #applying = false;

  /**
   * Apply the whole level-up in one go: commit the driver's clone (the level decisions), then
   * write the staged spell picks and any swap onto the freshly-updated actor, then close. The
   * spell picks are staged on the state by the pre-review spell step, so a single Apply covers
   * everything the review screen showed. A commit failure leaves the actor untouched and the
   * window open for a retry; a spell failure after a successful commit keeps the level (it is
   * already applied) and tells the player to add the spells from the sheet.
   */
  async #applyLevelUp() {
    if ( this.#applying || !this.#requiredSteps.every(s => s.isComplete(this.state)) ) return;
    this.#applying = true;
    try {
      await this.state.driver.commit();
    } catch ( err ) {
      log("level-up apply failed", err);
      ui.notifications?.error(t("levelup.notify.applyFailed"));
      this.#applying = false;
      return;
    }
    this.state.committed = true;

    // The sourceTag guard covers a rare edge: picks staged while the class was briefly a caster
    // (an Eldritch Knight pick later undone) must not be created against a non-caster.
    const { actor } = this.state;
    const { sourceTag, create, deleteIds } = spellChanges(this.state);
    if ( sourceTag && (create.length || deleteIds.length) ) {
      try {
        // Create the replacements before deleting the swapped-out spell, so a failure part-way
        // can only ever leave an extra spell to tidy up — never a destroyed one.
        await applyLevelUpSpells(actor, sourceTag, create);
        if ( deleteIds.length ) await actor.deleteEmbeddedDocuments("Item", deleteIds, { render: false });
      } catch ( err ) {
        log("level-up spell grant failed", err);
        ui.notifications?.error(t("levelup.notify.spellsFailed"));
      }
    }

    await this.close({ force: true });
    actor?.sheet?.render(true);
  }

  static #onCancel() {
    this.close();
  }

  /**
   * Confirm before a close that would lose the player's work. Every exit path funnels through
   * here — the Cancel button, the window frame's close, Escape, and programmatic closes. Nothing
   * touches the real actor until Apply, so closing with decisions made (or spells staged)
   * discards the whole level-up — safe, but rolled HP and picked features silently vanish, hence
   * the prompt. Apply itself passes `force` because its work is already saved; an untouched
   * window (or a pre-seeded one the player never interacted with) closes without ceremony.
   * @override
   */
  async close(options = {}) {
    if ( !options.force && !this.state.committed && this.state.hasPlayerInput() ) {
      const proceed = await DialogV2.confirm({
        window: { title: t("levelup.cancel.title"), icon: "fa-solid fa-triangle-exclamation" },
        content: `<p>${t("levelup.cancel.body")}</p>`,
        modal: true,
        rejectClose: false
      });
      if ( !proceed ) return this;
    }
    return super.close(options);
  }

  /**
   * Every exit funnels through here — the Cancel button, the window frame's close, and any
   * programmatic close. The sheet's level selector shows the *target* level the player picked to
   * open this wizard, but that pick is never persisted: the driver works on a throwaway clone and
   * only {@link LevelUpDriver#commit} touches the real actor. So on any close we re-render the actor
   * sheet, snapping the selector back to the character's actual level after a cancel. When the
   * level-up was committed the same re-render simply reflects the new level.
   * @override
   */
  _onClose(options) {
    super._onClose(options);
    const sheet = this.state.actor?.sheet;
    if ( sheet?.rendered ) sheet.render(true);
  }
}
