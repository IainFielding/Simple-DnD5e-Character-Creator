import { MODULE_ID, tpl, t, log } from "../config.mjs";
import { CreatorState } from "../state/creator-state.mjs";
import { STEPS, REQUIRED_STEPS } from "../steps/registry.mjs";
import { getSources, warmSources, onWarmProgress, isStale, invalidateSources } from "../data/source-cache.mjs";
import { assembleActor } from "../build/actor-assembler.mjs";
import { launchLevelUpTo } from "../levelup/intercept.mjs";

// Foundry's UI base classes. ApplicationV2 is the modern window/app framework; the
// HandlebarsApplicationMixin adds Handlebars-template rendering on top of it; DialogV2 is
// the standard confirm/prompt popup. Destructuring them here keeps the references short.
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * The creator window. Deliberately thin: it owns navigation (which step is active,
 * what is reachable) and a single event dispatcher, then delegates all per-step
 * data and behaviour to the step modules. It contains no class/ability/species
 * preparation logic of its own — that lives in scripts/steps/*.
 *
 * For a junior dev: this is a Foundry ApplicationV2 subclass — i.e. a window. The three
 * things that make it tick are the static config blocks just below:
 *   DEFAULT_OPTIONS – window behaviour + the "actions" map (clickable [data-action] names -> methods)
 *   PARTS           – the named Handlebars templates that make up the window's HTML
 *   _prepareContext – builds the plain-object data those templates render with
 * The mental model: state changes -> we call this.render() -> Foundry re-runs _prepareContext
 * and re-paints the PARTS. We rarely touch the DOM by hand.
 */
export class CreatorShell extends HandlebarsApplicationMixin(ApplicationV2) {

  // Static config Foundry reads when constructing the window. `actions` is the key one: it maps
  // the string in a template's `data-action="goto"` to the static method run on click. Foundry
  // calls those methods with `this` bound to the app instance.
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

  // The window is built from named "parts", each its own template. `rail` is the left-hand
  // step list; `stage` is the main panel showing the current step. Splitting them lets us
  // re-render just one — e.g. render({ parts: ["rail"] }) refreshes the rail without redrawing
  // the (image-heavy) stage.
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

  // Instance state that drives rendering but isn't the character data itself:
  #current = 0;          // index into STEPS of the step currently on screen
  #loading = true;       // true while the compendium index warms; shows the spinner
  #finished = false;     // set once Create succeeds, so close() won't warn about a discard
  /** Set once the player has made any choice, so closing early can warn before discarding it. */
  #dirty = false;
  /** Live loading caption; null falls back to the initial "reading compendiums" label. */
  #loadingLabel = null;

  constructor(actor, options = {}) {
    super(options);
    // `state` is the single source of truth for what the player has chosen so far. Passing an
    // existing actor resumes it; passing null starts a fresh, unsaved draft.
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

  /**
   * @override
   * Foundry calls this before every render to build the data object the templates read.
   * We assemble the whole window's view-model here: the rail (step list + ticks), the active
   * step's own context, and the nav bar (Back/Next state, hints). Returning a plain object;
   * the templates never see our live state directly, only this snapshot.
   */
  async _prepareContext() {
    // Let the active step record that it's been shown (e.g. the optional Equipment step's
    // "visited" flag) before completion is read, so its rail tick and the Next button reflect
    // the arrival on this very render rather than one render late.
    if ( !this.#loading ) this.#activeStep.onEnter?.(this.state);
    const flags = this.#completeFlags();
    const step = this.#activeStep;
    const stepContext = this.#loading ? {} : await step.context(this.#ctx());
    const canFinish = REQUIRED_STEPS.every(s => s.isComplete(this.state));

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
        const hasNext = this.#nextVisible(this.#current) >= 0;
        return {
          index: this.#current,
          total: visible.length,
          position: t("nav.position", { current: visible.indexOf(this.#current) + 1, total: visible.length }),
          canBack: this.#prevVisible(this.#current) >= 0,
          canNext: hasNext && flags[this.#current],
          backLabel: t("nav.back"),
          nextLabel: t("nav.next"),
          // When Next is greyed because this step isn't finished, say what's still needed
          // instead of leaving the player guessing at a dead button.
          hint: (hasNext && !flags[this.#current])
            ? (step.incompleteHint?.(this.state, this.source) ?? t("nav.incomplete"))
            : null
        };
      })(),
      canFinish,
      // On the review step, spell out which required steps are still blocking Create.
      finishHint: (step.id === "review" && !canFinish)
        ? t("nav.missing", { steps: REQUIRED_STEPS.filter(s => !s.isComplete(this.state)).map(s => t(s.labelKey)).join(", ") })
        : null,
      finishLabel: t("nav.create")
    };
  }

  /**
   * @override
   * Runs after each render, once the fresh HTML is in the DOM. The `actions` map handles clicks
   * for us, but anything else — change events on inputs, drag-and-drop, live search filtering —
   * has to be wired up by hand here each time, because the old listeners died with the old HTML.
   */
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
    const bgFilter = root.querySelector("[data-bg-filter-ability]");
    if ( spellFilters.length ) {
      const apply = () => this.#applySpellFilters();
      if ( search ) search.addEventListener("input", apply);
      for ( const sel of spellFilters ) sel.addEventListener("change", apply);
    } else if ( bgFilter ) {
      // Background step: search box + the increased-ability dropdown drive a combined filter.
      const apply = () => this.#applyBackgroundFilter();
      if ( search ) search.addEventListener("input", apply);
      bgFilter.addEventListener("change", apply);
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
    this.#updateNoResults(needle, !!(level || school));
  }

  /**
   * Hide background pick-rows that don't match the active name search and increased-ability
   * dropdown (a row must satisfy both). Each row carries the abilities its increase can raise
   * in `data-abilities` (space-joined); the dropdown filters to backgrounds that raise one.
   */
  #applyBackgroundFilter() {
    const root = this.element;
    const needle = (root.querySelector("[data-creator-search]")?.value ?? "").trim().toLowerCase();
    const ability = root.querySelector("[data-bg-filter-ability]")?.value ?? "";
    for ( const row of root.querySelectorAll(".creator-pickrow") ) {
      const matchesName = !needle || (row.dataset.name ?? "").toLowerCase().includes(needle);
      const matchesAbility = !ability || (row.dataset.abilities ?? "").split(" ").includes(ability);
      (row.closest("li") ?? row).classList.toggle("is-hidden", !(matchesName && matchesAbility));
    }
    this.#updateNoResults(needle, !!ability);
  }

  /**
   * Toggle a "no matches" line inside any pick-list whose rows are all currently filtered out, so a
   * search or filter that hides everything explains itself instead of leaving a blank column. Lists
   * that were empty to begin with keep their own `.creator-empty` message and are left alone.
   * @param {string} needle    The active name search, for the message wording.
   * @param {boolean} filtered Whether a non-search filter (spell level/school) is also narrowing.
   */
  #updateNoResults(needle, filtered = false) {
    for ( const list of this.element.querySelectorAll(".creator-picklist") ) {
      const rows = [...list.querySelectorAll("li:not(.creator-no-results)")];
      let msg = list.querySelector(".creator-no-results");
      // No real rows at all → the template's empty-state already covers it.
      if ( !rows.length || rows.some(li => !li.classList.contains("is-hidden")) ) {
        msg?.remove();
        continue;
      }
      if ( !msg ) {
        msg = document.createElement("li");
        msg.className = "creator-no-results";
        list.appendChild(msg);
      }
      msg.textContent = needle
        ? t("common.noResults", { query: needle })
        : (filtered ? t("common.noResultsFilters") : t("common.noEntries"));
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
    // Nothing the player picks is written to the world until Create, so closing early throws the
    // whole draft away. Once they've made a choice, confirm before discarding it — every exit path
    // (Cancel, the frame's close, a programmatic close) funnels through here. A finished build, or
    // an explicit `force`, skips the prompt.
    if ( !this.#finished && !options.force && this.#dirty ) {
      const proceed = await DialogV2.confirm({
        window: { title: t("cancel.title"), icon: "fa-solid fa-triangle-exclamation" },
        content: `<p>${t("cancel.body")}</p>`,
        modal: true,
        rejectClose: false
      });
      if ( !proceed ) return this;
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Navigation helpers                          */
  /* -------------------------------------------- */
  //
  // These decide which steps are done, reachable, or hidden. The core rule of the whole flow:
  // a step is only reachable once every step before it is complete — so the player can't skip
  // ahead past an unfinished requirement. "Visible" and "reachable" are separate ideas: a step
  // can be shown-but-locked (greyed), or dropped from the flow entirely (see #hidden).

  /** One boolean per step, in STEPS order: is it complete right now? Recomputed each render. */
  #completeFlags() {
    return STEPS.map(s => s.isComplete(this.state));
  }

  /** When resuming a saved character, the first step that still needs input (or review if all done). */
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
    this.#updateNoResults(needle);
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

  // The single funnel every UI interaction flows through. Given an action name and the element
  // that triggered it, hand off to the active step's handle(), then re-render — unless the handler
  // returned false to say "I already updated the DOM, don't re-render" (see the note below).
  async #dispatch(action, el) {
    // Any step interaction counts as progress worth confirming before a discard.
    this.#dirty = true;
    const step = this.#activeStep;
    // A handler may return false to signal it has updated the DOM itself and a full re-render
    // should be skipped — used by the Details name roller, whose stage re-render would otherwise
    // rebuild (and visibly flicker) the portrait/token images in the left-hand media column.
    const handled = step?.handle ? await step.handle(action, el, this.#ctx()) : undefined;
    if ( handled === false ) return;
    this.render();
  }

  /**
   * Public navigation for step handlers: jump to a step by id when it is currently reachable
   * (Quick Build uses this to land on Review after filling the state). When the requested step's
   * prerequisites aren't all complete, fall back to the first incomplete step instead, so a
   * partial fill still lands the player somewhere sensible.
   * @param {string} id  A step id from STEPS (e.g. "review").
   * @returns {boolean}  Whether the requested step was reached.
   */
  gotoStep(id) {
    const index = STEPS.findIndex(s => s.id === id);
    if ( index < 0 ) return false;
    const reached = this.#reachable(index);
    this.#current = reached ? index : this.#firstIncompleteIndex();
    this.render();
    return reached;
  }

  // The methods below are the targets of the `actions` map in DEFAULT_OPTIONS. Foundry calls them
  // on click with (event, target) and `this` bound to the app. Most just move #current and re-render.

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

  // The "Create" button. This is where the draft finally becomes a real actor in the world:
  // guard that every required step is done, create the actor if we don't already have one, then
  // hand off to assembleActor() to write class/species/spells/equipment onto it. On any failure we
  // roll #finished back so the window stays open and the player can retry.
  static async #onFinish(event, target) {
    // A build takes seconds (actor create + advancement manager + many embedded writes), so guard
    // against a second click landing while the first is still running — without this, the second
    // pass sees state.actor still null and builds a whole second actor. #finished is our latch.
    if ( this.#finished ) return;
    if ( !REQUIRED_STEPS.every(s => s.isComplete(this.state)) ) return;
    this.#finished = true;
    // Tell the player work is happening, and make the button un-clickable for real (the latch above
    // already blocks re-entry; this is the visible half of the same guard).
    if ( target ) {
      target.disabled = true;
      target.textContent = t("nav.building");
    }
    let actor = this.state.actor;
    // Track whether *this* build created the actor. If assembleActor throws after Actor.create
    // succeeded, we delete the half-built actor below so a retry starts from a clean slate instead
    // of re-running assembly on top of the partial one (which duplicates every already-written item).
    // A resumed character's actor pre-exists in state, so this stays false and we never delete it.
    let createdActor = false;
    try {
      // The draft actor is created only now, at Create — so a cancelled build never leaves an
      // orphan "New Character" in the directory. Resuming an existing character reuses its actor.
      if ( !actor ) {
        actor = await Actor.create({ name: this.state.details.name?.trim() || t("common.newCharacter"), type: "character" });
        if ( !actor ) throw new Error("actor creation returned nothing");
        this.state.actor = actor;
        createdActor = true;
      }
      await assembleActor(this.state, this.source, this.equipment);
    } catch ( err ) {
      log("character build failed", err);
      ui.notifications?.error(t("notify.buildFailed"));
      // Delete the orphaned actor this build created so the retry rebuilds from scratch rather than
      // stacking assembly onto a partially-built actor. Clear state.actor so the next attempt takes
      // the create path again.
      if ( createdActor ) {
        try {
          await actor?.delete();
        } catch ( cleanupErr ) {
          log("failed to clean up half-built actor", cleanupErr);
        }
        this.state.actor = null;
      }
      this.#finished = false;
      // Re-enable the button so the player can retry without reopening the window.
      if ( target ) {
        target.disabled = false;
        target.textContent = t("nav.create");
      }
      return;
    }
    await this.close();
    actor?.sheet?.render(true);
    // The build above always produces a level-1 character. When the player asked for more on the
    // Class step, hand the rest to the level-up wizard: one manager for the whole 1→target jump, so
    // they get a screen per gained level and a single commit. It opens over the sheet we just
    // rendered — so if they close it, they still have the (valid) level-1 character they built.
    const targetLevel = this.state.targetLevel ?? 1;
    if ( actor && targetLevel > 1 ) await launchLevelUpTo(actor, targetLevel);
  }

  static #onCancel() {
    this.close();
  }
}
