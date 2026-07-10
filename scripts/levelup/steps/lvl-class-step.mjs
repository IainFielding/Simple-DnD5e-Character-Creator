import { t, log, multiclassMode } from "../../config.mjs";
import { LevelUpDriver } from "../manager-driver.mjs";
import { multiclassBlockers, formatBlockers } from "../multiclass.mjs";

/**
 * The Class step — the level-up wizard's first screen when the session opens with the class
 * undecided (the Level Up button / context menu on a character with more than one option). It
 * reuses the creator's pick-list + detail layout: the actor's own classes lead the list (each
 * tagged with its level jump), and, when the world's multiclass setting opts in, the classes the
 * character could newly take follow (prerequisite failures locked with the reason as tooltip,
 * under the `"prereq"` mode).
 *
 * Picking a card is the moment the advancement pipeline starts: the step builds the system's
 * AdvancementManager for that class (a level change for an owned class, `forNewItem` for a
 * multiclass), gates it through {@link LevelUpDriver.canDrive}, prepares the driver against the
 * manager's clone, and installs it on the state ({@link LevelUpState#adoptDriver}) — at which
 * point the level screens appear in the rail. Changing the pick discards that driver (and every
 * decision made on it, after a confirmation) and builds a fresh one; nothing touches the real
 * actor either way.
 */
export const lvlClassStep = {
  id: "class",
  icon: "fa-solid fa-chess-rook",
  labelKey: "levelup.step.class.label",
  template: "levelup/class",

  isComplete(state) {
    return !!state.driver;
  },

  /** Rail summary: the chosen class's name once the driver is built. */
  summary(state) {
    return state.driver ? (state.classItem?.name ?? "") : "";
  },

  async context({ state, source }) {
    const actor = state.actor;
    const selection = state.classSelection;

    // The actor's own classes: always offered, tagged with the level jump they would take.
    const existing = actor.items.filter(i => i.type === "class").map(item => {
      const level = item.system?.levels ?? 0;
      return {
        kind: "existing",
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        tag: t("levelup.step.class.levelTag", { from: level, to: level + 1 }),
        selected: selection?.kind === "existing" && selection.id === item.id,
        disabled: false,
        reason: ""
      };
    });

    // The classes the character could newly take, when multiclassing is enabled. Owned classes
    // are dropped by identifier; under "prereq" each candidate is resolved (all pre-warmed) and
    // locked with the failing requirement when the written prerequisites aren't met.
    const mode = multiclassMode();
    const addable = [];
    if ( mode !== "off" ) {
      const owned = new Set(actor.items.filter(i => i.type === "class")
        .map(i => i.system?.identifier).filter(Boolean));
      for ( const card of source.classes() ) {
        if ( owned.has(card.identifier) ) continue;
        let reason = "";
        if ( mode === "prereq" ) {
          const doc = await fromUuid(card.uuid).catch(err => { log("class resolve failed", card.uuid, err); return null; });
          const blockers = doc ? multiclassBlockers(actor, doc) : [];
          if ( blockers.length ) reason = formatBlockers(blockers);
        }
        addable.push({
          kind: "new",
          uuid: card.uuid,
          name: card.name,
          img: card.img,
          tag: t("levelup.step.class.newTag"),
          selected: selection?.kind === "new" && selection.uuid === card.uuid,
          disabled: !!reason,
          reason
        });
      }
    }

    // The detail pane for the selected card — the same resolved description + advancement groups
    // the creator shows. An owned class prefers its compendium source (fuller text, memoised
    // across sessions) and falls back to the embedded item itself.
    const cards = [...existing, ...addable];
    const sel = cards.find(c => c.selected);
    let detail = null;
    let groups = null;
    if ( sel ) {
      let uuid = sel.uuid;
      let doc;
      if ( sel.kind === "existing" ) {
        doc = actor.items.get(sel.id);
        uuid = doc?._stats?.compendiumSource ?? sel.uuid;
        if ( uuid !== sel.uuid ) doc = undefined;   // resolvable from the pack; let fromUuid fetch it
      }
      [detail, groups] = await Promise.all([
        source.detail(uuid, doc).catch(() => null),
        source.advancementGroups(uuid, doc).catch(() => null)
      ]);
    }

    return { existing, addable, hasAddable: addable.length > 0, hasSelection: !!sel, detail, groups };
  },

  async handle(action, el, ctx) {
    if ( action !== "pick-levelup-class" ) return;
    // A locked card (multiclass prerequisites unmet) only shows its tooltip.
    if ( el.getAttribute("aria-disabled") === "true" ) return false;
    const { state } = ctx;
    const { kind, id, uuid } = el.dataset;

    const same = state.classSelection
      && state.classSelection.kind === kind
      && (kind === "existing" ? state.classSelection.id === id : state.classSelection.uuid === uuid);

    // Changing (or clearing) the pick throws away the driver and every decision on it — rolled
    // hit points included — so confirm when the player has actually made one.
    if ( state.driver && state.hasPlayerInput() ) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: t("levelup.step.class.switchTitle"), icon: "fa-solid fa-triangle-exclamation" },
        content: `<p>${t("levelup.step.class.switchBody")}</p>`,
        modal: true,
        rejectClose: false
      });
      if ( !proceed ) return false;
    }

    state.clearDriver();
    if ( same ) {                       // re-clicking the active card backs out of the choice
      state.classSelection = null;
      return;
    }
    state.classSelection = kind === "existing" ? { kind, id } : { kind, uuid };
    await buildDriver(ctx);
  }
};

/**
 * Build and adopt the driver for the state's current class selection: construct the system's
 * manager, gate it, prepare the clone, install it. On any failure the selection is cleared and
 * the player is told — the wizard simply stays on the Class step.
 * @param {object} ctx   The shell's step context ({ state, app, … }).
 */
async function buildDriver(ctx) {
  const { state } = ctx;
  const actor = state.actor;
  const selection = state.classSelection;
  try {
    const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
    let manager;
    if ( selection.kind === "existing" ) {
      manager = AdvancementManager.forLevelChange(actor, selection.id, 1);
    } else {
      const doc = await fromUuid(selection.uuid);
      if ( !doc ) throw new Error(`class ${selection.uuid} did not resolve`);
      // fromCompendium strips ids/folders and stamps _stats.compendiumSource, so review chips
      // resolve back to the pack entry.
      const itemData = game.items.fromCompendium(doc);
      foundry.utils.setProperty(itemData, "system.levels", 1);
      manager = AdvancementManager.forNewItem(actor, itemData);
    }
    // The manager is driven directly and never rendered, but flag it anyway so the takeover hook
    // could never re-claim it if some other module forces a render.
    manager._sogromLevelUp = true;

    if ( !LevelUpDriver.canDrive(manager, { allowNewClass: multiclassMode() !== "off" }) ) {
      state.classSelection = null;
      ui.notifications?.warn(t("levelup.notify.choicesUnsupported"));
      return;
    }

    const driver = new LevelUpDriver(manager);
    await driver.prepare();
    state.adoptDriver(driver);
    // Kick the background warms (subclass cards, spell pool) for the freshly-known class.
    ctx.app?.warmForDriver?.();
  } catch ( err ) {
    log("class-step driver build failed", err);
    state.clearDriver();
    state.classSelection = null;
    ui.notifications?.error(t("levelup.notify.takeoverFailed"));
  }
}
