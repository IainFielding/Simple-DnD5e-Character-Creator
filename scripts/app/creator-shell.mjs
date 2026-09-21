import {
  MODULE_ID, HOOKS, tpl, t, log, ABILITIES, formatMod, fireHook, fireCancellableHook,
  emberActive, systemRulesEdition
} from "../config.mjs";
import { CreatorShellBase, shellOptions, dossierStageParts, SHELL_ACTIONS } from "./shell-base.mjs";
import { illuminatePages, drawFrameSigils, fitCardArt } from "./page-illumination.mjs";
import { CreatorState } from "../state/creator-state.mjs";
import {
  applyDraft, cancelDraftSave, clearDraft, flushDraftSave, pruneMissingOrigins, scheduleDraftSave
} from "../state/draft-store.mjs";
import { STEPS, REQUIRED_STEPS } from "../steps/registry.mjs";
import { getSources, warmSources, onWarmProgress, isStale, invalidateSources } from "../data/source-cache.mjs";
import { assembleActor } from "../build/actor-assembler.mjs";
import { postCreationSummary } from "../build/chat-summary.mjs";
import { exportCharacterPdf } from "../build/pdf-export.mjs";
import { launchLevelUpTo } from "../levelup/intercept.mjs";
import { chooserContext, premadeContext, applyPremade, takePregen } from "./entry-chooser.mjs";
import { isQuickLevel, quickClimb } from "../data/quick-climb.mjs";
import { foundryPregens } from "../data/premades.mjs";
import {
  QUICK_FILLED_STEPS, thresholdClear, thresholdContext, thresholdCreate, thresholdRoll,
  thresholdRollAll, thresholdRollName, seedThreshold
} from "./threshold.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * The creator window. Deliberately thin: it owns which step is active and what is reachable, then
 * delegates all per-step data and behaviour to the step modules. It contains no
 * class/ability/species preparation logic of its own — that lives in scripts/steps/*.
 *
 * The window chrome, the click dispatcher, Back/Next and the discard prompt are all inherited from
 * {@link CreatorShellBase}, shared with the level-up window; what's left here is the creator's own
 * step model (a fixed registry whose entries can be hidden or greyed) and the Create button.
 *
 * For a junior dev: this is a Foundry ApplicationV2 subclass — i.e. a window. The three things that
 * make it tick are the static config blocks just below plus `_prepareContext`:
 *   DEFAULT_OPTIONS – window behaviour + the "actions" map (clickable [data-action] names -> methods)
 *   PARTS           – the named Handlebars templates that make up the window's HTML
 *   _prepareContext – builds the plain-object data those templates render with
 * The mental model: state changes -> we call this.render() -> Foundry re-runs _prepareContext
 * and re-paints the PARTS. We rarely touch the DOM by hand.
 */
export class CreatorShell extends CreatorShellBase {

  // The shared actions plus the picker drawer's two. They live here rather than in each pick
  // step's `handle()` because opening and closing the drawer is window chrome, not a choice: the
  // three pick steps would otherwise carry three identical copies of the same two lines.
  static DEFAULT_OPTIONS = {
    ...shellOptions("sogrom-creator"),
    actions: {
      ...SHELL_ACTIONS,
      openPicker() { this._setPicker(true); },
      closePicker() { this._setPicker(false); },
      // The entry screens. Every one of these ends in either a render or a step change, and none
      // of them touches the wizard's own step model — which is what keeps the chooser addable
      // without any step being able to notice it exists.
      entryPath(event, target) { return this._entryPath(target.dataset.path); },
      entryBack() { return this._openEntry("chooser"); },
      entryReturn() { return this._returnToQuick(); },
      entryPremade(event, target) { this._premadeSelect(target.dataset.id); },
      entryPremadeConfirm(event, target) { return this._premadeConfirm(target); },
      thresholdEdition(event, target) { return this._thresholdEdition(target.dataset.rules); },
      thresholdLevel(event, target) { return this._thresholdLevel(target.dataset.level); },
      thresholdRoll(event, target) { return this._thresholdRoll(target.dataset.category); },
      thresholdRollAll() { return this._thresholdRollAll(); },
      thresholdBrowse(event, target) { this._entryBrowse(target.dataset.category); },
      thresholdCreate(event, target) { return this._thresholdCreate(target); },
      thresholdName(event, target) { this._thresholdName(target.value); }
    }
  };

  // Beyond the shared stage body: the work surface's page and its picker drawer, the spell
  // browser's list and description columns, the details form/media columns, the choices list,
  // and the store's shelf/cart (otherwise picking an option snaps them all back to the top).
  static PARTS = dossierStageParts([
    ".creator-work-page", ".creator-drawer",
    ".creator-picklist", ".creator-pick-desc",
    ".creator-details-form", ".creator-details-media", ".creator-choices",
    ".creator-store-shelf", ".creator-store-cart-list"
  ]);

  /** @type {CreatorState} */
  state;
  /** @type {import("../data/source-index.mjs").SourceIndex} */
  source;
  /** @type {import("../data/spell-source.mjs").SpellSource} */
  spells;
  /** @type {import("../data/equipment-source.mjs").EquipmentSource} */
  equipment;
  /** @type {import("../data/store-source.mjs").StoreSource} */
  store;

  // Instance state that drives rendering but isn't the character data itself
  // (`_stepIndex`, the index into STEPS of the step on screen, lives on the base):
  #loading = true;       // true while the compendium index warms; shows the spinner
  #finished = false;     // set once Create succeeds, so close() won't warn about a discard
  /** Set once the player has made any choice, so closing early can warn before discarding it. */
  #dirty = false;
  /** Whether this window opened on a restored draft, so the load can report what didn't survive. */
  #resumed = false;
  /**
   * Which entry screen is covering the stage: "chooser", "premade", "threshold", or null for none.
   *
   * Held here rather than as a step because an entry screen must not be able to disturb step
   * gating, ordering or reachability — it is chrome over the stage, like Compare and the source
   * book page, and it shares their slot and their one-at-a-time rule.
   * @type {"chooser"|"premade"|"threshold"|null}
   */
  #entry = null;
  /**
   * Whether the player has typed a name of their own on the threshold. Rolling a new species
   * re-rolls the name to match it, but never over a name they wrote.
   */
  #nameTouched = false;
  /**
   * Which rules edition the quick screen is offering — "2024" (5.5e) or "2014" (5e).
   *
   * Defaults to the world's own answer (dnd5e's `rulesVersion`), which is 2024 unless the GM has
   * set the world to legacy. Deferring to the world rather than hard-coding 2024 means a table
   * playing 2014 opens on its own books without touching anything, and a 2024 table — the large
   * majority, and the system default — sees 5.5e as asked.
   */
  #thresholdRules = null;
  /**
   * Which entry screen the player left, and so which one to offer them a way back to — or null
   * when they did not arrive from one.
   *
   * Two cases, and they want different destinations. Leaving the quick screen to browse one
   * category in full should come back to the quick screen, with the pick they went to make. Taking
   * Custom build from the chooser should come back to the chooser, because the choice being
   * reconsidered is which path to take, not which class.
   *
   * It survives moving between steps on purpose: someone who goes to the class grid, then wanders
   * to Background to look something up, has not changed their mind about wanting to go back.
   * @type {"threshold"|"chooser"|null}
   */
  #returnTo = null;
  /**
   * Whether this build came through the Quick Build screen, and so should climb to its starting
   * level headlessly rather than by opening the level-up wizard. See {@link _thresholdCreate}.
   */
  #quickClimb = false;
  /** The ready-made character the player has selected but not yet confirmed. */
  #premadeChoice = null;
  /**
   * Whether this window's work belongs in a draft.
   *
   * False when the creator was opened on an actor that already exists. That character is its own
   * persistence — every answer was read back off it and will be written back to it — so storing a
   * draft alongside would be a second copy of one character, and the next fresh launch would offer
   * to build a duplicate of it.
   */
  #draftable = true;
  /** Live loading caption; null falls back to the initial "reading compendiums" label. */
  #loadingLabel = null;
  /**
   * CSS selector for the control that should hold keyboard focus after the next render, or null
   * to leave focus alone. Set by an interaction that re-renders away the control the player was
   * standing on; consumed once by {@link CreatorShell##restoreFocus}.
   */
  #focusAfterRender = null;

  constructor(actor, options = {}, draft = null) {
    super(options);
    // `state` is the single source of truth for what the player has chosen so far. Passing an
    // existing actor resumes it; passing null starts a fresh, unsaved draft.
    this.state = new CreatorState(actor);
    this.#draftable = !actor;
    // A draft the player chose to pick up (see {@link module:api.launchCreator}). Applied over the
    // fresh state rather than instead of it, so anything the draft doesn't carry keeps its default.
    if ( draft ) {
      applyDraft(this.state, draft);
      // Restored answers are unsaved work like any other: closing must offer to keep them, and the
      // autosave has to stay current from here rather than waiting for the first fresh click.
      this.#dirty = true;
      this.#resumed = true;
    }
    // Reuse the shared, warm-once compendium index (warmed in the background at `ready`).
    // `#loadStage` re-grabs these after any staleness check, in case the cache was rebuilt.
    const { source, spells, equipment, store } = getSources();
    this.source = source;
    this.spells = spells;
    this.equipment = equipment;
    this.store = store;
  }

  get title() {
    return t("window.title", { name: this.state.actor?.name ?? t("common.newCharacter") });
  }

  /** @override The creator walks the fixed step registry. */
  get _activeStep() {
    return STEPS[this._stepIndex];
  }

  /** @override */
  get _stepCount() {
    return STEPS.length;
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
      const { source, spells, equipment, store } = getSources();
      this.source = source;
      this.spells = spells;
      this.equipment = equipment;
      this.store = store;
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
    // A restored draft names its origins by uuid, and the world may have changed since it was
    // written. Now — with the index warm, so "missing" means missing rather than not-yet-loaded —
    // is the only moment those can be checked before a step tries to render one.
    if ( this.#resumed ) this.#reportPrunedOrigins(pruneMissingOrigins(this.state, this.source));
    this.#loading = false;
    // Resuming an in-progress actor: jump to the first step still needing input.
    this._stepIndex = this.#firstIncompleteIndex();
    // The chooser, if this world asked for it and there is nothing built yet. Gated in this one
    // place, so a world with the setting off never builds an entry context and never renders an
    // entry template — the creator opens on its first step exactly as it always has.
    if ( this.#shouldOfferEntry() ) this.#entry = "chooser";
    if ( this.rendered ) this.render();
    // The window is now genuinely usable — sources loaded, first step chosen. Announcing at
    // construction instead would hand listeners a shell still showing its loading screen.
    fireHook(HOOKS.creatorOpened, { app: this, state: this.state });
  }

  /**
   * @override
   * Foundry calls this before every render to build the data object the templates read.
   * We assemble the whole window's view-model here: the dossier (the character so far, with the
   * step list folded into it), the progress meter, the active step's own context, and the nav bar
   * (Back/Next state, hints). Returning a plain object; the templates never see our live state
   * directly, only this snapshot.
   */
  async _prepareContext() {
    // Let the active step record that it's been shown (e.g. the optional Equipment step's
    // "visited" flag) before completion is read, so its dossier tick and the Next button reflect
    // the arrival on this very render rather than one render late.
    if ( !this.#loading ) this._activeStep.onEnter?.(this.state);
    const step = this._activeStep;
    // Build the active screen BEFORE reading the completion flags: laying it out can refresh the
    // caches those flags read (the Choices step resolves its requirements into `state.choiceCache`),
    // so the dossier tick and the Next button reflect this very render rather than the previous one.
    const stepContext = this.#loading ? {} : await step.context(this._ctx());
    // Built before the flags are read, like the step context above and for the same reason: the
    // threshold resolves origin ability increases into the state, and the dossier must show this
    // render rather than the previous one.
    const entry = this.#entry === "chooser" ? await chooserContext(this._ctx())
      : this.#entry === "premade"
        ? { premades: await premadeContext(this._ctx(), this.#premadeChoice) }
        : null;
    const threshold = this.#entry === "threshold"
    ? await thresholdContext(this._ctx(), this.#thresholdRules ?? systemRulesEdition())
    : null;

    const flags = this._completeFlags();
    // Both derived from `flags`, rather than re-running every step's isComplete() twice more.
    const missing = REQUIRED_STEPS.filter(s => !flags[STEPS.indexOf(s)]);
    const lines = this.#stepLines(flags);

    return {
      loading: this.#loading,
      loadingLabel: this.#loadingLabel ?? t("loading.indexing"),
      // The source-book overlay, when one is open — window chrome over the stage, not step data.
      sourceDetails: this._sourceDetails,
      // The comparison grid, likewise. Both are the shell's, not the step's: the step supplies the
      // options, the shell decides what is covering them.
      compare: this._compare,
      // The entry screens, in the same slot and under the same rule: at most one is ever set.
      entry,
      threshold,
      version: game.modules.get(MODULE_ID)?.version ?? "",
      cancelLabel: t("nav.cancel"),
      // The heading band. Normally the active step's, but an entry screen is not a step and must
      // not wear one's name — "Class & Abilities" over the quick screen describes the step
      // underneath rather than the screen on top of it. The chooser goes further and has no
      // separate heading of its own: its question IS the heading, so it moves up into this band
      // rather than repeating below it.
      heading: this.#entryHeading() ?? {
        title: t(step.labelKey),
        instruction: step.instructionKey ? t(step.instructionKey) : null
      },
      // The way back to the quick screen, for a player who left it to browse one category in full.
      // Shell chrome in the stage footer, so no step has to know the quick screen exists.
      quickReturn: this.#canReturnToEntry()
        ? t(this.#returnTo === "chooser" ? "entry.returnToChooser" : "quickBuild.threshold.returnToQuick")
        : null,
      dossier: this.#dossierContext(lines, threshold),
      progress: this._progressContext(lines, missing),
      step: {
        id: step.id,
        template: tpl(`${step.template}.hbs`),
        label: t(step.labelKey),
        // Optional one-line framing under the heading, shown by stage.hbs. Steps opt in.
        instruction: step.instructionKey ? t(step.instructionKey) : null,
        ...stepContext,
        // After the spread: the drawer's state is the shell's to decide, not the step's.
        drawerOpen: this.#drawerOpen(step, stepContext)
      },
      isReview: step.id === "review",
      nav: (() => {
        // Position and Back/Next are measured over the *visible* steps, so a hidden step neither
        // occupies a number nor is landed on when paging through.
        const visible = this.#visibleIndices();
        const hasNext = this._nextIndex() >= 0;
        return {
          index: this._stepIndex,
          total: visible.length,
          position: t("nav.position", { current: visible.indexOf(this._stepIndex) + 1, total: visible.length }),
          canBack: this._prevIndex() >= 0,
          canNext: hasNext && flags[this._stepIndex],
          backLabel: t("nav.back"),
          nextLabel: t("nav.next"),
          // When Next is greyed because this step isn't finished, say what's still needed
          // instead of leaving the player guessing at a dead button.
          // Suppressed behind an entry screen. "Spend all 27 remaining ability points" is advice
          // about the step underneath, and on a screen that is about to spend them for you it is
          // both wrong and alarming.
          hint: (hasNext && !flags[this._stepIndex] && !this.#entry)
            ? (step.incompleteHint?.(this.state, this.source) ?? t("nav.incomplete"))
            : null
        };
      })(),
      canFinish: missing.length === 0,
      // On the review step, spell out which required steps are still blocking Create.
      finishHint: (step.id === "review" && missing.length)
        ? t("nav.missing", { steps: missing.map(s => t(s.labelKey)).join(", ") })
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
    // The head artwork lives in stage DOM, so it has to be redrawn whenever the
    // stage is. Cheap and idempotent — it clears its own previous pass first.
    illuminatePages(root);
    drawFrameSigils(root);
    fitCardArt(root);
    this.#wireEntryEscape(root);
    // Above the guard below, and deliberately: a pending focus request has to be *consumed* on the
    // very next render whatever kind it is, or a rail-only render would carry it forward and move
    // focus during some later, unrelated one.
    this.#restoreFocus(root);
    // Everything below binds to stage DOM. A rail-only render (the point-buy steppers) leaves that
    // DOM in place, so re-binding would stack a second set of listeners on it — see
    // {@link CreatorShellBase#_stageRendered}.
    if ( !this._stageRendered(options) ) return;
    // Selects/inputs don't fire click "actions"; wire their change events to the dispatcher.
    this._wireStepChanges(root);
    this._wireOverlays(root);
    this.#wireDragDrop(root);
    // Client-side filtering — no re-render, so the field keeps focus while typing. A spell step's
    // dropdowns and its search box drive one combined filter, wired (and restored from the state)
    // by the shared base; anything else falls through to the plain name search below.
    const search = root.querySelector("[data-creator-search]");
    // The two pick drawers that carry a dropdown beside their search box: the background step's
    // increased-ability filter and the class step's edition filter. Never both at once — one pick
    // step is on screen — so one combined pass serves either.
    const drawerFilter = root.querySelector("[data-bg-filter-ability], [data-class-filter-rules]");
    if ( this._wireSpellFilters(root) ) {
      // Wired by the base — nothing further to do here.
    } else if ( drawerFilter ) {
      const apply = () => this.#applyDrawerFilter();
      if ( search ) search.addEventListener("input", apply);
      drawerFilter.addEventListener("change", ev => {
        // The edition filter outlives its own DOM: picking a class re-renders the drawer away, and
        // the state is what puts the player's choice back on the rebuilt control (the same trick
        // the spell filters use, see SPELL_FILTER_CONTROLS). The background filter needs none —
        // choosing a background closes its step.
        if ( ev.currentTarget.matches("[data-class-filter-rules]") ) {
          this.state.classRulesFilter = ev.currentTarget.value;
        }
        apply();
      });
    } else if ( this._wireShelfSearch(root) ) {
      // The Store shelf — wired by the base, which the level-up shell shares for Magic Items.
    } else if ( search ) {
      search.addEventListener("input", ev => this._filterCards(ev.currentTarget.value));
    }
    this.#wireDrawer(root);
  }

  /**
   * Give the picker drawer the keyboard behaviour the chevron on its switcher promises.
   *
   * Escape closes it — the drawer is the only overlay in the creator and had no keyboard
   * dismissal at all. Only when something is already chosen: with nothing chosen the drawer *is*
   * the step, and closing it would leave an empty surface with no way back except picking
   * something. That is the same condition the template uses to decide whether to render a Close
   * button, so it is read off the DOM here rather than recomputed, and the two cannot drift.
   *
   * Bound to the drawer element, not the document, so the listener dies with the DOM it belongs
   * to and can never fire on a later step.
   * @param {HTMLElement} root  The application's root element.
   */
  #wireDrawer(root) {
    const drawer = root.querySelector(".creator-drawer.is-open");
    if ( !drawer?.querySelector("[data-action='closePicker']") ) return;
    drawer.addEventListener("keydown", ev => {
      if ( ev.key !== "Escape" ) return;
      ev.preventDefault();
      ev.stopPropagation();    // don't let Foundry read it as "close the application"
      this._setPicker(false);
    });
  }

  /**
   * Put keyboard focus back where the interaction that caused this render left it.
   *
   * Opening or closing the drawer re-renders the whole stage, so the control the player just
   * activated stops existing and focus falls back to <body>. A keyboard user who pressed Enter on
   * the switcher then had to Tab past the top bar and the entire dossier to reach the list they
   * had just asked for; closing the drawer dropped them at the top of the window again.
   *
   * `#focusAfterRender` is set by whatever initiated the change and consumed exactly once here, so
   * an ordinary render — navigation, a step action — never moves focus on its own.
   * @param {HTMLElement} root  The application's root element.
   */
  #restoreFocus(root) {
    const selector = this.#focusAfterRender;
    this.#focusAfterRender = null;
    if ( !selector ) return;
    // preventScroll: the target is on screen already, and letting the browser scroll to it jogs
    // the surface underneath for no reason.
    root.querySelector(selector)?.focus({ preventScroll: true });
  }

  /**
   * @override Explain an emptied list after any client-side filter pass — the shared spell filter
   * and the drawer filter below both land here.
   */
  _afterFilter(needle, filtered) {
    this._updateNoResults(needle, filtered);
    this._updateVisibleCount();
  }

  /**
   * Hide pick-rows that don't match every active drawer control — the name search plus whichever
   * dropdown this step renders (a row must satisfy all of them).
   *
   * Each row carries what it can be filtered on: `data-abilities` (space-joined) is the abilities a
   * background's increase can raise, `data-rules` the edition a class belongs to. A class that
   * declares no edition stays on offer under either filter, which is the same rule the grids
   * themselves apply — see {@link module:data/source-index.matchesRules}.
   */
  #applyDrawerFilter() {
    const root = this.element;
    const needle = (root.querySelector("[data-creator-search]")?.value ?? "").trim().toLowerCase();
    const ability = root.querySelector("[data-bg-filter-ability]")?.value ?? "";
    const rules = root.querySelector("[data-class-filter-rules]")?.value ?? "";
    for ( const row of root.querySelectorAll(".creator-pickrow") ) {
      const matchesName = !needle || (row.dataset.name ?? "").toLowerCase().includes(needle);
      const matchesAbility = !ability || (row.dataset.abilities ?? "").split(" ").includes(ability);
      const matchesEdition = !rules || !row.dataset.rules || (row.dataset.rules === rules);
      const shown = matchesName && matchesAbility && matchesEdition;
      (row.closest("li") ?? row).classList.toggle("is-hidden", !shown);
    }
    this._updateNoResults(needle, !!(ability || rules));
    this._updateVisibleCount();
  }

  /**
   * When the official D&D Player's Handbook module is installed, borrow two of its journal
   * sketches as faded backdrops behind the remaining empty-state placeholders — a general
   * adventuring sketch for the choices/equipment/store steps, plus the abjurer on the spells
   * step. The CSS variables feed `.creator-pick-empty::before`; left unset (no PHB module) the
   * backdrops simply don't render, so the creator looks identical without it.
   *
   * The origin steps used to be the main consumer of the first sketch. They have no placeholder
   * any more — they open on their options rather than on a panel announcing it has nothing to
   * show — but the steps that still have one keep theirs.
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
        this._dispatch(el.dataset.stepDrop, el);
      });
    }
  }

  /** @override */
  async close(options = {}) {
    // Nothing the player picks is written to the world until Create, so closing early ends the
    // build — but it no longer has to lose it. Once they've made a choice, ask what should happen
    // to it: every exit path (Cancel, the frame's close, a programmatic close) funnels through
    // here. A finished build, or an explicit `force`, skips the question.
    if ( !this.#finished && !options.force && this.#dirty ) {
      // Editing an existing character has nowhere to be kept but that character, so the question
      // there is the plain one it always was: discard these edits, or carry on?
      if ( !this.#draftable ) {
        if ( !await this._confirmDiscard("cancel.title", "cancel.body") ) return this;
        return super.close(options);
      }
      const choice = await this.#confirmClose();
      if ( choice === "cancel" ) return this;
      // Keeping means settling the debounced save now rather than letting a timer race the close;
      // discarding means dropping both the stored draft and any save still queued for it.
      if ( choice === "keep" ) await flushDraftSave();
      else await clearDraft();
    }
    return super.close(options);
  }

  /**
   * Ask what to do with an unfinished build.
   *
   * Three answers rather than the usual two, because there are genuinely three things a player
   * closing this window might mean: keep it for later (the default, and the reason drafts exist),
   * throw it away, or "I didn't mean to click that". Collapsing the first two into one — as a
   * plain confirm would — makes the safe answer and the destructive one share a button.
   * @returns {Promise<"keep"|"discard"|"cancel">}
   */
  async #confirmClose() {
    return DialogV2.wait({
      window: { title: t("draft.close.title"), icon: "fa-solid fa-floppy-disk" },
      content: `<p>${t("draft.close.body")}</p>`,
      modal: true,
      buttons: [
        { action: "keep", label: t("draft.close.keep"), icon: "fa-solid fa-floppy-disk", default: true },
        { action: "discard", label: t("draft.close.discard"), icon: "fa-solid fa-trash" },
        { action: "cancel", label: t("draft.close.stay"), icon: "fa-solid fa-xmark" }
      ],
      // Dismissing the question is not an answer to it: leave the window, and the draft, alone.
      close: () => "cancel"
    });
  }

  /**
   * Tell the player which restored picks the world could no longer resolve, once, as a warning
   * rather than in silence. A draft that quietly comes back missing its class is far more
   * confusing than one that says the class is gone — the player would otherwise be looking for a
   * mistake they didn't make.
   * @param {string[]} dropped   Origin keys from {@link pruneMissingOrigins}.
   */
  #reportPrunedOrigins(dropped) {
    if ( !dropped.length ) return;
    const names = dropped.map(key => t(`step.${key}.label`)).join(", ");
    ui.notifications?.warn(t("notify.draftPruned", { steps: names }));
  }

  /* -------------------------------------------- */
  /*  Navigation helpers                          */
  /* -------------------------------------------- */
  //
  // These decide which steps are done, reachable, or hidden. The core rule of the whole flow:
  // a step is only reachable once every step before it is complete — so the player can't skip
  // ahead past an unfinished requirement. "Visible" and "reachable" are separate ideas: a step
  // can be shown-but-locked (dimmed on the dossier), or dropped from the flow entirely (see #hidden).

  /** @override One boolean per step, in STEPS order: is it complete right now? */
  _completeFlags() {
    return STEPS.map(s => s.isComplete(this.state));
  }

  /** When resuming a saved character, the first step that still needs input (or review if all done). */
  #firstIncompleteIndex() {
    const idx = REQUIRED_STEPS.findIndex(s => !s.isComplete(this.state));
    return idx === -1 ? STEPS.length - 1 : STEPS.indexOf(REQUIRED_STEPS[idx]);
  }

  /**
   * Whether a step is hidden from the flow right now — a step that opts into {@link
   * hideWhenInapplicable} is dropped entirely (not just dimmed) while it doesn't apply, so the
   * Feat-Spells step appears on the dossier only once a feat that needs it is chosen.
   */
  #hidden(step) {
    return step.hideWhenInapplicable && !(step.applicable?.(this.state) ?? true);
  }

  /** STEPS indices currently shown, in order (hidden steps omitted). */
  #visibleIndices() {
    return STEPS.map((_s, i) => i).filter(i => !this.#hidden(STEPS[i]));
  }

  /**
   * @override The next / previous *visible* step index, or -1 if none — so paging through the flow
   * skips a step that doesn't currently apply instead of landing on it.
   */
  _nextIndex() {
    for ( let i = this._stepIndex + 1; i < STEPS.length; i++ ) if ( !this.#hidden(STEPS[i]) ) return i;
    return -1;
  }

  /** @override */
  _prevIndex() {
    for ( let i = this._stepIndex - 1; i >= 0; i-- ) if ( !this.#hidden(STEPS[i]) ) return i;
    return -1;
  }

  /**
   * One line per visible step, for the dossier's roll. Each carries both what the step *is*
   * (label, index, reachability) and what the player has put in it (`summary`) — which is what
   * lets the dossier be the navigation and the character summary at once instead of two objects.
   *
   * `summary` is not new: every step module has produced this short line since the old stepper,
   * where it was only ever surfaced as a hover tooltip. On the dossier it is the value on the line.
   * @param {boolean[]} flags   Completion per step, in STEPS order.
   * @returns {object[]}
   */
  #stepLines(flags) {
    const lines = [];
    // On the quick screen, a step this build answers for the player is not something outstanding.
    // An em-dash against four of them reads as "four things left to do", which is the opposite of
    // what the screen is promising.
    const quickFilling = this.#entry === "threshold";
    STEPS.forEach((s, i) => {
      if ( this.#hidden(s) ) return;        // dropped from the roll until it applies
      // A step can still opt out of applicability while remaining visible (e.g. Spells for a
      // non-caster); the line is struck through and shows no completion tick.
      const applicable = s.applicable?.(this.state) ?? true;
      const complete = flags[i] && s.id !== "review" && applicable;
      const reachable = this._reachable(i, flags);
      const pending = (quickFilling && applicable && !complete && QUICK_FILLED_STEPS.has(s.id))
        ? t("quickBuild.threshold.willPick")
        : null;
      lines.push({
        index: i,
        id: s.id,
        label: t(s.labelKey),
        icon: s.icon,
        active: i === this._stepIndex,
        applicable,
        complete,
        reachable,
        // "Outstanding" is deliberately narrower than "not complete": a step the player cannot
        // reach yet is not something they have left to do, it is something they have left to
        // arrive at. Marking those too would paint most of the roll teal on the first screen and
        // teach the player to ignore the colour.
        // A step the quick build is about to answer is not something the player has left to do,
        // so it loses the "To do" chip along with its progress count. Leaving the chip would put
        // "To do" and "Quick Build will pick" on the same line, contradicting each other.
        open: reachable && applicable && !complete && s.id !== "review" && !pending,
        // A promise, not an answer — styled quietly so it cannot be mistaken for one.
        pending,
        // Suppressed while the promise stands. Several of these steps report progress even with
        // nothing chosen — Choices says "0 of 6 made" — and a running count is the wrong thing to
        // show beside a screen whose whole claim is that the player has nothing left to answer.
        // It reads as six outstanding tasks rather than six about to be filled in.
        summary: pending ? "" : (s.summary?.(this.state, this.source) ?? "")
      });
    });
    return lines;
  }

  /**
   * The dossier's view-model: the character as it stands, then the step lines.
   *
   * The identity and score blocks are read-only by design. Every control that *sets* one of these
   * values lives on the work surface; the dossier only ever reports. Keeping that rule is what
   * stops the two halves of the window competing to own the same decision.
   * @param {object[]} lines   From {@link #stepLines}.
   * @param {object|null} [threshold]   The quick screen's context, when it is the screen on show.
   */
  #dossierContext(lines, threshold = null) {
    return {
      portrait: this.state.portrait,
      name: this.state.details.name?.trim() ?? "",
      className: this.source.card(this.state.classUuid)?.name ?? "",
      level: this.state.targetLevel ?? 1,
      ...this.#dossierAbilities(threshold),
      steps: lines
    };
  }

  /**
   * The six ability plates: base score plus whatever the chosen origins add.
   *
   * `abilitiesSet` gates whether numbers show at all. Until the ability step is finished the raw
   * state still holds a full set of values (point-buy starts every ability at 8), and printing
   * those would show the player a set of scores they never chose sitting on their sheet. Blanks
   * are the honest reading of "not decided yet".
   */
  #dossierAbilities(threshold = null) {
    // On the quick screen the dossier mirrors the plates in the middle of the stage. Those are a
    // *preview* — `applyQuickBuild` does not write the scores until Create — so reading the state
    // here would show six dashes beside six numbers and leave the player to guess which was real.
    // Nothing is written early to make this work: showing two views of one answer is the
    // dossier's job, and inventing state to populate it would set `abilityMethod` behind the
    // player's back, which is the thing the quick screen was careful not to do.
    if ( threshold?.plates?.length ) {
      return {
        abilities: threshold.plates.map(plate => ({
          key: plate.key,
          abbr: CONFIG.DND5E?.abilities?.[plate.key]?.abbreviation ?? plate.key.slice(0, 3).toUpperCase(),
          value: plate.total,
          modifier: plate.mod,
          bonus: plate.bonus ? `+${plate.bonus}` : null,
          bonusTip: null
        })),
        abilitiesSet: true
      };
    }
    const scores = this.state.resolvedScores();
    const deltas = this.state.abilityDeltas();
    const abilities = ABILITIES.map(key => {
      const bonus = deltas[key]?.total ?? 0;
      const value = (scores[key] ?? 8) + bonus;
      return {
        key,
        abbr: CONFIG.DND5E?.abilities?.[key]?.abbreviation ?? key.slice(0, 3).toUpperCase(),
        value,
        modifier: formatMod(value),
        bonus: bonus ? `+${bonus}` : null,
        bonusTip: bonus
          ? deltas[key].sources.map(s => t(`step.${s.source}.label`) + ` +${s.bonus}`).join(", ")
          : null
      };
    });
    // The class step owns the ability panel, so its completion flag is the one that says whether a
    // full, valid set of scores exists.
    return { abilities, abilitiesSet: STEPS[0].isComplete(this.state) };
  }

  /* -------------------------------------------- */
  /*  Dispatch                                    */
  /* -------------------------------------------- */

  /**
   * @override
   * The shared context handed to every step's `context()` and `handle()`. `app` lets a
   * step request a re-render after an async flow that resolves later (e.g. a FilePicker
   * callback), since the dispatch's own render fires immediately.
   */
  _ctx() {
    return { state: this.state, source: this.source, spells: this.spells, equipment: this.equipment, store: this.store, app: this };
  }

  /* -------------------------------------------- */
  /*  The entry screens                           */
  /* -------------------------------------------- */

  /**
   * Mark this window's work as concluded, so closing it does not warn about a discard.
   *
   * Taking one of Foundry's pregenerated characters finishes the job without going through
   * `_finish` — the actor is imported whole rather than built — so the latch has to be set by hand.
   * Without it the player is asked whether they really want to throw away the character they just
   * successfully made.
   */
  markFinished() {
    this.#finished = true;
    cancelDraftSave();
    clearDraft();
  }

  /**
   * Whether to open on the chooser: this is a fresh build and Ember does not own creation here.
   *
   * The chooser is the front door now, not an opt-in. It was built behind a world setting so that
   * no existing world would acquire a new first screen by upgrading; that setting is gone, and
   * every world gets it. Nothing about the step-by-step path changed — it is simply reached by
   * choosing it rather than by default.
   *
   * Two things still suppress it. **Ember** owns creation outright and has its own front end, so a
   * chooser in front of it would be a door onto a room someone else furnished. And **a build
   * already under way** — a resumed draft, an actor being finished — goes back to its work rather
   * than being asked how the player would like to start something they already started.
   * @returns {boolean}
   */
  #shouldOfferEntry() {
    if ( emberActive() ) return false;
    return !this.state.classUuid && !this.state.speciesUuid && !this.state.backgroundUuid;
  }

  /**
   * Escape on an entry screen. Every other overlay in this window closes on Escape, so these have
   * to as well or the key becomes conditional — but "close" means something different here: an
   * entry screen has nothing behind it yet, so Escape takes the path that always works. From the
   * chooser that is Custom build (the wizard, which is where Escape would have left them anyway);
   * from the other two it is back to the chooser.
   * @param {HTMLElement} root
   */
  #wireEntryEscape(root) {
    const overlay = root.querySelector(".creator-entry, .creator-threshold");
    if ( !overlay ) return;
    overlay.addEventListener("keydown", ev => {
      if ( ev.key !== "Escape" ) return;
      ev.preventDefault();
      ev.stopPropagation();
      if ( this.#entry === "chooser" ) this._entryPath("custom");
      else this._openEntry("chooser");
    });
    // Take focus so Escape reaches the handler without the player clicking first — but never off
    // an input the player may already be typing in.
    if ( !root.contains(document.activeElement) ) overlay.focus?.();
  }

  /**
   * Whether to still offer the way back to an entry screen.
   *
   * Withdrawn from the Choices step onwards. Up to that point the player has only settled the same
   * three things the entry screens are about, so going back costs nothing. Choices is where the
   * build starts answering questions that belong to those three — a class's fighting style, a
   * species' lineage — and an offer to start over from a different door, sitting in the footer
   * beside that work, is an invitation to lose it.
   *
   * Hidden rather than disabled: a greyed control still reads as something the player might get
   * back, and this one is simply finished with.
   * @returns {boolean}
   */
  #canReturnToEntry() {
    if ( !this.#returnTo || this.#entry || this.#loading ) return false;
    const choices = STEPS.findIndex(step => step.id === "choices");
    return (choices < 0) || (this._stepIndex < choices);
  }

  /**
   * The heading band for whichever entry screen is open, or null when none is.
   *
   * The chooser's question is its heading, so it is lifted here and not drawn again in the body.
   * @returns {{title: string, instruction: string|null}|null}
   */
  #entryHeading() {
    if ( this.#entry === "chooser" ) {
      return { title: t("entry.heading"), instruction: t("entry.blurb") };
    }
    if ( this.#entry === "premade" ) {
      return { title: t("entry.premade.heading"), instruction: t("entry.premade.blurb") };
    }
    if ( this.#entry === "threshold" ) {
      return {
        title: t("quickBuild.threshold.title"),
        instruction: t("quickBuild.threshold.instruction")
      };
    }
    return null;
  }

  /**
   * Show one entry screen, or dismiss them all with null. Clears the other overlays for the same
   * reason they clear each other: one absolute surface over the stage at a time.
   * @param {"chooser"|"premade"|"threshold"|null} view
   */
  async _openEntry(view) {
    this.#entry = view;
    this._sourceDetails = null;
    this._compare = null;
    if ( view === "threshold" ) {
      this.#thresholdRules ??= systemRulesEdition();
      // Open on a character rather than three blanks: an empty threshold would ask for three
      // decisions before it could show anything, which is the wizard it exists to replace.
      await seedThreshold(this._ctx(), { rules: this.#thresholdRules });
      this.#nameTouched = false;
    }
    this.render();
  }

  /**
   * Take one of the three paths. Custom dismisses the entry screens onto the wizard, unchanged;
   * the other two open their own screen.
   * @param {"custom"|"quick"|"premade"} path
   */
  async _entryPath(path) {
    if ( path === "quick" ) return this._openEntry("threshold");
    if ( path === "premade" ) return this._openEntry("premade");
    // Custom: dismiss onto the wizard. Anything the threshold already seeded is kept rather than
    // discarded — the player carries their picks in with them. The way back now points at the
    // chooser rather than the quick screen: what they may want to reconsider is which path they
    // took, not which class.
    this.#entry = null;
    this.#returnTo = "chooser";
    this._leaveStepFor(this.#firstIncompleteIndex());
  }

  /**
   * "Browse all 13" on a threshold card: leave for that category's own step, where the full grid,
   * the detail pane and the comparison tool already live. Rebuilding any of that inside the overlay
   * would be a second picker to maintain.
   *
   * The seeded pick is **cleared on the way out**. Arriving with it still selected — one card lit,
   * the detail pane already filled — reads as "here is your class" rather than "here are the
   * classes", which makes the control look like it did nothing. The step is a question again, and
   * the footer carries the way back.
   * @param {"class"|"species"|"background"} category
   */
  async _entryBrowse(category) {
    this.#dirty = true;
    await thresholdClear(this._ctx(), category);
    this.#entry = null;
    this.#returnTo = "threshold";
    const index = STEPS.findIndex(step => step.id === category);
    this._leaveStepFor(index >= 0 ? index : this.#firstIncompleteIndex());
  }

  /**
   * Select a ready-made character. Selecting is not taking it: creating an actor is the one action
   * in this window that cannot be undone from inside it, so it takes a second, deliberate press.
   * @param {string} id
   */
  _premadeSelect(id) {
    this.#premadeChoice = (this.#premadeChoice === id) ? null : id;
    this.render();
  }

  /** Create the selected ready-made character. */
  async _premadeConfirm(el) {
    const id = this.#premadeChoice;
    if ( !id ) return;
    const official = (await foundryPregens())
      .flatMap(group => group.entries)
      .find(pc => pc.id === id);
    this.#dirty = true;
    if ( official ) return takePregen(this._ctx(), official.uuid, el);
    this.#entry = null;
    this.#returnTo = null;
    const done = await applyPremade(this._ctx(), id, el);
    if ( !done ) this.render();
  }

  /**
   * Back to the quick screen from whichever step the player wandered to.
   *
   * Anything they chose while they were away is kept — that was the point of the trip — and any
   * slot still empty is re-seeded, so the screen is never reached with a blank card.
   */
  async _returnToQuick() {
    const target = this.#returnTo ?? "chooser";
    this.#returnTo = null;
    return this._openEntry(target);
  }

  /**
   * Switch the quick screen between 5e (2014) and 5.5e (2024).
   *
   * Every pick is cleared and re-seeded rather than kept: a 2014 class with a 2024 background is
   * not a character anyone asked for, and the origin grids are scoped to the class's edition
   * everywhere else in the wizard for exactly that reason.
   * @param {"2014"|"2024"} rules
   */
  async _thresholdEdition(rules) {
    if ( !rules || rules === this.#thresholdRules ) return;
    this.#thresholdRules = rules;
    this.#dirty = true;
    this.state.classUuid = null;
    this.state.speciesUuid = null;
    this.state.backgroundUuid = null;
    this.state.resetClassDependent();
    this.state.resetSourceChoices("species");
    this.state.resetSourceChoices("background");
    await seedThreshold(this._ctx(), { rules });
    this.render();
  }

  /**
   * Set the starting level from the threshold's rungs.
   *
   * Only `targetLevel` changes — none of the three picks, and nothing `applyQuickBuild` fills. The
   * level is consumed after the character is created, by the climb, so changing it here costs
   * nothing and never invalidates a pick already made.
   * @param {string|number} level
   */
  _thresholdLevel(level) {
    const next = Number(level) || 1;
    if ( !isQuickLevel(next) || (next === this.state.targetLevel) ) return;
    this.state.targetLevel = next;
    this.#dirty = true;
    this.render();
  }

  /**
   * Roll one of the threshold's dice: a category, or the name.
   * @param {"class"|"species"|"background"|"name"} category
   */
  async _thresholdRoll(category) {
    this.#dirty = true;
    if ( category === "name" ) {
      thresholdRollName(this._ctx());
      this.#nameTouched = false;
    } else {
      await thresholdRoll(this._ctx(), category,
        { rerollName: !this.#nameTouched, rules: this.#thresholdRules });
    }
    this.render();
  }

  /**
   * Roll a whole character: all three cards and the name.
   *
   * The name goes with them, and the touched flag resets — asking for a random character is asking
   * for a random name too, unlike the species die, which leaves a name the player wrote alone.
   */
  async _thresholdRollAll() {
    this.#dirty = true;
    await thresholdRollAll(this._ctx(), { rules: this.#thresholdRules });
    this.#nameTouched = false;
    this.render();
  }

  /**
   * The typed name. Written straight to the state without a re-render: re-rendering would destroy
   * the very box the player is typing in, which is the same reason the ability panel patches in
   * place rather than repainting.
   * @param {string} value
   */
  _thresholdName(value) {
    this.state.details.name = value;
    this.#nameTouched = true;
    this.#dirty = true;
  }

  /**
   * Fill the character from the threshold's three picks and create it.
   *
   * "Create Character" means what it says: the actor is built and the window closes. Landing on
   * Review instead would make the button a lie and leave a second Create to find, which is the
   * wizard this screen exists to skip.
   *
   * The one case that does not create is a fill with a gap in it — a class whose spell list could
   * not be read, say. `_finish` already refuses unless every required step is complete, but it
   * refuses *silently*, so the gap is caught here and the player is put on the step that still
   * needs them rather than left pressing a button that does nothing.
   */
  async _thresholdCreate(el) {
    this.#dirty = true;
    this.#returnTo = null;
    // Remember that this build came from the quick screen, so `_finish` climbs headlessly instead
    // of opening the level-up wizard. The flag rather than a look at `#entry`: by the time `_finish`
    // runs the overlay has been dismissed, and "which door did this character come through" is the
    // question being asked, not "which door is open now".
    this.#quickClimb = true;
    const filled = await thresholdCreate(this._ctx(), el);
    this.#entry = null;
    if ( !filled ) { this.render(); return; }

    if ( REQUIRED_STEPS.every(step => step.isComplete(this.state)) ) return this._finish(el);

    ui.notifications?.warn(t("quickBuild.partial"));
    this._leaveStepFor(this.#firstIncompleteIndex());
  }

  /** @override Creation step changes are public — see {@link module:api}. */
  get _stepChangeHook() { return HOOKS.creationStepChanged; }

  /** @override */
  get _hookState() { return this.state; }

  /** @override Any step interaction counts as progress worth confirming before a discard. */
  _onDispatch(action) {
    this.#dirty = true;
    // Keep the stored draft current. Debounced, so a run of clicks costs one write — and skipped
    // once the build has started, when the draft is about to be thrown away anyway.
    if ( this.#draftable && !this.#finished ) scheduleDraftSave(this.state);
    // Choosing an option answers the question the drawer was opened to ask, so it closes itself.
    // Re-clicking the chosen row clears the selection instead, and #drawerOpen() reopens it on the
    // next render — a step with nothing chosen always shows its options.
    if ( action === "pick-class" || action === "pick-origin" ) {
      this.state.pickerFor = null;
      // The card just clicked is about to be re-rendered away with the drawer, so land the
      // keyboard on the switcher that now names the choice. If this click *cleared* a selection
      // instead, the drawer reopens and there is no switcher — #restoreFocus() finds nothing and
      // leaves focus alone, which is the behaviour that was there before.
      this.#focusAfterRender = ".creator-work-switch";
    }
  }

  /**
   * Whether the picker drawer is open on the current step.
   *
   * Derived rather than stored, from one nullable field: the drawer is open when nothing is
   * chosen (there is nothing underneath worth covering, and the choice *is* the step), or when the
   * player explicitly opened it from the switcher. Because `pickerFor` is compared against the
   * active step's id, navigating away closes it with no reset logic anywhere.
   * @param {object} step        The active step module.
   * @param {object} stepContext The context it just produced.
   * @returns {boolean}
   */
  #drawerOpen(step, stepContext) {
    if ( !("hasSelection" in stepContext) ) return false;    // not a pick step; it has no drawer
    return !stepContext.hasSelection || this.state.pickerFor === step.id;
  }

  /**
   * Open or close the picker drawer on the current step. Bound to the `openPicker`/`closePicker`
   * actions above.
   * @param {boolean} open
   */
  _setPicker(open) {
    this.state.pickerFor = open ? this._activeStep?.id ?? null : null;
    // Follow the drawer with the keyboard: opening lands in the search field at the top of the
    // list just asked for, closing returns to the switcher that opened it. Without this the
    // re-render below destroys whichever control was activated and focus falls to <body>.
    this.#focusAfterRender = open ? "[data-creator-search]" : ".creator-work-switch";
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
    const reached = this._reachable(index);
    this._leaveStepFor(reached ? index : this.#firstIncompleteIndex());
    return reached;
  }

  /**
   * @override
   * The "Create" button. This is where the draft finally becomes a real actor in the world:
   * guard that every required step is done, create the actor if we don't already have one, then
   * hand off to assembleActor() to write class/species/spells/equipment onto it. On any failure we
   * roll #finished back so the window stays open and the player can retry.
   */
  async _finish(target) {
    // A build takes seconds (actor create + advancement manager + many embedded writes), so guard
    // against a second click landing while the first is still running — without this, the second
    // pass sees state.actor still null and builds a whole second actor. #finished is our latch.
    if ( this.#finished ) return;
    if ( !REQUIRED_STEPS.every(s => s.isComplete(this.state)) ) return;
    this.#finished = true;
    // Stop the autosave before the build starts. It would otherwise be racing a flow that ends by
    // deleting the very draft it is writing — and on a failed build the state is restored below,
    // so nothing is lost by holding off until then.
    cancelDraftSave();
    // Tell the player work is happening, and make the button un-clickable for real (the latch above
    // already blocks re-entry; this is the visible half of the same guard).
    if ( target ) {
      target.disabled = true;
      target.textContent = t("nav.building");
    }

    // The veto point: every choice is made and validated, but nothing has been written to the
    // world yet — so a listener refusing here costs nothing to undo. This is the seam a GM
    // approval queue or a house-rule validator hangs off. Fired before `Actor.create` on purpose;
    // afterwards there would be an actor to clean up.
    if ( !fireCancellableHook(HOOKS.preCreateCharacter, { state: this.state, actor: this.state.actor ?? null }) ) {
      this.#reopenForRetry(target);
      return;
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
      this.#reopenForRetry(target);
      return;
    }
    // The draft has become a character, so it has nothing left to protect. Cleared before the
    // close so the close's own prompt — which `force` skips anyway — can never re-save it.
    if ( this.#draftable ) await clearDraft();
    await this.close();
    actor?.sheet?.render(true);
    // The build above always produces a level-1 character. When the player asked for more on the
    // Class step, hand the rest to the level-up wizard: one manager for the whole 1→target jump, so
    // they get a screen per gained level and a single commit. It opens over the sheet we just
    // rendered — so if they close it, they still have the (valid) level-1 character they built.
    // The creator state rides along so that wizard can announce the finished character with the
    // same payload this one would have (see {@link module:levelup/intercept}).
    const targetLevel = this.state.targetLevel ?? 1;
    // A Quick Build climbs headlessly: the screen promised three choices, so handing back a
    // multi-level wizard here would break that promise at the last moment. Every other route keeps
    // the interactive climb, where the player asked for the levels a screen at a time.
    // `climbing` stays false for the quick path because nothing downstream will post the card —
    // the climb is already over by the time this returns, so the duty to announce stays here.
    const climbing = (actor && targetLevel > 1 && !this.#quickClimb)
      ? await launchLevelUpTo(actor, targetLevel, { creationState: this.state })
      : false;
    if ( actor && (targetLevel > 1) && this.#quickClimb ) {
      const { reached } = await quickClimb(actor, targetLevel, this.source, this.spells);
      // Said plainly when the climb fell short: the character is valid at the level it reached, and
      // the repair wrench on the sheet offers the rest. Silence here would leave a player looking
      // at a 3rd-level character they asked to be 5th with no idea why.
      if ( reached < targetLevel ) {
        ui.notifications?.warn(t("quickBuild.climbPartial", { reached, target: targetLevel }));
      }
    }
    // Announce the finished character — but only when it *is* finished. A climb to a higher
    // starting level isn't done yet, so that wizard owns the card and posts it on Apply (or on
    // abandon, since the level-1 character it leaves behind is still a character). When the climb
    // never opened, nothing downstream will post it and the duty stays here.
    //
    // The public hook rides alongside the card rather than inside it, because the two answer to
    // different masters: the card is the GM's setting to switch off, the hook is a contract with
    // other modules and fires either way.
    if ( !climbing ) {
      fireHook(HOOKS.characterCreated, { actor, state: this.state, targetLevel });
      await postCreationSummary(actor, { magicShop: actor.sogromMagicShopGrant ?? null });
      // The sheet PDF, when it was asked for. Same rule as the card: a climb isn't finished here,
      // and that wizard prints it at the level the player actually asked for.
      if ( this.state.exportPdf ) await exportCharacterPdf(actor);
    }
  }

  /**
   * Undo the Create button's "building…" state so the player can try again without reopening the
   * window: release the re-entrancy latch and put the button back.
   *
   * Shared by the two ways a build stops after that state is entered — a listener vetoing
   * `preCreateCharacter`, and assembly throwing — so the veto path cannot drift from the
   * long-standing failure path.
   * @param {HTMLElement} [target]  The Create button, when the click supplied one.
   */
  #reopenForRetry(target) {
    this.#finished = false;
    // The build stopped, so the choices are unsaved work again and worth keeping.
    if ( this.#draftable ) scheduleDraftSave(this.state);
    if ( target ) {
      target.disabled = false;
      target.textContent = t("nav.create");
    }
  }
}
