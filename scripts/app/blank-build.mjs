import { t, log, creationEnabled } from "../config.mjs";
import { launchCreator } from "../api.mjs";
import { placeHeaderButton } from "../levelup/intercept.mjs";

/**
 * Building into a blank character the GM prepared.
 *
 * The creator's only other front door is the Actors sidebar button, and that needs the Create Actor
 * permission — which many tables withhold from players on purpose. The build engine never needed it
 * for this: {@link module:api.launchCreator} takes an existing actor and builds into it. So the GM
 * makes an empty character, gives the player ownership, and the player gets a "Build Character"
 * button on it. No socket and no GM-side relay; the permission Foundry already checks (ownership of
 * that actor) is the whole of the gate.
 *
 * "Blank" means a character with no class, species or background. Those are the three items the
 * assembler adds, so a sheet already holding one of them would end up with two. Anything else on it
 * (starting gold the GM put there, a trinket, a portrait) is left alone and kept.
 */

/** The origin item types the assembler writes. A character holding any of them is not blank. */
const ORIGIN_TYPES = new Set(["class", "race", "background"]);

/**
 * Whether this user can build a character into this actor from scratch.
 * @param {Actor5e|null} actor
 * @param {object} [options]
 * @param {boolean} [options.enabled]  Whether the module offers creation at all; injectable for tests.
 * @returns {boolean}
 */
export function canBuildInto(actor, { enabled = creationEnabled() } = {}) {
  if ( !enabled || !actor ) return false;
  if ( actor.type !== "character" || actor.pack || !actor.isOwner ) return false;
  return !actor.items?.some?.(i => ORIGIN_TYPES.has(i.type));
}

/**
 * Open the creator on a blank character. Re-checked on click: the sheet may have gained a class
 * since the button was drawn.
 * @param {Actor5e} actor
 */
export function buildInto(actor) {
  if ( !canBuildInto(actor) ) return ui.notifications?.warn(t("blankBuild.notBlank"));
  return launchCreator(actor);
}

/** Our header-control action name, namespaced so it cannot collide with a sheet's own. */
const HEADER_CONTROL = "sogromBuildCharacter";

/**
 * Wire the sheet's two entry points: a gold button in the sheet header (where the Level Up trophy
 * sits on a character with a class) and an entry in the sheet's ⋯ menu. Both are always on while
 * the module offers creation — on a blank sheet there is nothing else to do, so there is nothing
 * for a setting to protect. The sidebar entry is {@link registerBlankBuildMenu}, registered earlier.
 */
export function registerBlankBuild() {
  const onRender = (app, html) => {
    try {
      const root = html instanceof HTMLElement ? html : html?.[0];
      if ( !root ) return;
      const actor = app?.actor;
      // Cleared when it no longer applies: Tidy's sheets update in place, so a button drawn on the
      // blank sheet would otherwise outlive the build that filled it.
      const existing = root.querySelector(".sogrom-build-btn");
      if ( !canBuildInto(actor) ) { existing?.remove(); return; }
      if ( existing ) return;
      placeHeaderButton(root, {
        className: "sogrom-build-btn",
        icon: "fa-solid fa-hammer",
        label: t("blankBuild.button"),
        onClick: () => buildInto(actor)
      });
    } catch ( err ) {
      log("could not add the Build Character button", err);
    }
  };
  Hooks.on("renderActorSheet", onRender);
  Hooks.on("renderActorSheetV2", onRender);

  // Fires for every ApplicationV2 in the world (see intercept.mjs onGetHeaderControls for why the
  // base name), so the guard carries the whole decision.
  Hooks.on("getHeaderControlsApplicationV2", (application, controls) => {
    try {
      const actor = application?.actor;
      if ( !canBuildInto(actor) || controls.some(c => c.action === HEADER_CONTROL) ) return;
      controls.push({
        action: HEADER_CONTROL,
        icon: "fa-solid fa-hammer",
        label: t("blankBuild.button"),
        onClick: () => buildInto(actor)
      });
    } catch ( err ) {
      log("could not add the Build Character header control", err);
    }
  });

}

/**
 * The Actors sidebar's right-click entry.
 *
 * Registered when the module loads, not at `ready` with the rest. Foundry asks for a directory's
 * context entries exactly once, when the directory first renders (`DocumentDirectory#_onFirstRender`
 * → `_createContextMenus`), and the sidebar renders before `ready` — so an entry registered there
 * never makes it into the menu. The Level Up entry in main.mjs is registered at load for the same
 * reason. `condition` runs on every right-click, so the gate is still evaluated live.
 */
export function registerBlankBuildMenu() {
  Hooks.on("getActorContextOptions", (_directory, options) => {
    if ( game.system?.id !== "dnd5e" ) return;
    const actorOf = li => game.actors?.get(li.dataset?.entryId ?? li.dataset?.documentId);
    // v14's entry shape (`label`, `visible`, `onClick`); see the Level Up entry in main.mjs.
    options.push({
      label: t("blankBuild.button"),
      icon: "fa-solid fa-hammer",
      visible: li => canBuildInto(actorOf(li)),
      onClick: (_event, li) => {
        const actor = actorOf(li);
        if ( actor ) buildInto(actor);
      }
    });
  });
}
