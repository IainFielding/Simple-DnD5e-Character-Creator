import { MODULE_ID, SETTINGS, tpl, t, log, levelUpEnabled, heroMancerActive, launchWindowOptions, multiclassMode } from "../config.mjs";
import { LevelUpDriver } from "./manager-driver.mjs";
import { LevelUpState } from "./levelup-state.mjs";
import { LevelUpShell } from "./levelup-shell.mjs";
import { multiclassBlockers, formatBlockers } from "./multiclass.mjs";
import { MulticlassPicker } from "./class-picker.mjs";

/**
 * Wires up the level-up takeover (§4). Two trigger paths:
 *
 *  - **Primary** — `dnd5e.preAdvancementManagerRender` fires before the native manager draws.
 *    When the world leaves native advancements enabled (the default), every level-up funnels
 *    through here; we claim the ones we can drive and suppress the native UI by returning false.
 *  - **Sheet button** — a "Level Up" button in the character sheet's header, the flow's front
 *    door (togglable via the `showLevelUpButton` setting). With native advancements enabled it
 *    routes through the system's own AdvancementManager — so the primary hook claims it exactly
 *    as if the sheet's level selector was used; with them disabled world-wide (no manager is
 *    ever built) it constructs one by hand and drives it directly.
 *
 * Both paths self-gate on the `mode` setting and stand down entirely when Hero Mancer is active.
 * Call once, at `ready`.
 *
 * For a junior dev: "intercept" = we hook the dnd5e level-up so our own UI runs instead of the
 * system's default wizard. The clean way in is the `preAdvancementManagerRender` hook: it fires
 * just before the native wizard paints, and if our handler returns `false` the native UI is
 * cancelled — leaving us to open our shell in its place. We only take over level-ups we know we
 * can fully handle (see LevelUpDriver.canDrive); anything else we let the system handle normally.
 */
export function registerLevelUp() {
  // The level-up step partials are pulled in by the stage's dynamic Handlebars partial, so they
  // must be registered up front just like the creation steps.
  foundry.applications.handlebars.loadTemplates([
    tpl("levelup/level.hbs"),
    tpl("levelup/hp.hbs"),
    tpl("levelup/choices.hbs"),
    tpl("levelup/trait.hbs"),
    tpl("levelup/asi.hbs"),
    tpl("levelup/subclass.hbs"),
    tpl("levelup/grant.hbs"),
    tpl("levelup/review.hbs"),
    tpl("levelup/spells.hbs")
  ]);

  Hooks.on("dnd5e.preAdvancementManagerRender", onPreAdvancementManagerRender);
  Hooks.on("renderActorSheet", onRenderActorSheet);
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
}

/* -------------------------------------------- */
/*  Primary path — wrap the native manager      */
/* -------------------------------------------- */

/**
 * @param {AdvancementManager} manager
 * @returns {boolean|void}  `false` suppresses the native render once we have claimed the manager.
 */
function onPreAdvancementManagerRender(manager) {
  // Temporary diagnostics for the Phase 1 bring-up: report why we did or didn't take over.
  // NOTE (junior): this console.table/log block is developer scaffolding for the in-progress
  // level-up feature — safe to strip once the takeover is stable. It only logs; it changes nothing.
  const steps = manager?.steps ?? [];
  const actorLevel = manager?.actor?.system?.details?.level ?? 0;
  const classItem = steps.find(s => s.class)?.class?.item;
  console.table(steps.map(s => ({
    type: s.type,
    automatic: !!s.automatic,
    level: s.level,
    advType: s.flow?.advancement?.type ?? "—",
    advName: s.flow?.advancement?.title ?? s.flow?.advancement?.constructor?.name ?? "—",
    hasClass: !!s.class,
    supported: !!s.automatic || LevelUpDriver.isStepSupported(s)
  })));
  log("preAdvancementManagerRender gates", {
    levelUpEnabled: levelUpEnabled(),
    heroMancerActive: heroMancerActive(),
    isOwner: !!manager?.actor?.isOwner,
    actorLevel,
    classItemId: classItem?.id ?? null,
    classOnActor: !!(classItem && manager.actor?.items?.get(classItem.id)),
    classOnClone: !!(classItem && manager.clone?.items?.get(classItem.id)),
    multiclassMode: multiclassMode(),
    hasReverseOrDelete: steps.some(s => s.type === "reverse" || s.type === "delete"),
    raisesLevel: steps.some(s => s.type === "forward" && s.class && (s.level ?? 0) > actorLevel),
    canDrive: LevelUpDriver.canDrive(manager, { allowNewClass: multiclassMode() !== "off" }),
    unsupportedSteps: steps
      .filter(s => !s.automatic && !LevelUpDriver.isStepSupported(s))
      .map(s => `${s.flow?.advancement?.type ?? "?"} — ${s.flow?.advancement?.title ?? s.flow?.item?.name ?? "?"}`)
  });

  if ( !levelUpEnabled() || heroMancerActive() ) return;
  // The hook fires on every (re-)render; once we have claimed a manager, never re-enter.
  if ( manager._sogromLevelUp ) return;
  if ( !shouldTakeOver(manager) ) return;

  manager._sogromLevelUp = true;
  // The hook is synchronous and reads our return value, so kick the (async) takeover off
  // without awaiting it and suppress the native UI straight away.
  launchLevelUp(manager);
  return false;
}

/**
 * Whether this manager is a level-up we can fully own: the user owns the actor, and the driver's
 * conservative gate accepts every step — including a new class (multiclass) when the world
 * setting opts in. Anything else (level-downs, choice edits, or levels carrying choices we
 * don't yet re-skin) is left to the native flow.
 * @param {AdvancementManager} manager
 * @returns {boolean}
 */
function shouldTakeOver(manager) {
  if ( !manager?.actor?.isOwner ) return false;
  const mode = multiclassMode();
  if ( !LevelUpDriver.canDrive(manager, { allowNewClass: mode !== "off" }) ) return false;

  // A new-class claim under the "prereq" mode must meet the written multiclass prerequisites.
  // The wizard's own picker never offers an ineligible class, but a class item dragged onto
  // the sheet arrives here unchecked — warn and stand down, leaving the native flow to run.
  const classItem = manager.steps.find(s => s.class)?.class?.item;
  if ( (mode === "prereq") && classItem && !manager.actor.items.get(classItem.id) ) {
    const blockers = multiclassBlockers(manager.actor, classItem);
    if ( blockers.length ) {
      ui.notifications?.warn(t("levelup.multiclass.blocked", { reasons: formatBlockers(blockers) }));
      return false;
    }
  }
  return true;
}

/**
 * Drive a claimed manager: prepare its clone (apply automatic advancements, surface the
 * hit-point decisions), then open our shell. The real actor is untouched until the player
 * applies, so any failure here leaves them exactly where they were.
 * @param {AdvancementManager} manager
 */
async function launchLevelUp(manager) {
  try {
    const driver = new LevelUpDriver(manager);
    await driver.prepare();
    const state = new LevelUpState(manager.actor, driver);
    new LevelUpShell(state, launchWindowOptions()).render(true);
  } catch ( err ) {
    log("level-up takeover failed; the native advancement flow was suppressed", err);
    ui.notifications?.error(t("levelup.notify.takeoverFailed"));
  }
}

/* -------------------------------------------- */
/*  Sheet button                                */
/* -------------------------------------------- */

/**
 * Inject the "Level Up" button into the character sheet — the flow's front door, so a player
 * never has to know about the class-level selector buried in the sheet. It sits in the header's
 * rest-button row as a gold icon button matching short/long rest (tooltip on hover) — recreating
 * that row when the system left it out (a player without rest permission), so only a sheet with no
 * such structure at all (a legacy sheet) falls back to a labelled title-bar button. Hidden when the
 * module mode leaves levelling to the system, when the world setting turns the button off, when
 * Hero Mancer owns the space, and when there is nothing to level (no class yet, or already at
 * the level cap).
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 */
function onRenderActorSheet(app, html) {
  if ( !levelUpEnabled() || heroMancerActive() ) return;
  if ( !game.settings.get(MODULE_ID, SETTINGS.levelUpButton) ) return;
  const actor = app?.actor;
  if ( actor?.type !== "character" || !actor.isOwner ) return;

  if ( !actor.items.some(i => i.type === "class") ) return;            // nothing to level yet
  if ( (actor.system?.details?.level ?? 0) >= (CONFIG.DND5E?.maxLevel ?? 20) ) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root || root.querySelector(".sogrom-levelup-btn") ) return;

  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", ev => {
    ev.preventDefault();
    levelUpFromButton(actor);
  });

  // Prefer the system's rest-button row. It only exists when dnd5e sets `showRests`
  // (`game.user.isGM || (actor.isOwner && allowRests)`), so a plain player who owns the
  // character but lacks the "allow rests" world setting has no row — synthesize one in the
  // same spot so they get the same gold trophy, not the labelled fallback.
  const existingRow = root.querySelector(".sheet-header-buttons");
  const row = existingRow ?? buildHeaderButtonRow(root);
  if ( row ) {
    // Match the rest buttons exactly: a .gold-button icon whose empty data-tooltip makes the
    // tooltip system fall back to the aria-label, just like the system's own header buttons.
    button.className = "sogrom-levelup-btn gold-button";
    button.dataset.tooltip = "";
    button.setAttribute("aria-label", t("levelup.button"));
    button.innerHTML = "<i class=\"fa-solid fa-trophy-star\" inert></i>";
    row.append(button);
    // The populated system row is absolutely positioned with no spare room, so this class shifts
    // it left one icon-width (see creator.css, which also handles the Action Tracker module's own
    // shift). A row we synthesized holds only our button, so it fits without shifting.
    if ( existingRow ) row.classList.add("sogrom-has-levelup");
  } else {
    const header = root.querySelector(".window-header");
    if ( !header ) return;
    button.className = "sogrom-levelup-btn sogrom-levelup-btn--window";
    button.innerHTML = `<i class="fa-solid fa-trophy-star"></i> ${t("levelup.button")}`;
    header.prepend(button);
  }
}

/**
 * Recreate the dnd5e v2 character sheet's rest-button row when the system omitted it (a player
 * without rest permission). It lives as the first child of the "XP & Buttons" wrapper — the last
 * div in the header's `.right` column — where its `.sheet-header-buttons` styling positions it.
 * @param {HTMLElement} root
 * @returns {HTMLElement|null} the empty row, or null on a sheet without that structure
 */
function buildHeaderButtonRow(root) {
  const wrapper = root.querySelector(".sheet-header .right > div:last-child");
  if ( !wrapper ) return null;
  const row = document.createElement("div");
  row.className = "sheet-header-buttons";
  wrapper.prepend(row);
  return row;
}

/** Sentinel returned by {@link pickClass} when the player chose to add a new class instead. */
const ADD_CLASS = Symbol("sogrom.addClass");

/**
 * Level one class up from the button. A multiclass character picks which class gains the level
 * (and, when the world's multiclass setting opts in, may add a brand-new class instead — see
 * {@link addClassFromButton}); the click then follows the same path as the sheet's own level
 * selector (see dnd5e's `BaseActorSheet##changeLevel`): build the level-change manager and render
 * it when it has steps — which fires the primary hook, claiming a drivable level-up for our
 * wizard and leaving an unsupported one to the native UI — or apply the bare level directly when
 * there is nothing to decide. Advancements disabled world-wide is the exception: no native flow
 * exists at all, so the manager is driven by hand ({@link driveManager}).
 * @param {Actor5e} actor
 */
async function levelUpFromButton(actor) {
  const classes = actor.items.filter(i => i.type === "class");
  // Offering a new class also forces the picker dialog on a single-class character, who would
  // otherwise skip straight past the only place the option can live.
  const canMulticlass = multiclassMode() !== "off"
    && (actor.system?.details?.level ?? 0) < (CONFIG.DND5E?.maxLevel ?? 20);
  const choice = (classes.length === 1 && !canMulticlass)
    ? classes[0]
    : await pickClass(classes, { canMulticlass });
  if ( !choice ) return;
  if ( choice === ADD_CLASS ) return addClassFromButton(actor);
  const classItem = choice;

  const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
  const manager = AdvancementManager.forLevelChange(actor, classItem.id, 1);
  if ( game.settings.get("dnd5e", "disableAdvancements") ) return driveManager(manager);
  if ( manager.steps.length ) return manager.render({ force: true });
  return classItem.update({ "system.levels": (classItem.system?.levels ?? 0) + 1 });
}

/**
 * Ask which class gains the level — one button per class, showing its current level, plus an
 * "Add a Class…" option when multiclassing is enabled.
 * @param {Item5e[]} classes
 * @param {object} [options]
 * @param {boolean} [options.canMulticlass=false]  Offer the new-class option.
 * @returns {Promise<Item5e|typeof ADD_CLASS|null>}  The chosen class, the {@link ADD_CLASS}
 *   sentinel, or null when the dialog was dismissed.
 */
async function pickClass(classes, { canMulticlass = false } = {}) {
  const { DialogV2 } = foundry.applications.api;
  const buttons = classes.map(c => ({
    action: c.id,
    label: `${c.name} ${c.system?.levels ?? ""}`.trim()
  }));
  if ( canMulticlass ) buttons.push({
    action: "sogrom-add-class",
    label: t("levelup.chooseClass.addClass"),
    icon: "fa-solid fa-chess-rook"
  });
  const choice = await DialogV2.wait({
    window: { title: t("levelup.chooseClass.title"), icon: "fa-solid fa-trophy-star" },
    content: `<p>${t("levelup.chooseClass.body")}</p>`,
    buttons,
    rejectClose: false
  }).catch(() => null);
  if ( choice === "sogrom-add-class" ) return ADD_CLASS;
  return classes.find(c => c.id === choice) ?? null;
}

/**
 * Add a new class (multiclass) from the button: pick the class, then hand the system's
 * `forNewItem` manager down the same two paths a same-class level-up takes — render it (the
 * primary hook claims a drivable one) or, when the world disabled native advancements, drive
 * it by hand. The picker already filtered to eligible classes, so a prerequisite failure can't
 * arrive here.
 * @param {Actor5e} actor
 */
async function addClassFromButton(actor) {
  const uuid = await MulticlassPicker.pick(actor);
  if ( !uuid ) return;
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return;

  // fromCompendium strips ids/folders and stamps _stats.compendiumSource, so review chips and
  // future "same class?" identifier checks resolve back to the pack entry.
  const itemData = game.items.fromCompendium(doc);
  foundry.utils.setProperty(itemData, "system.levels", 1);

  const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
  const manager = AdvancementManager.forNewItem(actor, itemData);
  if ( !manager.steps.length ) return actor.createEmbeddedDocuments("Item", [itemData]);
  if ( game.settings.get("dnd5e", "disableAdvancements") ) return driveManager(manager);
  return manager.render({ force: true });
}

/**
 * Drive a hand-built manager directly — the path for worlds that disabled native advancements,
 * where rendering would never fire the primary hook (no native flow exists at all).
 * @param {AdvancementManager} manager
 */
function driveManager(manager) {
  if ( !shouldTakeOver(manager) ) {
    ui.notifications?.warn(t("levelup.notify.choicesUnsupported"));
    return;
  }
  manager._sogromLevelUp = true;
  launchLevelUp(manager);
}

/* -------------------------------------------- */
/*  Window options                              */
/* -------------------------------------------- */
