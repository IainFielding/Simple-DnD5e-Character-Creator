/**
 * Curated fixtures from the D&D 5e system, release 5.3.3 (2024 / "PHB '24" content).
 *
 * These are faithful, trimmed transcriptions of real pack source documents
 * (`H:/Code/dnd5e-release-5.3.3/packs/_source/...`). Real `_id`s, real advancement
 * `configuration` shapes, real trait keys and UUIDs are kept verbatim so the pure
 * logic under test sees exactly what the live system feeds it — only the bulky
 * `description.value` HTML and unrelated fields (equipment, source, _stats) are
 * dropped. When the dnd5e system bumps a version and reshapes an advancement, these
 * fixtures are where a regression surfaces; refresh them from the pack source above.
 *
 * Source files:
 *   fighter        classes24/fighter/fighter.yml            (_id phbftrFighter000)
 *   human          origins24/species/human.yml              (_id phbspHuman000000)
 *   sage           origins24/backgrounds/sage.yml           (_id phbbgSage0000000-ish)
 *   magicInitiate  feats24/origin-feats/magic-initiate.yml  (_id phbftMagicInitia)
 *
 * Every item is shaped like `Item#toObject()` output: advancements live under
 * `system.advancement` as an array, which is the form {@link advancementArray}
 * normalises. Helpers at the bottom build a `fromUuid` registry and a resolver
 * `source` stub from these so tests can wire the compendium reads the real code makes.
 */

/* -------------------------------------------- */
/*  Real compendium UUIDs referenced below      */
/* -------------------------------------------- */

export const UUID = {
  fighter: "Compendium.dnd5e.classes24.Item.phbftrFighter000",
  human: "Compendium.dnd5e.origins24.Item.phbspHuman000000",
  sage: "Compendium.dnd5e.origins24.Item.phbbgSage0000000",
  magicInitiate: "Compendium.dnd5e.feats24.Item.phbftMagicInitia",
  // Human trait features granted at level 0.
  resourceful: "Compendium.dnd5e.origins24.Item.phbsptResourcefu",
  skillful: "Compendium.dnd5e.origins24.Item.phbsptSkillful00",
  versatile: "Compendium.dnd5e.origins24.Item.phbsptVersatile0",
  // Fighter class features granted at level 1.
  fightingStyleFeat: "Compendium.dnd5e.classes24.Item.phbftrFightingSt",
  secondWind: "Compendium.dnd5e.classes24.Item.phbftrSecondWind",
  weaponMastery: "Compendium.dnd5e.classes24.Item.phbftrWeaponMast",
  // Fighting-style options (feat subtype fightingStyle).
  archery: "Compendium.dnd5e.feats24.Item.phbfstArchery000",
  defense: "Compendium.dnd5e.feats24.Item.phbfstDefense000",
  greatWeapon: "Compendium.dnd5e.feats24.Item.phbfstGreatWeapo",
  twoWeapon: "Compendium.dnd5e.feats24.Item.phbfstTwoWeaponF",
  // Human "Versatile" origin-feat options.
  alert: "Compendium.dnd5e.feats24.Item.phbftAlert000000",
  savageAttacker: "Compendium.dnd5e.feats24.Item.phbftSavageAttac",
  skilled: "Compendium.dnd5e.feats24.Item.phbftSkilled0000"
};

/* -------------------------------------------- */
/*  Fighter (class) — classes24/fighter          */
/* -------------------------------------------- */

/** Fighter, level-1 advancements only (higher-level entries trimmed as irrelevant here). */
export const fighter = {
  _id: "phbftrFighter000",
  name: "Fighter",
  type: "class",
  img: "systems/dnd5e/icons/classes/fighter.webp",
  system: {
    identifier: "fighter",
    spellcasting: { progression: "none", ability: "" },
    advancement: [
      { _id: "zvm19nuuM9qRHGrR", type: "HitPoints", configuration: {}, value: {} },
      {
        _id: "15eBHWfn4f7qB8mA", type: "ItemGrant", level: 1, title: "Class Features",
        configuration: {
          items: [
            { uuid: UUID.fightingStyleFeat, optional: false },
            { uuid: UUID.secondWind, optional: false },
            { uuid: UUID.weaponMastery, optional: false }
          ],
          optional: false, spell: null
        },
        value: {}
      },
      {
        _id: "B05A1ijLPQMNlb3m", type: "Trait", level: 1, title: "Saving Throw Proficiencies",
        classRestriction: "primary",
        configuration: { mode: "default", allowReplacements: false, grants: ["saves:str", "saves:con"], choices: [] },
        value: { chosen: [] }
      },
      {
        _id: "UaSYMl2io5kbXNOY", type: "Trait", level: 1, title: "Skill Proficiencies",
        classRestriction: "primary",
        configuration: {
          mode: "default", allowReplacements: false, grants: [],
          choices: [{
            count: 2,
            pool: ["skills:acr", "skills:ani", "skills:ath", "skills:his", "skills:ins",
              "skills:itm", "skills:prc", "skills:per", "skills:sur"]
          }]
        },
        value: { chosen: [] }
      },
      {
        _id: "TsqDRDOepHDmgYjZ", type: "Trait", level: 1, title: "Weapon Proficiencies",
        classRestriction: "primary",
        configuration: { mode: "default", allowReplacements: false, grants: ["weapon:sim", "weapon:mar"], choices: [] },
        value: { chosen: [] }
      },
      {
        _id: "XNba1RiASLSxoS8e", type: "Trait", level: 1, title: "Armor Training",
        classRestriction: "primary",
        configuration: {
          mode: "default", allowReplacements: false,
          grants: ["armor:lgt", "armor:med", "armor:hvy", "armor:shl"], choices: []
        },
        value: { chosen: [] }
      },
      {
        // classRestriction: secondary — a multiclass-only grant the resolver must ignore.
        _id: "fK62ORkG9cOsa3XL", type: "Trait", level: 1, title: "Weapon Proficiencies",
        classRestriction: "secondary",
        configuration: { mode: "default", allowReplacements: false, grants: ["weapon:mar"], choices: [] },
        value: { chosen: [] }
      },
      {
        _id: "mJnrjhWpEz2lMDq4", type: "Trait", level: 1, title: "Weapon Mastery",
        configuration: {
          mode: "mastery", allowReplacements: false, grants: [],
          choices: [{ count: 3, pool: ["weapon:sim:*", "weapon:mar:*"] }]
        },
        value: { chosen: [] }
      },
      {
        _id: "EmTANp6x6GfXFTmU", type: "ItemChoice", title: "Fighting Style",
        configuration: {
          choices: { 1: { count: 1, replacement: true } },
          allowDrops: true, type: "feat",
          pool: [
            { uuid: UUID.archery }, { uuid: UUID.defense },
            { uuid: UUID.greatWeapon }, { uuid: UUID.twoWeapon }
          ],
          spell: null,
          restriction: { type: "feat", subtype: "fightingStyle", list: [] }
        },
        value: { added: {}, replaced: {} }
      }
    ]
  }
};

/* -------------------------------------------- */
/*  Human (species) — origins24/species          */
/* -------------------------------------------- */

/** Human: a Size choice (sm/med), granted trait features, a wildcard skill pick, an origin-feat choice. */
export const human = {
  _id: "phbspHuman000000",
  name: "Human",
  type: "race",
  img: "icons/environment/people/commoner.webp",
  system: {
    identifier: "human",
    type: { value: "humanoid", subtype: "Human" },
    movement: { walk: 30 },
    advancement: [
      {
        _id: "dLxv96vt2B2KOEe2", type: "Size", level: 0,
        configuration: { sizes: ["sm", "med"] },
        value: {}
      },
      {
        _id: "2H3yQa0PfjBgXw2W", type: "ItemGrant", level: 0, title: "Human Traits",
        configuration: {
          items: [
            { uuid: UUID.resourceful, optional: false },
            { uuid: UUID.skillful, optional: false },
            { uuid: UUID.versatile, optional: false }
          ],
          optional: false, spell: null
        },
        value: {}
      },
      {
        _id: "xIdIaWtTj1cBERln", type: "Trait", level: 0, title: "Skillful",
        configuration: {
          mode: "default", allowReplacements: false, grants: [],
          choices: [{ count: 1, pool: ["skills:*"] }]
        },
        value: { chosen: [] }
      },
      {
        _id: "KB8IQLwyuL6SOFnv", type: "ItemChoice", level: 0, title: "Versatile",
        configuration: {
          choices: { 0: { count: 1, replacement: false } },
          allowDrops: true, type: "feat",
          pool: [
            { uuid: UUID.alert }, { uuid: UUID.magicInitiate },
            { uuid: UUID.savageAttacker }, { uuid: UUID.skilled }
          ],
          spell: null,
          restriction: { type: "feat", subtype: "origin" }
        },
        value: { added: {}, replaced: {} }
      }
    ]
  }
};

/* -------------------------------------------- */
/*  Sage (background) — origins24/backgrounds     */
/* -------------------------------------------- */

/** Sage: a locked-ability ASI, fixed skill/tool grants, a granted Magic Initiate feat, a language pick. */
export const sage = {
  _id: "phbbgSage0000000",
  name: "Sage",
  type: "background",
  system: {
    identifier: "sage",
    advancement: [
      {
        _id: "3O61L5uTy5jRCqJb", type: "AbilityScoreImprovement", level: 0,
        title: "Background Ability Score Improvement",
        configuration: {
          cap: 2, points: 3,
          fixed: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
          locked: ["str", "dex", "cha"]
        },
        value: {}
      },
      {
        _id: "DMd8rikwPlZdpP1l", type: "Trait", level: 0, title: "Background Proficiencies",
        configuration: {
          mode: "default", allowReplacements: false,
          grants: ["tool:art:calligrapher", "skills:arc", "skills:his"], choices: []
        },
        value: { chosen: [] }
      },
      {
        _id: "kKt7VMmZUuRr35dP", type: "ItemGrant", level: 0, title: "Background Feat",
        configuration: {
          items: [{ uuid: UUID.magicInitiate, optional: false }],
          optional: false, spell: null
        },
        value: {}
      },
      {
        _id: "pLGiyOjTP7nwuwTl", type: "Trait", level: 0, title: "Choose Languages",
        configuration: {
          mode: "default", allowReplacements: false,
          grants: ["languages:standard:common"],
          choices: [{ count: 2, pool: ["languages:standard:*"] }]
        },
        value: { chosen: [] }
      }
    ]
  }
};

/* -------------------------------------------- */
/*  Magic Initiate (feat) — feats24/origin-feats  */
/* -------------------------------------------- */

/**
 * Magic Initiate: the granted feature the Sage's ItemGrant hands out. Its two spell-type
 * ItemChoices are why the wizard "takes over" the grant — the AdvancementManager would
 * otherwise prompt for these cantrip/spell picks. `spell.ability` is the pick surfaced on
 * the feat-spells step.
 */
export const magicInitiate = {
  _id: "phbftMagicInitia",
  name: "Magic Initiate",
  type: "feat",
  img: "icons/magic/symbols/chevron-elipse-circle-blue.webp",
  system: {
    identifier: "magic-initiate",
    type: { value: "feat", subtype: "origin" },
    prerequisites: { level: null, repeatable: true },
    advancement: [
      {
        _id: "ElkyDafWSUXOkPdJ", type: "ItemChoice", title: "Two Cantrips",
        configuration: {
          allowDrops: true,
          choices: { 0: { count: 2, replacement: false } },
          pool: [],
          restriction: { list: ["class:cleric", "class:druid", "class:wizard"], level: "0" },
          spell: { ability: ["int", "wis", "cha"], method: "", prepared: 0,
            uses: { max: "", per: "", requireSlot: false } },
          type: "spell"
        },
        value: { added: {}, replaced: {} }
      },
      {
        _id: "ZbKHs2FVCkJVNW8p", type: "ItemChoice", title: "Level 1 Spell",
        configuration: {
          allowDrops: true,
          choices: { 0: { count: 1, replacement: false } },
          pool: [],
          restriction: { list: ["class:cleric", "class:druid", "class:wizard"], level: "1" },
          spell: { ability: ["int", "wis", "cha"], method: "spell", prepared: 2,
            uses: { max: "1", per: "lr", requireSlot: false } },
          type: "spell"
        },
        value: { added: {}, replaced: {} }
      }
    ]
  }
};

/* -------------------------------------------- */
/*  Wiring helpers                               */
/* -------------------------------------------- */

/** Every fixture item keyed by its real compendium UUID, for a `fromUuid` stub. */
export const itemsByUuid = {
  [UUID.fighter]: fighter,
  [UUID.human]: human,
  [UUID.sage]: sage,
  [UUID.magicInitiate]: magicInitiate
};

/**
 * A `fromUuid`-style resolver over the fixtures. Returned "documents" carry a `toObject()`
 * (a deep clone, as the real one does) so code that mutates the result can't corrupt the
 * shared fixture. Unknown UUIDs resolve to null, matching the real API's miss behaviour.
 */
export function makeFromUuid(extra = {}) {
  const registry = { ...itemsByUuid, ...extra };
  return async uuid => {
    const doc = registry[uuid];
    if ( !doc ) return null;
    return { ...doc, toObject: () => structuredClone(doc) };
  };
}
