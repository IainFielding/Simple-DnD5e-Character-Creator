import { tpl, t, log, levelUpEnabled, heroMancerActive, launchWindowOptions } from "../config.mjs";
import { LevelUpDriver } from "./manager-driver.mjs";
import { LevelUpState } from "./levelup-state.mjs";
import { LevelUpShell } from "./levelup-shell.mjs";

/**
 * Wires up the level-up takeover (§4). Two mutually-exclusive trigger paths:
 *
 *  - **Primary** — `dnd5e.preAdvancementManagerRender` fires before the native manager draws.
 *    When the world leaves native advancements enabled (the default), every level-up funnels
 *    through here; we claim the ones we can drive and suppress the native UI by returning false.
 *  - **Fallback** — a sheet button, shown only when the world has *disabled* native advancements
 *    (so no manager is ever built). Without it there would be no entry point at all.
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
/*  Fallback path — sheet button                */
/* -------------------------------------------- */

/**
 * When native advancements are disabled world-wide, the system never builds a manager, so the
 * primary hook can't fire — inject a launch button instead. Limited to single-class characters
 * for Phase 1 (multiclassing is Phase 5); a multiclass actor simply shows no button here.
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 */
function onRenderActorSheet(app, html) {
  if ( !levelUpEnabled() || heroMancerActive() ) return;
  if ( !game.settings.get("dnd5e", "disableAdvancements") ) return;   // primary hook covers the normal case
  const actor = app?.actor;
  if ( actor?.type !== "character" || !actor.isOwner ) return;

  const classes = actor.items.filter(i => i.type === "class");
  if ( classes.length !== 1 ) return;                                  // multiclass: defer to Phase 5

  const root = html instanceof HTMLElement ? html : html?.[0];
  const header = root?.querySelector(".window-header");
  if ( !header || header.querySelector(".sogrom-levelup-btn") ) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sogrom-levelup-btn";
  button.innerHTML = `<i class="fa-solid fa-angles-up"></i> ${t("levelup.button")}`;
  button.addEventListener("click", ev => {
    ev.preventDefault();
    launchFromButton(actor, classes[0]);
  });
  header.prepend(button);
}

/**
 * Build a level-change manager by hand (the system would normally do this) and drive it, so the
 * fallback button reaches the same takeover as the primary path.
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
