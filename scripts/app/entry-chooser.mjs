import { t, log } from "../config.mjs";
import { resolveArtFor } from "../data/art-cache.mjs";
import { availablePremades, foundryPregens, importPregen, profileFor } from "../data/premades.mjs";
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
 * avoid. Behind a chooser it is a first-class choice instead of a hidden setting, and the setting
 * shrinks to one question: does the creator open on this, or straight on the wizard as it always
 * has? Off by default, so no world acquires a new first screen by upgrading.
 *
 * ## The art
 *
 * Three journal scenes from whichever book the world has, resolved through the same cache as the
 * origin cards but with no icon tier — these are our own concepts, not compendium content, so
 * nothing has an icon for them and the honest fallback is our own frame. The filenames are verified
 * against the directory listing like everything else; a world without the Player's Handbook gets
 * the frame treatment and no broken images.
 */

/**
 * The three paths. `art` names a Player's Handbook journal scene; `id` is both the action payload
 * and the sigil seed for the art-free fallback.
 */
const PATHS = [
  { id: "custom", art: "consider-choices-sketch.webp" },
  { id: "quick", art: "adventurers-ready-for-new-adventure.webp", lead: true },
  { id: "premade", art: "heroes-of-the-forgotten-realm.webp" }
];

/** The package the chooser's own scenes come from, when it is installed. */
const SCENE_PACKAGE = "dnd-players-handbook";

/**
 * Resolve the chooser's three scenes in one browse.
 *
 * Reuses `resolveArtFor` by handing it synthetic "cards" whose uuid points at the PHB and whose
 * identifier is the bare filename — the resolver matches `<identifier>.webp` in `journal-art/` for
 * the class category, which is exactly the shape these files have. Cheaper and less code than a
 * second lookup path, and it inherits the existence check for free.
 * @returns {Promise<Map<string, {path: string}>>}  Keyed by path id.
 */
async function sceneArt() {
  const requests = PATHS.map(p => ({
    card: {
      uuid: `Compendium.${SCENE_PACKAGE}.journals.Item.${p.id}`,
      identifier: p.art.replace(/\.webp$/, ""),
      name: p.id
    },
    category: "class"
  }));
  const found = await resolveArtFor(requests);
  const out = new Map();
  for ( const [i, p] of PATHS.entries() ) {
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
  const premades = [...await foundryPregens(), ...availablePremades(source)];
  return {
    heading: t("entry.heading"),
    blurb: t("entry.blurb"),
    gmNote: t("entry.gmNote"),
    paths: PATHS.map(p => ({
      id: p.id,
      lead: !!p.lead,
      title: t(`entry.${p.id}.title`),
      tagline: t(`entry.${p.id}.tagline`),
      go: t(`entry.${p.id}.go`),
      recommended: p.lead ? t("entry.recommended") : null,
      points: [1, 2, 3].map(n => t(`entry.${p.id}.point${n}`)),
      banner: art.get(p.id)?.path ?? null,
      seed: p.id,
      // A world with no ready-made characters it can build should not be offered the room.
      // Hiding it beats opening an empty list, which is the same rule the premades themselves
      // follow when their content is missing.
      hidden: p.id === "premade" && !premades.length
    })).filter(p => !p.hidden)
  };
}

/**
 * Build the ready-made list's render context: two groups, each omitted when empty.
 *
 * Foundry's own pregenerated characters come first and are labelled as theirs. They are finished
 * Actors, so taking one is an import; our configured premades are built through the same engine a
 * hand-made character uses. Both end with a playable character, and the card says which is which
 * rather than blurring them — a player who picks "Akra" is getting the system's Akra, not our
 * approximation of her.
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function premadeContext({ source }) {
  const official = await foundryPregens();
  const configured = availablePremades(source);

  // Species art for our own premades. The official ones already carry a portrait of the character
  // themselves, which beats anything we could infer about them, so they need no lookup.
  const art = await resolveArtFor(configured.map(e => ({ card: e.species, category: "species" })));

  const groups = [];
  if ( official.length ) {
    groups.push({
      id: "official",
      label: t("entry.premade.fromFoundry"),
      // Foundry's own mark, served from core. Not bundled, and not a brand being borrowed:
      // it labels content the platform itself ships.
      badge: "icons/vtt-512.png",
      entries: official.map(pc => ({
        id: pc.id,
        uuid: pc.uuid,
        name: pc.name,
        line: pc.line,
        tagline: "",
        // The character's own portrait, so it fills the plate rather than sitting on it as an
        // emblem would. `portraitFor` has already fallen back to the class illustration for any
        // document that turns out to have only a placeholder.
        banner: pc.img,
        icon: null,
        seed: pc.id,
        official: true
      }))
    });
  }
  if ( configured.length ) {
    groups.push({
      id: "configured",
      label: t("entry.premade.fromModule"),
      badge: null,
      entries: configured.map(({ premade, ...cards }) => ({
        id: premade.id,
        uuid: "",
        name: premade.name,
        tagline: premade.tagline ?? "",
        line: `${cards.species.name} ${cards.class.name} 1 \u00b7 ${cards.background.name}`,
        banner: art.get(cards.species.uuid)?.path ?? null,
        icon: art.get(cards.species.uuid) ? null : (cards.species.img ?? null),
        seed: premade.id,
        official: false
      }))
    });
  }

  return {
    heading: t("entry.premade.heading"),
    blurb: t("entry.premade.blurb"),
    back: t("entry.premade.back"),
    none: groups.length ? null : t("entry.premade.none"),
    groups
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
    const actor = await importPregen(uuid);
    if ( !actor ) throw new Error(`could not read ${uuid}`);
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
