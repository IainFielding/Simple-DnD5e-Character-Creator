import { t, log } from "../config.mjs";
import { formatCp } from "../data/store-source.mjs";
import { sectionKey, groupCards, itemTypeLabel, subtypeLabel } from "../data/shelf-sections.mjs";
import {
  RARITIES, rarityRank, rarityLabel, countPicks, canPick, withinAllowance, slotsSummary,
  highestSlotRank, bonusGoldCp, goldRange, itemUsability
} from "../data/magic-shop.mjs";
import {
  magicShopConfig, magicShopTier, magicShopSource, ensureMagicShopRoll, goldNeedsRoll, goldRolled, pickList,
  usabilityProfile, proficiencyMaps
} from "../data/magic-shop-source.mjs";

/**
 * The Magic Items step: for a character starting above level 1, the bonus gold and free magic
 * items the (GM-overridable) DMG table grants. It sits after the Store, and its gold goes straight
 * to the purse on Create rather than into the Store's budget.
 *
 * The bonus-gold d10 is the player's to roll, from a button in the gold panel, like a hit-point roll:
 * the throw is seen (Dice So Nice animates it), the result is locked once rolled, and the step is not
 * complete until it has been. The creation chat card then records the roll. The picks are free: a slot takes its own
 * rarity or anything lower, so the shelf shows every rarity up to the rarest slot the tier has, and
 * a row can be added only while it would still fit.
 *
 * The shelf is loaded lazily — see {@link module:data/magic-shop-source.MagicShopSource}. Until it
 * is ready the step renders a percentage and re-renders itself when the load lands.
 */

/** The step id, also used to tell whether the player is still on this step when a load finishes. */
const STEP_ID = "magicShop";

export const magicShopStep = {
  id: STEP_ID,
  icon: "fa-solid fa-wand-sparkles",
  labelKey: "step.magicShop.label",
  template: "steps/magic-shop",

  // Only a build climbing past level 1 with the GM's shop switched on sees this step at all.
  hideWhenInapplicable: true,

  applicable(state) {
    return !!magicShopTier(state);
  },

  isComplete(state) {
    const tier = magicShopTier(state);
    if ( !tier ) return true;
    if ( !withinAllowance(countPicks(state.magicShop?.picks), tier.allowance) ) return false;
    if ( !goldRolled(state, tier) ) return false;
    return !!state.magicShopVisited;
  },

  onEnter(state) {
    state.magicShopVisited = true;
  },

  incompleteHint(state) {
    const tier = magicShopTier(state);
    if ( tier && !withinAllowance(countPicks(state.magicShop?.picks), tier.allowance) ) {
      return t("step.magicShop.overAllowance");
    }
    if ( tier && !goldRolled(state, tier) ) return t("step.magicShop.rollFirst");
    return null;
  },

  /** Rail summary: how many items are picked and the gold. */
  summary(state) {
    const tier = magicShopTier(state);
    if ( !tier ) return "";
    const count = pickList(state).reduce((n, p) => n + p.qty, 0);
    const goldCp = goldRolled(state, tier) ? bonusGoldCp(tier, state.magicShop?.d10 ?? 0) : 0;
    if ( !count && !goldCp ) return "";
    return t("step.magicShop.summary", { count, gold: formatCp(goldCp) });
  },

  async handle(action, el, { state }) {
    state.magicShop ??= { d10: null, picks: {} };
    const picks = state.magicShop.picks;
    if ( action === "magic-roll" ) {
      if ( !goldNeedsRoll(magicShopTier(state)) ) return false;
      await ensureMagicShopRoll(state);
      return;
    }
    if ( action === "magic-add" ) {
      const tier = magicShopTier(state);
      const uuid = el.dataset.uuid;
      const rarity = el.dataset.rarity;
      if ( !tier || !uuid || !canPick(countPicks(picks), rarity, tier.allowance) ) return;
      const pick = picks[uuid] ??= { qty: 0, name: el.dataset.name ?? "", img: el.dataset.img ?? "", rarity };
      pick.qty += 1;
      return;
    }
    if ( action === "magic-remove" ) {
      const pick = picks[el.dataset.uuid];
      if ( !pick ) return;
      pick.qty -= 1;
      if ( pick.qty <= 0 ) delete picks[el.dataset.uuid];
      return;
    }
    if ( action === "magic-clear" ) {
      state.magicShop.picks = {};
      return;
    }
    if ( action === "magic-category" ) {
      state.magicShopCategory = el.value ?? "";
      state.magicShopSubtype = "";   // subtype keys only mean anything inside their category
      return;
    }
    if ( action === "magic-subtype" ) {
      state.magicShopSubtype = el.value ?? "";
      return;
    }
    if ( action === "magic-rarity" ) {
      state.magicShopRarity = el.value ?? "";
      return;
    }
    if ( action === "magic-group" ) {
      const key = el.dataset.group;
      const open = new Set(state.magicShopOpenGroups ?? []);
      if ( open.has(key) ) open.delete(key);
      else open.add(key);
      state.magicShopOpenGroups = [...open];
    }
  },

  async context({ state, app, actor = null }) {
    const config = magicShopConfig();
    const tier = magicShopTier(state, config);
    if ( !tier ) return { unavailable: true };

    state.magicShop ??= { d10: null, picks: {} };
    const d10 = Number.isInteger(state.magicShop.d10) ? state.magicShop.d10 : null;
    const counts = countPicks(state.magicShop.picks);
    const aside = asideContext(state, tier, d10, counts);

    const topRank = highestSlotRank(tier.allowance);
    if ( topRank < 0 ) return { ...aside, noItems: true };

    // Lazy load: the first visit resolves the stock behind a percentage, then re-renders. The whole
    // visible inventory is loaded, not just this tier's rarities, so changing level never reloads.
    const entries = config.inventory.filter(e => !e.hidden);
    const stock = magicShopSource.peek(entries);
    if ( !stock ) {
      magicShopSource.load(entries, pct => {
        const node = app?.element?.querySelector("[data-magic-progress]");
        if ( node ) node.textContent = t("step.magicShop.loading", { percent: pct });
      }).then(() => {
        if ( app?.rendered && (app._activeStep?.id === STEP_ID) ) app.render();
      }).catch(err => {
        log("magic shop stock failed to load", err);
        ui.notifications?.error(t("step.magicShop.loadFailed"));
      });
      return { ...aside, loading: true, loadingLabel: t("step.magicShop.loading", { percent: magicShopSource.percent }) };
    }

    const eligible = stock.filter(e => rarityRank(e.rarity) <= topRank);

    // Filters: category and subtype exactly as the Store offers them, plus rarity.
    const category = state.magicShopCategory ?? "";
    const categories = [...new Set(eligible.map(e => e.type))].sort()
      .map(type => ({ value: type, label: itemTypeLabel(type), selected: type === category }));
    const subtype = category ? (state.magicShopSubtype ?? "") : "";
    const subtypes = !category ? [] : [...new Set(eligible.filter(e => e.type === category).map(e => e.subtype))]
      .filter(Boolean)
      .map(key => ({ value: key, label: subtypeLabel(category, key), selected: key === subtype }))
      .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
    const rarity = state.magicShopRarity ?? "";
    const rarities = RARITIES.slice(0, topRank + 1)
      .filter(r => eligible.some(e => e.rarity === r))
      .map(r => ({ value: r, label: rarityLabel(r), selected: r === rarity }));

    // What the character can actually use. Nothing is hidden or blocked — a player may well want an
    // item for a later level, or for someone else at the table — but an item they cannot use says so
    // on its card, which is the difference between a considered pick and a wasted one.
    const profile = usabilityProfile(actor);
    const maps = profile ? proficiencyMaps() : null;

    const picks = state.magicShop.picks;
    const cards = eligible
      .filter(e => (!category || e.type === category) && (!subtype || e.subtype === subtype)
        && (!rarity || e.rarity === rarity))
      .map(e => {
        const qty = picks[e.uuid]?.qty ?? 0;
        const use = profile ? itemUsability(e, profile, maps) : null;
        const warnings = [];
        if ( use && !use.proficient ) warnings.push(t("step.magicShop.notProficient"));
        if ( use?.needsStrength ) warnings.push(t("step.magicShop.needsStrength", { score: use.needsStrength }));
        return {
          uuid: e.uuid, link: e.link ?? e.uuid, name: e.name, img: e.img, rarity: e.rarity,
          rarityLabel: rarityLabel(e.rarity),
          section: sectionKey(e),
          typeLabel: itemTypeLabel(e.type),
          qty, picked: qty > 0,
          canAdd: canPick(counts, e.rarity, tier.allowance),
          warnings,
          warningLabel: warnings.join(" · "),
          warningTip: warnings.length ? t("step.magicShop.usableTip") : null
        };
      });

    // Every section starts collapsed so a long shop scrolls as a short list of headings. A filter that
    // narrows the shelf to a single section opens it, since there is nothing else to scroll past.
    const openGroups = new Set(state.magicShopOpenGroups ?? []);
    const grouped = groupCards(cards, key => {
      if ( key === "armor" ) return t("step.store.armorHeading");
      if ( key === "game" ) return t("step.store.gamingHeading");
      if ( key === "music" ) return t("step.store.instrumentHeading");
      return itemTypeLabel(key);
    });
    const groups = grouped.map(g => ({
      ...g,
      count: g.cards.length,
      pickedCount: g.cards.reduce((n, c) => n + c.qty, 0),
      open: (grouped.length === 1) || openGroups.has(g.key)
    }));

    return {
      ...aside,
      intro: t("step.magicShop.intro"),
      groups,
      hasGoods: cards.length > 0,
      stockEmpty: eligible.length === 0,
      count: cards.length,
      categories,
      hasCategories: categories.length > 1,
      subtypes,
      hasSubtypes: subtypes.length > 1,
      rarities,
      hasRarities: rarities.length > 1
    };
  }
};

/** The right-hand column: the gold roll, the slot chips and the picks. Needs no stock. */
function asideContext(state, tier, d10, counts) {
  const rollable = goldNeedsRoll(tier);
  const rolled = !rollable || (d10 !== null);
  const goldCp = rolled ? bonusGoldCp(tier, d10 ?? 0) : 0;
  const hasGold = (tier.baseGp > 0) || rollable;
  const range = goldRange(tier);
  const picks = pickList(state).map(p => ({ ...p, multi: p.qty > 1, rarityLabel: rarityLabel(p.rarity) }));
  const slots = slotsSummary(counts, tier.allowance).map(s => ({ ...s, label: rarityLabel(s.rarity) }));
  const fits = withinAllowance(counts, tier.allowance);
  return {
    tierLabel: t("step.magicShop.tier", { from: tier.from, to: tier.to }),
    hasGold,
    rollable,
    rolled,
    d10,
    goldFormula: rolled
      ? t("step.magicShop.goldFormula", { base: tier.baseGp, die: d10 ?? 0, per: tier.perD10Gp })
      : t("step.magicShop.goldFormulaUnrolled", { base: tier.baseGp, per: tier.perD10Gp }),
    gold: rolled ? formatCp(goldCp) : t("step.magicShop.goldRange", { min: range.min, max: range.max }),
    slots,
    hasSlots: slots.length > 0,
    picks,
    hasPicks: picks.length > 0,
    overAllowance: !fits
  };
}
