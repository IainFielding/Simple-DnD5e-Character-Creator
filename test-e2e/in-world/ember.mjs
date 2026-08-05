/**
 * Stage the advancement manager Ember's character builder hands off, without Ember's builder.
 *
 * Ember has no API. Its creation sheet lives in a ~6 MB bundle whose internals move between
 * releases, so driving that UI from a test would be re-implementing a moving target and would break
 * on every Ember update for reasons that have nothing to do with this module.
 *
 * What *is* stable, and what this reproduces, is the hand-off itself
 * (`EmberCharacterCreationSheet#createAdvancementManager`):
 *
 *   const manager = new AdvancementManager(actor, { automaticApplication: true });
 *   manager.clone.updateSource({ items });          // clone only — never the actor
 *   for ( const itemData of items ) {
 *     const item = manager.clone.items.get(itemData._id);
 *     if ( item.type === "class" ) manager.createLevelChangeSteps(item, 1);
 *     else for ( let l = 0; l < 2; l++ ) for ( const flow of flowsForLevel(item, l) ) {
 *       manager.steps.push({ type: "forward", flow });
 *     }
 *   }
 *
 * Twenty lines, mechanical, and it is the shape `isEmberCreationManager` fingerprints. Reproducing it
 * lets both adapters be pointed at a genuine Ember-shaped manager.
 *
 * **What this cannot cover**, and what still needs a person in Foundry:
 *  - Detection against a manager Ember *actually* built. This stages what we believe Ember stages;
 *    if Ember changes, this changes with our belief and agrees with itself.
 *  - Ember's completion handling — it returns `false` from `preAdvancementManagerComplete` to block
 *    the system's write and applies the diff itself. Nothing here registers that handler, so both
 *    adapters write normally. That keeps the comparison fair but does not exercise Ember's apply.
 *  - Cancel, which relies on dispatching a `close` event at the manager.
 */

/**
 * Ember's `createBackground`: one background item merged from a culture and a path.
 *
 * The advancement maps are merged and the starting equipment concatenated, with a fixed
 * `emberBackground` identifier and `flags.ember` recording the two halves — which together are what
 * the module's detection looks for. Soulbound is left out: it adds one more ItemGrant and nothing
 * structural, and no scenario here uses it.
 * @param {Item5e} culture
 * @param {Item5e} path
 * @returns {object}  Background item data.
 */
export function emberBackground(culture, path) {
  const cultureItem = culture.toObject();
  const pathItem = path.toObject();
  return {
    _id: foundry.utils.randomID(16),
    name: `${culture.name} ${path.name}`,
    type: "background",
    img: cultureItem.img,
    system: {
      advancement: { ...cultureItem.system.advancement, ...pathItem.system.advancement },
      description: { value: `<p>${culture.name} / ${path.name}</p>` },
      identifier: "emberBackground",
      source: { book: "Ember" },
      startingEquipment: [
        ...(cultureItem.system.startingEquipment ?? []),
        ...(pathItem.system.startingEquipment ?? [])
      ]
    },
    flags: { ember: { culture: culture.id, path: path.id } }
  };
}

/**
 * Build the actor and the hand-off manager for an Ember scenario.
 *
 * The actor is created with its ability scores already written, as Ember writes them before handing
 * off; everything the build grants is staged on the manager's clone alone.
 * @param {object} scenario          Carries `ember: { ancestryUuid, cultureUuid, pathUuid }`,
 *                                   `classUuid`, `abilities` and `name`.
 * @returns {Promise<{actor: Actor5e, manager: AdvancementManager}>}
 */
export async function stageEmberManager(scenario) {
  const { ancestryUuid, cultureUuid, pathUuid } = scenario.ember ?? {};
  const [ancestry, culture, path, klass] = await Promise.all(
    [ancestryUuid, cultureUuid, pathUuid, scenario.classUuid].map(u => (u ? fromUuid(u) : null))
  );
  for ( const [label, doc] of [["ancestry", ancestry], ["culture", culture], ["path", path], ["class", klass]] ) {
    if ( !doc ) throw new Error(`Ember scenario is missing its ${label}`);
  }

  const actor = await Actor.implementation.create({
    name: scenario.name,
    type: "character",
    system: { abilities: Object.fromEntries(
      Object.entries(scenario.abilities ?? {}).map(([key, value]) => [key, { value }])
    ) }
  }, { render: false });

  // Ember stages `packDoc.toObject()`, which carries no `_stats.compendiumSource` — Foundry only
  // stamps that on import. Anything resolving a staged origin by compendium source therefore gets
  // nothing, which is a real property of the hand-off and is left as-is here on purpose.
  const items = [
    { ...ancestry.toObject(), _id: foundry.utils.randomID(16) },
    emberBackground(culture, path),
    { ...klass.toObject(), _id: foundry.utils.randomID(16), system: { ...klass.toObject().system, levels: 0 } }
  ];

  const manager = new dnd5e.applications.advancement.AdvancementManager(actor, { automaticApplication: true });
  manager.clone.updateSource({ items });
  for ( const itemData of items ) {
    const item = manager.clone.items.get(itemData._id);
    if ( item.type === "class" ) manager.createLevelChangeSteps(item, 1);
    else for ( let l = 0; l < 2; l++ ) {
      for ( const flow of manager.constructor.flowsForLevel(item, l) ) {
        manager.steps.push({ type: "forward", flow });
      }
    }
  }
  return { actor, manager };
}
