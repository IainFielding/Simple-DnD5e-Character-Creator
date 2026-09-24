import { ABILITIES, t, log } from "../config.mjs";
import { resolveArtFor, creditFor } from "../data/art-cache.mjs";
import { QUICK_BUILD } from "../data/quick-build-data.mjs";
import { classGuide } from "../data/class-guide.mjs";
import { allocateOriginAsi, applyQuickBuild } from "../data/quick-build.mjs";
import { QUICK_LEVELS } from "../data/quick-climb.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";
import { generateName } from "../data/name-generator.mjs";

/**
 * The quick-build screen — "the threshold". Three art cards (class, species, background), a name,
 * and one button.
 *
 * It decides nothing the module could not already decide. `applyQuickBuild()` has filled a whole
 * character from a class since long before this screen existed; what was missing was a front door
 * that looks like one decision instead of a wizard, and a place to find Quick Build *before*
 * picking a class rather than in the class detail header afterwards.
 *
 * ## The ability scores are the standard array, and there is no method picker
 *
 * Deliberate, and it is the question this screen gets asked most. A four-way choice between point
 * buy, standard array, roll and manual would be a fourth decision on a screen whose whole promise is
 * three — and two of those methods cannot be filled for the player at all. Roll needs their dice;
 * manual needs their keyboard. Both would have to disable the Create button until the player acted,
 * which is precisely the one click this screen exists to offer.
 *
 * It is also already the behaviour: `applyQuickBuild()` calls `assignStandardArray()`. So the quick
 * path needs no new engine option, and today's Quick Build button is untouched. A table that plays
 * point buy switches method on the Abilities step — one click from Review, keeping every other pick.
 * The one thing that changes is that the method is **named on screen** rather than applied silently.
 *
 * ## The origin increase is shown, not folded in
 *
 * The array is the character's own scores; the +2/+1 belongs to an origin and is drawn as such — a
 * badge on the plate and the pre-increase score beneath it. Which origin carries it is the
 * edition's call and not ours (2024 the background, 2014 the species, never both), so the line
 * under the plates names whichever one paid. The arithmetic is `allocateOriginAsi()`, unchanged and
 * already covered by `test/origin-abilities.test.mjs`.
 */

/** The standard array, in the order a class's priorities consume it. */
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/** The three categories, in the order they are drawn. */
export const THRESHOLD_CATEGORIES = ["class", "species", "background"];

/**
 * The steps Quick Build answers on the player's behalf.
 *
 * Used by the dossier to say "Quick Build will pick" against them rather than an em-dash, which on
 * this screen would read as "you still have four things to do" — the precise opposite of the
 * promise the screen is making.
 *
 * Kept here rather than as a flag on each step: whether a step is auto-filled is a fact about
 * `applyQuickBuild`, not about the step, and a step should not have to know this screen exists.
 * Derived from what that function actually writes — it seeds the choices, the class spells, the
 * feat spells and the default equipment option, and marks the store visited with an empty cart. It
 * deliberately does *not* touch the magic shop, whose picks stay the player's, so that one is
 * absent here too.
 */
export const QUICK_FILLED_STEPS = new Set(["choices", "spells", "featSpells", "equipment", "store"]);

/** Ability modifier as a signed string. */
const mod = v => { const m = Math.floor((v - 10) / 2); return (m >= 0 ? "+" : "") + m; };

/**
 * The cards on offer for one category, scoped to the chosen class's rules edition so a 2014 class
 * is never handed a 2024 species — the same scoping the pick grids apply.
 * @param {object} source
 * @param {string} category
 * @param {string|null} rules
 * @returns {object[]}
 */
function cardsFor(source, category, rules) {
  if ( category === "class" ) {
    // Classes are not scoped by `source.classes()` — the class is normally the choice that *sets*
    // the edition. Here the toggle sets it instead, so the same rule is applied by hand. Content
    // that declares no edition stays on offer, exactly as `matchesRules` treats it elsewhere.
    return source.classes().filter(c => !rules || !c.rules || String(c.rules) === String(rules));
  }
  if ( category === "species" ) return source.species({ rules });
  return source.backgrounds({ rules });
}

/**
 * Whether both editions are actually represented in this world's content.
 *
 * The toggle is offered only where it would do something — a world holding one edition's books gets
 * no control rather than a switch whose other position empties the screen. Same rule the class
 * step's edition filter already follows.
 * @param {object} source
 * @returns {boolean}
 */
export function hasBothEditions(source) {
  const editions = new Set();
  for ( const card of source.classes() ) {
    if ( card.rules ) editions.add(String(card.rules));
  }
  return editions.has("2014") && editions.has("2024");
}

/**
 * The ability block: the standard array down the class's priorities, plus whatever the chosen
 * origins add on top.
 *
 * Returns nulls rather than throwing when a class has no profile and no primary ability to derive
 * one from — the screen still renders, it simply shows no numbers until a class is chosen.
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @param {object} source
 * @returns {{plates: object[], priorities: string[]}|null}
 */
export function abilityPreview(state, source) {
  const identifier = source.card(state.classUuid)?.identifier ?? "";
  const profile = QUICK_BUILD[identifier];
  const priorities = profile?.abilities ?? [...ABILITIES];

  const base = {};
  priorities.forEach((key, i) => { if ( ABILITIES.includes(key) ) base[key] = STANDARD_ARRAY[i] ?? 8; });
  for ( const key of ABILITIES ) base[key] ??= 8;

  // Ask the engine, not a copy of it: same function, same cap-counts-fixed rule, same result the
  // character will actually be built with.
  const bonus = Object.fromEntries(ABILITIES.map(k => [k, 0]));
  for ( const origin of ["background", "species"] ) {
    const asi = state.originAsi?.[origin];
    if ( !asi ) continue;
    const scratch = {
      originAsi: { [origin]: asi },
      originAbilities: { [origin]: {} }
    };
    allocateOriginAsi(scratch, origin, priorities);
    for ( const key of ABILITIES ) {
      bonus[key] += Number(asi.fixed?.[key] ?? 0) + Number(scratch.originAbilities[origin][key] ?? 0);
    }
  }

  const plates = ABILITIES.map((key, i) => ({
    key,
    label: CONFIG.DND5E?.abilities?.[key]?.abbreviation?.toUpperCase() ?? key.toUpperCase(),
    base: base[key],
    bonus: bonus[key],
    total: base[key] + bonus[key],
    mod: mod(base[key] + bonus[key]),
    top: priorities.indexOf(key) >= 0 && priorities.indexOf(key) < 2,
    order: i
  }));
  return { plates, priorities };
}

/**
 * One line saying where the increase came from and how it was spent — the answer to "why is my
 * Strength 17". Null when no chosen origin grants one, in which case nothing is drawn.
 * @param {import("../state/creator-state.mjs").CreatorState} state
 * @param {object} source
 * @param {string[]} priorities
 * @returns {string|null}
 */
export function asiLine(state, source, priorities) {
  for ( const origin of ["background", "species"] ) {
    const asi = state.originAsi?.[origin];
    if ( !asi ) continue;
    const uuid = origin === "background" ? state.backgroundUuid : state.speciesUuid;
    const name = source.card(uuid)?.name ?? "";
    if ( !name ) continue;

    const fixed = Object.entries(asi.fixed ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ");

    const scratch = { originAsi: { [origin]: asi }, originAbilities: { [origin]: {} } };
    allocateOriginAsi(scratch, origin, priorities);
    const spent = priorities
      .filter(k => scratch.originAbilities[origin][k])
      .map(k => `+${scratch.originAbilities[origin][k]} ${k.toUpperCase()}`).join(", ");

    const className = source.card(state.classUuid)?.name ?? "";
    const args = { origin: name, fixed, spent, class: className, points: asi.points, cap: asi.cap };
    if ( fixed && spent ) return t("quickBuild.threshold.asiBoth", args);
    if ( fixed ) return t("quickBuild.threshold.asiFixed", args);
    if ( spent ) return t("quickBuild.threshold.asiSpent", args);
  }
  return null;
}

/** Which `CreatorState` field each category writes, and which origin (if any) carries its ASI. */
const FIELDS = {
  class: { field: "classUuid", asi: null },
  species: { field: "speciesUuid", asi: "species" },
  background: { field: "backgroundUuid", asi: "background" }
};

/**
 * Select one option for a category, exactly as the corresponding wizard step would.
 *
 * This deliberately mirrors `origin-step.mjs`'s `pick-origin` handler line for line rather than
 * calling it: that handler is bound to a step's own `state[field]` and to a re-render this screen
 * must not trigger. What it must NOT do is diverge — clearing the dependent choices and resolving
 * the new origin's ability increase are what make the selection real, and a copy that forgets
 * either leaves a character carrying the previous pick's advancement answers.
 * @param {object} ctx
 * @param {"class"|"species"|"background"} category
 * @param {string} uuid
 */
export async function thresholdSelect({ state, source }, category, uuid) {
  const spec = FIELDS[category];
  if ( !spec || !uuid ) return;
  state[spec.field] = uuid;
  // Clears the previous pick's advancement answers and any increase it granted.
  state.resetSourceChoices(category);
  if ( category === "class" ) state.resetClassDependent();
  if ( spec.asi ) state.originAsi[spec.asi] = await source.abilityScoreIncrease(uuid);
  state.choiceCache = await resolveChoices(state, source);
}

/**
 * Clear one category's selection, exactly as re-clicking the chosen card on its own step would.
 *
 * Used when the player leaves the quick screen to browse a category in full. Landing on that step
 * with the seeded pick already selected makes "Browse all 13" look like it did nothing — the grid
 * opens with one card lit and the detail pane filled, which reads as "here is your class" rather
 * than "here are the classes". Clearing first is what makes the step an open question again.
 * @param {object} ctx
 * @param {"class"|"species"|"background"} category
 */
export async function thresholdClear({ state, source }, category) {
  const spec = FIELDS[category];
  if ( !spec ) return;
  state[spec.field] = null;
  // Also clears whatever ability increase that origin granted.
  state.resetSourceChoices(category);
  if ( category === "class" ) state.resetClassDependent();
  state.choiceCache = await resolveChoices(state, source);
}

/**
 * Roll one category at random, never landing on what is already showing.
 *
 * Excluding the current pick is the whole point of a re-roll button: a die that returns the same
 * face a twelfth of the time reads as broken rather than as random. With only one option installed
 * there is nothing to change to, and the roll is a no-op.
 * @param {object} ctx
 * @param {"class"|"species"|"background"} category
 * @param {object} [options]
 * @param {() => number} [options.rng]
 * @param {boolean} [options.rerollName]  Re-roll the name alongside a new species. The caller owns
 *   this decision because only it knows whether the player has typed a name of their own, and
 *   overwriting one they wrote is the rudest thing this screen could do.
 */
export async function thresholdRoll(ctx, category, { rng = Math.random, rerollName = false, rules = null } = {}) {
  const { state, source } = ctx;
  const current = state[FIELDS[category]?.field ?? ""];
  const pool = cardsFor(source, category, rules).filter(c => c.uuid !== current);
  if ( !pool.length ) return;
  await thresholdSelect(ctx, category, pool[Math.floor(rng() * pool.length)].uuid);
  if ( category === "species" && rerollName ) thresholdRollName(ctx);
}

/**
 * Roll all three cards and the name at once — a whole character, at random.
 *
 * Not the same thing as pressing the three dice in turn, in one respect that matters: this rolls
 * the name unconditionally, where a species re-roll leaves a typed name alone. A player who asks
 * for a random character is asking for a random character; a player who re-rolls the species has
 * said nothing about the name they wrote. The touched-name flag is reset by the caller to match.
 *
 * Each category still avoids the option already showing, so pressing it twice never appears to do
 * nothing — the same rule {@link thresholdRoll} follows, applied three times.
 * @param {object} ctx
 * @param {object} [options]
 * @param {() => number} [options.rng]
 * @param {string|null} [options.rules]
 */
export async function thresholdRollAll(ctx, { rng = Math.random, rules = null } = {}) {
  for ( const category of THRESHOLD_CATEGORIES ) {
    await thresholdRoll(ctx, category, { rng, rules });
  }
  thresholdRollName(ctx);
}

/**
 * Roll a name in the chosen species' style, using the generator the Details step already uses.
 * @param {object} ctx
 */
export function thresholdRollName({ state, source }) {
  const species = source.card(state.speciesUuid);
  const name = generateName(species?.identifier || species?.name);
  if ( name ) state.details.name = name;
}

/**
 * Fill any empty slot so the screen opens on a character rather than on three blanks.
 *
 * An empty threshold would ask the player to make three decisions before it could show them
 * anything, which is the wizard it exists to replace. Seeding at random and letting them re-roll
 * inverts that: there is always something on screen, and changing it is a choice rather than a
 * prerequisite. Only untouched slots are filled, so this is safe to call on a resumed draft.
 * @param {object} ctx
 * @param {object} [options]
 * @param {() => number} [options.rng]
 */
export async function seedThreshold(ctx, { rng = Math.random, rules = null } = {}) {
  const { state, source } = ctx;
  for ( const category of THRESHOLD_CATEGORIES ) {
    if ( state[FIELDS[category].field] ) continue;
    const pool = cardsFor(source, category, rules);
    if ( !pool.length ) continue;
    await thresholdSelect(ctx, category, pool[Math.floor(rng() * pool.length)].uuid);
  }
  if ( !state.details.name ) thresholdRollName(ctx);
}

/**
 * Build the threshold's render context.
 *
 * @param {object} ctx  The shell's step context.
 * @returns {Promise<object|null>}  Null when there is nothing to build from (no classes installed),
 *   which the shell turns into a message rather than an empty screen.
 */
export async function thresholdContext({ state, source }, rules = null) {
  const classes = source.classes();
  if ( !classes.length ) return { empty: t("quickBuild.threshold.noClasses") };

  const chosen = {
    class: source.card(state.classUuid),
    species: source.card(state.speciesUuid),
    background: source.card(state.backgroundUuid)
  };

  // One batched art lookup for the three chosen cards; each directory is browsed at most once per
  // session, so flipping between options costs nothing after the first.
  const requests = THRESHOLD_CATEGORIES
    .filter(c => chosen[c])
    .map(c => ({ card: chosen[c], category: c }));
  const art = await resolveArtFor(requests);

  const cards = THRESHOLD_CATEGORIES.map(category => {
    const card = chosen[category];
    const banner = card ? art.get(card.uuid) : null;
    return {
      category,
      label: t(`step.${category}.label`),
      name: card?.name ?? "",
      uuid: card?.uuid ?? "",
      // Three tiers, each degrading cleanly into the next: the book's own scene, the item's icon
      // (always present, always legal to show), then our own frame. `seed` drives the frame's
      // sigil so an art-free card is still distinctly that option's.
      banner: banner?.path ?? null,
      icon: banner ? null : (card?.img ?? null),
      seed: card?.identifier || card?.name || category,
      // What the class does and how hard it is to play, under its name. Classes only.
      guide: (category === "class" && card) ? classGuide(card.identifier) : null,
      count: cardsFor(source, category, rules).length,
      browse: t("quickBuild.threshold.browse", { count: cardsFor(source, category, rules).length }),
      roll: t("quickBuild.threshold.rollCategory", { category: t(`step.${category}.label`).toLowerCase() }),
      view: t("quickBuild.threshold.view")
    };
  });

  const abilities = abilityPreview(state, source);
  const credits = creditFor(art);

  return {
    cards,
    rollAll: t("quickBuild.threshold.rollAll"),
    editions: hasBothEditions(source)
      ? [
          { rules: "2024", label: t("quickBuild.threshold.edition2024"), active: String(rules) !== "2014" },
          { rules: "2014", label: t("quickBuild.threshold.edition2014"), active: String(rules) === "2014" }
        ]
      : null,
    // The starting level. Three fixed rungs rather than a 1–20 spinner — see {@link QUICK_LEVELS}
    // for why the profile can stand behind these and not behind every level.
    levels: QUICK_LEVELS.map(level => ({
      level,
      label: t("quickBuild.threshold.level", { level }),
      active: (state.targetLevel ?? 1) === level
    })),
    name: state.details?.name ?? "",
    plates: abilities.plates,
    fills: t("quickBuild.threshold.fills", {
      array: STANDARD_ARRAY.join(" "),
      class: chosen.class?.name ?? ""
    }),
    asi: asiLine(state, source, abilities.priorities),
    asiEdit: t("quickBuild.threshold.asiEdit"),
    credit: credits.length ? `${t("quickBuild.threshold.credit")} ${credits.join(", ")}.` : null,
    canCreate: Boolean(state.classUuid)
  };
}

/**
 * Fill the character from the three choices on screen.
 *
 * Fills only — where the player lands afterwards is the shell's call, because that depends on
 * whether the fill left any gaps. Everything below the three picks is `applyQuickBuild()`'s to
 * decide, unchanged, which is what makes this screen safe: it writes exactly the state the existing
 * Quick Build button writes, so the same gates validate it and the same driver applies it.
 * @param {object} ctx
 * @param {HTMLElement} [el]  The button, latched while the fill runs.
 * @returns {Promise<boolean>}  Whether the fill succeeded.
 */
export async function thresholdCreate({ state, source, spells, equipment }, el) {
  if ( !state.classUuid ) return false;
  // The fill awaits several compendium reads; latch the button so a double-click cannot start a
  // second fill over the first. Same hardening as the Quick Build button and Create.
  if ( el ) { el.disabled = true; el.classList.add("is-busy"); }
  try {
    const result = await applyQuickBuild({ state, source, spells, equipment }, {
      speciesUuid: state.speciesUuid,
      backgroundUuid: state.backgroundUuid,
      // The name in the field is the one the character gets. Without this the fill rolled a fresh
      // one over it — whatever the player typed, or the name a GM gave the blank sheet.
      name: state.details.name?.trim() || null
    });
    if ( !result.ok ) ui.notifications?.warn(t("quickBuild.partial"));
  } catch ( err ) {
    log("threshold create failed", err);
    ui.notifications?.error(t("quickBuild.failed"));
    if ( el ) { el.disabled = false; el.classList.remove("is-busy"); }
    return false;
  }
  return true;
}
