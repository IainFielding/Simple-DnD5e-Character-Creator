import { t } from "../config.mjs";

/**
 * The Details step: the character's name (the only mandatory field) plus the
 * optional identity/biography fields, the portrait, and the prototype-token
 * visuals (token image, dynamic ring, lock rotation).
 *
 * Text fields write straight through to {@link CreatorState#details} via the
 * shell's `data-step-change` channel; the image and toggle controls are click
 * actions. Nothing here touches the actor — the assembler reads this state on build.
 */

/** The short single-line fields, in display order. */
export const DETAIL_FIELDS = [
  "alignment", "faith", "gender", "eyes", "hair", "skin", "height", "weight", "age"
];
/** The multi-line fields, in display order. */
export const DETAIL_TEXT_FIELDS = ["trait", "ideals", "bonds", "flaws", "appearance", "biography"];
/** Multi-line fields that span the full form width (with their textarea row counts). */
const WIDE_TEXT_FIELDS = { appearance: 4, biography: 6 };

const FALLBACK_IMG = "icons/svg/mystery-man.svg";

export const detailsStep = {
  id: "details",
  icon: "fa-solid fa-address-card",
  labelKey: "step.details.label",
  template: "steps/details",

  // A name is the one thing the character cannot be built without.
  isComplete(state) {
    return !!state.details.name?.trim();
  },

  /** Rail summary: the chosen name (or nothing yet). */
  summary(state) {
    return state.details.name?.trim() ?? "";
  },

  async handle(action, el, { state, app }) {
    switch ( action ) {
      // A text input / textarea changed — `data-detail` names the field.
      case "detail": {
        const field = el.dataset.detail;
        if ( field && (field in state.details) ) state.details[field] = el.value;
        return;
      }
      case "portrait": return pickImage(state, app, "portrait");
      case "tokenImg": return pickImage(state, app, "tokenImg");
      case "tokenRingImg": return pickImage(state, app, "tokenRingImg");
      case "tokenTab": state.tokenTab = el.dataset.tab === "ring" ? "ring" : "token"; return;
      case "toggleRing": state.tokenRingEnabled = !state.tokenRingEnabled; return;
      case "toggleLock": state.tokenLockRotation = !state.tokenLockRotation; return;
    }
  },

  context({ state }) {
    const d = state.details;
    const field = key => ({
      key,
      value: d[key] ?? "",
      label: t(`step.details.field.${key}`),
      placeholder: t(`step.details.placeholder.${key}`)
    });
    const gridTextKeys = DETAIL_TEXT_FIELDS.filter(k => !(k in WIDE_TEXT_FIELDS));
    const onRing = state.tokenTab === "ring";
    return {
      name: d.name ?? "",
      namePlaceholder: t("step.details.namePlaceholder"),
      subtitle: t("step.details.subtitle"),
      shortFields: DETAIL_FIELDS.map(field),
      gridTextFields: gridTextKeys.map(k => ({ ...field(k), rows: 3 })),
      wideTextFields: Object.entries(WIDE_TEXT_FIELDS).map(([k, rows]) => ({ ...field(k), rows })),
      portrait: state.portrait || FALLBACK_IMG,
      // The token column shows one image at a time; the tab picks token vs ring subject.
      onRing,
      onToken: !onRing,
      tokenImg: (onRing ? state.tokenRingImg : state.tokenImg) || FALLBACK_IMG,
      ringEnabled: state.tokenRingEnabled,
      lockRotation: state.tokenLockRotation
    };
  }
};

/* -------------------------------------------- */

/** Which state property each image control writes. */
const IMAGE_TARGET = { portrait: "portrait", tokenImg: "tokenImg", tokenRingImg: "tokenRingImg" };

/**
 * Open Foundry's image FilePicker for one of the three image slots, writing the
 * chosen path back to state and re-rendering when the user confirms. The picker
 * resolves after this handler returns, so it asks the shell to render itself.
 */
function pickImage(state, app, slot) {
  const prop = IMAGE_TARGET[slot];
  const Picker = foundry.applications.apps.FilePicker?.implementation ?? FilePicker;
  const picker = new Picker({
    type: "image",
    current: state[prop],
    callback: path => { state[prop] = path; app?.render(); }
  });
  return picker.render(true);
}
