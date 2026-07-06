import { MODULE_ID, SETTINGS, tpl, t, log, levelUpEnabled, heroMancerActive, launchWindowOptions } from "../config.mjs";
import { LevelUpDriver } from "./manager-driver.mjs";
import { LevelUpState } from "./levelup-state.mjs";
import { LevelUpShell } from "./levelup-shell.mjs";

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
    hasReverseOrDelete: steps.some(s => s.type === "reverse" || s.type === "delete"),
    raisesLevel: steps.some(s => s.type === "forward" && s.class && (s.level ?? 0) > actorLevel),
    canDrive: LevelUpDriver.canDrive(manager),
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
 * conservative gate accepts every step. Anything else (level-downs, choice edits, multiclass
 * drops, or levels carrying choices we don't yet re-skin) is left to the native flow.
 * @param {AdvancementManager} manager
 * @returns {boolean}
 */
function shouldTakeOver(manager) {
  if ( !manager?.actor?.isOwner ) return false;
  return LevelUpDriver.canDrive(manager);
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
 * rest-button row as a gold icon button matching short/long rest (tooltip on hover); a sheet
 * without that row (a legacy sheet) gets a labelled title-bar button instead. Hidden when the
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

  const row = root.querySelector(".sheet-header-buttons");
  if ( row ) {
    // Match the rest buttons exactly: a .gold-button icon whose empty data-tooltip makes the
    // tooltip system fall back to the aria-label, just like the system's own header buttons.
    button.className = "sogrom-levelup-btn gold-button";
    button.dataset.tooltip = "";
    button.setAttribute("aria-label", t("levelup.button"));
    button.innerHTML = "<i class=\"fa-solid fa-trophy-star\" inert></i>";
    row.append(button);
    // The row is absolutely positioned with no spare room; this class shifts it left one
    // icon-width (see creator.css, which also handles the Action Tracker module's own shift).
    row.classList.add("sogrom-has-levelup");
  } else {
    const header = root.querySelector(".window-header");
    if ( !header ) return;
    button.className = "sogrom-levelup-btn sogrom-levelup-btn--window";
    button.innerHTML = `<i class="fa-solid fa-trophy-star"></i> ${t("levelup.button")}`;
    header.prepend(button);
  }
}

/**
 * Level one class up from the button. A multiclass character picks which class gains the level;
 * the click then follows the same path as the sheet's own level selector (see dnd5e's
 * `BaseActorSheet##changeLevel`): build the level-change manager and render it when it has steps
 * — which fires the primary hook, claiming a drivable level-up for our wizard and leaving an
 * unsupported one to the native UI — or apply the bare level directly when there is nothing to
 * decide. Advancements disabled world-wide is the exception: no native flow exists at all, so
 * the manager is driven by hand ({@link launchFromButton}).
 * @param {Actor5e} actor
 */
async function levelUpFromButton(actor) {
  const classes = actor.items.filter(i => i.type === "class");
  const classItem = classes.length === 1 ? classes[0] : await pickClass(classes);
  if ( !classItem ) return;

  if ( game.settings.get("dnd5e", "disableAdvancements") ) return launchFromButton(actor, classItem);

  const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
  const manager = AdvancementManager.forLevelChange(actor, classItem.id, 1);
  if ( manager.steps.length ) return manager.render({ force: true });
  return classItem.update({ "system.levels": (classItem.system?.levels ?? 0) + 1 });
}

/**
 * Ask which class gains the level — one button per class, showing its current level.
 * @param {Item5e[]} classes
 * @returns {Promise<Item5e|null>}  The chosen class, or null when the dialog was dismissed.
 */
async function pickClass(classes) {
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: t("levelup.chooseClass.title"), icon: "fa-solid fa-trophy-star" },
    content: `<p>${t("levelup.chooseClass.body")}</p>`,
    buttons: classes.map(c => ({
      action: c.id,
      label: `${c.name} ${c.system?.levels ?? ""}`.trim()
    })),
    rejectClose: false
  }).catch(() => null);
  return classes.find(c => c.id === choice) ?? null;
}

/**
 * Build a level-change manager by hand (the system would normally do this) and drive it — the
 * path for worlds that disabled native advancements, where no manager would otherwise exist.
 * @param {Actor5e} actor
 * @param {Item5e} classItem
 */
function launchFromButton(actor, classItem) {
  const AdvancementManager = dnd5e.applications.advancement.AdvancementManager;
  const manager = AdvancementManager.forLevelChange(actor, classItem.id, 1);
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
