import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { buildSteps } from "./registry.mjs";
import { SourceIndex } from "../data/source-index.mjs";
import { SpellSource } from "../data/spell-source.mjs";
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
 *   2. The finish button is two-phase: first press = "Apply" (commit the level to the actor);
 *      second press only appears if new spells were unlocked = "Done" (save the spell picks).
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
  /** A non-warmed source index, used only by the subclass picker to list/describe subclasses. */
  #source = new SourceIndex();
  /** Spell source for the post-commit spell step (§3.4); loads the class's castable spell pool. */
  #spells = new SpellSource();

  constructor(state, options = {}) {
    super(options);
    this.state = state;
    this.#steps = buildSteps(state);
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
      // Pre-commit the button really does cancel the level-up; once committed it only closes the
      // window (the level is already applied), so it must not promise an undo it can't deliver.
      cancelLabel: this.state.committed ? t("levelup.nav.close") : t("nav.cancel"),
      rail: this.#railContext(flags),
      step: {
        id: step.id,
        template: tpl(`${step.template}.hbs`),
        // Per-level steps carry a resolved label ("Level 4"); the review step uses its labelKey.
        label: step.label ?? t(step.labelKey),
        ...stepContext
      },
      // The finish button shows on the review step (Apply) and, once committed, on the spell step
      // (Done). Both replace Next in the footer; the label distinguishes the two phases.
      isReview: step.id === "review" || step.id === "spells",
      nav: {
        index: this.#current,
        total: this.#steps.length,
        position: t("nav.position", { current: this.#current + 1, total: this.#steps.length }),
        // Once committed the level screens are locked behind us — only the spell step is live.
        canBack: this.#current > 0 && !this.state.committed,
        canNext: this.#current < this.#steps.length - 1 && flags[this.#current]
          && this.#reachable(this.#current + 1, flags),
        backLabel: t("nav.back"),
        nextLabel: t("nav.next")
      },
      canFinish: this.state.committed || this.#requiredSteps.every(s => s.isComplete(this.state)),
      finishLabel: this.state.committed ? t("levelup.nav.done") : t("levelup.nav.apply")
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
    for ( const el of this.element.querySelectorAll("[data-step-change]") ) {
      el.addEventListener("change", ev => this.#dispatch(el.dataset.stepChange, ev.currentTarget));
    }
    // Client-side spell-list filters on the spell step — search box plus the level/school dropdowns.
    // All filter in the DOM without a re-render, so the search field keeps focus while typing.
    const search = this.element.querySelector("[data-creator-search]");
    if ( search ) search.addEventListener("input", () => this.#applySpellFilters());
    for ( const sel of this.element.querySelectorAll("[data-spell-filter-level], [data-spell-filter-school]") ) {
      sel.addEventListener("change", () => this.#applySpellFilters());
    }
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
    // After commit the level-up is applied and its screens are frozen — only the spell step is live.
    if ( this.state.committed ) return this.#steps[index]?.id === "spells";
    // Pre-commit the spell step is gated behind Apply; it is never reached by Next or the rail.
    if ( this.#steps[index]?.id === "spells" ) return false;
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
    if ( this.#current > 0 && !this.state.committed ) {
      this.#current -= 1;
      this.render();
    }
  }

  /**
   * The finish button drives a two-phase completion so the spell step (§3.4) can run against the
   * committed actor within the same window:
   *  - **Phase A** (not yet committed) — validate the level decisions, commit the driver's clone to
   *    the real actor, then either advance to the spell step or, for a non-caster, close.
   *  - **Phase B** (committed, on the spell step) — write the staged spell picks and close.
   */
  static async #onFinish() {
    if ( !this.state.committed ) return this.#applyLevelUp();
    return this.#finishSpells();
  }

  /** Phase A: commit the level grant, then reveal the spell step or close. */
  async #applyLevelUp() {
    if ( !this.#requiredSteps.every(s => s.isComplete(this.state)) ) return;
    try {
      await this.state.driver.commit();
    } catch ( err ) {
      log("level-up apply failed", err);
      ui.notifications?.error(t("levelup.notify.applyFailed"));
      return;
    }
    this.state.committed = true;

    // If the level-up opened spell capacity, stay open on the (now unlocked) spell step; otherwise
    // we're done — close and surface the updated sheet, exactly as before.
    this.#steps = buildSteps(this.state);
    const spellIndex = this.#steps.findIndex(s => s.id === "spells");
    if ( spellIndex >= 0 ) {
      this.#current = spellIndex;
      return this.render();
    }
    await this.close({ force: true });
    this.state.actor?.sheet?.render(true);
  }

  /** Phase B: persist the staged spell picks (and any swaps) onto the committed actor, then close. */
  async #finishSpells() {
    const { actor } = this.state;
    const { sourceTag, create, deleteIds } = spellChanges(this.state);
    try {
      // Delete swapped-out spells first so a replacement of the same name can't momentarily collide.
      if ( deleteIds.length ) await actor.deleteEmbeddedDocuments("Item", deleteIds, { render: false });
      await applyLevelUpSpells(actor, sourceTag, create);
    } catch ( err ) {
      log("level-up spell grant failed", err);
      ui.notifications?.error(t("levelup.notify.spellsFailed"));
      return;
    }
    await this.close({ force: true });
    actor?.sheet?.render(true);
  }

  static #onCancel() {
    this.close();
  }

  /**
   * Confirm before a close that would lose the player's work. Every exit path funnels through
   * here — the Cancel/Close button, the window frame's close, Escape, and programmatic closes.
   * Two distinct situations warrant a prompt:
   *  - **Pre-commit** with decisions made: closing discards the whole level-up (that's safe — the
   *    real actor was never touched — but rolled HP and picked features silently vanish).
   *  - **Post-commit** with staged spell picks: the level itself is already applied and kept, but
   *    the spells chosen on the spell step would be lost.
   * The internal completion paths pass `force` because their work is already saved; an untouched
   * window (or a pre-seeded one the player never interacted with) closes without ceremony.
   * @override
   */
  async close(options = {}) {
    if ( !options.force ) {
      let confirmKey = null;
      if ( !this.state.committed && this.state.hasPlayerInput() ) confirmKey = "levelup.cancel";
      else if ( this.state.committed && this.state.hasStagedSpells() ) confirmKey = "levelup.cancelSpells";
      if ( confirmKey ) {
        const proceed = await DialogV2.confirm({
          window: { title: t(`${confirmKey}.title`), icon: "fa-solid fa-triangle-exclamation" },
          content: `<p>${t(`${confirmKey}.body`)}</p>`,
          modal: true,
          rejectClose: false
        });
        if ( !proceed ) return this;
      }
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
