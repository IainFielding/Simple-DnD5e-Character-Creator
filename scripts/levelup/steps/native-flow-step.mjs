import { log, t } from "../../config.mjs";
import { advancementTitle } from "../../data/advancement-util.mjs";
import { atLevel, advancementHint } from "../levelup-state.mjs";

/**
 * Advancements of a type registered by another module — Forge of the Artificer's Potent Dragonmark,
 * or whatever premium content ships next — presented through that module's **own** flow.
 *
 * The driver has already committed each one as its untouched screen would be (see
 * `LevelUpDriver#nativeSteps`), so this block never has to be opened for the clone to be right. It
 * exists so a type that does carry a choice still reaches the player: the placeholder the template
 * leaves is filled after render by {@link mountNativeFlows} with the flow's real element, rendered
 * against the driver's clone exactly as the native manager would render it. This is the one place
 * the wizard gives up its own styling, and only for types it has no screen of its own for.
 */
export const nativeFlowStep = {
  id: "native",
  icon: "fa-solid fa-puzzle-piece",
  labelKey: "levelup.step.native.label",
  template: "levelup/native",

  isCompleteAt(state, level) {
    // Only a refusal holds the level back; an untouched screen is a valid answer, as it is natively.
    return atLevel(state.nativeSteps, level).every(r => !r.error);
  },

  async sectionsAt({ state }, level) {
    const records = atLevel(state.nativeSteps, level);
    if ( !records.length ) return null;
    // One block per advancement, titled after it: two unrelated modules' screens pooled under one
    // generic heading would read as one decision.
    return Promise.all(records.map(async record => {
      const title = advancementTitle(record.advancement) || record.item?.name || t("levelup.step.native.label");
      return {
        key: String(state.nativeSteps.indexOf(record)),
        index: state.nativeSteps.indexOf(record),
        blockLabel: title,
        blockSource: record.item?.name && (record.item.name !== title) ? record.item.name : null,
        complete: !record.error,
        hint: await advancementHint(record),
        error: record.error,
        unavailable: t("levelup.step.native.unavailable")
      };
    }));
  },

  handle() {
    // The mounted flow owns its own controls; nothing routes through the wizard's actions.
  }
};

/**
 * Fill every native-flow placeholder in a freshly rendered level screen with its advancement's own
 * flow element. Called from the level-up shell's `_onRender`.
 *
 * Both flow generations can live outside a manager: a V1 `AdvancementFlow` is a `popOut: false`
 * FormApplication and a V2 one is frameless and unpositioned. Each is rendered where Foundry puts
 * it and then moved into the placeholder — the whole shell re-renders on every action, so this runs
 * again each time and simply re-homes the same flow instance.
 *
 * A V2 flow applies its own form on change. A V1 flow does not, so a change is re-committed through
 * the driver (reverse, then `_updateObject`) and the shell re-rendered; its own `submit` is stopped
 * in the capture phase, before the FormApplication's handler would apply the form a second time.
 * @param {HTMLElement} root
 * @param {import("../levelup-state.mjs").LevelUpState} state
 * @param {() => void} rerender   Re-render the shell after a V1 change.
 */
export async function mountNativeFlows(root, state, rerender) {
  const FlowV2 = globalThis.dnd5e?.applications?.advancement?.AdvancementFlowV2;
  for ( const host of root.querySelectorAll("[data-native-flow]") ) {
    const record = state.nativeSteps[Number(host.dataset.nativeFlow)];
    const flow = record?.flow;
    if ( !flow || state.committed ) continue;
    try {
      let element;
      if ( FlowV2 && (flow instanceof FlowV2) ) {
        await flow.render({ force: true });
        element = flow.element;
      } else {
        flow._element = null;
        await flow._render(true);
        element = flow.element?.[0] ?? flow.element;
        host.addEventListener("submit", ev => { ev.preventDefault(); ev.stopImmediatePropagation(); }, true);
        host.addEventListener("change", async () => {
          await state.driver.resubmitNativeFlow(record);
          rerender();
        });
      }
      // The placeholder may have been replaced by a newer render while the flow was rendering.
      if ( element && host.isConnected ) host.replaceChildren(element);
    } catch ( err ) {
      // The block keeps its fallback text. The advancement is already applied; only the screen failed.
      log("mounting a native advancement flow failed", record.advancement?.type, err);
    }
  }
}

/**
 * Close the V2 flows a level-up rendered, so their instances don't outlive the wizard in Foundry's
 * application registry. V1 flows are `popOut: false` and never registered.
 * @param {import("../levelup-state.mjs").LevelUpState} state
 */
export function closeNativeFlows(state) {
  const FlowV2 = globalThis.dnd5e?.applications?.advancement?.AdvancementFlowV2;
  for ( const { flow } of state?.nativeSteps ?? [] ) {
    if ( FlowV2 && (flow instanceof FlowV2) && flow.rendered ) flow.close({ animate: false }).catch(() => {});
  }
}
