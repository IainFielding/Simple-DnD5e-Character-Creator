import { t, log, multiclassMode } from "../../config.mjs";
import { LevelUpDriver } from "../manager-driver.mjs";
import { multiclassBlockers, formatBlockers } from "../multiclass.mjs";

/**
 * The Class step — the level-up wizard's first screen when the session opens with the class
 * undecided (the Level Up button / context menu on a character with more than one option).
 *
 * It has two faces, switched by {@link LevelUpState#classBrowse}:
 *
 *   - the **route** screen (default): what the player almost always wants, stated plainly. The
 *     character's current classes head the screen, then one big card per owned class ("advance
 *     this one"), then a single muted card for taking a class the character doesn't have yet —
 *     worded for how many they already carry ("a second class", "a third class"). Mixing the whole
 *     compendium of classes into that decision was the old screen's mistake: the common case (one
 *     class, one obvious card) drowned in a scroll list.
 *   - the **browse** screen: the creator's pick-list + detail layout over the *addable* classes
 *     only, reached from the muted card and backed out of with its Back link. Under the `"prereq"`
 *     multiclass mode a candidate whose written requirements aren't met is locked, the failing
 *     ability named in its tooltip.
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
    const owned = actor.items.filter(i => i.type === "class");

    // The actor's own classes: always offered, tagged with the level jump they would take.
    const existing = owned.map(item => {
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
    // locked with the failing requirement when the written prerequisites aren't met. Only the
    // browse screen renders them, but the route screen needs to know whether any exist before it
    // offers the card that leads there — so the cheap owned-filter runs either way and the costly
    // prerequisite resolution only when browsing.
    const mode = multiclassMode();
    const ownedIds = new Set(owned.map(i => i.system?.identifier).filter(Boolean));
    const candidates = mode === "off" ? []
      : source.classes().filter(card => !ownedIds.has(card.identifier));
    const addable = [];
    if ( state.classBrowse ) {
      for ( const card of candidates ) {
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

    // A new class already picked (the player browsed, chose, then came back) shows on the route
    // screen as a card of its own, so the route never contradicts the live selection.
    let pending = null;
    if ( selection?.kind === "new" ) {
      const card = candidates.find(c => c.uuid === selection.uuid);
      if ( card ) pending = { kind: "new", uuid: card.uuid, name: card.name, img: card.img,
        tag: t("levelup.step.class.newTag"), selected: true, disabled: false, reason: "" };
    }

    // The muted "take a class you don't have" card. Its wording counts the classes the character
    // already carries, so a single-class character is invited to multiclass and a multiclassed one
    // is offered the next class along.
    const newCard = {
      title: t(`levelup.step.class.add.${["first", "second", "third"][owned.length] ?? "more"}`),
      hint: t("levelup.step.class.add.hint"),
      disabled: mode === "off" || candidates.length === 0,
      reason: mode === "off" ? t("levelup.step.class.add.off") : t("levelup.step.class.add.none")
    };

    // The detail pane for the browse screen's selected card — the same resolved description +
    // advancement groups the creator shows.
    const sel = addable.find(c => c.selected);
    let detail = null;
    let groups = null;
    if ( sel ) {
      [detail, groups] = await Promise.all([
        source.detail(sel.uuid).catch(() => null),
        source.advancementGroups(sel.uuid).catch(() => null)
      ]);
    }

    return {
      browse: state.classBrowse,
      current: existing,
      existing: pending ? [...existing, pending] : existing,
      addable,
      newCard,
      hasSelection: !!sel,
      detail,
      groups
    };
  },

  async handle(action, el, ctx) {
    const { state } = ctx;
    // The route ⇄ browse flip is pure presentation: neither face touches the pick or the driver.
    if ( action === "levelup-class-browse" ) {
      if ( el.getAttribute("aria-disabled") === "true" ) return false;
      state.classBrowse = true;
      return;
    }
    if ( action === "levelup-class-route" ) {
      state.classBrowse = false;
      return;
    }
    if ( action !== "pick-levelup-class" ) return;
    // A locked card (multiclass prerequisites unmet) only shows its tooltip.
    if ( el.getAttribute("aria-disabled") === "true" ) return false;
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
