import { ABILITIES, log } from "../config.mjs";

/**
 * Turns a finished {@link CreatorState} into a real character by writing the base
 * ability scores and adding the chosen origin items. Each origin is added through
 * the dnd5e system's own {@link AdvancementManager} (via the public `forNewItem`
 * factory), which presents any required advancement choices and commits the result
 * to the actor. Items are added in turn — class first — so later items see the
 * level the class established.
 *
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @returns {Promise<Actor>} The built actor.
 */
export async function assembleActor(state) {
  const actor = state.actor;

  // 1. Base ability scores (before any species/background increases the manager applies).
  const scores = state.resolvedScores();
  const update = {};
  for ( const key of ABILITIES ) update[`system.abilities.${key}.value`] = scores[key];
  await actor.update(update);

  // 2. Origin items, in dependency order.
  for ( const uuid of [state.classUuid, state.backgroundUuid, state.speciesUuid] ) {
    if ( !uuid ) continue;
    const doc = await fromUuid(uuid);
    if ( !doc ) { log(`origin item not found: ${uuid}`); continue; }
    await addOrigin(actor, doc.toObject());
  }

  return actor;
}

/* -------------------------------------------- */

/**
 * Add one origin item to the actor. If it carries advancements, hand off to the
 * AdvancementManager and wait for it to finish; otherwise create the item directly.
 */
async function addOrigin(actor, itemData) {
  const Manager = dnd5e.applications.advancement.AdvancementManager;
  const manager = Manager.forNewItem(actor, itemData, { automaticApplication: true });

  if ( !manager.steps.length ) {
    const data = foundry.utils.deepClone(itemData);
    if ( data.type === "class" ) data.system.levels = 1;
    await actor.createEmbeddedDocuments("Item", [data]);
    return;
  }

  await manager.render(true);
  await waitForManager(manager);
}

/** Resolve once the manager commits its results or is dismissed. */
function waitForManager(manager) {
  return new Promise(resolve => {
    const finish = () => { Hooks.off("dnd5e.advancementManagerComplete", hookId); resolve(); };
    const hookId = Hooks.on("dnd5e.advancementManagerComplete", mgr => {
      if ( mgr === manager ) finish();
    });
    manager.addEventListener("close", finish, { once: true });
  });
}
