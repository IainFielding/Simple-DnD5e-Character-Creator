import { MODULE_ID, SETTINGS, DEFAULTS, launchWindowOptions, tpl, t, log, levelUpEnabled, heroMancerActive } from "./config.mjs";
import { STEPS } from "./steps/registry.mjs";
import { CreatorShell } from "./app/creator-shell.mjs";
import { warmSources } from "./data/source-cache.mjs";
import { registerLevelUp } from "./levelup/intercept.mjs";

/*
 * This is the module's entry point — module.json points Foundry here via "esmodules".
 * The file wires the module into Foundry's startup lifecycle using Hooks. A Hook is
 * Foundry's event system: `Hooks.once(event, fn)` runs `fn` a single time when that
 * event fires, `Hooks.on(event, fn)` runs it every time. The lifecycle order we use is:
 *   init   -> register settings and templates (before the game data is loaded)
 *   ready  -> everything is loaded; safe to touch actors, install our level-up takeover
 * We also listen for directory events to inject our "launch" button and context menu item.
 */

/* -------------------------------------------- */
/*  Init: settings + templates                  */
/* -------------------------------------------- */

// `init` fires early, before world data loads — the right place to register settings and
// pre-load templates so they're ready by the time anything renders.
Hooks.once("init", () => {
  registerSettings();
  // Step partials are pulled in by the stage via a dynamic Handlebars partial, so they
  // must be registered up front (the rail/stage/shell themselves are loaded as PARTS).
  foundry.applications.handlebars.loadTemplates(STEPS.map(s => tpl(`${s.template}.hbs`)));

  // The `data-tooltip` payload that triggers a dnd5e *rich* item tooltip. The system's
  // global Tooltips5e observer watches the live tooltip element for a `.loading[data-uuid]`
  // section and swaps it for the item's richTooltip() on hover. A bare " " can never become
  // one — it just shows an empty (black) box — so item links must emit this instead.
  // Handlebars escapes the returned string into the attribute; the browser decodes it back to
  // real HTML, so element.dataset.tooltip yields exactly the markup dnd5e looks for.
  Handlebars.registerHelper("ccItemTooltip", uuid => {
    if ( !uuid ) return "";
    return `<section class="loading" data-uuid="${uuid}"><i class="fa-solid fa-spinner fa-spin-pulse"></i></section>`;
  });
});

// Declare every world setting so it shows up in Foundry's "Configure Settings" menu and can
// be read via game.settings.get(). `scope: "world"` means one shared value for the whole game
// (GM-controlled); `config: true` means it appears in the settings UI. Names/hints are pulled
// from lang/en.json through t() so they can be translated.
function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.launchButton, {
    name: t("settings.launchButton.name"),
    hint: t("settings.launchButton.hint"),
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.contextMenu, {
    name: t("settings.contextMenu.name"),
    hint: t("settings.contextMenu.hint"),
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.pointBuyBudget, {
    name: t("settings.pointBuyBudget.name"),
    hint: t("settings.pointBuyBudget.hint"),
    scope: "world", config: true, type: Number, default: DEFAULTS.pointBuyBudget
  });
  game.settings.register(MODULE_ID, SETTINGS.rollFormula, {
    name: t("settings.rollFormula.name"),
    hint: t("settings.rollFormula.hint"),
    scope: "world", config: true, type: String, default: DEFAULTS.rollFormula
  });
  game.settings.register(MODULE_ID, SETTINGS.displayMode, {
    name: t("settings.displayMode.name"),
    hint: t("settings.displayMode.hint"),
    scope: "world", config: true, type: String, default: DEFAULTS.displayMode,
    choices: {
      fullscreen: t("settings.displayMode.fullscreen"),
      windowed: t("settings.displayMode.windowed")
    }
  });
  game.settings.register(MODULE_ID, SETTINGS.mode, {
    name: t("settings.mode.name"),
    hint: t("settings.mode.hint"),
    scope: "world", config: true, type: String, default: DEFAULTS.mode,
    choices: {
      "creation": t("settings.mode.creation"),
      "creation-levelup": t("settings.mode.creationLevelup")
    }
  });
  game.settings.register(MODULE_ID, SETTINGS.levelUpButton, {
    name: t("settings.levelUpButton.name"),
    hint: t("settings.levelUpButton.hint"),
    scope: "world", config: true, type: Boolean, default: DEFAULTS.levelUpButton
  });
  game.settings.register(MODULE_ID, SETTINGS.multiclass, {
    name: t("settings.allowMulticlass.name"),
    hint: t("settings.allowMulticlass.hint"),
    scope: "world", config: true, type: String, default: DEFAULTS.multiclass,
    choices: {
      "off": t("settings.allowMulticlass.off"),
      "prereq": t("settings.allowMulticlass.prereq"),
      "free": t("settings.allowMulticlass.free")
    }
  });
  game.settings.register(MODULE_ID, SETTINGS.levelUpHpMode, {
    name: t("settings.levelUpHpMode.name"),
    hint: t("settings.levelUpHpMode.hint"),
    scope: "world", config: true, type: String, default: DEFAULTS.levelUpHpMode,
    choices: {
      "choice": t("settings.levelUpHpMode.choice"),
      "average-roll": t("settings.levelUpHpMode.averageRoll"),
      "average": t("settings.levelUpHpMode.average")
    }
  });
  game.settings.register(MODULE_ID, SETTINGS.levelUpHpRollToChat, {
    name: t("settings.levelUpHpRollToChat.name"),
    hint: t("settings.levelUpHpRollToChat.hint"),
    scope: "world", config: true, type: Boolean, default: DEFAULTS.levelUpHpRollToChat
  });
}

/* -------------------------------------------- */
/*  Ready: system guard                         */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if ( game.system.id !== "dnd5e" ) {
    console.error(`${MODULE_ID} | requires the dnd5e game system; disabling.`);
    return;
  }
  log("ready");

  // Install the level-up takeover hooks (primary: wrap the native AdvancementManager;
  // fallback: a sheet button when the world has disabled native advancements). Both paths
  // self-gate on the `mode` setting and Hero Mancer, so this is safe to register unconditionally.
  registerLevelUp();

  // Pre-warm the shared compendium index in the background, so the builder opens instantly
  // instead of showing its loading screen on first use. Gated to the audiences that will
  // actually open a window — users who can create actors (the launch button), and, when the
  // level-up takeover is on, players who own a character (the level-up flow) — to avoid taxing
  // clients that will never open either. Deferred to idle so it never competes with the rest of
  // world startup. A window opened before this finishes simply awaits the same in-flight work.
  const levelUpAudience = levelUpEnabled() && !heroMancerActive()
    && game.actors?.some(a => (a.type === "character") && a.isOwner);
  if ( game.user?.can("ACTOR_CREATE") || levelUpAudience ) {
    const warm = () => warmSources().catch(() => {});
    if ( typeof requestIdleCallback === "function" ) requestIdleCallback(warm, { timeout: 3000 });
    else window.setTimeout(warm, 1000);
  }
});

/* -------------------------------------------- */
/*  Launch entry points                         */
/* -------------------------------------------- */

/**
 * Open the creator on a fresh draft (or an existing character to resume). A brand-new
 * character is *not* written to the world here — the actor is created only when the player
 * clicks Create (see {@link CreatorShell}), so a cancelled build never litters the directory.
 * @param {Actor} [actor]  Existing actor to resume; null starts a fresh, unsaved draft.
 */
async function launchCreator(actor) {
  // Give the permission feedback up front rather than after the player has filled everything in.
  if ( !actor && !game.user?.can("ACTOR_CREATE") ) return ui.notifications?.warn(t("notify.noPermission"));
  new CreatorShell(actor ?? null, launchWindowOptions()).render(true);
}

// Every time the Actors sidebar tab renders, add our "launch" button to its header — but only
// if the system is dnd5e, the setting is on, and this user is allowed to create actors.
Hooks.on("renderActorDirectory", (_app, html) => {
  if ( game.system?.id !== "dnd5e" ) return;
  if ( !game.settings.get(MODULE_ID, SETTINGS.launchButton) ) return;
  if ( !game.user?.can("ACTOR_CREATE") ) return;
  injectLaunchButton(rootElement(html));
});

// Add a right-click "Resume in creator" entry to character actors in the sidebar. Foundry passes
// us the menu's option array and we push our own entry onto it; `condition` decides per-actor
// whether the entry shows, `callback` runs when it's clicked.
Hooks.on("getActorContextOptions", (_directory, options) => {
  if ( game.system?.id !== "dnd5e" ) return;
  if ( !game.settings.get(MODULE_ID, SETTINGS.contextMenu) ) return;
  options.push({
    name: t("menu.resume"),
    icon: "",
    condition: li => {
      const actor = game.actors?.get(li.dataset?.entryId ?? li.dataset?.documentId);
      return actor?.type === "character" && (game.user.isGM || actor.isOwner);
    },
    callback: li => {
      const actor = game.actors?.get(li.dataset?.entryId ?? li.dataset?.documentId);
      if ( actor ) launchCreator(actor);
    }
  });
});

/* -------------------------------------------- */
/*  DOM helpers                                 */
/* -------------------------------------------- */

// Foundry's render hooks sometimes hand us a raw HTMLElement (ApplicationV2) and sometimes a
// jQuery-like object (ApplicationV1). This normalises either into a plain DOM element.
function rootElement(html) {
  if ( html instanceof HTMLElement ) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

// Create the launch button and drop it into the directory header. Guards against adding it twice
// (the hook can fire repeatedly) and falls back through a few known header containers because the
// exact markup differs between Foundry/dnd5e versions.
function injectLaunchButton(root) {
  if ( !root || root.querySelector(".sogrom-launch") ) return;
  const container = root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header");
  if ( !container ) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sogrom-launch";
  button.innerHTML = t("menu.launch");
  button.addEventListener("click", ev => { ev.preventDefault(); launchCreator(); });
  container.appendChild(button);
}
