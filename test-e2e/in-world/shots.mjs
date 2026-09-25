/**
 * Screenshot support, running *inside* the world.
 *
 * The equivalence harness deliberately never touches the wizard's UI — it fills a `CreatorState`
 * and calls the assembler, because the UI's bugs are not what that comparison is about. Capturing
 * README screenshots is the opposite job: the UI *is* the subject, so this module opens the real
 * `CreatorShell` and puts it into the state each picture wants. Playwright then photographs the
 * viewport from the Node side.
 *
 * Everything here drives the shell through its own objects and public navigation (`gotoStep`),
 * not through DOM clicks — same reasoning as the rest of the harness: a selector for a card in a
 * grid breaks every time the markup is restyled, and restyling is exactly when the screenshots
 * need retaking.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";

const { CreatorShell } = await import(`${MODULE}/app/creator-shell.mjs`);
const { StoreConfigApp } = await import(`${MODULE}/app/store-config.mjs`);
const { MagicShopConfigApp } = await import(`${MODULE}/app/magic-shop-config.mjs`);
const { magicEntryFromItem } = await import(`${MODULE}/data/magic-shop.mjs`);
const { applyQuickBuild } = await import(`${MODULE}/data/quick-build.mjs`);
const { getSources } = await import(`${MODULE}/data/source-cache.mjs`);
const { launchWindowOptions, MODULE_ID, SETTINGS } = await import(`${MODULE}/config.mjs`);

/** The open shell, so successive calls from Node act on the same window. */
let shell = null;

/* -------------------------------------------- */
/*  Opening and navigating                      */
/* -------------------------------------------- */

/**
 * Open the creator on a fresh draft and wait for its compendium index to warm.
 *
 * The shell shows a spinner until `#loadStage` finishes, and a screenshot taken during that window
 * is a picture of the spinner. There is no "loaded" event to await, so poll the rendered stage for
 * the absence of the loading class instead.
 */
export async function openCreator() {
  await closeAll();
  shell = new CreatorShell(null, launchWindowOptions());
  await shell.render(true);
  await waitForStage();
  await pause(500);
  depersonalise();
  return true;
}

/**
 * Resolve once the stage has content rather than the loading spinner.
 *
 * The generous timeout is not padding: the first open indexes every pack in the world, and the
 * screenshot world runs eight content modules across 78 compendiums. A cold warm-up sits at
 * "Preparing classes, species & backgrounds…" for minutes, and the failure mode without this is a
 * screenshot of the spinner.
 */
async function waitForStage(timeout = 420_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    const el = document.querySelector(".creator-stage");
    if ( el && !el.querySelector(".creator-loading") ) return;
    await pause(500);
  }
  const label = document.querySelector(".creator-loading p")?.textContent ?? "(no stage at all)";
  throw new Error(`creator stage never finished loading — stuck at: ${label}`);
}

/**
 * Remove the things that belong to *this* machine rather than to the module.
 *
 * Two of them: Foundry's own toast notifications (the headless browser always warns about missing
 * hardware acceleration, and a passing "actor created" toast would date the picture), and the
 * version pill in the top bar, which reads a literal `#{VERSION}#` when the module runs from a
 * source checkout because the release workflow is what substitutes it. Hidden rather than
 * back-filled with a number — a screenshot should not claim a version it wasn't taken from.
 */
export function depersonalise() {
  document.querySelectorAll("#notifications .notification").forEach(el => el.remove());
  ui.notifications?.clear?.();
  document.querySelectorAll(".creator-topbar-version").forEach(el => { el.style.visibility = "hidden"; });
}

/** Jump to a step by id. Returns false when the step's prerequisites aren't met yet. */
export async function goto(id) {
  const reached = shell.gotoStep(id);
  await settleRender();
  return reached;
}

/** Open or close the picker drawer on the current step (the card grid). */
export async function picker(open) {
  shell._setPicker(open);
  await settleRender();
  return true;
}

/* -------------------------------------------- */
/*  Filling the character                       */
/* -------------------------------------------- */

/**
 * Choose class / background / species by *name*, preferring the Player's Handbook copy.
 *
 * Screenshots want the PHB's official artwork behind the cards, and a world with both the PHB
 * module and the system's SRD packs offers two of everything (the shell's own de-duplication
 * keeps the PHB one, but the index this reads is the raw list).
 * @param {{class?: string, background?: string, species?: string}} names
 */
export async function choose(names) {
  const { source } = getSources();
  const pick = (cards, name) => {
    const matches = cards.filter(c => c.name === name);
    // PHB first for its artwork; then the **2024** copy, which is what matters in a world with no
    // premium books. Falling through to `matches[0]` there picked the 2014 SRD class, and a 2014
    // build then filters the origin grids to 2014 content — where the SRD ships a single
    // background. The resulting picture is accurate and badly misleading: it reads as "this module
    // offers one background" rather than "the 2014 SRD contains one". 2024 is the system default
    // and what a fresh install opens on, so it is what the reference set should show.
    return (matches.find(c => c.uuid.includes("dnd-players-handbook"))
      ?? matches.find(c => String(c.rules) === "2024")
      ?? matches[0])?.uuid ?? null;
  };
  if ( names.class ) shell.state.classUuid = pick(source.classes(), names.class);
  const rules = source.rulesOf(shell.state.classUuid);
  if ( names.background ) shell.state.backgroundUuid = pick(source.backgrounds({ rules }), names.background);
  if ( names.species ) shell.state.speciesUuid = pick(source.species({ rules }), names.species);
  await settleRender();
  return {
    class: shell.state.classUuid,
    background: shell.state.backgroundUuid,
    species: shell.state.speciesUuid
  };
}

/**
 * Run the real Quick Build fill, exactly as the button does, then land on the requested step.
 *
 * `rng` is seeded so a re-run produces the same character — a screenshot set where the species
 * changes every time is one that can never be partially retaken.
 */
export async function quickBuild({ seed = 7, goTo = "review" } = {}) {
  const { source, spells, equipment } = getSources();
  const rng = mulberry32(seed);
  const result = await applyQuickBuild({ state: shell.state, source, spells, equipment }, { rng });
  shell.gotoStep(goTo);
  await settleRender();
  return result;
}

/**
 * Focus one of the chosen spells, so the description column shows a spell rather than its empty
 * "pick one to read it" state — the point the README makes about this screen is that every option
 * carries its full text.
 */
export async function focusSpell({ index = 0 } = {}) {
  const list = [...shell.state.selectedCantrips, ...shell.state.selectedSpells];
  const entry = list[index];
  shell.state.focusedSpellUuid = typeof entry === "string" ? entry : entry?.uuid ?? null;
  await settleRender();
  return shell.state.focusedSpellUuid;
}

/**
 * Set the identity Quick Build leaves at its defaults: name, portrait, token art, and the token
 * flags the Details screen exposes.
 *
 * Portrait and token are separate images on purpose — the Details screen's whole point is that
 * they are two different pictures of the same character.
 */
export async function details({ name, portrait, token, lockRotation }) {
  if ( name ) shell.state.details.name = name;
  if ( portrait ) shell.state.portrait = portrait;
  if ( token ) shell.state.tokenImg = token;
  if ( lockRotation !== undefined ) shell.state.tokenLockRotation = !!lockRotation;
  await settleRender();
  return true;
}

/**
 * Choose named options inside a starting-equipment bundle — the "or" pills, like which instrument
 * a Bard's kit includes.
 *
 * Matched by visible label and clicked, rather than written into `state.equipment.orSelections`:
 * the option ids are content-generated, so a label is the only stable way to name one from here.
 *
 * `source` is required because the class and the background each offer their own copy of the same
 * list — a Bard and an Entertainer both choose an instrument, so an unscoped label match would
 * silently set the same one twice and leave the other on its default.
 * @param {{source: "class"|"background", label: string}[]} picks
 */
export async function pickEquipment(picks = []) {
  for ( const { source, label } of picks ) {
    const section = document.querySelector(`.creator-equip-source[data-equip-source="${source}"]`);
    if ( !section ) throw new Error(`no equipment section for "${source}"`);
    const pills = [...section.querySelectorAll('[data-step-action="equip-or"]')];
    const pill = pills.find(el => el.textContent.trim().toLowerCase().includes(label.toLowerCase()));
    if ( !pill ) {
      throw new Error(`no ${source} equipment option matching "${label}". On screen: `
        + pills.map(el => el.textContent.trim()).join(" | "));
    }
    pill.click();
    await pause(500);
  }
  await settleRender();
  return true;
}

/* -------------------------------------------- */
/*  The other windows                           */
/* -------------------------------------------- */

/** The actor built by {@link buildActor}, so the level-up shot can grow the same character. */
let built = null;

/** Build the character for real and open its sheet — the "finished actor" picture. */
export async function buildActor() {
  // Found by diffing the directory, not by name: the screenshot world keeps characters from earlier
  // runs, and a name lookup returns the first "Aria Nightbreeze" — an old one, whose creation card is
  // not from this run.
  const before = new Set(game.actors.map(a => a.id));
  await shell._finish(null);
  await pause(2500);
  built = game.actors.find(a => !before.has(a.id) && (a.type === "character"))
    ?? game.actors.find(a => a.name === shell.state.details.name)
    ?? game.actors.contents.at(-1);
  await closeAll();
  await built.sheet.render(true);
  await pause(2000);
  return built.uuid;
}

/**
 * Level the built character up, which is the module's *other* wizard.
 *
 * Goes through `triggerLevelUp` rather than constructing the shell, so the picture is of whatever
 * the sidebar's "Level Up" entry actually produces — including the class-choice screen when
 * multiclassing is enabled, which is a different first screen.
 */
export async function levelUp() {
  const { triggerLevelUp } = await import(`${MODULE}/levelup/intercept.mjs`);
  await closeAll();
  const actor = built ?? game.actors.find(a => a.type === "character" && a.items.some(i => i.type === "class"));
  if ( !actor ) throw new Error("no character to level up");
  await triggerLevelUp(actor);
  await waitForStage();
  await pause(800);
  depersonalise();
  return actor.uuid;
}

/* -------------------------------------------- */
/*  Ember                                       */
/* -------------------------------------------- */

/**
 * Ember's creation hand-off, in Ember's own world.
 *
 * Ember's builder is not driven here — the equivalence harness explains why in `ember.mjs`: Ember
 * exposes no API, and its creation sheet lives in a bundle whose internals move between releases.
 * What this stages is the *manager* Ember hands over, built exactly as
 * `EmberCharacterCreationSheet#createAdvancementManager` builds it, so rendering it fires the same
 * `preAdvancementManagerRender` our takeover listens for.
 *
 * The picture is therefore genuinely our wizard, genuinely in Ember's skin, reached by the same
 * hook a real Ember run reaches it by — but the click that started it came from here rather than
 * from Ember's sheet.
 */
export async function emberCreation() {
  const { stageEmberManager } = await import(`./ember.mjs?v=${Date.now()}`);
  await closeAll();
  const { manager } = await stageEmberManager({
    name: "Ember: Human Strider Monster Hunter Sorcerer",
    ember: {
      ancestryUuid: "Compendium.ember.character.Item.emberAncHuman000",
      cultureUuid: "Compendium.ember.character.Item.emberBkgStrider0",
      pathUuid: "Compendium.ember.character.Item.monsterHunter000"
    },
    classUuid: "Compendium.dnd-players-handbook.classes.Item.phbscrSorcerer00",
    abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }
  });
  await manager.render(true);
  await waitForStage();
  // The wizard that opened is our takeover's, not one we constructed, so adopt it for the calls
  // that follow (`takeGold`, `walkTo`).
  shell = liveShell();
  await pause(1000);
  depersonalise();
  return true;
}

/**
 * A character to level up in the Ember world, so the level-up wizard can be photographed wearing
 * the Ember skin. Built directly rather than through the creator, which Ember switches off.
 */
export async function emberActor({ classUuid = "Compendium.dnd-players-handbook.classes.Item.phbscrSorcerer00" } = {}) {
  const klass = await fromUuid(classUuid);
  built = await Actor.implementation.create({
    name: "Kell Ashvane",
    type: "character",
    system: { abilities: { str: { value: 8 }, dex: { value: 14 }, con: { value: 13 },
      int: { value: 10 }, wis: { value: 12 }, cha: { value: 15 } } }
  }, { render: false });
  await built.createEmbeddedDocuments("Item", [{ ...klass.toObject(), system: { ...klass.toObject().system, levels: 1 } }]);
  await pause(1500);
  return built.uuid;
}

/* -------------------------------------------- */
/*  3.3.0: party, XP glow, blank sheets         */
/* -------------------------------------------- */

/** The party the Review and chat-card shots add to. A plain name, since it is on screen. */
const PARTY_NAME = "The Company";
/** The blank character the Build Character shots are of. */
const BLANK_NAME = "New Recruit";
/** The screenshot character's name (screenshots.mjs CHARACTER.name), removed by cleanup. */
const CHARACTER_NAME = "Aria Nightbreeze";

/**
 * Make sure the world has a primary party the GM owns, so the Review page shows its
 * "Add to {party}" switch and the creation card its button. Reused across runs rather than created
 * each time, so repeated captures don't fill the world with parties.
 */
export async function ensureParty() {
  let party = game.actors.find(a => (a.type === "group") && (a.name === PARTY_NAME));
  party ??= await Actor.implementation.create({ name: PARTY_NAME, type: "group" }, { renderSheet: false });
  await game.settings.set("dnd5e", "primaryParty", { actor: party.id });
  if ( shell ) { shell.render(); await settleRender(); }
  return party.id;
}

/**
 * The built character's sheet once they have the XP for their next level: the Level Up button
 * wears its golden outline. The glow animates, so any frame of it is a fair picture.
 */
/** The world's levelling mode before `xpReadySheet` changed it, so `cleanupShots` can put it back. */
let levelingModeBefore = null;

export async function xpReadySheet() {
  await closeAll();
  if ( !built ) throw new Error("no built character: run buildActor first");
  // The glow only exists in a world that levels by XP; a milestone world ("noxp") never lights it.
  const mode = game.settings.get("dnd5e", "levelingMode");
  if ( mode === "noxp" ) {
    levelingModeBefore ??= mode;
    await game.settings.set("dnd5e", "levelingMode", "xp");
  }
  const max = built.system.details.xp.max;
  if ( Number.isFinite(max) ) await built.update({ "system.details.xp.value": max });
  await built.sheet.render(true);
  await pause(2000);
  return built.uuid;
}

/**
 * The sheet's repair wrench, which dnd5e's own header never shows: it appears only while a level has
 * a choice that was never made.
 *
 * The picture needs such a character, and the built one is whole — so this copies it and blanks one
 * answered decision on the copy, the class's skill picks, which is exactly the shape a skipped choice
 * leaves (`value.chosen` short of the count). The copy keeps the character's name, so the cleanup
 * step removes it with everything else, and the built character stays whole for the shots after
 * this one. XP is zeroed so the Level Up button beside the wrench is its ordinary self rather than
 * the glowing ready state the previous shot shows.
 */
export async function repairSheet() {
  await closeAll();
  if ( !built ) throw new Error("no built character: run buildActor first");
  const [copy] = await Actor.implementation.createDocuments([built.toObject()]);
  const cls = copy.items.find(i => i.type === "class");
  // Read from the source: on a live item `system.advancement` may hold prepared objects.
  // One that was actually answered: a class also carries its multiclass Trait (restricted to a
  // secondary class), which the original class never answers — blanking that one changes nothing.
  const advancement = cls?.toObject().system?.advancement ?? {};
  const trait = Object.values(advancement)
    .find(a => (a.type === "Trait") && (a.configuration?.choices ?? []).some(c => c?.count > 0)
      && (a.value?.chosen?.length > 0));
  if ( !trait ) throw new Error(`${cls?.name ?? "the class"} has no answered Trait choice to blank`);
  trait.value.chosen = [];
  // Written back whole, so it lands whether the source keeps advancements as an array or keyed by id.
  await cls.update({ "system.advancement": advancement });
  await copy.update({ "system.details.xp.value": 0 });
  const { canRepair } = await import("/modules/sogrom-dnd5e-character-creator/scripts/levelup/repair.mjs");
  if ( !canRepair(copy) ) throw new Error("the copy has nothing to repair; the wrench would not show");
  await copy.sheet.render(true);
  await pause(2000);
  return copy.uuid;
}

/**
 * The creation chat card for the built character, with its "Add to {party}" button.
 *
 * Rendered on its own rather than photographed in the chat log: `closeAll` closes the sidebar with
 * everything else, and a card cropped out of a scrolled log is at the mercy of whatever else was
 * posted. `renderHTML` runs the same hooks the log does, so the button is filled in exactly as a
 * GM would see it.
 */
export async function creationCard() {
  await closeAll();
  if ( !built ) throw new Error("no built character: run buildActor first");
  const message = [...game.messages].reverse().find(m =>
    (m.getFlag(MODULE_ID, "summary") === "creation") && (m.speaker?.actor === built.id));
  if ( !message ) throw new Error("the built character has no creation card (is the summary setting off?)");
  // The real message in the real chat log, as a GM sees it — a card rendered on its own elsewhere
  // loses the log's theme, and its text came out pale on the parchment.
  ui.sidebar.expand?.();
  await ui.sidebar.changeTab?.("chat", "primary");
  await pause(1000);
  const el = document.querySelector(`#chat [data-message-id="${message.id}"], .chat-log [data-message-id="${message.id}"]`);
  if ( !el ) throw new Error("the creation card is not in the chat log");
  el.scrollIntoView({ block: "center" });
  el.classList.add("sogrom-shot-target");
  await pause(800);
  return message.id;
}

/** Set the Review page's "Add to {party}" switch — the state the next Create honours. */
export async function joinParty(on = true) {
  if ( !shell ) throw new Error("no creator open");
  shell.state.joinParty = !!on;
  shell.render();
  await settleRender();
  return shell.state.joinParty;
}

/** A blank character the GM has prepared: no class, species or background. Reused across runs. */
async function blankCharacter() {
  let actor = game.actors.find(a => (a.type === "character") && (a.name === BLANK_NAME));
  actor ??= await Actor.implementation.create({ name: BLANK_NAME, type: "character" }, { renderSheet: false });
  const origins = actor.items.filter(i => ["class", "race", "background"].includes(i.type)).map(i => i.id);
  if ( origins.length ) await actor.deleteEmbeddedDocuments("Item", origins);
  return actor;
}

/** The blank character's sheet, with the gold Build Character hammer in its header. */
export async function blankSheet() {
  await closeAll();
  const actor = await blankCharacter();
  await actor.sheet.render(true);
  await pause(2000);
  return actor.uuid;
}

/**
 * The Actors sidebar's right-click menu on the blank character, offering Build Character.
 *
 * The sidebar is switched to its Actors tab (and expanded) before the right-click. The click is a real `contextmenu` event on the row, so the menu
 * is the one Foundry builds, not a copy of it.
 */
export async function blankMenu() {
  await closeAll();
  const actor = await blankCharacter();
  await actor.sheet?.close({ force: true }).catch(() => {});
  // The sidebar is on screen in this one, so it should not advertise the harness: drop the actors
  // other runs left behind (the `[e2e] ` prefix is the harness's own, and older copies of the
  // screenshot character), keeping the one this run built.
  const stale = game.actors.filter(a => a.name.startsWith("[e2e] ")
    || ((a.name === CHARACTER_NAME) && (a.id !== built?.id))).map(a => a.id);
  if ( stale.length ) await Actor.implementation.deleteDocuments(stale);
  ui.sidebar.expand?.();
  await ui.sidebar.changeTab?.("actors", "primary");
  await ui.actors.render();
  await pause(1000);
  const row = ui.actors.element?.querySelector(`.directory-item[data-entry-id="${actor.id}"]`);
  if ( !row ) throw new Error("the blank character has no row in the Actors sidebar");
  row.scrollIntoView({ block: "center" });
  await pause(300);
  // The world opens paused, and the banner would fill the middle of the picture.
  if ( game.paused ) game.togglePause(false, { broadcast: true });
  // Right-clicked near the row's bottom edge, so the menu opens beneath the name rather than over it.
  const box = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, button: 2, clientX: box.left + 60, clientY: box.bottom - 3
  }));
  await pause(800);
  return actor.uuid;
}

/** The GM's Level-Up Options window, where "Maximum only" hit points is chosen. */
export async function levelUpOptions() {
  await closeAll();
  const { LevelUpOptionsApp } = await import(`${MODULE}/app/levelup-options.mjs`);
  await new LevelUpOptionsApp().render(true);
  await pause(1500);
  return true;
}

/**
 * Put the world back: drop the party, the blank character and the screenshot character this file
 * created, leave no primary party set, and restore the levelling mode. Run last, so the next
 * capture starts from the same world.
 */
export async function cleanupShots() {
  await closeAll();
  await game.settings.set("dnd5e", "primaryParty", { actor: null });
  if ( levelingModeBefore ) {
    await game.settings.set("dnd5e", "levelingMode", levelingModeBefore);
    levelingModeBefore = null;
  }
  const ids = game.actors
    .filter(a => ((a.type === "group") && (a.name === PARTY_NAME))
      || ((a.type === "character") && [BLANK_NAME, CHARACTER_NAME].includes(a.name)))
    .map(a => a.id);
  if ( ids.length ) await Actor.implementation.deleteDocuments(ids);
  return ids.length;
}

/** Open the GM's store configuration window. */
export async function storeConfig() {
  await closeAll();
  await new StoreConfigApp().render(true);
  await pause(1500);
  return true;
}

/** Turn the optional store step on, so the Store screen is reachable. */
export async function enableStore(enabled = true) {
  await game.settings.set(MODULE_ID, SETTINGS.storeEnabled, enabled);
  return true;
}

/* -------------------------------------------- */
/*  Equipment, gold and the shop                */
/* -------------------------------------------- */

/**
 * Take the gold option instead of the gear bundle, on both the class and the background.
 *
 * The Store step only opens when there is money to spend, and Quick Build takes the bundle — so
 * without this the shop screenshot is a picture of an empty wallet. Option index 1 is the "or B"
 * branch of a `startingEquipment` tree; the store step recomputes the budget from the selection on
 * every render, so nothing else needs poking.
 */
export async function takeGold() {
  const state = (shell ?? liveShell()).state;
  for ( const source of ["class", "background"] ) {
    if ( state.equipment?.[source] ) state.equipment[source].selectedOption = 1;
  }
  await settleRender();
  return true;
}

/**
 * Put a few things in the cart, by clicking the shelf's own "+" buttons.
 *
 * Driven through the DOM rather than by writing `state.store.purchases` directly, because the
 * price each entry caches is computed by the step's handler from the rendered price — reproducing
 * that here would be a second implementation of it that could quietly disagree.
 */
export async function shop({ count = 4 } = {}) {
  const bought = new Set();
  for ( let i = 0; i < count; i++ ) {
    // Re-query every pass: the click re-renders the shelf, so the previous nodes are detached.
    // Skipping what is already in the cart gives a basket of different things rather than four
    // of the first item on the shelf.
    const button = [...document.querySelectorAll('[data-step-action="store-add"]:not([disabled])')]
      .find(el => !bought.has(el.dataset.uuid));
    if ( !button ) break;
    bought.add(button.dataset.uuid);
    button.click();
    await pause(500);
  }
  await settleRender();
  return Object.keys((shell ?? liveShell()).state.store?.purchases ?? {}).length;
}

/* -------------------------------------------- */
/*  Walking the wizard                          */
/* -------------------------------------------- */

/** The module's own shell, whichever kind is currently open. */
function liveShell() {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.element?.classList?.contains("sogrom-creator")
      || app.element?.querySelector?.(".creator-stage") ) return app;
  }
  return null;
}

/** The heading of the screen currently on stage. */
function currentStep() {
  return document.querySelector(".creator-stage-head h1")?.textContent?.trim() ?? "";
}

/**
 * Click forward through the wizard until the screen headed `until` is reached.
 *
 * Used for the Ember hand-off, where there is no `gotoStep` to jump with: its rail is rebuilt from
 * the driver's steps every render, and a later screen is unreachable until the earlier ones are
 * answered. So this answers them — clicking real option cards and the real Next button, the same
 * two things a player clicks — rather than reaching into the state.
 *
 * The rule each pass is simply: if Next is live, take it; otherwise pick the first option that is
 * offered and not already taken. That is enough for skill lists, trait grids and spell picks,
 * which is all the level-1 hand-off asks for.
 */
export async function walkTo({ until, limit = 60 } = {}) {
  const SELECTABLE = [
    '.creator-choice-card:not(.is-selected):not([disabled])',
    '[data-step-action="pick-spell"]:not(.is-selected):not([disabled])'
  ].join(", ");

  const trail = [];
  for ( let i = 0; i < limit; i++ ) {
    const here = currentStep();
    if ( trail.at(-1) !== here ) trail.push(here);
    if ( here.toLowerCase() === until.toLowerCase() ) {
      await settleRender();
      return here;
    }
    const next = document.querySelector('.creator-stage-foot [data-action="navNext"]');
    if ( next && !next.disabled ) {
      next.click();
      await pause(900);
      continue;
    }
    const option = document.querySelector(`.creator-stage ${SELECTABLE}`);
    if ( !option ) break;
    option.click();
    await pause(600);
  }
  throw new Error(`walkTo("${until}") ended on "${currentStep()}". Screens seen: ${trail.join(" → ")}`
    + `. Rail: ${railLabels().join(" | ")}`);
}

/** The step names in the rail, in order — the level-up rail is horizontal along the top. */
function railLabels() {
  return [...document.querySelectorAll('[data-action="goto"]')].map(el => el.textContent.trim());
}

/**
 * Jump to a named step by clicking its rail entry.
 *
 * Only works once that step is reachable (the rail refuses a step whose predecessors are
 * unanswered), so it pairs with {@link walkTo}: walk to the end once, then jump freely.
 */
export async function gotoRail(label) {
  const entry = [...document.querySelectorAll('[data-action="goto"]')]
    .find(el => el.textContent.trim().toLowerCase().includes(label.toLowerCase()));
  if ( !entry ) throw new Error(`no rail entry matching "${label}". Rail: ${railLabels().join(" | ")}`);
  entry.click();
  await pause(900);
  await settleRender();
  return currentStep();
}

/** Close every open application, so one picture never has the last one's window in it. */
export async function closeAll() {
  // The staged chat card (see {@link creationCard}) is not an application; it goes with them.
  document.getElementById("sogrom-shot-chat")?.remove();
  document.querySelectorAll(".sogrom-shot-target").forEach(el => el.classList.remove("sogrom-shot-target"));
  // Foundry's own interface (the sidebar and its tabs, chat, hotbar…) is everything reachable from
  // `ui`, and is left alone: closing it and rendering it back fails ("Failed to render Sidebar tab
  // chat"), which is what stopped the right-click shot. hooks.mjs `closeAll` learned the same.
  const core = new Set(Object.values(ui).filter(v => v && (typeof v === "object")));
  const closeOne = async app => {
    if ( !app || core.has(app) || (typeof app.close !== "function") ) return;
    await Promise.resolve(app.close({ force: true })).catch(() => {});
  };
  for ( const app of Object.values(ui.windows ?? {}) ) await closeOne(app);
  for ( const app of [...foundry.applications.instances.values()] ) await closeOne(app);
  shell = null;
  await pause(400);
  return true;
}

/* -------------------------------------------- */
/*  The entry screens                           */
/* -------------------------------------------- */

/**
 * Open one of the three entry overlays: the chooser, Quick Build, or Ready-made.
 *
 * Driven through `_openEntry` rather than by setting the private field, because opening the
 * threshold *seeds* it — `seedThreshold` resolves three origins and their ability increases — and a
 * screenshot of an unseeded threshold is three empty slots, which is the wizard it exists to
 * replace.
 * @param {"chooser"|"threshold"|"premade"} view
 */
export async function entry(arg = "chooser") {
  // One argument, because the screenshot runner's `call` passes exactly one. A bare string is the
  // common case ("open the chooser"); an object carries the pinned origins.
  const { view = "chooser", species = null, background = null } =
    (typeof arg === "string") ? { view: arg } : (arg ?? {});
  const app = shell ?? liveShell();
  await app._openEntry(view);

  // The threshold seeds a *random* species — "every installed species is somebody's favourite" —
  // which is right for a player and wrong for a screenshot: the picture changes every run, and it
  // can land on art we would rather not put in the README. Pin it after the seed rather than
  // reaching into the seeding itself, so the shot still shows whatever that screen really renders.
  if ( species || background ) {
    const { source } = getSources();
    const find = (cards, name) => cards.find(c => c.name?.toLowerCase() === name.toLowerCase())
      ?? cards.find(c => c.name?.toLowerCase().includes(name.toLowerCase()));
    if ( species ) {
      const card = find(source.species(), species);
      if ( !card ) throw new Error(`no species matching "${species}"`);
      app.state.speciesUuid = card.uuid;
      app.state.originAsi.species = await source.abilityScoreIncrease(card.uuid);
    }
    if ( background ) {
      const card = find(source.backgrounds(), background);
      if ( !card ) throw new Error(`no background matching "${background}"`);
      app.state.backgroundUuid = card.uuid;
      app.state.originAsi.background = await source.abilityScoreIncrease(card.uuid);
    }
  }

  await settleRender();
  // The entry screens are the art-led ones: every card carries a banner browsed from a content
  // module, and a picture taken before those decode is a screenshot of empty frames.
  await pause(1200);
  await settleRender();
  return true;
}

/**
 * Select a ready-made character without taking it, so the card shows its chosen state.
 *
 * Selecting is deliberately not taking — a second, explicit press creates — so this is the state
 * the screen actually sits in while a player reads the character they are considering.
 */
export async function premadeSelect({ index = 0 } = {}) {
  const cards = [...document.querySelectorAll('[data-action="entryPremade"]')];
  const card = cards[index];
  if ( !card ) throw new Error(`no ready-made card at index ${index} (found ${cards.length})`);
  card.click();
  await settleRender();
  await pause(600);
  return card.dataset.id ?? true;
}

/**
 * Take one of the chooser's three paths, exactly as pressing its button does.
 *
 * `"custom"` is the one the wizard shots need: the creator now *opens* on the chooser, so a shot
 * list that called `openCreator` and then `goto("class")` changed the step underneath while the
 * overlay stayed up — and, because the shots run against one open creator, every picture from that
 * point on was of the chooser rather than the screen it was captioned as. Driving the real action
 * is better than dismissing the overlay by hand: it is what a player does, and it leaves the same
 * "way back" state they would have.
 * @param {"custom"|"quick"|"premade"} path
 */
export async function entryPath(path = "custom") {
  await (shell ?? liveShell())._entryPath(path);
  await settleRender();
  return true;
}

/**
 * Dismiss whatever overlay is covering the stage — an entry screen, the comparison grid or a
 * rulebook page — leaving the step underneath. The shots run against one open creator, so a shot
 * that opens an overlay would otherwise leave it in every picture that follows.
 */
export async function closeOverlays() {
  const app = shell ?? liveShell();
  await app._openEntry(null);
  app._closeCompare?.();
  app._closeSourceDetails?.();
  await settleRender();
  return true;
}

/* -------------------------------------------- */
/*  Compare                                     */
/* -------------------------------------------- */

/**
 * Pin a few options in a category and open the comparison grid.
 *
 * Pins are written through the shell's own `PinSet` rather than by clicking each scales icon: the
 * icons live on cards inside the picker drawer, and driving three of them through re-renders is a
 * lot of machinery for a state the set can simply be told to hold.
 * @param {{category?: string, count?: number}} options
 */
export async function compare({ category = "class", count = 3 } = {}) {
  const app = shell ?? liveShell();
  const { source } = getSources();
  const cards = ({
    class: () => source.classes(),
    species: () => source.species(),
    background: () => source.backgrounds()
  })[category]?.() ?? [];

  // Prefer the Player's Handbook copies, for the same reason `choose` does — the artwork.
  const preferred = cards.filter(c => c.uuid.includes("dnd-players-handbook"));
  for ( const card of (preferred.length >= count ? preferred : cards).slice(0, count) ) {
    app.pins.toggle(category, card.uuid);
  }
  await app._openCompare(category);
  await settleRender();
  await pause(800);
  return true;
}

/* -------------------------------------------- */
/*  The magic item shop                         */
/* -------------------------------------------- */

/**
 * Turn the magic shop on and stock it, so its step has something to show.
 *
 * The shop ships **empty** — stocking it is the GM's job, and an unstocked shop renders its "ask
 * your GM to stock it" empty state. Stock is written straight into the setting through the module's
 * own `magicEntryFromItem`, so the rows are shaped exactly as a drag-and-drop would leave them
 * rather than by a second, divergent implementation of that mapping.
 *
 * The wealth table is left at its DMG default (there is no on/off switch; a level whose row grants
 * nothing has no step), so only `targetLevel` decides whether the step appears.
 * @param {{packs?: string[], limit?: number}} options
 */
export async function stockMagicShop({ packs = null, limit = 60 } = {}) {
  const wanted = packs ?? ["dnd-dungeon-masters-guide.items", "dnd5e.items24", "dnd5e.items"];
  const inventory = [];
  for ( const packId of wanted ) {
    const pack = game.packs?.get(packId);
    if ( !pack ) continue;
    const index = await pack.getIndex({ fields: ["system.rarity", "system.type.value"] });
    for ( const entry of index ) {
      // Only items with a rarity are magic items — the same test the drop handler applies.
      if ( !entry.system?.rarity ) continue;
      inventory.push(magicEntryFromItem(entry, `Compendium.${packId}.Item.${entry._id}`));
      if ( inventory.length >= limit ) break;
    }
    if ( inventory.length >= limit ) break;
  }
  if ( !inventory.length ) throw new Error(`no magic items found in ${wanted.join(", ")}`);

  const current = game.settings.get(MODULE_ID, SETTINGS.magicShopConfig) ?? {};
  await game.settings.set(MODULE_ID, SETTINGS.magicShopConfig, { ...current, inventory });
  return inventory.length;
}

/**
 * Put the creator on a starting level the wealth table actually grants something at.
 *
 * The magic-item step stands down on a level whose row gives nothing, so a picture of it needs a
 * level inside the DMG's bands — 5th, which grants both gold and a couple of item slots.
 */
export async function startAtLevel(level = 5) {
  const app = shell ?? liveShell();
  app.state.targetLevel = level;
  await settleRender();
  return app.state.targetLevel;
}

/**
 * Roll the bonus gold, open the shelves and take a few of the free slots.
 *
 * The groups start **collapsed** (all but a lone one), and a collapsed group renders no pick
 * buttons at all — so this has to open them before it can take anything. The first version of this
 * helper went straight for the buttons, found none, and produced a picture of an empty shelf under
 * four shut headings, which is the least useful shot of this screen it is possible to take.
 */
export async function pickMagicItems({ count = 3, roll = true } = {}) {
  if ( roll ) {
    document.querySelector('[data-step-action="magic-roll"]')?.click();
    await settleRender();
    await pause(600);
  }

  // Re-query every pass. The click re-renders the shelf, so a list collected up front is detached
  // after the first one and the remaining groups stay shut — the same reason `shop` re-queries.
  // The guard is the group key, not the node: the keys are stable across renders, the nodes are not.
  const opened = new Set();
  for ( let i = 0; i < 12; i++ ) {
    const toggle = [...document.querySelectorAll('[data-step-action="magic-group"][aria-expanded="false"]')]
      .find(el => !opened.has(el.dataset.group));
    if ( !toggle ) break;
    opened.add(toggle.dataset.group);
    toggle.click();
    await settleRender();
  }

  const taken = new Set();
  for ( let i = 0; i < count; i++ ) {
    const button = [...document.querySelectorAll('[data-step-action="magic-add"]:not([disabled])')]
      .find(el => !taken.has(el.dataset.uuid));
    if ( !button ) break;
    taken.add(button.dataset.uuid);
    button.click();
    await settleRender();
  }
  // Always settle, even when nothing was taken: this step loads its index asynchronously and
  // re-renders when it lands, which puts back the `#{VERSION}#` pill `depersonalise` had hidden.
  await settleRender();
  return taken.size;
}

/** The GM's magic-shop configuration window. */
export async function magicShopConfig() {
  await closeAll();
  await new MagicShopConfigApp().render(true);
  await pause(1800);
  return true;
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Re-render and give Handlebars, the images and the fonts a moment to land. */
async function settleRender() {
  await (shell ?? liveShell())?.render();
  await pause(700);
  await document.fonts.ready;
  // Card art is lazy: wait for every <img> currently in the stage to have decoded, so no picture
  // is taken with half its portraits still grey.
  const images = [...document.querySelectorAll(".creator-stage img, .sogrom-creator-fullscreen img")];
  await Promise.all(images.map(img => img.complete ? null : img.decode().catch(() => null)));
  depersonalise();
  await pause(300);
}

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Small seeded PRNG, so Quick Build's random species/name are reproducible across runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
