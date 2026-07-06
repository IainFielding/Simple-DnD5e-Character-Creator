/**
 * Per-class "Quick Build" suggestion tables, adapted from the 2014 PHB's quick-build
 * sidebars (the 2024 rules dropped them, and no machine-readable equivalent exists in
 * dnd5e or its packs — verified against dnd5e 5.3.3 source). Pure data, no Foundry
 * imports, so the tables are unit-testable and safe to import from any layer.
 *
 * How the engine (quick-build.mjs) reads a profile: every list is an ORDERED PREFERENCE,
 * deliberately longer than the pick count where useful. The engine takes the first N
 * entries that are actually available (present in the requirement's options, not
 * disabled, not already granted by another origin) and backfills any remaining slots
 * deterministically from the top of the option list. So a profile never has to know how
 * many picks a class really grants, whether a suggested background is installed, or
 * which of its skills the chosen background already grants — mismatches degrade to
 * sensible defaults instead of failing.
 *
 * Only identifiers and names are hardcoded here. Ability-increase sets, choice pools,
 * and spell counts are all read from the live documents at runtime, so worlds with more
 * content modules enabled automatically get more coverage (and classes missing from this
 * table fall back to a generic profile built from `system.primaryAbility`).
 */

/**
 * @typedef {object} QuickBuildProfile
 * @property {string[]} abilities   All six ability keys, highest priority first. The standard
 *   array [15, 14, 13, 12, 10, 8] is assigned in this order, and the background's ability-score
 *   increase is allocated in this order too.
 * @property {string[]} backgrounds Background identifiers, preferred first (2014 suggestions
 *   mapped to 2024 backgrounds whose increase abilities align with the class priorities). When
 *   none is installed, the engine scores every available background by that alignment instead.
 * @property {string[]} skills      dnd5e skill codes in preference order, matched against
 *   `skills:<code>` option keys.
 * @property {string[]} [expertise] Skill codes for Expertise picks (default: the `skills` order).
 * @property {string[]} [masteries] Weapon base-item ids for Weapon Mastery / weapon-proficiency
 *   picks, matched against the last `:` segment of option keys like `weapon:mar:greataxe`.
 * @property {string[]} [tools]     Tool base-item ids for tool-proficiency picks, suffix-matched
 *   the same way (e.g. `lute` ↔ `tool:music:lute`).
 * @property {string[]} [features]  Feature/feat NAMES for ItemChoice picks (fighting styles,
 *   invocations…), matched case-insensitively; falls back to {@link FEATURE_PREFERENCES}.
 * @property {string[]} [cantrips]  Spell NAMES (case-insensitive) for the class cantrip picks.
 * @property {string[]} [spells]    Spell NAMES for the class level-1 spell picks.
 * @property {string} [miList]      Preferred spell list when a granted Magic Initiate-style feat
 *   offers a choice of lists ("cleric" | "druid" | "wizard").
 */

/** @type {Record<string, QuickBuildProfile>} */
export const QUICK_BUILD = {
  artificer: {
    abilities: ["int", "con", "dex", "wis", "cha", "str"],
    backgrounds: ["artisan", "sage"],
    skills: ["arc", "inv", "prc", "his", "med", "nat", "slt"],
    tools: ["alchemist"],
    cantrips: ["Fire Bolt", "Guidance", "Mending"],
    spells: ["Cure Wounds", "Grease", "Faerie Fire", "Detect Magic"]
  },
  barbarian: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    backgrounds: ["soldier", "farmer"],
    skills: ["ath", "prc", "sur", "itm", "ani", "nat"],
    masteries: ["greataxe", "handaxe"]
  },
  bard: {
    abilities: ["cha", "dex", "con", "wis", "int", "str"],
    backgrounds: ["entertainer", "charlatan"],
    skills: ["per", "dec", "prf", "ins", "acr"],
    tools: ["lute", "flute", "drum"],
    cantrips: ["Vicious Mockery", "Dancing Lights", "Prestidigitation"],
    spells: ["Charm Person", "Healing Word", "Thunderwave", "Detect Magic", "Dissonant Whispers", "Faerie Fire"]
  },
  cleric: {
    abilities: ["wis", "con", "str", "cha", "dex", "int"],
    backgrounds: ["acolyte"],
    skills: ["rel", "ins", "med", "per", "his"],
    cantrips: ["Sacred Flame", "Guidance", "Thaumaturgy", "Light"],
    spells: ["Cure Wounds", "Guiding Bolt", "Bless", "Shield of Faith", "Healing Word"],
    miList: "cleric"
  },
  druid: {
    abilities: ["wis", "con", "dex", "int", "cha", "str"],
    backgrounds: ["hermit", "guide"],
    skills: ["prc", "nat", "sur", "ins", "med", "ani"],
    cantrips: ["Produce Flame", "Druidcraft", "Guidance", "Shillelagh"],
    spells: ["Entangle", "Cure Wounds", "Faerie Fire", "Thunderwave", "Animal Friendship"],
    miList: "druid"
  },
  fighter: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    backgrounds: ["soldier"],
    skills: ["ath", "prc", "itm", "ins", "acr", "sur"],
    masteries: ["greatsword", "javelin", "longbow", "longsword"],
    features: ["Defense"]
  },
  monk: {
    abilities: ["dex", "wis", "con", "str", "cha", "int"],
    backgrounds: ["sailor", "criminal", "guard"],
    skills: ["acr", "ste", "ins", "ath", "his", "rel"],
    masteries: ["spear", "dagger", "shortsword"],
    tools: ["calligrapher", "painter", "lute"]
  },
  paladin: {
    abilities: ["str", "cha", "con", "wis", "dex", "int"],
    backgrounds: ["noble", "soldier"],
    skills: ["ath", "per", "itm", "ins", "med", "rel"],
    masteries: ["longsword", "javelin", "greatsword"],
    spells: ["Cure Wounds", "Bless", "Shield of Faith", "Heroism"]
  },
  ranger: {
    abilities: ["dex", "wis", "con", "str", "int", "cha"],
    backgrounds: ["guide", "criminal", "sailor"],
    skills: ["prc", "ste", "sur", "nat", "ani", "ath"],
    masteries: ["longbow", "shortsword"],
    spells: ["Hunter's Mark", "Cure Wounds", "Ensnaring Strike", "Goodberry"],
    miList: "druid"
  },
  rogue: {
    abilities: ["dex", "int", "con", "cha", "wis", "str"],
    backgrounds: ["criminal"],
    skills: ["ste", "slt", "prc", "dec", "acr", "inv", "per", "itm", "ath", "ins"],
    expertise: ["ste", "slt"],
    masteries: ["shortsword", "dagger", "shortbow"]
  },
  sorcerer: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    backgrounds: ["hermit", "charlatan"],
    skills: ["arc", "dec", "per", "ins", "itm", "rel"],
    cantrips: ["Light", "Prestidigitation", "Ray of Frost", "Shocking Grasp", "Fire Bolt", "Mage Hand"],
    spells: ["Magic Missile", "Shield", "Burning Hands"]
  },
  warlock: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    backgrounds: ["charlatan", "criminal"],
    skills: ["dec", "arc", "itm", "inv", "his", "rel"],
    features: ["Pact of the Tome"],
    cantrips: ["Eldritch Blast", "Minor Illusion", "Chill Touch", "Mage Hand"],
    spells: ["Hex", "Charm Person", "Witch Bolt", "Comprehend Languages"]
  },
  wizard: {
    abilities: ["int", "con", "dex", "wis", "cha", "str"],
    backgrounds: ["sage"],
    skills: ["arc", "inv", "ins", "his", "med", "rel"],
    cantrips: ["Fire Bolt", "Light", "Mage Hand", "Ray of Frost", "Prestidigitation"],
    spells: ["Magic Missile", "Mage Armor", "Shield", "Sleep", "Detect Magic", "Feather Fall", "Burning Hands"],
    miList: "wizard"
  }
};

/**
 * Spell-name preferences for a Magic Initiate-style feat, per spell list. Used when an origin
 * (e.g. the 2024 Acolyte, Guide, or Sage) grants such a feat and the engine must fill its
 * cantrip/spell buckets; anything unavailable backfills from the top of the list's pool.
 */
export const MI_SPELL_SUGGESTIONS = {
  cleric: { cantrips: ["Guidance", "Sacred Flame", "Thaumaturgy"], spells: ["Bless", "Cure Wounds"] },
  druid: { cantrips: ["Guidance", "Druidcraft", "Thorn Whip"], spells: ["Goodberry", "Cure Wounds"] },
  wizard: { cantrips: ["Mage Hand", "Minor Illusion", "Prestidigitation"], spells: ["Detect Magic", "Find Familiar"] }
};

/**
 * Fallback label preferences for ItemChoice picks (an origin's "choose a feat/feature" —
 * e.g. the Human's Versatile origin feat) when the class profile names no `features` of
 * its own. Broadly useful, always-on picks a brand-new player won't have to re-plan around.
 */
export const FEATURE_PREFERENCES = ["Skilled", "Alert", "Tough", "Lucky"];
