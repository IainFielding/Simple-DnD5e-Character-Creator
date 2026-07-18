import { t } from "../config.mjs";

/**
 * The rules-as-written multiclass ability prerequisite (PHB: a score of 13 or higher in the
 * primary ability of both your current class(es) and the new one). dnd5e records each class's
 * primary ability on its item (`system.primaryAbility`: a set of ability keys plus an `all`
 * flag — "all of these" vs "any one of these") but never enforces it; these helpers do, for
 * the wizard's `"prereq"` multiclass mode.
 *
 * Pure of settings and UI: callers decide *when* the rule applies (see `multiclassMode()` in
 * config.mjs); {@link formatBlockers} is the one i18n-aware piece, turning failures into the
 * message a toast or tooltip shows.
 */

/** The score every prerequisite ability must reach, per the written rule. */
export const MULTICLASS_PREREQ_SCORE = 13;

/**
 * A class's primary-ability requirement, normalised. Works on a live Item5e and on plain item
 * data (a compendium document's `toObject()`), where the prepared Set is a raw array.
 * @param {object} classLike   A class item or its data: `{ name, system: { primaryAbility } }`.
 * @returns {{ abilities: string[], all: boolean }}   Empty `abilities` = no requirement.
 */
function requirementOf(classLike) {
  const pa = classLike?.system?.primaryAbility ?? {};
  return { abilities: Array.from(pa.value ?? []), all: pa.all !== false };
}

/**
 * Every way the actor fails the multiclass prerequisites for taking `newClass`: one entry per
 * class (existing or new) whose primary-ability requirement isn't met. A class with no
 * primary-ability data (homebrew) imposes no requirement. An empty array means the multiclass
 * is allowed.
 * @param {Actor5e} actor        The character multiclassing (its current ability scores are read).
 * @param {object} [newClass]    The class being added — an Item5e or plain item data.
 * @returns {{ className: string, abilities: string[], all: boolean }[]}
 *   `abilities` lists what's missing: with `all`, only the failing keys; without (an "any one
 *   of" requirement), every alternative — none of them is met.
 */
export function multiclassBlockers(actor, newClass) {
  const classes = actor?.items?.filter?.(i => i.type === "class") ?? [];
  if ( newClass ) classes.push(newClass);

  const blockers = [];
  for ( const cls of classes ) {
    const { abilities, all } = requirementOf(cls);
    if ( !abilities.length ) continue;
    const met = abilities.filter(key => (actor?.system?.abilities?.[key]?.value ?? 0) >= MULTICLASS_PREREQ_SCORE);
    const ok = all ? (met.length === abilities.length) : (met.length > 0);
    if ( !ok ) blockers.push({
      className: cls.name ?? "",
      abilities: all ? abilities.filter(key => !met.includes(key)) : abilities,
      all
    });
  }
  return blockers;
}

/**
 * Whether the actor meets the multiclass prerequisites for taking `newClass`.
 * @param {Actor5e} actor
 * @param {object} newClass   An Item5e or plain item data.
 * @returns {boolean}
 */
export function meetsMulticlassPrereqs(actor, newClass) {
  return multiclassBlockers(actor, newClass).length === 0;
}

/**
 * One human-readable sentence for a set of blockers — "Barbarian requires Strength 13;
 * Fighter requires Strength 13 or Dexterity 13" — for the picker's tooltip and the
 * drag-drop fallback toast.
 * @param {ReturnType<typeof multiclassBlockers>} blockers
 * @returns {string}
 */
export function formatBlockers(blockers) {
  const reasons = blockers.map(b => {
    const scores = b.abilities.map(key => t("levelup.multiclass.score", {
      ability: CONFIG.DND5E?.abilities?.[key]?.label ?? key,
      score: MULTICLASS_PREREQ_SCORE
    }));
    // "all of these" reads as a conjunction (Strength 13 and Wisdom 13); "any one" as
    // a disjunction (Strength 13 or Dexterity 13) — none of the alternatives is met.
    const list = game.i18n.getListFormatter({ type: b.all ? "conjunction" : "disjunction" }).format(scores);
    return t("levelup.multiclass.requires", { class: b.className, abilities: list });
  });
  return reasons.join("; ");
}
