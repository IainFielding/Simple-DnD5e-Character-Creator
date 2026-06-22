import { MODULE_ID, SETTINGS, DEFAULTS, tpl, t, log } from "./config.mjs";
import { STEPS } from "./steps/registry.mjs";
import { CreatorShell } from "./app/creator-shell.mjs";

/* -------------------------------------------- */
/*  Init: settings + templates                  */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();
  // Step partials are pulled in by the stage via a dynamic Handlebars partial, so they
  // must be registered up front (the rail/stage/shell themselves are loaded as PARTS).
  foundry.applications.handlebars.loadTemplates(STEPS.map(s => tpl(`${s.template}.hbs`)));
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
  new CreatorShell(actor).render(true);
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
    icon: '<i class="fa-solid fa-hat-wizard"></i>',
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
  button.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> ${t("menu.launch")}`;
  button.addEventListener("click", ev => { ev.preventDefault(); launchCreator(); });
  container.appendChild(button);
}
