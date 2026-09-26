import { t, log, recommendedPath, MODULE_ID } from "../config.mjs";
import { resolveArtFor } from "../data/art-cache.mjs";
import { postCreationSummary } from "../build/chat-summary.mjs";
import {
  DEFAULT_PREGEN_LEVEL, availablePremades, foundryPregens, importPregen, profileFor
} from "../data/premades.mjs";
import { applyQuickBuild } from "../data/quick-build.mjs";
import { resolveChoices } from "../data/choice-resolver.mjs";

/**
 * The entry chooser — "how do you want to build this character?" — and the ready-made list behind
 * one of its three answers.
 *
 * ## One front door, three rooms
 *
 * Custom build is the wizard exactly as it ships: nine steps, nothing decided. Quick build is the
 * threshold. Ready-made starts from a stored set of choices. All three end on the same Review page
 * with every pick still editable, and that is what makes them safe to offer side by side — they are
 * three depths of the same flow, not three flows.
 *
 * This shape exists because the quick screen on its own was a *second* front door onto a flow that
 * already had one, which is the objection the module's own `headerMenu` default was written to
 * avoid. Behind a chooser it is a first-class choice instead. It shipped behind a world setting so
 * that no world would acquire a new first screen by upgrading; that setting is gone and this is
 * simply where the creator opens. The step-by-step path is unchanged — it is now reached by
 * choosing it.
 *
 * ## The art
 *
 * Journal scenes from whichever book the world has, resolved through the same cache as the origin
 * cards but with no icon tier — these are our own concepts, not compendium content, so nothing has
 * an icon for them and the honest fallback is our own frame. The filenames are verified against the
 * directory listing like everything else; a world without the Player's Handbook gets the frame
 * treatment and no broken images — and so does a world that merely has it *disabled*, which needs
 * its own check: Foundry serves module files from the filesystem regardless of whether the world
 * enables them, so an existence check alone cannot tell the two apart. See {@link sceneArt}.
 *
 * A path may instead name its own image with `src`, relative to this module's directory. That tier
 * needs no lookup and no book, so it resolves whatever the world has installed. Those files live in
 * `img/`, which is in the release archive — `docs/` is not, so a screenshot referenced where it sits
 * would render in a checkout and be a missing image in an installed copy.
 */

/**
 * The three paths. `art` names a Player's Handbook journal scene, `src` a path relative to this
 * module's own directory; a path carries one or the other. `id` is both the action payload and the
 * sigil seed for the art-free fallback.
 *
 * Which one is badged as recommended is the GM's setting, not a constant here — see
 * {@link recommendedPath}.
 */
const PATHS = [
  { id: "custom", art: "consider-choices-sketch.webp" },
  { id: "quick", art: "adventurers-ready-for-new-adventure.webp" },
  // The ready-made room is the one path whose subject is the creator itself rather than a scene of
  // adventuring, so it is illustrated with our own shot of it instead of a book's artwork.
  { id: "premade", src: "img/premade.webp" }
];

/** The package the chooser's own scenes come from, when it is installed. */
const SCENE_PACKAGE = "dnd-players-handbook";

/**
 * Resolve the chooser's book scenes in one browse.
 *
 * Reuses `resolveArtFor` by handing it synthetic "cards" whose uuid points at the PHB and whose
 * identifier is the bare filename — the resolver matches `<identifier>.webp` in `journal-art/` for
 * the class category, which is exactly the shape these files have. Cheaper and less code than a
 * second lookup path, and it inherits the existence check for free.
 * @returns {Promise<Map<string, {path: string}>>}  Keyed by path id.
 */
async function sceneArt() {
  // Installed is not the same as enabled, and only the existence check would notice the difference.
  // Foundry serves a module's files from disk whether or not the world has it switched on, so the
  // `FilePicker.browse` below happily finds these scenes in a world that deliberately excludes the
  // Player's Handbook — and the chooser then illustrates itself with a book the GM turned off.
  // This is the one lookup that names a package outright; the origin cards take theirs from the
  // item's own uuid, so a card can only ever be drawn from a package the world is already using.
  if ( !game.modules.get(SCENE_PACKAGE)?.active ) return new Map();

  // Paths that ship their own image are not looked up at all, so a world without the Player's
  // Handbook still loses only the cards whose art came from it.
  const scenes = PATHS.filter(p => p.art);
  const requests = scenes.map(p => ({
    card: {
      uuid: `Compendium.${SCENE_PACKAGE}.journals.Item.${p.id}`,
      identifier: p.art.replace(/\.webp$/, ""),
      name: p.id
    },
    category: "class"
  }));
  const found = await resolveArtFor(requests);
  const out = new Map();
  for ( const [i, p] of scenes.entries() ) {
    const hit = found.get(requests[i].card.uuid);
    if ( hit ) out.set(p.id, hit);
  }
  return out;
}

/**
 * Build the chooser's render context.
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function chooserContext({ source }) {
  const art = await sceneArt();
  const officialCount = (await foundryPregens()).reduce((n, g) => n + g.entries.length, 0);
  const premadeCount = officialCount + availablePremades(source).length;
  // A world that recommends the ready-made path but has no ready-made characters would badge a
  // card that is not on screen, so the recommendation falls back to the default in that case.
  let lead = recommendedPath();
  if ( lead === "premade" && !premadeCount ) lead = "quick";
  return {
    heading: t("entry.heading"),
    blurb: t("entry.blurb"),
    paths: PATHS.map(p => ({
      id: p.id,
      lead: p.id === lead,
      title: t(`entry.${p.id}.title`),
      tagline: t(`entry.${p.id}.tagline`),
      go: t(`entry.${p.id}.go`),
      recommended: (p.id === lead) ? t("entry.recommended") : null,
      points: [1, 2, 3].map(n => t(`entry.${p.id}.point${n}`)),
      banner: p.src ? `modules/${MODULE_ID}/${p.src}` : (art.get(p.id)?.path ?? null),
      seed: p.id,
      // A world with no ready-made characters it can build should not be offered the room.
      // Hiding it beats opening an empty list, which is the same rule the premades themselves
      // follow when their content is missing.
      hidden: p.id === "premade" && !premadeCount
    })).filter(p => !p.hidden)
  };
}

/**
 * Build the ready-made list's render context: one group per source, each omitted when empty, and
 * all of them narrowed to one level by the filter above the list.
 *
 * The filter is across every group rather than per book, because the question a player is asking
 * is "what can I play at level 5", not "what does this book have at level 5". It offers only the
 * levels something is actually at, plus "All levels", and opens on {@link DEFAULT_PREGEN_LEVEL} so
 * the first view is the starting characters rather than four copies of each hero.
 *
 * Foundry's own pregenerated characters come first and are labelled as theirs. They are finished
 * Actors, so taking one is an import; our configured premades are built through the same engine a
 * hand-made character uses. Both end with a playable character, and the card says which is which
 * rather than blurring them — a player who picks "Akra" is getting the system's Akra, not our
 * approximation of her.
 * @param {object} ctx
 * @param {string|null} [chosenId]
 * @param {number|"all"|null} [level]  The level to show; null means the default.
 * @returns {Promise<object>}
 */
export async function premadeContext({ source }, chosenId = null, level = null) {
  const official = await foundryPregens();
  const configured = availablePremades(source);

  // Species art for our own premades. The official ones already carry a portrait of the character
  // themselves, which beats anything we could infer about them, so they need no lookup.
  const art = await resolveArtFor(configured.map(e => ({ card: e.species, category: "species" })));

  // One group per book that ships ready-made characters, labelled with that book — a player
  // picking "Akra" is getting the system's Akra, and one picking a Borderlands hero is getting
  // that adventure's, and the heading says which.
  const groups = official.map(group => ({
    id: group.pack,
    label: group.label,
    badge: group.badge,
    entries: group.entries.map(pc => ({
      id: pc.id,
      level: pc.level,
      uuid: pc.uuid,
      name: pc.name,
      line: pc.line,
      tagline: pc.tagline ?? "",
      // The character's own portrait, so it fills the plate rather than sitting on it as an emblem
      // would. `portraitFor` has already fallen back to the class illustration for any document
      // that turns out to have only a placeholder.
      banner: pc.img,
      icon: null,
      seed: pc.id,
      official: true,
      chosen: pc.id === chosenId
    }))
  }));

  if ( configured.length ) {
    groups.push({
      id: "configured",
      label: t("entry.premade.fromModule"),
      badge: null,
      entries: configured.map(({ premade, ...cards }) => ({
        id: premade.id,
        // Built through the level 1 creation flow, so level 1 is what they are.
        level: 1,
        uuid: "",
        name: premade.name,
        tagline: premade.tagline ?? "",
        line: `${cards.species.name} ${cards.class.name} 1 \u00b7 ${cards.background.name}`,
        banner: art.get(cards.species.uuid)?.path ?? null,
        icon: art.get(cards.species.uuid) ? null : (cards.species.img ?? null),
        seed: premade.id,
        official: false,
        chosen: premade.id === chosenId
      }))
    });
  }

  // The levels on offer, from what is actually there. A world whose only pregens are level 1 gets
  // no filter at all — a control with one useful position is not a control.
  const present = [...new Set(groups.flatMap(g => g.entries.map(e => e.level)))].sort((a, b) => a - b);
  // A requested level nothing is at (a pack switched off since) falls back rather than showing an
  // empty list; so does the default, in a world with no level 1 characters at all.
  let active = level ?? DEFAULT_PREGEN_LEVEL;
  if ( (active !== "all") && !present.includes(active) ) {
    active = present.includes(DEFAULT_PREGEN_LEVEL) ? DEFAULT_PREGEN_LEVEL : (present[0] ?? "all");
  }
  const levels = (present.length > 1) ? [
    ...present.map(n => ({ value: String(n), label: t("entry.premade.level", { level: n }), active: active === n })),
    { value: "all", label: t("entry.premade.allLevels"), active: active === "all" }
  ] : null;

  const shown = groups
    .map(g => ({ ...g, entries: g.entries.filter(e => (active === "all") || (e.level === active)) }))
    .filter(g => g.entries.length);

  // Picking a card selects it; a second, deliberate press creates the character. Creating an
  // actor on a single click of a browsing grid is too easy to do by accident, and unlike every
  // other path here it cannot be undone from inside the window. Read from the shown cards only, so
  // a choice the filter has hidden cannot be created from a footer naming someone off screen.
  const chosen = shown.flatMap(g => g.entries).find(e => e.chosen) ?? null;

  return {
    heading: t("entry.premade.heading"),
    blurb: t("entry.premade.blurb"),
    none: groups.length ? null : t("entry.premade.none"),
    levels,
    groups: shown,
    chosen,
    confirm: chosen ? t("entry.premade.confirm", { name: chosen.name }) : null
  };
}

/**
 * Import one of Foundry's pregenerated characters, then hand the player their sheet.
 *
 * Nothing of ours runs over it. The document in the pack is a finished, correct character; putting
 * it through our build engine could only introduce differences from what the system intends, and
 * there is nothing left for that engine to decide.
 * @param {object} ctx
 * @param {string} uuid
 * @param {HTMLElement} [el]
 * @returns {Promise<boolean>}  Always true — the window closes either way.
 */
export async function takePregen({ app }, uuid, el) {
  if ( el ) { el.disabled = true; el.classList.add("is-busy"); }
  try {
    // A blank sheet the GM prepared is filled rather than a new actor created beside it.
    const actor = await importPregen(uuid, { into: app.state?.actor ?? null });
    if ( !actor ) throw new Error(`could not read ${uuid}`);
    // Announced like any other character this module makes. Taking a ready-made one is still
    // making one, and a table that watches the creation cards should not have a player quietly
    // appear with a finished character and no card. Obeys the same summary setting as the rest.
    const group = (await foundryPregens()).find(g => g.entries.some(e => e.uuid === uuid));
    await postCreationSummary(actor, { readyMade: group?.label ?? null });
    app.markFinished?.();
    await app.close();
    actor.sheet?.render(true);
  } catch ( err ) {
    log("could not import the pregenerated character", err);
    ui.notifications?.error(t("entry.premade.importFailed"));
    if ( el ) { el.disabled = false; el.classList.remove("is-busy"); }
  }
  return true;
}

/**
 * Apply a ready-made character: set its three origins, then fill everything else from its profile.
 *
 * The same `applyQuickBuild()` the quick screen and the Quick Build button use, with the origins
 * pinned and the class's profile overlaid with whatever the premade states. That is the whole
 * mechanism, and it is the reason a ready-made character is indistinguishable from one built by
 * hand — same engine, same state fields, same driver, same gates.
 * @param {object} ctx
 * @param {string} id   The premade's id.
 * @param {HTMLElement} [el]
 * @returns {Promise<boolean>}  Whether the caller should skip its own re-render.
 */
export async function applyPremade({ state, source, spells, equipment, app }, id, el) {
  const entry = availablePremades(source).find(e => e.premade.id === id);
  if ( !entry ) return false;
  const { premade } = entry;

  if ( el ) { el.disabled = true; el.classList.add("is-busy"); }
  try {
    state.classUuid = entry.class.uuid;
    state.resetClassDependent();
    state.originAsi.species = await source.abilityScoreIncrease(entry.species.uuid);
    state.originAsi.background = await source.abilityScoreIncrease(entry.background.uuid);
    state.choiceCache = await resolveChoices(state, source);

    const result = await applyQuickBuild({ state, source, spells, equipment }, {
      profile: profileFor(premade),
      speciesUuid: entry.species.uuid,
      backgroundUuid: entry.background.uuid,
      name: premade.name
    });
    if ( !result.ok ) ui.notifications?.warn(t("quickBuild.partial"));
  } catch ( err ) {
    log(`premade "${id}" failed`, err);
    ui.notifications?.error(t("quickBuild.failed"));
    if ( el ) { el.disabled = false; el.classList.remove("is-busy"); }
    return false;
  }
  app.gotoStep("review");
  return true;
}
