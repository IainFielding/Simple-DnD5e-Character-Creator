import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { CreatorState } from "../state/creator-state.mjs";
import { SourceIndex } from "../data/source-index.mjs";
import { STEPS, REQUIRED_STEPS } from "../steps/registry.mjs";
import { assembleActor } from "../build/actor-assembler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The creator window. Deliberately thin: it owns navigation (which step is active,
 * what is reachable) and a single event dispatcher, then delegates all per-step
 * data and behaviour to the step modules. It contains no class/ability/species
 * preparation logic of its own — that lives in scripts/steps/*.
 */
export class CreatorShell extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sogrom-creator",
    classes: ["sogrom-creator"],
    tag: "div",
    window: { frame: false, positioned: false },
    actions: {
      goto: CreatorShell.#onGoto,
      navNext: CreatorShell.#onNext,
      navBack: CreatorShell.#onBack,
      stepAction: CreatorShell.#onStepAction,
      finish: CreatorShell.#onFinish,
      cancel: CreatorShell.#onCancel
    }
  };

  static PARTS = {
    rail: { id: "rail", template: `modules/${MODULE_ID}/templates/rail.hbs` },
    stage: { id: "stage", template: `modules/${MODULE_ID}/templates/stage.hbs`, scrollable: [".creator-stage-body"] }
  };

  /** @type {CreatorState} */
  state;
  /** @type {SourceIndex} */
  source;

  #current = 0;
  #loading = true;
  #finished = false;

  constructor(actor, options = {}) {
    super(options);
    this.state = new CreatorState(actor);
    this.source = new SourceIndex();
  }

  get title() {
    return t("window.title", { name: this.state.actor?.name ?? t("common.newCharacter") });
  }

  get #activeStep() {
    return STEPS[this.#current];
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    try {
      await this.source.load();
    } catch ( err ) {
      log("source index failed to load", err);
      ui.notifications?.error(t("notify.indexFailed"));
    }
    this.#loading = false;
    // Resuming an in-progress actor: jump to the first step still needing input.
    this.#current = this.#firstIncompleteIndex();
    if ( this.rendered ) this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const flags = this.#completeFlags();
    const step = this.#activeStep;
    const stepContext = this.#loading ? {} : await step.context({ state: this.state, source: this.source });

    return {
      loading: this.#loading,
      loadingLabel: t("loading.indexing"),
      cancelLabel: t("nav.cancel"),
      rail: this.#railContext(flags),
      step: {
        id: step.id,
        template: tpl(`${step.template}.hbs`),
        label: t(step.labelKey),
        ...stepContext
      },
      isReview: step.id === "review",
      nav: {
        index: this.#current,
        total: STEPS.length,
        position: t("nav.position", { current: this.#current + 1, total: STEPS.length }),
        canBack: this.#current > 0,
        canNext: this.#current < STEPS.length - 1 && flags[this.#current],
        backLabel: t("nav.back"),
        nextLabel: t("nav.next")
      },
      canFinish: REQUIRED_STEPS.every(s => s.isComplete(this.state)),
      finishLabel: t("nav.create")
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // Selects/inputs don't fire click "actions"; wire their change events to the dispatcher.
    for ( const el of root.querySelectorAll("[data-step-change]") ) {
      el.addEventListener("change", ev => this.#dispatch(el.dataset.stepChange, ev.currentTarget));
    }
    // Client-side card filtering — no re-render, so the field keeps focus while typing.
    const search = root.querySelector("[data-creator-search]");
    if ( search ) search.addEventListener("input", ev => this.#filterCards(ev.currentTarget.value));
  }

  /** @override */
  async close(options = {}) {
    // Drop an abandoned, never-built draft so cancelling doesn't litter the directory.
    if ( !this.#finished && this.state.actor && !this.state.actor.items.size ) {
      try { await this.state.actor.delete(); } catch ( err ) { log("draft cleanup failed", err); }
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Navigation helpers                          */
  /* -------------------------------------------- */

  #completeFlags() {
    return STEPS.map(s => s.isComplete(this.state));
  }

  #firstIncompleteIndex() {
    const idx = REQUIRED_STEPS.findIndex(s => !s.isComplete(this.state));
    return idx === -1 ? STEPS.length - 1 : STEPS.indexOf(REQUIRED_STEPS[idx]);
  }

  /** A step is reachable once every step before it is complete. */
  #reachable(index, flags = this.#completeFlags()) {
    return index === 0 || flags.slice(0, index).every(Boolean);
  }

  #railContext(flags) {
    return STEPS.map((s, i) => ({
      index: i,
      id: s.id,
      label: t(s.labelKey),
      icon: s.icon,
      ordinal: i + 1,
      active: i === this.#current,
      complete: flags[i] && s.id !== "review",
      reachable: this.#reachable(i, flags),
      summary: s.summary?.(this.state, this.source) ?? ""
    }));
  }

  #filterCards(query) {
    const needle = query.trim().toLowerCase();
    for ( const card of this.element.querySelectorAll(".creator-card") ) {
      const name = (card.dataset.name ?? "").toLowerCase();
      card.classList.toggle("is-hidden", !!needle && !name.includes(needle));
    }
  }

  /* -------------------------------------------- */
  /*  Dispatch                                    */
  /* -------------------------------------------- */

  async #dispatch(action, el) {
    const step = this.#activeStep;
    if ( step?.handle ) await step.handle(action, el, { state: this.state, source: this.source });
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
    if ( this.#current < STEPS.length - 1 && this.#activeStep.isComplete(this.state) ) {
      this.#current += 1;
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
    if ( !REQUIRED_STEPS.every(s => s.isComplete(this.state)) ) return;
    this.#finished = true;
    let actor;
    try {
      actor = await assembleActor(this.state);
    } catch ( err ) {
      log("character build failed", err);
      ui.notifications?.error(t("notify.buildFailed"));
      this.#finished = false;
      return;
    }
    await this.close();
    actor?.sheet?.render(true);
  }

  static #onCancel() {
    this.close();
  }
}
