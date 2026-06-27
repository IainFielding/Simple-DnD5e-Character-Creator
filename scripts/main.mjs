import { MODULE_ID, SETTINGS, DEFAULTS, tpl, t, log } from "./config.mjs";
import { STEPS } from "./steps/registry.mjs";
import { CreatorShell } from "./app/creator-shell.mjs";
import { warmSources } from "./data/source-cache.mjs";

/* -------------------------------------------- */
/*  Init: settings + templates                  */
/* -------------------------------------------- */

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
}

/**
 * Resolve the ApplicationV2 options for a launch, based on the configured display mode.
 * Fullscreen covers the viewport with no chrome; windowed opens a themed, draggable,
 * resizable frame at ~90% of the screen, centred.
 * @returns {object}
 */
function sheetOptions() {
  const windowed = game.settings.get(MODULE_ID, SETTINGS.displayMode) === "windowed";
  // Carry the base class explicitly: ApplicationV2 may replace (rather than merge)
  // the static DEFAULT_OPTIONS.classes with the array passed here.
  if ( !windowed ) return { classes: ["sogrom-creator", "sogrom-creator-fullscreen"] };

  const w = Math.min(1800, Math.round(window.innerWidth * 0.9));
  const h = Math.min(1100, Math.round(window.innerHeight * 0.9));
  return {
    classes: ["sogrom-creator", "sogrom-creator-windowed"],
    window: { frame: true, positioned: true, resizable: true },
    position: {
      width: w,
      height: h,
      top: Math.max(4, Math.round((window.innerHeight - h) / 2)),
      left: Math.max(4, Math.round((window.innerWidth - w) / 2))
    }
  };
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

  // Pre-warm the shared compendium index in the background, so the builder opens instantly
  // instead of showing its loading screen on first use. Gated to users who can create actors
  // (the launch button's audience) to avoid taxing clients that will never open it, and deferred
  // to idle so it never competes with the rest of world startup. A window opened before this
  // finishes simply awaits the same work behind its loading screen.
  if ( game.user?.can("ACTOR_CREATE") ) {
    const warm = () => warmSources().catch(() => {});
    if ( typeof requestIdleCallback === "function" ) requestIdleCallback(warm, { timeout: 3000 });
    else window.setTimeout(warm, 1000);
  }
});

/* -------------------------------------------- */
/*  Launch entry points                         */
/* -------------------------------------------- */

/**
 * Create a fresh character (or reuse an existing one) and open the creator.
 * @param {Actor} [actor]  Existing actor to resume; a new draft is created if omitted.
 */
async function launchCreator(actor) {
  if ( !actor ) {
    try {
      actor = await Actor.create({ name: t("common.newCharacter"), type: "character" });
    } catch ( err ) {
      log("actor creation failed", err);
    }
    if ( !actor ) return ui.notifications?.warn(t("notify.noPermission"));
  }
  new CreatorShell(actor, sheetOptions()).render(true);
}

Hooks.on("renderActorDirectory", (_app, html) => {
  if ( game.system?.id !== "dnd5e" ) return;
  if ( !game.settings.get(MODULE_ID, SETTINGS.launchButton) ) return;
  if ( !game.user?.can("ACTOR_CREATE") ) return;
  injectLaunchButton(rootElement(html));
});

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

function rootElement(html) {
  if ( html instanceof HTMLElement ) return html;
  return html?.[0] instanceof HTMLElement ? html[0] : null;
}

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
