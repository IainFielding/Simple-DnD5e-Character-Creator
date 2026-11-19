import { MODULE_ID, log } from "../config.mjs";
import { LevelUpDriver } from "../levelup/manager-driver.mjs";
import { FIELD_GROUPS, STAMP_FLAG, isGrantedSpell, sourceStamp } from "./fingerprint.mjs";
import { refreshedItemData } from "./merge.mjs";
import { advancementList, baseTypeOf, harvestDecisions, treeKey } from "./answers.mjs";
import { pairItems, remapIds } from "./reconcile.mjs";
import { UpdateAnswerProvider } from "./provider.mjs";
import { ALWAYS_KEPT, packageVersion } from "./scan.mjs";

/**
 * REHEARSE and COMMIT: build the updated character on a clone, then write it in one batch.
 *
 * Two shapes of update:
 *
 * **Refresh only** — no item's advancement configuration changed. Each changed item is rebuilt from
 * its new source by {@link refreshedItemData}, keeping its id and state, and written as an update.
 *
 * **Rebuild** — at least one advancement configuration changed. The character's whole advancement
 * skeleton (species, background, every class and subclass, and everything they granted) is taken
 * apart and put back together, in a single dnd5e `AdvancementManager` walked by our
 * `LevelUpDriver` on a clone:
 *   1. **reverse** every advancement the character has, deepest grant first, with dnd5e's own
 *      `reverse` — which is what takes back ability increases, proficiencies, hit points and granted
 *      items exactly as the system applied them;
 *   2. **delete** the old origin and class items;
 *   3. **stage** the new versions of those items and walk them forward level by level, the way the
 *      system's own level-change steps do, answering every decision from
 *      {@link UpdateAnswerProvider} — the decisions this character already made.
 * The whole skeleton is rebuilt, not only the changed part, because its pieces depend on one another
 * (the original class's proficiencies, a background feat that unlocks a class choice, the character
 * level a species' spells arrive at); an unchanged item replays its own decisions by id and comes back
 * as it was.
 *
 * At commit the result is reconciled with the old character ({@link transform}): rebuilt items get
 * their old ids back, keep their state and any groups the player kept, changed inventory is refreshed
 * in place, and current hit points are carried over.
 */

/** Deep copy of plain data. */
const copy = value => (value === undefined) ? undefined : JSON.parse(JSON.stringify(value));

/** How deep an item sits in the grant chain (0 for an item nothing granted). */
function grantDepth(item, items) {
  let depth = 0;
  let cur = item;
  for ( let i = 0; i < 10; i++ ) {
    const origin = cur?.flags?.dnd5e?.advancementOrigin;
    const next = origin ? items.get(String(origin).split(".")[0]) : null;
    if ( !next ) break;
    depth++;
    cur = next;
  }
  return depth;
}

/** Reversal order for items at the same depth: subclass first, the original class and origins last. */
function rootRank(item, originalClassId) {
  switch ( item.type ) {
    case "subclass": return 1;
    case "class": return (item.id === originalClassId) ? 3 : 2;
    case "background": return 4;
    case "race": return 5;
    default: return 0;
  }
}

/**
 * Push reverse steps for every advancement on the clone, deepest grant first, levels descending, then
 * delete steps for the items nothing granted (granted items go with their grant's reversal).
 * @param {AdvancementManager} manager
 * @returns {Set<string>}   Ids of every item the strip touches.
 */
function pushStripSteps(manager) {
  const AM = manager.constructor;
  const clone = manager.clone;
  const originalClassId = clone._source.system?.details?.originalClass ?? null;
  const withAdv = clone.items.filter(i => i.hasAdvancement);
  withAdv.sort((a, b) => (grantDepth(b, clone.items) - grantDepth(a, clone.items))
    || (rootRank(a, originalClassId) - rootRank(b, originalClassId)));

  for ( const item of withAdv ) {
    const top = AM.currentLevel(item, clone) ?? 0;
    for ( let level = top; level >= 0; level-- ) {
      for ( const flow of AM.flowsForLevel(item, level).reverse() ) {
        manager.steps.push({ type: "reverse", flow, automatic: true });
      }
    }
  }
  for ( const item of withAdv ) {
    if ( item.flags?.dnd5e?.advancementOrigin ) continue;
    manager.steps.push({ type: "delete", item, automatic: true });
  }
  return new Set(withAdv.map(i => i.id));
}

/**
 * Forward steps for a class gaining `count` levels from 0, starting at character level `baseLevel`:
 * the same per-level set `AdvancementManager#createLevelChangeSteps` builds (species flows at the
 * character level, class and subclass flows at the class level, every other item at whichever level
 * it follows), except that the starting character level is given rather than read off the actor — the
 * actor still carries its old classes while the steps are being built.
 */
function pushClassLevels(manager, classItem, count, baseLevel, { raceItem, skip }) {
  const AM = manager.constructor;
  const otherFlows = (characterLevel, classLevel) => manager.clone.items.contents.flatMap(i => {
    if ( skip.has(i.id) || ["class", "subclass", "race"].includes(i.type) ) return [];
    const root = i.system?.advancementRootItem;
    if ( ["class", "subclass"].includes(root?.type) && i.system?.advancementClassLinked ) {
      const rootClass = root.class ?? root;
      return (rootClass === classItem) ? AM.flowsForLevel(i, classLevel) : [];
    }
    return AM.flowsForLevel(i, characterLevel);
  });

  for ( let classLevel = 1; classLevel <= count; classLevel++ ) {
    const characterLevel = baseLevel + classLevel;
    const data = { type: "forward", class: { item: classItem, level: classLevel }, level: characterLevel };
    const push = flows => manager.steps.push(...flows.map(flow => ({ flow, ...data })));
    if ( raceItem ) push(AM.flowsForLevel(raceItem, characterLevel));
    push(AM.flowsForLevel(classItem, classLevel));
    push(otherFlows(characterLevel, classLevel));
  }
  manager.steps.push({
    type: "forward", automatic: true, class: { item: classItem, level: count }, level: baseLevel + count
  });
}

/**
 * Take back a grant the walk applied that the character's own build never did.
 *
 * Content modules prune steps from a manager in `dnd5e.preAdvancementManagerRender` when a character
 * does not qualify — Tasha's drops a 2014 Ranger's level-6 and level-10 Roving grants unless Deft
 * Explorer was taken. Tasha's decides by looking at the manager's *first* step, which in a rebuild is a
 * reversal on some granted feature rather than the class, so it stands down and the grant applies.
 *
 * The character itself says what happened: the same advancement, in the same tree, at a level the
 * class has reached, with nothing ever recorded. Something pruned it then, and the rebuild should not
 * add it now. A grant that is new in this version has a new id and is not affected.
 * @param {LevelUpDriver} driver
 * @param {object} oldData   `actor.toObject()` from before the rebuild.
 */
async function undoNeverApplied(driver, oldData) {
  const oldById = new Map(oldData.items.map(i => [i._id, i]));
  const oldTree = id => treeKey(oldById.get(id), x => oldById.get(x));
  const levels = new Map(oldData.items.filter(i => i.type === "class")
    .map(i => [`class:${i.system?.identifier}`, i.system?.levels ?? 0]));
  const blank = new Set();
  for ( const item of oldData.items ) {
    const tree = oldTree(item._id);
    for ( const adv of advancementList(item) ) {
      if ( (baseTypeOf(adv) !== "ItemGrant") || !(adv.level <= (levels.get(tree) ?? 0)) ) continue;
      if ( !Object.keys(adv.value?.added ?? {}).length ) blank.add(`${tree}|${adv._id}`);
    }
  }
  if ( !blank.size ) return;
  const clone = driver.clone;
  const getItem = id => clone.items.get(id)?.toObject();
  let changed = false;
  for ( const item of clone.items.contents ) {
    const tree = treeKey(item.toObject(), getItem);
    for ( const adv of Object.values(item.advancement?.byId ?? {}) ) {
      if ( !blank.has(`${tree}|${adv.id}`) || !Object.keys(adv.value?.added ?? {}).length ) continue;
      try {
        await adv.reverse(adv.level);
        changed = true;
      } catch ( err ) {
        log("content update: could not take back a never-applied grant", adv.id, err);
      }
    }
  }
  if ( changed ) clone.reset();
}

/**
 * @typedef {object} Rehearsal
 * @property {Actor5e} actor
 * @property {boolean} rebuild           Whether the skeleton is rebuilt.
 * @property {LevelUpDriver|null} driver
 * @property {object[]} decisions        The provider's report lines (rebuild only).
 * @property {object} preview            The final actor data the commit will write.
 * @property {object} summary            Before/after, for the review page.
 * @property {(data: object) => object} transform
 * @property {() => object} base         Fresh copy of the data the transform is applied to.
 * @property {Set<string>} walked        Item ids whose "Keep mine" answer the walk itself read.
 */

/**
 * Build the updated character without touching the real one.
 * @param {Actor5e} actor
 * @param {{entries: import("./scan.mjs").ScanEntry[], needsRebuild: boolean}} scan
 * @param {object} [options]
 * @param {Map<string, boolean>} [options.keep]   item id → true for "Keep mine".
 * @returns {Promise<Rehearsal>}
 */
export async function rehearse(actor, scan, { keep = new Map() } = {}) {
  const oldData = actor.toObject();
  const entries = new Map(scan.entries.map(e => [e.item.id, e]));
  const keeps = id => keep.get(id) ?? entries.get(id)?.keepDefault ?? false;

  if ( !scan.needsRebuild ) {
    const t = makeTransform({ actor, oldData, entries, keeps, rebuilt: false });
    const preview = t(copy(oldData));
    return { actor, rebuild: false, driver: null, decisions: [], preview, transform: t,
      base: () => copy(oldData), walked: new Set(), summary: summarise(actor, preview, null) };
  }

  const AM = dnd5e.applications.advancement.AdvancementManager;
  const manager = new AM(actor);
  const clone = manager.clone;

  // 1–2. Take every advancement back off, then the items they hang from.
  const stripped = pushStripSteps(manager);

  // 3. Stage the new versions of everything nothing granted: origins, classes, standalone items.
  const roots = oldData.items.filter(i => stripped.has(i._id) && !i.flags?.dnd5e?.advancementOrigin
    && (i.type !== "subclass"));
  const newIds = new Map();
  const staged = roots.map(old => {
    const entry = entries.get(old._id);
    const useSource = entry?.source && !keeps(old._id);
    const data = useSource ? entry.source.toObject() : copy(old);
    data._id = foundry.utils.randomID();
    data._stats = { ...(data._stats ?? {}), compendiumSource: entry?.sourceUuid ?? old._stats?.compendiumSource ?? null };
    // A kept item still carries what its advancements recorded the first time round; the walk records
    // them afresh, so they start empty. A source copy arrives with the pack's own defaults (an ASI's
    // `value.type`), exactly as the native manager stages it, and keeps them.
    if ( !useSource ) {
      const advs = data.system?.advancement;
      for ( const a of (Array.isArray(advs) ? advs : Object.values(advs ?? {})) ) delete a.value;
    }
    if ( data.type === "class" ) data.system.levels = 0;
    delete data.flags?.dnd5e?.advancementOrigin;
    newIds.set(old._id, data._id);
    return data;
  });
  const details = oldData.system?.details ?? {};
  const update = { items: staged };
  for ( const key of ["race", "background", "originalClass"] ) {
    if ( details[key] && newIds.has(details[key]) ) update[`system.details.${key}`] = newIds.get(details[key]);
  }
  clone.updateSource(update);
  clone.reset();

  const stagedItems = staged.map(d => clone.items.get(d._id)).filter(Boolean);
  const raceItem = stagedItems.find(i => i.type === "race") ?? null;
  // Level 0 of everything that is not a class: what a species, background or feat applies on arrival.
  for ( const item of stagedItems.filter(i => i.type !== "class") ) {
    for ( const flow of AM.flowsForLevel(item, 0) ) manager.steps.push({ type: "forward", flow });
  }
  // Classes in the order they were taken, as far as it is known: the original class first.
  const originalNew = newIds.get(details.originalClass);
  const classes = stagedItems.filter(i => i.type === "class")
    .sort((a, b) => ((a.id === originalNew) ? -1 : (b.id === originalNew) ? 1 : 0));
  let base = 0;
  for ( const cls of classes ) {
    const oldId = [...newIds].find(([, n]) => n === cls.id)?.[0];
    const levels = oldData.items.find(i => i._id === oldId)?.system?.levels ?? 0;
    if ( !levels ) continue;
    pushClassLevels(manager, cls, levels, base, { raceItem, skip: stripped });
    base += levels;
  }

  // Walk it, answering from the character's own decisions. Picks and subclasses synthesise further
  // decisions, so warm and resolve until nothing new appears.
  const driver = new LevelUpDriver(manager);
  await driver.prepare();
  const lineages = scan.entries.filter(e => e.lineage)
    .map(e => ({ ...e.lineage, from: e.item.name }));
  const provider = new UpdateAnswerProvider(harvestDecisions(oldData), { lineages });
  for ( let pass = 0; pass < 5; pass++ ) {
    const before = UpdateAnswerProvider.records(driver).length;
    await provider.warm(driver);
    await driver.autoResolve(provider);
    if ( (pass > 0) && (UpdateAnswerProvider.records(driver).length === before) ) break;
  }
  await provider.warm(driver);
  await undoNeverApplied(driver, oldData);

  const t = makeTransform({ actor, oldData, entries, keeps, rebuilt: true });
  const preview = t(driver.clone.toObject());
  // The items whose "Keep mine" answer was read while staging the walk (above): changing one of those
  // means walking again. Every other answer is read only by the transform, so the walk can be reused.
  const walked = new Set(roots.filter(old => entries.get(old._id)?.source).map(old => old._id));
  return { actor, rebuild: true, driver, decisions: provider.report, preview, transform: t,
    base: () => driver.clone.toObject(), walked, summary: summarise(actor, preview, driver.clone) };
}

/**
 * Re-apply a rehearsal's transform after a "Keep mine" answer changed, without walking again. The
 * transform reads the answers live, so this is all an answer outside `rehearsal.walked` needs.
 * @param {Rehearsal} rehearsal
 * @returns {Rehearsal}
 */
export function refreshPreview(rehearsal) {
  rehearsal.preview = rehearsal.transform(rehearsal.base());
  rehearsal.summary = summarise(rehearsal.actor, rehearsal.preview, rehearsal.driver?.clone ?? null);
  return rehearsal;
}

/**
 * The reconciliation applied to the rehearsed actor data before it is written. See the module notes.
 * @returns {(data: object) => object}
 */
function makeTransform({ actor, oldData, entries, keeps, rebuilt }) {
  const oldById = new Map(oldData.items.map(i => [i._id, i]));
  return data => {
    let out = data;
    let rebuiltIds = new Set();
    if ( rebuilt ) {
      const finalIds = new Set(out.items.map(i => i._id));
      const removed = oldData.items.filter(i => !finalIds.has(i._id));
      const created = out.items.filter(i => !oldById.has(i._id));
      const pairs = pairItems(removed, created);
      out = remapIds(out, pairs);
      rebuiltIds = new Set(pairs.values());
    }

    const ids = new Set(out.items.map(i => i._id));
    out.items = out.items
      // A granted item whose granter is gone was missed by the reversal; it would duplicate a feature.
      .filter(i => {
        const origin = i.flags?.dnd5e?.advancementOrigin;
        return !origin || !oldById.has(i._id) || ids.has(String(origin).split(".")[0]);
      })
      .map(item => reconcileItem(item, { oldById, entries, keeps, rebuiltIds }));

    // Current hit points are the character's, not the rebuild's.
    const hp = oldData.system?.attributes?.hp;
    if ( hp && out.system?.attributes?.hp ) {
      out.system.attributes.hp.value = hp.value;
      out.system.attributes.hp.temp = hp.temp;
    }
    out._id = actor.id;
    return out;
  };
}

/** One item of the final data, reconciled with the old copy it replaces or refreshes. */
function reconcileItem(item, { oldById, entries, keeps, rebuiltIds }) {
  const old = oldById.get(item._id);
  if ( !old ) return item;                          // brand new: comes as granted
  const entry = entries.get(old._id);
  const kept = keeps(old._id);

  // A rebuilt item: the walk granted it afresh from the new source; it now carries its old id, and
  // takes its state and any kept groups from the old copy.
  if ( rebuiltIds.has(item._id) ) {
    // A species that split into a species and a lineage takes its successor's name and icon: "Elf, Drow"
    // is now an Elf, and the Drow lineage says the rest.
    const keep = kept ? FIELD_GROUPS.filter(g => g !== "advancement") : ((entry?.how === "split") ? [] : ALWAYS_KEPT);
    const merged = refreshedItemData(old, item, { uuid: item._stats?.compendiumSource, keep, rebuilt: true });
    // What the walk recorded wins over the old records: the answers were replayed into the new tree,
    // under (possibly) new advancement ids and new grant links.
    merged.system.advancement = copy(item.system?.advancement);
    const dnd5eFlags = { ...(old.flags?.dnd5e ?? {}), ...(item.flags?.dnd5e ?? {}) };
    if ( !item.flags?.dnd5e?.advancementOrigin ) delete dnd5eFlags.advancementOrigin;
    merged.flags = { ...(merged.flags ?? {}) };
    if ( Object.keys(dnd5eFlags).length || ("dnd5e" in (old.flags ?? {})) ) merged.flags.dnd5e = dnd5eFlags;
    else delete merged.flags.dnd5e;
    if ( item.type === "class" ) merged.system.levels = item.system?.levels;
    // A spell the walk granted is tagged with the item that grants it now. dnd5e 6.1.0 moved the
    // always-prepared lists (Life Domain Spells, Druidic's Speak with Animals) from the subclass or
    // class onto a feature, so the old tag (`subclass:life`) would no longer match a native build's
    // (`feat:life-domain-spells`).
    if ( isGrantedSpell(item) && item.system?.sourceItem ) merged.system.sourceItem = item.system.sourceItem;
    // Likewise "always prepared" belongs to the grant, not the player: 6.1.0 makes a Warlock's Mystic
    // Arcanum spell always prepared. Between the other states (a player's own toggle) the old copy wins.
    const ALWAYS = CONFIG.DND5E?.spellPreparationStates?.always?.value ?? 2;
    if ( isGrantedSpell(item) && ((item.system?.prepared === ALWAYS) || (old.system?.prepared === ALWAYS)) ) {
      merged.system.prepared = item.system?.prepared;
      if ( item.system?.method ) merged.system.method = item.system.method;
    }
    stamp(merged, item);
    return merged;
  }

  // An item refreshed in place.
  if ( (entry?.tier === "refresh") && entry.source && !kept ) {
    const sourceData = entry.source.toObject();
    const merged = refreshedItemData(old, sourceData, { uuid: entry.sourceUuid, keep: ALWAYS_KEPT });
    stamp(merged, sourceData, entry.sourceUuid);
    return merged;
  }
  return item;
}

/** Record the source stamp on a refreshed or rebuilt item. */
function stamp(itemData, sourceData, uuid = sourceData?._stats?.compendiumSource) {
  if ( !uuid ) return;
  itemData.flags ??= {};
  itemData.flags[MODULE_ID] = { ...(itemData.flags[MODULE_ID] ?? {}),
    [STAMP_FLAG]: sourceStamp(sourceData, { uuid, version: packageVersion(uuid) }) };
}

/* -------------------------------------------- */
/*  Summary                                     */
/* -------------------------------------------- */

/**
 * Before and after, for the review page: ability scores, hit point maximum, armour class, skill
 * proficiencies, and which items arrive, leave or change.
 * @param {Actor5e} actor
 * @param {object} preview         Final actor data.
 * @param {Actor5e|null} prepared  A prepared actor holding the result (the driver's clone), when there is one.
 */
export function summarise(actor, preview, prepared) {
  let after = prepared;
  if ( !after ) {
    try {
      after = actor.clone({ system: preview.system, items: preview.items }, { keepId: true });
    } catch ( err ) {
      log("content update: could not prepare the preview", err);
      after = null;
    }
  }
  const rows = [];
  const push = (label, a, b) => { if ( String(a) !== String(b) ) rows.push({ label, before: a, after: b }); };
  if ( after ) {
    for ( const [key, cfg] of Object.entries(CONFIG.DND5E.abilities) ) {
      push(cfg.label ?? key, actor.system.abilities?.[key]?.value, after.system.abilities?.[key]?.value);
    }
    push("HP", actor.system.attributes?.hp?.max, after.system.attributes?.hp?.max);
    push("AC", actor.system.attributes?.ac?.value, after.system.attributes?.ac?.value);
    for ( const [key, cfg] of Object.entries(CONFIG.DND5E.skills) ) {
      push(cfg.label ?? key, actor.system.skills?.[key]?.value ?? 0, after.system.skills?.[key]?.value ?? 0);
    }
  }

  const oldItems = new Map(actor.items.map(i => [i.id, i]));
  const newItems = new Map(preview.items.map(i => [i._id, i]));
  const added = preview.items.filter(i => !oldItems.has(i._id)).map(i => i.name);
  const removed = actor.items.filter(i => !newItems.has(i.id)).map(i => i.name);
  return { rows, added: added.sort(), removed: removed.sort() };
}

/* -------------------------------------------- */
/*  Commit                                      */
/* -------------------------------------------- */

/**
 * Write a rehearsal to the real actor.
 * @param {Rehearsal} rehearsal
 * @returns {Promise<Actor5e>}
 */
export async function commitRehearsal(rehearsal) {
  const { actor, driver, transform } = rehearsal;
  if ( driver ) return driver.commit({ transform });

  // Refresh only: the items that changed, as updates.
  const final = transform(actor.toObject());
  const updates = final.items.filter(i => {
    const now = actor.items.get(i._id);
    return now && !foundry.utils.objectsEqual(now.toObject(), i);
  });
  if ( updates.length ) {
    await actor.updateEmbeddedDocuments("Item", updates, { diff: false, recursive: false });
  }
  return actor;
}
