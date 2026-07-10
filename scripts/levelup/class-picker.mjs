import { MODULE_ID, tpl, t, log, multiclassMode, emberActive } from "../config.mjs";
import { getSources, isStale, invalidateSources } from "../data/source-cache.mjs";
import { multiclassBlockers, formatBlockers } from "./multiclass.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The multiclass class picker: a small themed window listing every class from the enabled
 * sources that the actor doesn't already have, reusing the creator's pick-list/detail layout
 * (and the shared, pre-warmed {@link SourceIndex} cards). Under the `"prereq"` multiclass mode
 * an ineligible class stays visible but locked, its tooltip naming the missing ability —
 * so a player sees *why* Monk is out of reach rather than wondering where it went.
 *
 * Use via {@link MulticlassPicker.pick}, which resolves with the chosen class's UUID, or null
 * when the player cancels or closes the window. Selection model matches the creation steps:
 * click a row to select it and read its description, then confirm.
 */
export class MulticlassPicker extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sogrom-mc-picker",
    classes: ["sogrom-creator", "sogrom-mc-picker"],
    tag: "div",
    window: {
      title: `${MODULE_ID}.levelup.multiclass.pickerTitle`,
      icon: "fa-solid fa-chess-rook",
      frame: true,
      positioned: true,
      resizable: true
    },
    position: { width: 900, height: 620 },
    actions: {
      pickClass: MulticlassPicker.#onPick,
      confirm: MulticlassPicker.#onConfirm,
      cancel: MulticlassPicker.#onCancel
    }
  };

  static PARTS = {
    body: {
      id: "body",
      template: tpl("levelup/class-picker.hbs"),
      scrollable: [".creator-picklist", ".creator-pick-desc"]
    }
  };

  /** @type {{uuid: string, name: string, img: string, disabled: boolean, reason: string}[]} */
  #cards;
  /** @type {import("../data/source-index.mjs").SourceIndex} For the detail pane. */
  #source;
  /** The currently-selected card's UUID, or null. */
  #selected = null;
  /** Settles the promise {@link pick} returned; nulled once called so close() can't double-fire. */
  #resolve;

  constructor({ cards, source, resolve }, options = {}) {
    super(options);
    this.#cards = cards;
    this.#source = source;
    this.#resolve = resolve;
  }

  /**
   * Open the picker for an actor and resolve with the chosen class UUID (or null on cancel).
   * Builds the card list first: classes the actor already has are dropped by identifier; under
   * the `"prereq"` mode each remaining candidate is resolved and checked against the written
   * multiclass prerequisites, locking the failures with the reason as their tooltip.
   * @param {Actor5e} actor
   * @returns {Promise<string|null>}
   */
  static async pick(actor) {
    if ( isStale() ) invalidateSources();
    const { source } = getSources();
    if ( !source.loaded ) await source.load();

    const owned = new Set(actor.items.filter(i => i.type === "class")
      .map(i => i.system?.identifier).filter(Boolean));
    const checkPrereqs = multiclassMode() === "prereq";

    const cards = [];
    for ( const card of source.classes() ) {
      if ( owned.has(card.identifier) ) continue;
      let reason = "";
      if ( checkPrereqs ) {
        // The full document carries system.primaryAbility; the cards are index-thin. All of
        // these are pre-warmed by the ready warm-up, so this is a cache hit in practice.
        const doc = await fromUuid(card.uuid).catch(err => { log("class resolve failed", card.uuid, err); return null; });
        const blockers = doc ? multiclassBlockers(actor, doc) : [];
        if ( blockers.length ) reason = formatBlockers(blockers);
      }
      cards.push({ uuid: card.uuid, name: card.name, img: card.img, disabled: !!reason, reason });
    }

    if ( !cards.length ) {
      ui.notifications?.warn(t("levelup.multiclass.noneAvailable"));
      return null;
    }
    // With Ember active the picker wears its skin like the level-up window does (see
    // launchWindowOptions); ApplicationV2 replaces (not merges) classes, so pass the full list.
    const options = emberActive()
      ? { classes: ["sogrom-creator", "sogrom-mc-picker", "sogrom-ember"] }
      : {};
    return new Promise(resolve => new MulticlassPicker({ cards, source, resolve }, options).render(true));
  }

  async _prepareContext() {
    const selected = this.#selected;
    // The detail pane reuses the creation steps' resolved detail + advancement groups (both
    // memoised on the shared SourceIndex, so re-selecting a card never re-reads the pack).
    const [detail, groups] = selected
      ? await Promise.all([
        this.#source.detail(selected).catch(() => null),
        this.#source.advancementGroups(selected).catch(() => null)
      ])
      : [null, null];
    return {
      cards: this.#cards.map(c => ({ ...c, selected: c.uuid === selected })),
      hasSelection: !!selected,
      detail,
      groups
    };
  }

  /** Select a row (re-clicking clears it); locked rows only show their tooltip. */
  static #onPick(_event, target) {
    const card = this.#cards.find(c => c.uuid === target.dataset.uuid);
    if ( !card || card.disabled ) return;
    this.#selected = this.#selected === card.uuid ? null : card.uuid;
    this.render();
  }

  static #onConfirm() {
    if ( !this.#selected ) return;
    this.#settle(this.#selected);
    this.close();
  }

  static #onCancel() {
    this.close();
  }

  /** Closing by any path (Esc, the frame's ✕, cancel) resolves null unless confirm settled first. */
  _onClose(options) {
    super._onClose?.(options);
    this.#settle(null);
  }

  #settle(value) {
    this.#resolve?.(value);
    this.#resolve = null;
  }
}
