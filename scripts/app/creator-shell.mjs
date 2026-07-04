import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { CreatorState } from "../state/creator-state.mjs";
import { STEPS, REQUIRED_STEPS } from "../steps/registry.mjs";
import { getSources, warmSources, onWarmProgress, isStale, invalidateSources } from "../data/source-cache.mjs";
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
  /** @type {import("../data/source-index.mjs").SourceIndex} */
  source;
  /** @type {import("../data/spell-source.mjs").SpellSource} */
  spells;
  /** @type {import("../data/equipment-source.mjs").EquipmentSource} */
  equipment;

  #current = 0;
  #loading = true;
  #finished = false;
  /** Live loading caption; null falls back to the initial "reading compendiums" label. */
  #loadingLabel = null;

  constructor(actor, options = {}) {
    super(options);
    this.state = new CreatorState(actor);
    // Reuse the shared, warm-once compendium index (warmed in the background at `ready`).
    // `#loadStage` re-grabs these after any staleness check, in case the cache was rebuilt.
    const { source, spells, equipment } = getSources();
    this.source = source;
    this.spells = spells;
    this.equipment = equipment;
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

  /**
   * Reveal the first step once the shared compendium index is warm. The warm normally ran in
   * the background at `ready`, so {@link warmSources} resolves instantly here; if the window was
   * opened first (or the enabled-source config changed), it awaits the in-flight work — or kicks
   * off a fresh one — behind the loading spinner. Progress is written straight to the caption's
   * text node (no re-render) so the bar advances smoothly while the player waits.
   */
  async #loadStage() {
    // A changed enabled-source set means the cached index no longer reflects the world; rebuild.
    if ( isStale() ) {
      invalidateSources();
      const { source, spells, equipment } = getSources();
      this.source = source;
      this.spells = spells;
      this.equipment = equipment;
    }
    const off = onWarmProgress(pct => {
      this.#loadingLabel = t("loading.preparing", { percent: pct });
      const node = this.element?.querySelector(".creator-loading p");
      if ( node ) node.textContent = this.#loadingLabel;
    });
    try {
      await warmSources();
    } catch ( err ) {
      log("source index failed to load", err);
      ui.notifications?.error(t("notify.indexFailed"));
    } finally {
      off();
    }
    this.#loading = false;
    // Resuming an in-progress actor: jump to the first step still needing input.
    this.#current = this.#firstIncompleteIndex();
    if ( this.rendered ) this.render();
  }

  /** @override */
  async _prepareContext() {
    // Let the active step record that it's been shown (e.g. the optional Equipment step's
    // "visited" flag) before completion is read, so its rail tick and the Next button reflect
    // the arrival on this very render rather than one render late.
    if ( !this.#loading ) this.#activeStep.onEnter?.(this.state);
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
      nav: (() => {
        // Position and Back/Next are measured over the *visible* steps, so a hidden step neither
        // occupies a number nor is landed on when paging through.
        const visible = this.#visibleIndices();
        return {
          index: this.#current,
          total: visible.length,
          position: t("nav.position", { current: visible.indexOf(this.#current) + 1, total: visible.length }),
          canBack: this.#prevVisible(this.#current) >= 0,
          canNext: this.#nextVisible(this.#current) >= 0 && flags[this.#current],
          backLabel: t("nav.back"),
          nextLabel: t("nav.next")
        };
      })(),
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
    // Client-side filtering — no re-render, so the field keeps focus while typing. The spell steps
    // add level/school dropdowns; when present, search + dropdowns drive the combined spell filter,
    // otherwise the search box filters the card/list grid by name.
    const search = root.querySelector("[data-creator-search]");
    const spellFilters = root.querySelectorAll("[data-spell-filter-level], [data-spell-filter-school]");
    if ( spellFilters.length ) {
      const apply = () => this.#applySpellFilters();
      if ( search ) search.addEventListener("input", apply);
      for ( const sel of spellFilters ) sel.addEventListener("change", apply);
    } else if ( search ) {
      search.addEventListener("input", ev => this.#filterCards(ev.currentTarget.value));
    }
  }

  /**
   * Hide pick-rows that don't match the active spell filters — name search, spell level, and spell
   * school — combined (a row must satisfy all three). Each control reads its value straight from the
   * DOM so any of them can drive the pass. Mirrors {@link LevelUpShell}'s spell-list filter.
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
      (row.closest("li") ?? row).classList.toggle("is-hidden", !(matchesName && matchesLevel && matchesSchool));
    }
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

  /**
   * Whether a step is hidden from the flow right now — a step that opts into {@link
   * hideWhenInapplicable} is dropped entirely (not just greyed) while it doesn't apply, so the
   * Feat-Spells step appears in the header only once a feat that needs it is chosen.
   */
  #hidden(step) {
    return step.hideWhenInapplicable && !(step.applicable?.(this.state) ?? true);
  }

  /** STEPS indices currently shown, in order (hidden steps omitted). */
  #visibleIndices() {
    return STEPS.map((_s, i) => i).filter(i => !this.#hidden(STEPS[i]));
  }

  /** The next / previous visible step index from `from`, or -1 if none. */
  #nextVisible(from) {
    for ( let i = from + 1; i < STEPS.length; i++ ) if ( !this.#hidden(STEPS[i]) ) return i;
    return -1;
  }
  #prevVisible(from) {
    for ( let i = from - 1; i >= 0; i-- ) if ( !this.#hidden(STEPS[i]) ) return i;
    return -1;
  }

  #railContext(flags) {
    const rail = [];
    let ordinal = 0;
    STEPS.forEach((s, i) => {
      if ( this.#hidden(s) ) return;        // dropped from the header until it applies
      // A step can still opt out of applicability while remaining visible (e.g. Spells for a
      // non-caster); the rail greys it out and shows no completion tick.
      const applicable = s.applicable?.(this.state) ?? true;
      ordinal += 1;
      rail.push({
        index: i,
        id: s.id,
        label: t(s.labelKey),
        icon: s.icon,
        ordinal,
        active: i === this.#current,
        applicable,
        complete: flags[i] && s.id !== "review" && applicable,
        reachable: this.#reachable(i, flags),
        summary: s.summary?.(this.state, this.source) ?? ""
      });
    });
    return rail;
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
    // A handler may return false to signal it has updated the DOM itself and a full re-render
    // should be skipped — used by the Details name roller, whose stage re-render would otherwise
    // rebuild (and visibly flicker) the portrait/token images in the left-hand media column.
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
    const next = this.#nextVisible(this.#current);
    if ( next >= 0 && this.#activeStep.isComplete(this.state) ) {
      this.#current = next;
      this.render();
    }
  }

  static #onBack() {
    const prev = this.#prevVisible(this.#current);
    if ( prev >= 0 ) {
      this.#current = prev;
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
