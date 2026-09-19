import { magicShopStep } from "../../steps/magic-shop-step.mjs";
import { goldRolled, magicShopTier } from "../../data/magic-shop-source.mjs";
import { countPicks, withinAllowance } from "../../data/magic-shop.mjs";

/**
 * The Magic Items step on the **level-up** rail — the creator's own step, shown at the end of a
 * creation climb rather than during creation.
 *
 * Why it lives here. The creator always builds a level-1 character and hands the rest to the
 * level-up wizard ({@link module:levelup/intercept.launchLevelUpTo}), while the DMG's starting-wealth
 * bands begin at level 2. Picking the items before the climb therefore meant choosing what a
 * character gets for being level 5 while they were still level 1: the proficiencies, ability scores
 * and spell slots that decide whether an item is any use had not been granted yet, and abandoning the
 * climb left a level-1 character holding a level-5 hoard. Both go away by asking last.
 *
 * Everything else is the creation step unchanged — the same shelf, filters, slot allowance, gold roll
 * and picks — so there is one implementation of the shop, not two. Only three things differ:
 *
 *   - **The state it reads is the creator's.** The picks, the rolled d10 and the chosen filters live
 *     on the `CreatorState` the climb was handed, which is also what {@link grantMagicItems} reads at
 *     Apply and what the creator's draft already persists. Each entry point swaps the state.
 *   - **Completion drops "has been seen".** The level-up shell has no `onEnter`, so a step cannot
 *     require a visit (the same adjustment the Ember equipment and store steps make). The one real
 *     error state — picks that outgrew the allowance — still gates Apply.
 *   - **It knows the character.** The clone is the levelled character, so the shelf can say which
 *     items the build cannot use (see {@link module:steps/magic-shop-step}).
 */

/** The creator state a climb carries, or null for an ordinary level-up. */
const creation = state => state?.creationState ?? null;

export const lvlMagicShopStep = {
  ...magicShopStep,

  applicable(state) {
    const from = creation(state);
    return !!from && !!magicShopTier(from);
  },

  /**
   * Complete once the gold is rolled and the picks fit the allowance. The creation step also
   * required the step to have been visited; the level-up shell never fires `onEnter`, so that
   * condition could never become true here. The roll can't be skipped the same way: it is the
   * player's to make, on screen, so Apply waits for it.
   */
  isComplete(state) {
    const from = creation(state);
    const tier = from ? magicShopTier(from) : null;
    if ( !tier ) return true;
    return withinAllowance(countPicks(from.magicShop?.picks), tier.allowance) && goldRolled(from, tier);
  },

  onEnter(state) {
    const from = creation(state);
    if ( from ) from.magicShopVisited = true;
  },

  incompleteHint(state) {
    const from = creation(state);
    return from ? magicShopStep.incompleteHint(from) : null;
  },

  summary(state) {
    const from = creation(state);
    return from ? magicShopStep.summary(from) : "";
  },

  handle(action, el, ctx) {
    const from = creation(ctx.state);
    if ( !from ) return;
    return magicShopStep.handle(action, el, { ...ctx, state: from });
  },

  /**
   * The shelf, built against the creator's state — plus the levelled character, so each card can
   * carry what the build cannot use. The clone is the right actor to ask: it holds everything this
   * climb granted, which the real actor does not until Apply.
   */
  context(ctx) {
    const from = creation(ctx.state);
    if ( !from ) return { unavailable: true };
    return magicShopStep.context({
      ...ctx, state: from, actor: ctx.state.driver?.clone ?? ctx.state.actor ?? null
    });
  }
};
