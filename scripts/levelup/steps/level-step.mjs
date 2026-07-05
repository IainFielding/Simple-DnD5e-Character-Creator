import { tpl, t } from "../../config.mjs";
import { atLevel } from "../levelup-state.mjs";
import { hpStep } from "./hp-step.mjs";
import { subclassStep } from "./subclass-step.mjs";
import { asiStep } from "./asi-step.mjs";
import { choicesStep } from "./choices-step.mjs";
import { traitStep } from "./trait-step.mjs";
import { grantStep } from "./grant-step.mjs";

/**
 * The decision components that can appear on a single level's screen, in display order: hit points
 * first, then the subclass pick (which can reveal features below it), then ASI/feat, then feature
 * and trait choices. Each is the same module that used to be its own rail step; here it contributes
 * a *block* to one combined screen instead of owning a screen of its own.
 *
 * For a junior dev: don't confuse these with the creation "step modules". A creation step (see
 * origin-step.mjs) owns a whole screen and implements isComplete/context/handle. These level-up
 * "components" instead implement isCompleteAt(state, level) and sectionsAt(ctx, level) — the extra
 * `level` arg is because ONE screen shows all decisions for one character level, and each component
 * contributes a block to it. levelStep() below is the real step; it just composes these components.
 */
const COMPONENTS = [hpStep, subclassStep, asiStep, choicesStep, traitStep, grantStep];

/**
 * Route a step action to the component that owns it, by the action's prefix. The action names are
 * already component-unique (`hp*`, `asi*`, `choice*`, `trait*`, `pick-subclass`), so the existing
 * per-component templates need no extra tagging to work inside the combined screen.
 * @param {string} action
 * @returns {object|null}
 */
function routeFor(action) {
  if ( action.startsWith("hp") ) return hpStep;
  if ( action.startsWith("asi") ) return asiStep;
  if ( action.startsWith("choice") ) return choicesStep;
  if ( action.startsWith("trait") ) return traitStep;
  if ( action.startsWith("grant") ) return grantStep;
  if ( action === "pick-subclass" ) return subclassStep;
  return null;
}

/**
 * Build the step for one gained character level: a single screen carrying *every* decision that
 * level introduces (hit points, subclass, ASI/feat, features, traits). This replaces the old
 * one-decision-per-screen rail. Per §2.2 of the level-up plan a level-up is a pipeline — choosing a
 * subclass (or a feat) can reveal further choices — so the screen is rebuilt each render and any
 * revealed block simply appears in place. Multi-level jumps produce one of these per level, in
 * order; the registry assembles them from {@link LevelUpState#gainedLevels}.
 * @param {number} level
 * @returns {object}
 */
export function levelStep(level) {
  return {
    id: `level-${level}`,
    icon: "fa-solid fa-angles-up",
    label: t("levelup.step.level.label", { level }),
    template: "levelup/level",
    level,

    isComplete(state) {
      return COMPONENTS.every(c => c.isCompleteAt(state, level));
    },

    summary(state) {
      // Echo the chosen subclass in the rail (the one pick worth surfacing there); otherwise blank.
      const record = atLevel(state.subclassSteps, level)[0];
      const sub = record && state.driver.subclassState(record);
      return sub?.chosen ? sub.name : "";
    },

    async context(ctx) {
      const blocks = [];
      for ( const component of COMPONENTS ) {
        const data = await component.sectionsAt(ctx, level);
        if ( !data ) continue;
        const complete = component.isCompleteAt(ctx.state, level);
        // A stable per-screen key (one block of each type per level) so the collapsed/expanded
        // state persists as the shell rebuilds the step set each render.
        const key = `${level}:${component.id}`;
        blocks.push({
          type: component.id,
          icon: component.icon,
          template: tpl(`${component.template}.hbs`),
          // A single-section feature/trait block names itself after that section (e.g. "Fighting
          // Style") rather than the generic "Features"; everything else uses its component label.
          label: data.blockLabel ?? t(component.labelKey),
          // The header pill: a count/value while choosing, a tick once the block is satisfied.
          status: data.blockStatus ?? null,
          showStatus: complete || (data.blockStatus != null),
          complete,
          // Drives the card/icon size tier for option grids (see creator.css [data-density]).
          density: data.density ?? "standard",
          ...data,
          key,
          // Collapsible header (like the creation choice checklist): expanded unless collapsed.
          open: !ctx.state.collapsedBlocks.has(key)
        });
      }
      return { level, blocks };
    },

    handle(action, el, ctx) {
      // Purely-UI collapse toggle for a block's header; the dispatcher re-renders after.
      if ( action === "toggle-block" ) {
        const collapsed = ctx.state.collapsedBlocks;
        const key = el.dataset.block;
        if ( collapsed.has(key) ) collapsed.delete(key);
        else collapsed.add(key);
        return;
      }
      return routeFor(action)?.handle(action, el, ctx);
    }
  };
}
