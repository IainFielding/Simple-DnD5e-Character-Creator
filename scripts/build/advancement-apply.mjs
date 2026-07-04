import { log } from "../config.mjs";
import { advancementArray } from "../data/choice-resolver.mjs";

/**
 * Applies the player's advancement choices without the dnd5e AdvancementManager ever
 * prompting them. It splits the work into three stages:
 *
 *  1. {@link buildChoicePlan} works out which advancements the wizard already resolved
 *     (so the manager should skip them) and which granted-feature ItemGrants must be
 *     recreated by hand (their sub-features carry their own choices).
 *  2. {@link runAdvancementManager} runs the manager non-interactively for the origin
 *     items, with the skipped advancements removed, and hands back its updates/items.
 *  3. {@link applyChoicePlan} then stamps the player's Trait/Size/ItemChoice picks and
 *     recreates the taken-over ItemGrants directly on the created items.
 *
 * All functions are pure of UI/state — they take explicit data so the assembler stays
 * the only orchestrator.
 */

const ADV_TYPES = ["Trait", "Size", "ItemChoice"];

/**
 * Plan which advancements the manager must skip and which ItemGrants we recreate.
 * @param {{sources: object[]}} resolved   Output of the choice resolver.
 * @param {{class:?object, background:?object, species:?object}} sourceItems  Origin docs.
 * @returns {{skipAdvIds: Set<string>, takeovers: {source:string, grantAdvId:string}[]}}
 */
export function buildChoicePlan(resolved, sourceItems) {
  const skipAdvIds = new Set();
  const takeovers = [];
  for ( const src of resolved?.sources ?? [] ) {
    const sourceItem = sourceItems[src.key];
    if ( !sourceItem ) continue;

    const ownerUuids = new Set(src.requirements.filter(r => r.ownerUuid).map(r => r.ownerUuid));
    const spellAbilityAdvIds = new Set(
      src.requirements.filter(r => r.type === "SpellAbility" && !r.ownerUuid).map(r => r.advId)
    );

    for ( const adv of advancementArray(sourceItem) ) {
      if ( adv.type !== "ItemGrant" || (adv.level ?? 0) > 1 ) continue;
      const granted = Array.from(adv.configuration?.items ?? [])
        .map(i => (typeof i === "string") ? i : i?.uuid).filter(Boolean);
      if ( spellAbilityAdvIds.has(adv._id) || granted.some(u => ownerUuids.has(u)) ) {
        skipAdvIds.add(adv._id);
        takeovers.push({ source: src.key, grantAdvId: adv._id });
      }
    }

    for ( const req of src.requirements ) {
      if ( req.ownerUuid ) continue;                // granted-feature choices handled via takeover
      if ( ADV_TYPES.includes(req.type) ) skipAdvIds.add(req.advId);
    }
  }
  return { skipAdvIds, takeovers };
}

/**
 * Run the AdvancementManager for the supplied origin items with the planned advancements
 * skipped, and return its committed result without applying it (the caller applies, so it
 * can also create the manually-resolved items). Resolves null if the flow is cancelled.
 * @returns {Promise<{updates: object, items: object[]}|null>}
 */
export async function runAdvancementManager(actor, items, skipAdvIds = new Set()) {
  const manager = new dnd5e.applications.advancement.AdvancementManager(actor, { automaticApplication: true });
  manager.clone.updateSource({ items });
  const backup = actor.toObject();

  for ( const itemData of items ) {
    const item = manager.clone.items.get(itemData._id);
    if ( !item ) continue;
    if ( item.type === "class" ) {
      manager.createLevelChangeSteps(item, 1);
      continue;
    }
    // Species and background aren't levelled, so push their advancement flows by hand —
    // both the level-0 grants and any tagged at level 1 (the only levels a new character has).
    for ( let l = 0; l < 2; l++ ) {
      for ( const flow of manager.constructor.flowsForLevel(item, l) ) {
        // The background ability increase is baked into the actor directly; skip its step.
        if ( flow.advancement?.type === "AbilityScoreImprovement" ) continue;
        if ( skipAdvIds.has(flow.advancement?._id) ) continue;
        manager.steps.push({ type: "forward", flow });
      }
    }
  }

  // Drop any class steps the level-change builder created for skipped (wizard-resolved)
  // advancements. Done once before render so the manager's step processing isn't disturbed.
  if ( skipAdvIds.size ) {
    manager.steps = manager.steps.filter(s => !skipAdvIds.has(s.flow?.advancement?._id));
  }

  await manager.render(true);

  return new Promise(resolve => {
    const onComplete = (mgr, updates, toCreate) => {
      if ( mgr !== manager ) return;
      const diff = foundry.utils.diffObject(backup, updates);
      delete diff._id;
      Hooks.off("dnd5e.preAdvancementManagerComplete", hookId);
      resolve({ updates: diff, items: toCreate });
      return false;   // prevent the manager committing itself — we apply manually
    };
    const hookId = Hooks.on("dnd5e.preAdvancementManagerComplete", onComplete);
    manager.addEventListener("close", () => {
      Hooks.off("dnd5e.preAdvancementManagerComplete", hookId);
      resolve(null);
    }, { once: true });
  });
}

/**
 * Record the player's background ability allocation onto the created background item's
 * AbilityScoreImprovement advancement, so the dnd5e sheet shows the step complete. The
 * numeric scores themselves were already baked into the actor by the assembler.
 */
export async function recordBackgroundAsiValue(actor, backgroundItemId, asi, bonuses) {
  if ( !backgroundItemId || !asi?.id ) return;
  const item = actor.items.get(backgroundItemId);
  if ( !item ) return;
  try {
    await item.update({
      [`system.advancement.${asi.id}.value`]: { type: "asi", assignments: foundry.utils.deepClone(bonuses) }
    });
  } catch ( err ) {
    log("could not record background ASI value (scores already applied)", err);
  }
}

/**
 * Apply the wizard's advancement choices to the created origin items.
 * @param {Actor} actor
 * @param {{takeovers: object[]}} plan
 * @param {{sources: object[]}} resolved
 * @param {object} advChoices                  state.advChoices
 * @param {{class:?string, background:?string, species:?string}} originItemIds
 */
export async function applyChoicePlan(actor, plan, resolved, advChoices, originItemIds) {
  // Phase A — recreate taken-over ItemGrants (granted features + their sub-advancements).
  for ( const t of plan.takeovers ) {
    const originItem = actor.items.get(originItemIds[t.source]);
    const grantAdv = originItem?.advancement?.byId?.[t.grantAdvId];
    if ( !grantAdv ) { log(`takeover ItemGrant ${t.grantAdvId} not found on ${t.source}`); continue; }
    await manuallyApplyItemGrant(actor, originItem, grantAdv, t.source, advChoices, 0);
  }

  // Phase B — the origin item's own Trait / Size / ItemChoice choices.
  for ( const src of resolved?.sources ?? [] ) {
    const originItem = actor.items.get(originItemIds[src.key]);
    if ( !originItem ) continue;

    const byAdv = {};
    for ( const req of src.requirements ) {
      if ( req.ownerUuid || !ADV_TYPES.includes(req.type) ) continue;
      const chosen = advChoices[src.key]?.[req.selKey] ?? [];
      const entry = (byAdv[req.advId] ??= { type: req.type, level: req.level ?? 0, keys: [] });
      entry.keys.push(...chosen);
    }

    for ( const [advId, info] of Object.entries(byAdv) ) {
      const adv = originItem.advancement?.byId?.[advId];
      if ( !adv ) continue;
      try {
        if ( info.type === "Trait" ) {
          // The manager skipped this whole advancement because it carried a choice, so its
          // automatic grants would be lost too — merge them back in with the player's picks.
          const chosen = mergeTraitGrants(adv, info.keys);
          if ( chosen.length ) await adv.apply(info.level, { chosen });
        }
        else if ( info.type === "Size" ) {
          if ( info.keys.length ) await adv.apply(info.level, { size: info.keys[0] });
        }
        else if ( info.type === "ItemChoice" ) await applyItemChoice(actor, originItem, adv, info.level, info.keys, src.key, advChoices, 0);
      } catch ( err ) {
        log(`failed to apply ${info.type} ${advId} on ${src.key}`, err);
      }
    }
  }
}

/* -------------------------------------------- */
/*  Manual application internals                */
/* -------------------------------------------- */

/**
 * The full `chosen` set a Trait advancement must apply: its automatic `configuration.grants`
 * plus the player's recorded picks, de-duplicated. The choice resolver only ever surfaces the
 * picks, so without folding the grants back in the manual apply path drops them (and the
 * manager can't, since it skipped the advancement to let the wizard own the choice).
 */
function mergeTraitGrants(adv, recordedKeys = []) {
  const grants = Array.from(adv?.configuration?.grants ?? []);
  return [...new Set([...grants, ...recordedKeys])];
}

/** Recorded selection keys for an advancement (merges its multiple Trait choice entries). */
function recordedKeysForAdv(advChoices, source, advId) {
  const bucket = advChoices[source] ?? {};
  const keys = [];
  for ( const [selKey, vals] of Object.entries(bucket) ) {
    if ( selKey === advId || selKey.startsWith(`${advId}#`) ) keys.push(...(vals ?? []));
  }
  return keys;
}

/** Recreate an ItemGrant by hand: create each granted item, then recurse into its advancements. */
async function manuallyApplyItemGrant(actor, parentItem, adv, source, advChoices, depth) {
  if ( depth > 3 ) return;
  const spellCfg = adv.configuration?.spell;
  const abilities = Array.from(spellCfg?.ability ?? []);
  const ability = recordedKeysForAdv(advChoices, source, adv.id)[0] || abilities[0] || null;
  const added = {};

  for ( const ref of Array.from(adv.configuration?.items ?? []) ) {
    const uuid = (typeof ref === "string") ? ref : ref?.uuid;
    if ( !uuid ) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if ( !doc ) { log(`granted item did not resolve: ${uuid}`); continue; }
    const data = doc.toObject();
    data._id = foundry.utils.randomID();
    if ( data._stats ) data._stats.compendiumSource = uuid;
    foundry.utils.setProperty(data, "flags.dnd5e.advancementOrigin", `${parentItem.id}.${adv.id}`);
    if ( doc.type === "spell" && spellCfg ) {
      if ( ability ) foundry.utils.setProperty(data, "system.ability", ability);
      if ( spellCfg.method ) foundry.utils.setProperty(data, "system.method", spellCfg.method);
      if ( spellCfg.prepared != null ) foundry.utils.setProperty(data, "system.prepared", spellCfg.prepared);
    }
    const [created] = await actor.createEmbeddedDocuments("Item", [data], { keepId: true, render: false });
    added[data._id] = uuid;
    if ( created && advancementArray(created).length ) {
      await manuallyApplyItemAdvancements(actor, created, source, advChoices, depth + 1);
    }
  }

  try {
    await parentItem.update({ [`system.advancement.${adv.id}.value.added`]: added });
  } catch ( err ) {
    log(`could not record ItemGrant value on ${parentItem.name}`, err);
  }
}

/** Apply a created (granted) item's own level-≤1 advancements. */
async function manuallyApplyItemAdvancements(actor, item, source, advChoices, depth) {
  if ( depth > 3 ) return;
  for ( const adv of advancementArray(item) ) {
    const level = adv.level ?? 0;
    if ( level > 1 ) continue;
    const liveAdv = item.advancement?.byId?.[adv._id];
    if ( !liveAdv ) continue;
    try {
      if ( adv.type === "ItemGrant" ) {
        await manuallyApplyItemGrant(actor, item, liveAdv, source, advChoices, depth);
      } else if ( adv.type === "Trait" ) {
        // Granted features (e.g. Construct Resilience) carry grant-only Trait advancements;
        // merge their automatic grants with any recorded picks so the traits actually apply.
        const chosen = mergeTraitGrants(adv, recordedKeysForAdv(advChoices, source, adv._id));
        if ( chosen.length ) await liveAdv.apply(level, { chosen });
      } else if ( adv.type === "ItemChoice" ) {
        const keys = recordedKeysForAdv(advChoices, source, adv._id);
        if ( keys.length ) await applyItemChoice(actor, item, liveAdv, level, keys, source, advChoices, depth + 1);
      }
    } catch ( err ) {
      log(`manual apply failed for ${adv.type} on ${item.name}`, err);
    }
  }
}

/** Apply an ItemChoice by creating the chosen items and recording them, then cascading. */
async function applyItemChoice(actor, item, adv, level, uuids, source, advChoices, depth) {
  // Spell-type ItemChoices (Magic Initiate & variants) carry a spell configuration that stamps the
  // granted spell's casting ability, preparation, source, and limited uses. The player chose the
  // ability on the feat-spells step, stored under `"<advId>::ability"`; the rest comes from the
  // advancement itself. Reuse dnd5e's own `applySpellChanges` so the result matches the native flow.
  const spellCfg = adv.configuration?.spell;
  const spellAbility = advChoices[source]?.[`${adv.id}::ability`];

  const toCreate = [];
  const added = {};
  for ( const uuid of uuids ) {
    const doc = await fromUuid(uuid).catch(() => null);
    if ( !doc ) continue;
    const data = doc.toObject();
    data._id = foundry.utils.randomID();
    if ( data._stats ) data._stats.compendiumSource = uuid;
    foundry.utils.setProperty(data, "flags.dnd5e.advancementOrigin", `${item.id}.${adv.id}`);
    if ( doc.type === "spell" && spellCfg?.applySpellChanges ) {
      try { spellCfg.applySpellChanges(data, { ability: spellAbility }); }
      catch ( err ) { log(`applySpellChanges failed for ${uuid}`, err); }
    }
    toCreate.push(data);
    added[data._id] = uuid;
  }
  if ( !toCreate.length ) return;
  const created = await actor.createEmbeddedDocuments("Item", toCreate, { keepId: true, render: false });
  await item.update({ [`system.advancement.${adv.id}.value.added.${level}`]: added });
  for ( const child of created ) {
    if ( child && advancementArray(child).length ) {
      await manuallyApplyItemAdvancements(actor, child, source, advChoices, depth + 1);
    }
  }
}
