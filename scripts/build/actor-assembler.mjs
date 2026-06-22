import { ABILITIES, MODULE_ID, log } from "../config.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";
import { collectEquipment } from "../data/equipment-source.mjs";
import {
  buildChoicePlan, runAdvancementManager, recordBackgroundAsiValue, applyChoicePlan
} from "./advancement-apply.mjs";

/**
 * Turns a finished {@link CreatorState} into a real character.
 *
 * Unlike the MVP — which added each origin through an interactive AdvancementManager —
 * this bakes the wizard's decisions in directly: base ability scores (with the
 * background increase layered on), the Details fields, then the origin items run through
 * a single non-interactive AdvancementManager whose wizard-resolved advancements are
 * skipped and applied by hand afterwards (see {@link module:build/advancement-apply}).
 * Finally the chosen spells are granted.
 *
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @param {import("../data/source-index.mjs").SourceIndex} source
 * @returns {Promise<Actor>} The built actor.
 */
export async function assembleActor(state, source, equipment) {
  const actor = state.actor;

  // 1. Resolve the chosen origin documents and stage their item data (each keeps its
  //    compendium id so the manager and the manual apply can address it consistently).
  const docs = {
    class: state.classUuid ? await fromUuid(state.classUuid) : null,
    background: state.backgroundUuid ? await fromUuid(state.backgroundUuid) : null,
    species: state.speciesUuid ? await fromUuid(state.speciesUuid) : null
  };

  const items = [];
  const originItemIds = { class: null, background: null, species: null };
  const detailLinks = {};
  const stage = (key, link, mutate) => {
    const doc = docs[key];
    if ( !doc ) { log(`origin item not found: ${key}`); return; }
    const data = doc.toObject();
    if ( data._stats ) data._stats.compendiumSource = doc.uuid;
    mutate?.(data);
    items.push(data);
    originItemIds[key] = data._id;
    detailLinks[link] = data._id;
  };
  // Species → background → class, matching the order the manager expects to process.
  stage("species", "system.details.race");
  stage("background", "system.details.background");
  stage("class", "system.details.originalClass", data => { data.system.levels = 0; });

  // 2. Actor-level update: identity/visuals, base scores with the background increase
  //    baked in, and the detail→item links. (The background ASI advancement step is then
  //    skipped, its value recorded after the items exist.)
  const scores = state.resolvedScores();
  const deltas = state.backgroundDeltas();
  const update = { ...detailsUpdate(state), ...detailLinks };
  for ( const key of ABILITIES ) update[`system.abilities.${key}.value`] = scores[key] + (deltas[key] ?? 0);
  await actor.update(update);

  // 3. Resolve the advancement choices once, plan what to skip, run the manager, then
  //    apply the wizard's picks to the created items.
  const resolved = state.choiceCache ?? await resolveChoices(state, source);
  const plan = buildChoicePlan(resolved, docs);

  if ( items.length ) {
    const result = await runAdvancementManager(actor, items, plan.skipAdvIds);
    if ( !result ) throw new Error("advancement flow was cancelled");
    foundry.utils.setProperty(result.updates, `flags.${MODULE_ID}.created`, true);
    await actor.update(result.updates, { render: false });
    await actor.createEmbeddedDocuments("Item", result.items, { render: false, keepId: true });

    await recordBackgroundAsiValue(actor, originItemIds.background, state.backgroundAsi, state.backgroundAbilities);
    await applyChoicePlan(actor, plan, resolved, state.advChoices, originItemIds);
  }

  // 4. Spells chosen on the Spells step, as prepared class spells.
  await addSpells(actor, state);

  // 5. Starting equipment and currency chosen on the Choices step.
  if ( equipment ) await grantEquipment(actor, state, source, equipment);

  return actor;
}

/**
 * Grant the chosen starting equipment (items, equipped by default) and add any currency
 * — both the lettered "gold" option and currency embedded in an equipment package.
 */
async function grantEquipment(actor, state, source, equipment) {
  const loaded = await equipment.load(state, source);
  if ( !loaded.class && !loaded.background ) return;

  const { items, currency } = await collectEquipment(loaded, state);
  if ( items.length ) await actor.createEmbeddedDocuments("Item", items, { keepId: true, render: false });

  const update = {};
  for ( const [denom, amount] of Object.entries(currency) ) {
    if ( amount > 0 ) update[`system.currency.${denom}`] = (actor.system?.currency?.[denom] ?? 0) + amount;
  }
  if ( Object.keys(update).length ) await actor.update(update, { render: false });
}

/* -------------------------------------------- */

/**
 * Create the player's chosen cantrips and level-1 spells on the actor as prepared
 * class spells. dnd5e 6.x marks a known class spell with `prepared:1`, `method:"spell"`,
 * and a `sourceItem` link back to the class identifier.
 */
async function addSpells(actor, state) {
  const picks = [...state.selectedCantrips, ...state.selectedSpells];
  if ( !picks.length ) return;

  let classId = "";
  if ( state.classUuid ) {
    const classDoc = await fromUuid(state.classUuid).catch(() => null);
    classId = classDoc?.system?.identifier ?? "";
  }

  const data = [];
  for ( const pick of picks ) {
    const doc = await fromUuid(pick.uuid).catch(() => null);
    if ( !doc ) { log(`selected spell not found: ${pick.uuid}`); continue; }
    const obj = doc.toObject();
    if ( obj._stats ) obj._stats.compendiumSource = pick.uuid;
    foundry.utils.setProperty(obj, "system.prepared", 1);
    foundry.utils.setProperty(obj, "system.method", "spell");
    if ( classId ) foundry.utils.setProperty(obj, "system.sourceItem", `class:${classId}`);
    data.push(obj);
  }
  if ( data.length ) await actor.createEmbeddedDocuments("Item", data, { render: false });
}

/**
 * Build the actor-update fragment carrying the Details step: name, portrait, the
 * prototype-token visuals, and the `system.details.*` identity/biography fields.
 * `ideals`/`bonds`/`flaws` map to the singular dnd5e keys; biography is rich text.
 */
function detailsUpdate(state) {
  const d = state.details;
  const name = d.name?.trim() || state.actor?.name || "";
  return {
    name,
    img: state.portrait,
    "prototypeToken.name": name,
    "prototypeToken.texture.src": state.tokenImg,
    "prototypeToken.ring.enabled": state.tokenRingEnabled,
    "prototypeToken.ring.subject.texture": state.tokenRingImg,
    "prototypeToken.lockRotation": state.tokenLockRotation,
    "system.details.alignment": d.alignment,
    "system.details.faith": d.faith,
    "system.details.gender": d.gender,
    "system.details.eyes": d.eyes,
    "system.details.hair": d.hair,
    "system.details.skin": d.skin,
    "system.details.height": d.height,
    "system.details.weight": d.weight,
    "system.details.age": d.age,
    "system.details.trait": d.trait,
    "system.details.ideal": d.ideals,
    "system.details.bond": d.bonds,
    "system.details.flaw": d.flaws,
    "system.details.appearance": d.appearance,
    "system.details.biography.value": d.biography
  };
}
