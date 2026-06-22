/**
 * Factory that builds an "origin" selection step (class, species, background).
 *
 * All three present a filterable grid of cards; picking one records its UUID on
 * the state and reveals its enriched description inline. Rather than repeat that
 * across three modules, each step is produced by configuring this factory with
 * the state field it writes and the card list it reads. This composition is the
 * unit of reuse here — there is no shared base Application doing the work.
 *
 * @param {object} cfg
 * @param {string} cfg.id           Step id (also its rail/template key).
 * @param {string} cfg.icon         FontAwesome classes for the rail.
 * @param {string} cfg.labelKey     i18n key for the step label.
 * @param {string} cfg.field        CreatorState property holding the chosen UUID.
 * @param {(src: import("../data/source-index.mjs").SourceIndex) => object[]} cfg.cards
 * @returns {object} A step module.
 */
export function originStep({ id, icon, labelKey, field, cards }) {
  return {
    id,
    icon,
    labelKey,
    template: "steps/origin",

    isComplete(state) {
      return !!state[field];
    },

    /** Short label shown on the rail once a choice is made. */
    summary(state, source) {
      return source.card(state[field])?.name ?? "";
    },

    async handle(action, el, { state }) {
      if ( action !== "pick-origin" ) return;
      const uuid = el.dataset.uuid;
      // Re-clicking the active card clears it, so a player can back out of a choice.
      state[field] = state[field] === uuid ? null : uuid;
    },

    async context({ state, source }) {
      const selected = state[field];
      const detail = selected ? await source.detail(selected) : null;
      const list = cards(source).map(c => ({ ...c, selected: c.uuid === selected }));
      return {
        cards: list,
        count: list.length,
        hasSelection: !!selected,
        selectedName: detail?.name ?? "",
        detail
      };
    }
  };
}
