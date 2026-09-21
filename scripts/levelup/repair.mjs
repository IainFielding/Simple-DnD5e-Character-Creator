import { t, log, launchWindowOptions, fireHook, HOOKS } from "../config.mjs";
import { unresolvedByLevel } from "../data/advancement-util.mjs";
import { LevelUpDriver } from "./manager-driver.mjs";
import { LevelUpState } from "./levelup-state.mjs";
import { LevelUpShell } from "./levelup-shell.mjs";

/**
 * "Repair this level": finish the decisions a character's level left unanswered.
 *
 * dnd5e never blocks Next on an unmade choice, so a level can be applied with a Fighting Style never
 * picked, an ASI never spent or a subclass never chosen, and nothing on the sheet says so. This finds
 * those gaps per class level and re-runs just them through the ordinary level-up shell. The idea is
 * plaksiy's "Fix Level N"; the mechanism is ours.
 *
 * Theirs rebuilds the level with dnd5e's `AdvancementManager.forModifyChoices`, which reverses every
 * level from N up, replays N, and restores the rest. That also re-asks everything level N *did*
 * answer, hit points included. Here the manager holds forward steps for the unanswered advancements
 * only. Nothing is reversed, so a decision the player made cannot be lost, and the driver's usual
 * synthesis covers the knock-on effects: a subclass chosen late brings in its features up to the
 * class's current level, and a picked feature brings its own advancements.
 */

/**
 * The items whose decisions belong to a class: the class, its subclass, and every item linked to
 * either (a feature granted by the class or subclass — Arcana Unleashed's Savant choice lives on one).
 * dnd5e reads a linked item's advancement level off the class it hangs from (`advancementLevel`), so
 * all of them share the class's levels.
 * @param {Actor5e} actor
 * @param {Item5e} classItem
 * @returns {Item5e[]}
 */
export function repairItems(actor, classItem) {
  const subclass = classItem.subclass ?? actor.items.find(i => (i.type === "subclass")
    && (i.system?.classIdentifier === classItem.system?.identifier)) ?? null;
  const roots = new Set([classItem.id, subclass?.id].filter(Boolean));
  const linked = actor.items.filter(i => !roots.has(i.id)
    && roots.has(i.system?.advancementRootItem?.id)
    && (i.system?.advancementClassLinked !== false));
  return [classItem, subclass, ...linked].filter(Boolean);
}

/**
 * The class level an item was granted at, for a feature whose own advancements sit at level 0 ("when
 * this item arrives"). Read off the granting advancement's record, following one granted feature up
 * to the one that granted it where needed. Null when the item carries no grant record.
 * @param {Actor5e} actor
 * @param {Item5e} item
 * @param {number} [depth]
 * @returns {number|null}
 */
export function grantLevel(actor, item, depth = 0) {
  const origin = item?.flags?.dnd5e?.advancementOrigin;
  if ( !origin || (depth > 3) ) return null;
  const [ownerId, advId] = String(origin).split(".");
  const owner = actor.items.get(ownerId);
  const adv = owner?.advancement?.byId?.[advId];
  if ( !adv ) return null;
  const added = adv.value?.added ?? {};
  if ( adv.constructor?.metadata?.multiLevel ) {
    for ( const [level, map] of Object.entries(added) ) if ( map?.[item.id] ) return Number(level);
  }
  const level = adv.level ?? null;
  if ( level ) return level;
  return grantLevel(actor, owner, depth + 1);
}

/**
 * Every class on the character with unanswered decisions, grouped by the class level they are owed
 * at. Empty when there is nothing to repair.
 * @param {Actor5e} actor
 * @returns {{classItem: Item5e, levels: {level: number, titles: string[],
 *   entries: {itemId: string, id: string, type: string, title: string, level: number}[]}[]}[]}
 */
export function repairTargets(actor) {
  if ( (actor?.type !== "character") || !actor.items ) return [];
  const out = [];
  for ( const classItem of actor.items.filter(i => i.type === "class") ) {
    const classLevel = classItem.system?.levels ?? 0;
    const byLevel = new Map();
    for ( const item of repairItems(actor, classItem) ) {
      for ( const entry of unresolvedByLevel(item, classLevel) ) {
        // A level-0 decision on a granted feature was owed when the feature arrived.
        const screen = entry.level || grantLevel(actor, item) || 1;
        if ( screen > classLevel ) continue;
        const group = byLevel.get(screen) ?? [];
        group.push({ ...entry, itemId: item.id });
        byLevel.set(screen, group);
      }
    }
    if ( !byLevel.size ) continue;
    out.push({
      classItem,
      levels: [...byLevel].sort(([a], [b]) => a - b).map(([level, entries]) => ({
        level, entries, titles: [...new Set(entries.map(e => e.title))]
      }))
    });
  }
  return out;
}

/**
 * Whether the repair action should be offered: the user owns this character and it has a level with
 * something unanswered. Unlike Level Up, a character at the level cap still qualifies.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function canRepair(actor) {
  if ( !actor?.isOwner ) return false;
  try {
    return repairTargets(actor).length > 0;
  } catch ( err ) {
    log("could not read the character's unanswered choices", err);
    return false;
  }
}

/**
 * A manager whose steps are forward flows for exactly the decisions one class level left unanswered.
 *
 * Each step carries the class at its *current* level, so the driver keeps the class where it is and
 * a subclass chosen here synthesises its features up to that level rather than only its first. No
 * step is automatic and none reverses anything.
 * @param {Actor5e} actor
 * @param {string} classItemId
 * @param {number} level        The class level to repair.
 * @returns {AdvancementManager}
 */
export function buildRepairManager(actor, classItemId, level) {
  const { AdvancementManager } = dnd5e.applications.advancement;
  const manager = new AdvancementManager(actor);
  const group = repairTargets(actor).find(tg => tg.classItem.id === classItemId)
    ?.levels.find(g => g.level === level);
  const cloneClass = manager.clone.items.get(classItemId);
  if ( !group || !cloneClass ) return manager;

  const seen = new Set();
  for ( const entry of group.entries ) {
    const key = `${entry.itemId}.${entry.id}.${entry.level}`;
    if ( seen.has(key) ) continue;
    seen.add(key);
    const item = manager.clone.items.get(entry.itemId);
    if ( !item ) continue;
    const flow = AdvancementManager.flowsForLevel(item, entry.level)
      .find(f => (f.advancement?.id ?? f.advancement?._id) === entry.id);
    if ( !flow ) continue;
    manager.steps.push({ type: "forward", flow, class: { item: cloneClass, level: cloneClass.system?.levels ?? level } });
  }
  return manager;
}

/**
 * Put every decision a repair surfaced on the one screen it repairs. A feature's own decisions sit at
 * level 0, and anything a late subclass pick reveals keeps the level it was granted at; either would
 * otherwise add a second screen to a session that is about a single level.
 * @param {LevelUpDriver} driver
 * @param {number} level
 */
export function foldToLevel(driver, level) {
  const arrays = [driver.hpSteps, driver.asiSteps, driver.choiceSteps, driver.traitSteps, driver.subclassSteps,
    driver.grantSteps, driver.sizeSteps, driver.optionalGrantSteps, driver.nativeSteps];
  for ( const records of arrays ) for ( const record of records ?? [] ) record.screenLevel = level;
}

/**
 * Open the level-up shell on one class level's unanswered decisions.
 * @param {Actor5e} actor
 * @param {string} classItemId
 * @param {number} level
 * @returns {Promise<LevelUpShell|null>}   The opened shell, or null when there was nothing to do.
 */
export async function launchRepair(actor, classItemId, level) {
  try {
    const manager = buildRepairManager(actor, classItemId, level);
    if ( !manager.steps.length ) {
      ui.notifications?.info(t("levelup.repair.nothing"));
      return null;
    }
    const driver = new LevelUpDriver(manager);
    await driver.prepare();
    foldToLevel(driver, level);
    const state = new LevelUpState(actor, driver, { repairLevel: level });
    const app = new LevelUpShell(state, launchWindowOptions());
    app.render(true);
    // A repair is the level-up wizard, so it keeps the wizard's hook contract: started now, then
    // applied or cancelled. `state.repairLevel` tells a listener which kind of session it is.
    state.startAnnounced = true;
    fireHook(HOOKS.levelUpStarted, { actor, app, state, driver });
    return app;
  } catch ( err ) {
    log("repair could not be prepared", err);
    ui.notifications?.error(t("levelup.repair.failed"));
    return null;
  }
}

/**
 * The sheet's repair action: straight into the one level there is to repair, or a choice between
 * them when there are several.
 * @param {Actor5e} actor
 * @returns {Promise<LevelUpShell|null>}
 */
export async function promptRepair(actor) {
  const options = repairOptions(actor);
  if ( !options.length ) {
    ui.notifications?.info(t("levelup.repair.nothing"));
    return null;
  }
  if ( options.length === 1 ) return launchRepair(actor, options[0].classId, options[0].level);

  const { DialogV2 } = foundry.applications.api;
  const picked = await DialogV2.wait({
    window: { title: t("levelup.repair.dialogTitle"), icon: "fa-solid fa-wrench" },
    content: `<p>${t("levelup.repair.prompt")}</p>`,
    buttons: options.map((o, i) => ({ action: String(i), label: o.label, icon: "fa-solid fa-wrench" })),
    rejectClose: false
  });
  const choice = options[Number(picked)];
  return choice ? launchRepair(actor, choice.classId, choice.level) : null;
}

/**
 * The repair targets as a flat list of labelled options, one per class level, for the prompt.
 * @param {Actor5e} actor
 * @returns {{classId: string, level: number, label: string}[]}
 */
export function repairOptions(actor) {
  return repairTargets(actor).flatMap(({ classItem, levels }) => levels.map(g => ({
    classId: classItem.id,
    level: g.level,
    label: t("levelup.repair.option", { class: classItem.name, level: g.level, titles: g.titles.join(", ") })
  })));
}
