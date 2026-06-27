import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { CreatorState } from "../state/creator-state.mjs";
import { SourceIndex } from "../data/source-index.mjs";
import { SpellSource } from "../data/spell-source.mjs";
import { EquipmentSource } from "../data/equipment-source.mjs";
import { STEPS, REQUIRED_STEPS } from "../steps/registry.mjs";
import { warmChoices } from "../data/choice-resolver.mjs";
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
    stage: {
      id: "stage",
      template: `modules/${MODULE_ID}/templates/stage.hbs`,
      // Preserve scroll across re-renders: the stage body, plus the pick steps'
      // independently-scrolling pick-list and description columns, the details form/media
      // columns, and the choices list (otherwise picking an option snaps them to the top).
      scrollable: [
        ".creator-stage-body", ".creator-picklist", ".creator-pick-desc",
        ".creator-details-form", ".creator-details-media", ".creator-choices"
      ]
    }
  };

  /** @type {CreatorState} */
  state;
  /** @type {SourceIndex} */
  source;
  /** @type {SpellSource} */
  spells;
  /** @type {EquipmentSource} */
  equipment;

  #current = 0;
  #loading = true;
  #finished = false;
  /** Live loading caption; null falls back to the initial "reading compendiums" label. */
  #loadingLabel = null;

  constructor(actor, options = {}) {
    super(options);
    this.state = new CreatorState(actor);
    this.source = new SourceIndex();
    this.spells = new SpellSource();
    this.equipment = new EquipmentSource();
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
    // Kick the load off without awaiting it: ApplicationV2 applies the framed window's
    // position/size only after `_onFirstRender` resolves, so awaiting the multi-second
    // load here would paint the spinner at the wrong size first (windowed mode) and snap
    // to the configured size once it finished. Returning immediately lets the frame size
    // correctly up front; `#loadStage()` flips `#loading` and re-renders when it's done.
    this.#loadStage();
  }

  /** Load the compendium index, warm caches, then reveal the first step. */
  async #loadStage() {
    try {
      await this.source.load();
      // Resolve every class/species/background detail and every class's spell list now,
      // behind the loading spinner, so selecting or switching an origin later is instant
      // instead of paying a multi-second cold compendium read on the click itself.
      await this.#warmSources();
    } catch ( err ) {
      log("source index failed to load", err);
      ui.notifications?.error(t("notify.indexFailed"));
    }
    this.#loading = false;
    // Resuming an in-progress actor: jump to the first step still needing input.
    this.#current = this.#firstIncompleteIndex();
    if ( this.rendered ) this.render();
  }

  /**
   * Pre-resolve every origin card and class spell list while the spinner is up, reporting
   * a single combined percentage across both sources. Progress is written straight to the
   * loading caption's text node (no re-render) so the bar advances smoothly during warm-up.
   */
  async #warmSources() {
    const classes = this.source.classes();
    const species = this.source.species();
    const backgrounds = this.source.backgrounds();
    const origins = classes.length + species.length + backgrounds.length;
    // Every compendium read the builder will ever need, warmed once here so navigation
    // (and especially selecting a class) never triggers a fresh pack re-index later:
    //   • warmAll        — origin details/advancement groups       (one tick per origin)
    //   • warmClasses    — each class's spell list                 (one tick per class)
    //   • warmChoices    — advancement choices' tool/restriction scans (one tick per origin)
    //   • equipment warm — class & background starting-equipment   (one tick per class+bg)
    const total = origins + classes.length + origins + (classes.length + backgrounds.length);
    let done = 0;
    const tick = () => {
      const pct = total ? Math.round((++done / total) * 100) : 100;
      this.#loadingLabel = t("loading.preparing", { percent: pct });
      const node = this.element?.querySelector(".creator-loading p");
      if ( node ) node.textContent = this.#loadingLabel;
    };
    await this.source.warmAll(tick);
    await this.spells.warmClasses(classes.map(c => c.uuid), tick);
    await warmChoices(this.source, tick);
    await this.equipment.warmAll(this.source, tick);
  }

  /** @override */
  async _prepareContext() {
    const flags = this.#completeFlags();
    const step = this.#activeStep;
    const stepContext = this.#loading ? {} : await step.context(this.#ctx());

    return {
      loading: this.#loading,
      loadingLabel: this.#loadingLabel ?? t("loading.indexing"),
      version: game.modules.get(MODULE_ID)?.version ?? "",
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
    this.#applySourceArt(root);
    // Selects/inputs don't fire click "actions"; wire their change events to the dispatcher.
    for ( const el of root.querySelectorAll("[data-step-change]") ) {
      el.addEventListener("change", ev => this.#dispatch(el.dataset.stepChange, ev.currentTarget));
    }
    this.#wireDragDrop(root);
    // Client-side card filtering — no re-render, so the field keeps focus while typing.
    const search = root.querySelector("[data-creator-search]");
    if ( search ) search.addEventListener("input", ev => this.#filterCards(ev.currentTarget.value));
  }

  /**
   * When the official D&D Player's Handbook module is installed, borrow two of its
   * journal sketches as faded backdrops behind the empty-state placeholders — a general
   * adventuring sketch for the origin/class/background steps, plus the abjurer on the
   * spells step. The CSS variables feed `.creator-pick-empty::before`; left unset (no PHB
   * module) the backdrops simply don't render, so the creator looks identical without it.
   */
  #applySourceArt(root) {
    const phb = "dnd-players-handbook";
    if ( game.modules.get(phb)?.active ) {
      root.style.setProperty("--cc-pick-sketch",
        `url("/modules/${phb}/assets/journal-art/adventuring-equipment-sketch.webp")`);
      root.style.setProperty("--cc-spells-sketch",
        `url("/modules/${phb}/assets/journal-art/abjurer.webp")`);
    } else {
      root.style.removeProperty("--cc-pick-sketch");
      root.style.removeProperty("--cc-spells-sketch");
    }
  }

  /**
   * Generic drag-and-drop bridge to the step dispatcher. A `[data-step-drag]` element
   * carries an opaque payload string; dropping it on a `[data-step-drop]` element stashes
   * that payload on the target's `dataset.dropPayload` and dispatches the drop's action, so
   * a step handler reads it exactly like any other dataset value. Used by the ability panel
   * to drop pooled scores onto abilities, but knows nothing of abilities itself.
   */
  #wireDragDrop(root) {
    for ( const el of root.querySelectorAll("[data-step-drag]") ) {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", ev => {
        ev.dataTransfer.setData("text/plain", el.dataset.stepDrag);
        ev.dataTransfer.effectAllowed = "move";
        el.classList.add("is-dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("is-dragging"));
    }
    for ( const el of root.querySelectorAll("[data-step-drop]") ) {
      el.addEventListener("dragover", ev => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        el.classList.add("is-dragover");
      });
      el.addEventListener("dragleave", () => el.classList.remove("is-dragover"));
      el.addEventListener("drop", ev => {
        ev.preventDefault();
        el.classList.remove("is-dragover");
        el.dataset.dropPayload = ev.dataTransfer.getData("text/plain");
        this.#dispatch(el.dataset.stepDrop, el);
      });
    }
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
    return STEPS.map((s, i) => {
      // A step can opt out of applicability (e.g. Spells for a non-caster); the rail greys
      // it out and shows no completion tick even though it doesn't block the build.
      const applicable = s.applicable?.(this.state) ?? true;
      return {
        index: i,
        id: s.id,
        label: t(s.labelKey),
        icon: s.icon,
        ordinal: i + 1,
        active: i === this.#current,
        applicable,
        complete: flags[i] && s.id !== "review" && applicable,
        reachable: this.#reachable(i, flags),
        summary: s.summary?.(this.state, this.source) ?? ""
      };
    });
  }

  #filterCards(query) {
    const needle = query.trim().toLowerCase();
    // Card grid (background/species) and the class pick-list share the same filter;
    // for a pick-row the <li> wrapper is hidden so the list gap collapses with it.
    for ( const card of this.element.querySelectorAll(".creator-card, .creator-pickrow") ) {
      const name = (card.dataset.name ?? "").toLowerCase();
      const target = card.closest("li") ?? card;
      target.classList.toggle("is-hidden", !!needle && !name.includes(needle));
    }
  }

  /* -------------------------------------------- */
  /*  Dispatch                                    */
  /* -------------------------------------------- */

  /**
   * The shared context handed to every step's `context()` and `handle()`. `app` lets a
   * step request a re-render after an async flow that resolves later (e.g. a FilePicker
   * callback), since the dispatch's own render fires immediately.
   */
  #ctx() {
    return { state: this.state, source: this.source, spells: this.spells, equipment: this.equipment, app: this };
  }

  async #dispatch(action, el) {
    const step = this.#activeStep;
    if ( step?.handle ) await step.handle(action, el, this.#ctx());
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
      actor = await assembleActor(this.state, this.source, this.equipment);
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
