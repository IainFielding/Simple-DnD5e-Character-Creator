/**
 * Scenarios: one decision script per character, consumed by *both* build adapters.
 *
 * A scenario names the origins and the base ability scores, then answers every choice those
 * origins raise. Answers are keyed by **advancement id** — the id in the compendium item's
 * `system.advancement` array — because that is the one identifier both adapters see: the native
 * wizard reads it off `manager.step.flow.advancement.id`, and the creator's choice resolver
 * stamps it on every requirement as `advId`.
 *
 * Answer shapes, by advancement type:
 *   HitPoints                 "avg" | "max" | <number>   (omit for a level-1 original class)
 *   Size                      "sm" | "med" | …
 *   Trait                     ["skills:ath", "skills:ins"]   — flat, across every choice pool
 *   ItemChoice                ["<uuid>", …]  or  { uuids: [...], ability: "int" }
 *   ItemGrant (spell ability) "int"
 *   AbilityScoreImprovement   { int: 2, con: 1 }   — the *total* per ability, fixed part included
 *
 * Finding the ids: `node run.mjs <world> --ids <uuid>` prints an item's advancements with their
 * ids, titles and options, which is how these tables are written and kept in step with content
 * updates.
 *
 * Every scenario here states all of its own answers. A scenario may instead set `generate: true` and
 * have the {@link AnswerBook} invent whatever its table leaves out — that is how the subclass sweep
 * (`sweep.mjs`) covers ninety-odd characters without ninety-odd tables. These six deliberately do
 * not: each exists to exercise one mechanism, its answers are argued for below, and a generated pick
 * would quietly change what is being tested. Their difference counts are recorded in the README and
 * are only comparable run to run because the answers are fixed.
 */

/** PHB'24 compendium uuids used below, named so the scenarios stay readable. */
export const UUID = {
  fighter: "Compendium.dnd5e.classes24.Item.phbftrFighter000",
  wizard: "Compendium.dnd5e.classes24.Item.phbwzdWizard0000",
  evoker: "Compendium.dnd5e.classes24.Item.phbwzdEvoker0000",
  // A half-feat, and the data shape that makes them awkward: a single-stat increase modelled as
  // 1 point with every other ability locked, rather than as a `fixed` bonus.
  actor: "Compendium.dnd-players-handbook.feats.Item.phbftActor000000",
  // Magic Initiate (Wizard) picks, for the feat-spells scenario.
  magicInitiate: "Compendium.dnd5e.feats24.Item.phbftMagicInitia",
  fireBolt: "Compendium.dnd5e.spells24.Item.phbsplFireBolt00",
  prestidigitation: "Compendium.dnd5e.spells24.Item.phbsplPrestidigi",
  magicMissile: "Compendium.dnd5e.spells24.Item.phbsplMagicMissi",
  human: "Compendium.dnd5e.origins24.Item.phbspHuman000000",
  sage: "Compendium.dnd5e.origins24.Item.phbbgSage0000000",
  // Human "Versatile" origin-feat options.
  alert: "Compendium.dnd5e.feats24.Item.phbftAlert000000",
  savageAttacker: "Compendium.dnd5e.feats24.Item.phbftSavageAttac",
  // Fighter fighting styles.
  archery: "Compendium.dnd5e.feats24.Item.phbfstArchery000",
  defense: "Compendium.dnd5e.feats24.Item.phbfstDefense000"
};

/**
 * The Human + Sage origin answers, shared by the scenarios that pair them with different classes
 * so a class swap is the only variable between two runs.
 *
 * Sage grants Magic Initiate, whose two spell `ItemChoice`s the creator deliberately defers to its
 * feat-spells step; leaving them unanswered here is why both scenarios show the same two known
 * `value.ability` differences.
 */
const HUMAN_SAGE = {
  dLxv96vt2B2KOEe2: "med",                                   // Human size: Small or Medium
  KB8IQLwyuL6SOFnv: [UUID.alert],                            // Human Versatile: an origin feat
  "3O61L5uTy5jRCqJb": { int: 2, con: 1 },                    // Sage ability increase (str/dex/cha locked)
  pLGiyOjTP7nwuwTl: ["languages:standard:elvish",            // Sage: choose 2 languages
    "languages:standard:dwarvish"]
};

export const SCENARIOS = [
  {
    id: "human-fighter-sage",
    name: "Equivalence: Human Fighter (Sage)",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.fighter,
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    answers: {
      // — Human (species) —
      dLxv96vt2B2KOEe2: "med",                                  // Size: Small or Medium
      xIdIaWtTj1cBERln: ["skills:sur"],                          // Skillful: any one skill
      KB8IQLwyuL6SOFnv: [UUID.savageAttacker],                   // Versatile: an origin feat

      // — Sage (background) —
      "3O61L5uTy5jRCqJb": { int: 2, wis: 1 },                    // Background ability increase
      pLGiyOjTP7nwuwTl: ["languages:standard:elvish",            // Choose 2 languages
        "languages:standard:dwarvish"],

      // — Fighter (class) —
      UaSYMl2io5kbXNOY: ["skills:ath", "skills:ins"],            // Skill proficiencies (choose 2)
      mJnrjhWpEz2lMDq4: ["weapon:mar:longsword",                 // Weapon Mastery (choose 3)
        "weapon:sim:handaxe", "weapon:mar:greatsword"],
      EmTANp6x6GfXFTmU: [UUID.archery]                           // Fighting Style
    }
  },

  /**
   * The same origins with a full caster in place of the martial, so the diff isolates the class.
   * Covers what the Fighter cannot: spellcasting progression, the `max-prepared` and
   * `cantrips-known` ScaleValues, and an Intelligence-based spellcasting ability.
   *
   * No spells are chosen. Picking a Wizard's level-1 spells is not an advancement — dnd5e's native
   * flow never asks, the player just adds them to the sheet — so spell selection has no native
   * counterpart to compare against and would only show up as creator-only extra items. What *is*
   * comparable is everything the class's advancements produce, which is what this checks.
   */
  {
    id: "human-wizard-sage",
    name: "Equivalence: Human Wizard (Sage)",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.wizard,
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    answers: {
      ...HUMAN_SAGE,
      // Sage already grants Arcana and History, so Skillful and the class picks avoid them.
      xIdIaWtTj1cBERln: ["skills:ath"],                          // Human Skillful: any one skill
      "73lag0NN0ElcSq94": ["skills:ins", "skills:inv"]            // Wizard skills (choose 2)
    }
  },

  /**
   * The same Wizard carried to level 3, which is where the interesting machinery lives: gained
   * levels with a hit-point decision, the level-2 Scholar trait, and a subclass whose own features
   * are synthesised into the walk mid-flight.
   *
   * Both sides do this as a *single* 1→3 jump on one manager, not one level at a time — the native
   * side through `forLevelChange` + the rendered wizard, the creator through the same manager
   * driven by `LevelUpDriver.autoResolve`. That mirrors the creator's real post-creation hand-off
   * (`intercept.mjs#launchLevelUpTo`) with only the interactive shell replaced.
   *
   * Hit points are stated once and apply to every gained level; `{ 2: "avg", 3: "max" }` would set
   * them per level instead. Keep them off "roll" — a rolled die is not reproducible, so a scenario
   * that rolls can never be an equivalence test.
   */
  {
    id: "human-wizard-sage-l3",
    name: "Equivalence: Human Wizard (Sage) at level 3",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.wizard,
    targetLevel: 3,
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    answers: {
      ...HUMAN_SAGE,
      xIdIaWtTj1cBERln: ["skills:ath"],                          // Human Skillful
      "73lag0NN0ElcSq94": ["skills:ins", "skills:inv"],           // Wizard skills, level 1

      // — gained on the way to 3 —
      a16u6wgnJQq8HMoq: "avg",                                   // Hit points, every gained level
      S1H3INPWaAiRkB6G: ["skills:inv"],                          // Scholar, level 2
      KTYjh1MKLvOtrZ3u: UUID.evoker                              // Subclass, level 3
    }
  },

  /**
   * Level 4, where the class's ability-score improvement is answered with a **feat** rather than
   * with points — the other half of what that screen offers, and the only route to a half-feat.
   *
   * Actor is deliberately the pick: its "+1 Charisma" is modelled as one point with every other
   * ability locked rather than as a `fixed` bonus, which is the shape the driver has a dedicated
   * branch for (a single open ability is an allocation with nothing to allocate, so it applies
   * outright instead of surfacing a choice with one option). Charisma is useless to a Wizard,
   * which is precisely why it is easy to see whether the bonus landed.
   *
   * The feat's own increase is stated explicitly (`Ki2HGAzrFwLX0HNG`) even though it is forced,
   * because the two sides reach it differently and the scenario should not depend on that. The
   * creator applies a one-open-ability allocation outright — there is nothing to allocate — while
   * the native flow renders the score un-incremented with a live "+" button
   * (`ability-score-improvement-flow.mjs` sets `value: sourceValue`, `canIncrease: true`) and
   * assigns nothing until it is clicked. Left unanswered, the creator lands +1 Charisma and the
   * native lands none; the creator is the one following the rules there, and a player using the
   * system's own wizard can simply forget to click. Stating the answer makes both sides do the
   * correct thing, so the scenario tests that they *can* rather than re-reporting a known
   * divergence on every run.
   */
  {
    id: "human-wizard-sage-l4-halffeat",
    name: "Equivalence: Human Wizard (Sage) at level 4 with a half-feat",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.wizard,
    targetLevel: 4,
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    answers: {
      ...HUMAN_SAGE,
      xIdIaWtTj1cBERln: ["skills:ath"],                          // Human Skillful
      "73lag0NN0ElcSq94": ["skills:ins", "skills:inv"],           // Wizard skills, level 1
      a16u6wgnJQq8HMoq: "avg",                                   // Hit points, every gained level
      S1H3INPWaAiRkB6G: ["skills:inv"],                          // Scholar, level 2
      KTYjh1MKLvOtrZ3u: UUID.evoker,                             // Subclass, level 3
      bwCLOdauuzoHofil: { feat: UUID.actor },                    // Level-4 ASI: take a feat instead
      Ki2HGAzrFwLX0HNG: { cha: 1 }                               // Actor's own +1 Cha (see above)
    }
  },

  /**
   * The Sage's granted Magic Initiate, with its spells actually chosen — the one path the other
   * scenarios leave unexercised, and the reason they all report the same two
   * `value.ability` differences.
   *
   * The two builds reach these spells by genuinely different routes, which is the point of
   * comparing them. The native flow applies the feat's own spell `ItemChoice`s, so dnd5e's
   * `applySpellChanges` configures the granted spells and the advancement records them in
   * `value.added`. The creator defers them to its feat-spells step and `applyFeatSpells` creates
   * them straight onto the actor, hand-applying the same casting configuration
   * (`method`, `prepared`, once-per-long-rest uses, the chosen ability). That hand-application is
   * a standing drift risk against the system's own — this scenario is what would catch it.
   *
   * Expect differences here rather than a clean match: the creator's spells are not tracked by
   * the advancement. What matters is that the *spells themselves* come out configured the same.
   */
  {
    id: "human-wizard-sage-featspells",
    name: "Equivalence: Human Wizard (Sage) with Magic Initiate spells chosen",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.wizard,
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    answers: {
      ...HUMAN_SAGE,
      xIdIaWtTj1cBERln: ["skills:ath"],                          // Human Skillful
      "73lag0NN0ElcSq94": ["skills:ins", "skills:inv"],           // Wizard skills

      // The native side answers Magic Initiate's own spell choices; the creator side takes the
      // same picks from `featSpells` below.
      ElkyDafWSUXOkPdJ: { uuids: [UUID.fireBolt, UUID.prestidigitation], ability: "int" },
      ZbKHs2FVCkJVNW8p: { uuids: [UUID.magicMissile], ability: "int" }
    },
    featSpells: {
      [UUID.magicInitiate]: {
        ability: "int",
        cantrips: [UUID.fireBolt, UUID.prestidigitation],
        spells: [UUID.magicMissile]
      }
    }
  },

  /**
   * A level-1 Fighter who multiclasses into Wizard — a *second class item*, not a level change,
   * which is a different entry point (`forNewItem`) and a different set of advancements.
   *
   * Two things only this covers. A secondary class contributes its `classRestriction: "secondary"`
   * advancements instead of its primary ones (a multiclass Wizard gets no skill choice and a
   * narrower proficiency set), so this is the one scenario where that restriction is exercised at
   * all. And the new class's first level is a genuine hit-point decision — `isOriginalClass` is
   * false — where every other scenario's level 1 takes the automatic maximum, so the driver's
   * "always ask, never inherit a prior avg" behaviour is finally under test.
   */
  {
    id: "fighter-multiclass-wizard",
    name: "Equivalence: Human Fighter 1 / Wizard 1 (Sage)",
    speciesUuid: UUID.human,
    backgroundUuid: UUID.sage,
    classUuid: UUID.fighter,
    multiclass: { classUuid: UUID.wizard, levels: 1 },
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    answers: {
      ...HUMAN_SAGE,
      xIdIaWtTj1cBERln: ["skills:sur"],                          // Human Skillful
      UaSYMl2io5kbXNOY: ["skills:ath", "skills:ins"],            // Fighter skills
      mJnrjhWpEz2lMDq4: ["weapon:mar:longsword",                 // Weapon Mastery
        "weapon:sim:handaxe", "weapon:mar:greatsword"],
      EmTANp6x6GfXFTmU: [UUID.archery],                          // Fighting Style
      a16u6wgnJQq8HMoq: "avg"                                    // Wizard's first level: a real roll
    }
  }
];
