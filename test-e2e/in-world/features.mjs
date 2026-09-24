/**
 * End-to-end checks for the 3.3.0 creation features that unit tests can only reach through stubs:
 *
 *   1. **Add to party, from the Review page.** The switch renders on Review for a party owner, toggles
 *      through a real click, and Create honours it both ways against a real group actor.
 *   2. **Add to party, from the chat card.** A real creation card renders its button through
 *      `dnd5e.renderChatMessage`, names the party, adds on click, and reads "In …" afterwards and on a
 *      fresh render. It is removed for a non-owner and when the world has no primary party.
 *   3. **Suggest for {class}.** The button is on the ability panel for a chosen class, and a real click
 *      lays point buy and the standard array out in the class's priority order. Absent before a roll.
 *   4. **Class guide.** Complexity pips and role lines on the class drawer's rows, matching the PHB
 *      table, and the guide line on the quick screen's class card.
 *   5. **The quick screen keeps a typed name.** A name typed into the box (an `input` event, as a
 *      keyboard produces) is the name the character is created with.
 *
 * The world's primary party and the creation-card setting are changed for the run and put back.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";

const { CreatorShell } = await import(`${MODULE}/app/creator-shell.mjs`);
const { applyQuickBuild } = await import(`${MODULE}/data/quick-build.mjs`);
const { getSources } = await import(`${MODULE}/data/source-cache.mjs`);
const { MODULE_ID, SETTINGS, launchWindowOptions } = await import(`${MODULE}/config.mjs`);
const { REQUIRED_STEPS } = await import(`${MODULE}/steps/registry.mjs`);
const { resolveArtFor, invalidateArtCache } = await import(`${MODULE}/data/art-cache.mjs`);
const { triggerLevelUp } = await import(`${MODULE}/levelup/intercept.mjs`);

const PREFIX = "[e2e] ";
const pause = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Close every non-core window. See hooks.mjs `closeAll` for why core windows are spared. */
async function closeAll() {
  const core = new Set(Object.values(ui).filter(v => v && (typeof v === "object")));
  for ( const app of [...(foundry.applications.instances?.values() ?? [])] ) {
    if ( !app || core.has(app) || (typeof app.close !== "function") ) continue;
    await Promise.resolve(app.close({ force: true })).catch(() => {});
  }
  await pause(200);
}

/** Resolve once the creator's stage has real content rather than its loading spinner. */
async function waitForStage(shell, timeout = 420_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    const el = shell.element?.querySelector(".creator-stage");
    if ( el && !el.querySelector(".creator-loading") ) return;
    await pause(300);
  }
  throw new Error("creator stage never finished loading");
}

/** Wait until `test()` holds, re-checking after each render tick. */
async function until(test, timeout = 15_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    if ( await test() ) return true;
    await pause(150);
  }
  return false;
}

/** A class card by name, preferring the PHB's copy. */
function classCard(name) {
  const classes = getSources().source.classes();
  return classes.find(c => (c.name === name) && c.uuid.includes("dnd-players-handbook"))
    ?? classes.find(c => c.name === name) ?? null;
}

/** A creator window opened straight onto the class step with a class chosen (no entry screen). */
async function openOnClass(className) {
  await closeAll();
  await game.user?.unsetFlag(MODULE_ID, "creatorDraft").catch(() => {});
  const shell = new CreatorShell(null, launchWindowOptions());
  const card = classCard(className);
  if ( !card ) throw new Error(`no ${className} class in the world`);
  // Chosen before the first render, so the entry chooser (offered only with nothing picked) stays away.
  shell.state.classUuid = card.uuid;
  await shell.render(true);
  await waitForStage(shell);
  return shell;
}

/** Fill the rest with the real Quick Build and walk to Review, as hooks.mjs does. */
async function fillToReview(shell, name) {
  const { source, spells, equipment } = getSources();
  const result = await applyQuickBuild({ state: shell.state, source, spells, equipment }, { rng: () => 0.42 });
  if ( !result?.ok ) throw new Error(`quick build did not fill: ${result?.warnings?.join(", ") || "no reason"}`);
  shell.state.details.name = name;
  shell.state.targetLevel = 1;
  for ( const id of ["details", "review"] ) {
    if ( !shell.gotoStep(id) ) throw new Error(`could not reach the "${id}" step`);
  }
  await waitForStage(shell);
  await pause(300);
  const incomplete = REQUIRED_STEPS.filter(s => !s.isComplete(shell.state)).map(s => s.id);
  if ( incomplete.length ) throw new Error(`incomplete after quick build: ${incomplete.join(", ")}`);
}

/** The actor a build just made, found by diffing the directory (never by name alone). */
function newActor(before, name) {
  return game.actors.find(a => !before.has(a.id) && (a.name === name)) ?? null;
}

/** The creation card posted for an actor, newest first. */
function creationCard(actor) {
  return [...game.messages].reverse().find(m =>
    (m.getFlag(MODULE_ID, "summary") === "creation") && (m.speaker?.actor === actor.id)) ?? null;
}

/** Render a message the way the chat log does, and return its party button (or null). */
async function partyButton(message) {
  const html = await message.renderHTML();
  return html?.querySelector?.("[data-sogrom-party-actor]") ?? null;
}

/* -------------------------------------------- */
/*  Cases                                       */
/* -------------------------------------------- */

/** 1. The Review switch, and Create honouring it both ways. */
async function partyFromReview(r, ctx) {
  for ( const join of [true, false] ) {
    const name = `${PREFIX}Party review ${join ? "on" : "off"}`;
    const shell = await openOnClass("Fighter");
    await fillToReview(shell, name);

    const toggle = () => shell.element.querySelector('[data-step-action="toggle-party"]');
    if ( !toggle() ) { r.failures.push("no party switch on the Review page for the party's owner"); await closeAll(); return; }
    if ( !toggle().textContent.includes(ctx.party.name) ) r.failures.push("the Review switch doesn't name the party");
    if ( shell.state.joinParty !== true ) r.failures.push("the party switch is not on by default");

    if ( !join ) {
      toggle().click();
      const off = await until(() => (shell.state.joinParty === false) && (toggle()?.getAttribute("aria-pressed") === "false"));
      if ( !off ) r.failures.push("clicking the Review switch didn't turn it off");
    }

    const before = new Set(game.actors.map(a => a.id));
    await shell._finish(null);
    await pause(2500);
    await closeAll();
    const actor = newActor(before, name);
    if ( !actor ) { r.failures.push(`the ${join ? "joining" : "non-joining"} build produced no actor`); continue; }
    ctx.made.push(actor.id);
    const member = ctx.party.system.members.ids.has(actor.id);
    if ( member !== join ) r.failures.push(`switch ${join ? "on" : "off"}: character ${member ? "joined" : "did not join"} the party`);
    ctx[join ? "joined" : "outside"] = actor;
  }
  if ( !r.failures.length ) r.notes.push(`switch on joined ${ctx.party.name}; switch off stayed out`);
}

/** 2. The chat card's button. */
async function partyFromCard(r, ctx) {
  const outside = ctx.outside;
  const joined = ctx.joined;
  if ( !outside || !joined ) return r.failures.push("case 1 did not leave the two characters this case needs");

  const joinedCard = creationCard(joined);
  const card = creationCard(outside);
  if ( !card || !joinedCard ) return r.failures.push("no creation card was posted (is the summary setting on?)");

  // A character who joined at Create already reads as a member.
  const spent = await partyButton(joinedCard);
  if ( !spent || spent.hidden || !spent.disabled ) r.failures.push("the joined character's card does not read as already in the party");

  let button = await partyButton(card);
  if ( !button || button.hidden ) return r.failures.push("the card shows no party button to the party's owner");
  if ( !button.textContent.includes(ctx.party.name) ) r.failures.push("the card's button doesn't name the party");
  // A detached render is not in the document; clicking still runs the listener the hook attached.
  button.click();
  const added = await until(() => ctx.party.system.members.ids.has(outside.id));
  if ( !added ) return r.failures.push("clicking the card's button did not add the character");
  if ( !(await until(() => button.disabled)) ) r.failures.push("the button stayed live after adding");

  button = await partyButton(card);
  if ( !button?.disabled || !button.textContent.includes(ctx.party.name) ) {
    r.failures.push("a fresh render of the card does not show the character as in the party");
  }

  // A viewer who doesn't own the party: shadow `isOwner` on the party for one render.
  Object.defineProperty(ctx.party, "isOwner", { value: false, configurable: true });
  try {
    if ( await partyButton(card) ) r.failures.push("the button is shown to someone who doesn't own the party");
  } finally {
    delete ctx.party.isOwner;
  }

  // A world with no primary party.
  await game.settings.set("dnd5e", "primaryParty", { actor: null });
  try {
    if ( await partyButton(card) ) r.failures.push("the button is shown with no primary party set");
  } finally {
    await game.settings.set("dnd5e", "primaryParty", { actor: ctx.party.id });
  }
  if ( !r.failures.length ) r.notes.push("card added the character; spent after; hidden from non-owners and without a party");
}

/**
 * 2b. The level-up-ready card's button. Its listener moved to `dnd5e.renderChatMessage` alongside the
 * party button's, so it gets the same proof: a real card, rendered the way the chat log renders it,
 * whose button opens the level-up wizard.
 */
async function levelUpReadyCard(r, ctx) {
  const actor = ctx.joined;
  if ( !actor ) return r.failures.push("case 1 did not leave a character to award XP to");
  const modeBefore = game.settings.get("dnd5e", "levelingMode");
  const noticeBefore = game.settings.get(MODULE_ID, SETTINGS.levelUpReadyNotice);
  if ( modeBefore === "noxp" ) await game.settings.set("dnd5e", "levelingMode", "xp");
  await game.settings.set(MODULE_ID, SETTINGS.levelUpReadyNotice, "gm");
  // The sheet's Level Up button: shown either way, lit only once the XP is there.
  const trophy = async () => {
    await actor.sheet.render(true);
    await until(() => actor.sheet.rendered && actor.sheet.element?.querySelector(".sogrom-levelup-btn"), 20_000);
    await pause(300);
    return actor.sheet.element?.querySelector(".sogrom-levelup-btn") ?? null;
  };
  try {
    const before = await trophy();
    if ( !before ) r.failures.push("no Level Up button on the sheet before the XP threshold");
    else if ( before.classList.contains("is-xp-ready") ) r.failures.push("the Level Up button is lit before the XP threshold");

    const threshold = actor.system.details.xp.max;
    await actor.update({ "system.details.xp.value": threshold });
    const lit = await trophy();
    if ( !lit?.classList.contains("is-xp-ready") ) r.failures.push("the Level Up button is not lit at the XP threshold");
    else if ( getComputedStyle(lit, "::before").content === "none" ) r.failures.push("the lit button draws no gold ring");
    else r.notes.push("sheet button unlit below the threshold, lit at it");

    // A milestone world: the button stays, unlit, however much XP the sheet carries.
    await game.settings.set("dnd5e", "levelingMode", "noxp");
    const milestone = await trophy();
    if ( !milestone ) r.failures.push("the Level Up button disappeared in a milestone world");
    else if ( milestone.classList.contains("is-xp-ready") ) r.failures.push("the Level Up button is lit in a milestone world");
    await game.settings.set("dnd5e", "levelingMode", "xp");
    await actor.sheet.close();
    const posted = await until(() => game.messages.some(m =>
      (m.getFlag(MODULE_ID, "summary") === "levelUpReady") && (m.speaker?.actor === actor.id)));
    if ( !posted ) return r.failures.push("no level-up-ready card after reaching the XP threshold");
    const card = [...game.messages].reverse().find(m =>
      (m.getFlag(MODULE_ID, "summary") === "levelUpReady") && (m.speaker?.actor === actor.id));
    const html = await card.renderHTML();
    const button = html.querySelector("[data-sogrom-levelup-actor]");
    if ( !button ) return r.failures.push("the level-up-ready card has no button");
    button.click();
    const opened = await until(() => [...(foundry.applications.instances?.values() ?? [])]
      .some(app => app.constructor?.name === "LevelUpShell"), 60_000);
    if ( !opened ) r.failures.push("clicking the card's Level Up button did not open the level-up wizard");
    else r.notes.push(`card posted at ${threshold} XP; its button opened the level-up wizard`);
  } finally {
    await closeAll();
    await game.settings.set(MODULE_ID, SETTINGS.levelUpReadyNotice, noticeBefore);
    await game.settings.set("dnd5e", "levelingMode", modeBefore);
  }
}

/** 3. Suggest for {class}, through real clicks. */
async function suggest(r) {
  const shell = await openOnClass("Wizard");
  const panel = () => shell.element.querySelector(".creator-abilities");
  const clickAction = async (selector, settle) => {
    const el = panel()?.querySelector(selector);
    if ( !el ) return false;
    el.click();
    return until(settle);
  };
  const button = () => panel()?.querySelector('[data-step-action="ability-suggest"]');

  // Point buy.
  await clickAction('[data-step-action="ability-method"][data-method="point-buy"]', () => shell.state.abilityMethod === "point-buy");
  await pause(300);
  if ( !button() ) { r.failures.push("no Suggest button on the ability panel with Wizard chosen"); await closeAll(); return; }
  if ( !button().textContent.includes("Wizard") ) r.failures.push("the Suggest button doesn't name the class");
  const intLabel = CONFIG.DND5E.abilities.int.label;
  if ( !(button().dataset.tooltip ?? "").includes(intLabel) ) r.failures.push("the Suggest tooltip doesn't list the order");
  const want = { int: 15, con: 14, dex: 13, wis: 12, cha: 10, str: 8 };
  const pb = await clickAction('[data-step-action="ability-suggest"]',
    () => Object.entries(want).every(([k, v]) => shell.state.pointBuy[k] === v));
  if ( !pb ) r.failures.push(`point buy after Suggest: ${JSON.stringify(shell.state.pointBuy)}`);

  // Standard array.
  await clickAction('[data-step-action="ability-method"][data-method="standard-array"]', () => shell.state.abilityMethod === "standard-array");
  await pause(300);
  const sa = await clickAction('[data-step-action="ability-suggest"]', () => {
    const scores = shell.state.resolvedScores();
    return Object.entries(want).every(([k, v]) => scores[k] === v);
  });
  if ( !sa ) r.failures.push(`standard array after Suggest: ${JSON.stringify(shell.state.resolvedScores())}`);

  // Roll, before rolling: nothing to arrange.
  shell.state.rolledPool = [];
  await clickAction('[data-step-action="ability-method"][data-method="roll"]', () => shell.state.abilityMethod === "roll");
  await pause(300);
  if ( button() ) r.failures.push("the Suggest button is offered before any roll");

  await closeAll();
  if ( !r.failures.length ) r.notes.push("point buy and standard array laid out INT > CON > DEX; absent before a roll");
}

/** 4. The class guide on the drawer rows and on the quick screen. */
async function classGuide(r) {
  const shell = await openOnClass("Fighter");
  const expected = { Fighter: 1, Rogue: 1, Wizard: 2, Cleric: 2, Bard: 3, Warlock: 3, Artificer: 3 };
  const seen = [];
  for ( const [name, pips] of Object.entries(expected) ) {
    const rows = [...shell.element.querySelectorAll(`.creator-drawer .creator-pickrow[data-name="${name}"]`)];
    if ( !rows.length ) {
      if ( name !== "Artificer" ) r.failures.push(`no ${name} row in the class drawer`);
      continue;
    }
    for ( const row of rows ) {
      const on = row.querySelectorAll(".creator-complexity i.is-on").length;
      const role = row.querySelector(".creator-pickrow-role")?.textContent.trim() ?? "";
      if ( on !== pips ) r.failures.push(`${name}${row.dataset.rules ? ` (${row.dataset.rules})` : ""}: ${on} pip(s), expected ${pips}`);
      if ( !role || role.includes("classGuide.") ) r.failures.push(`${name}: role line missing or untranslated ("${role}")`);
    }
    seen.push(`${name} ${pips}`);
  }

  // Layout: the pips sit under the icon, so the role line has the text column to itself.
  shell.element.querySelector('[data-action="openPicker"]')?.click();
  await until(() => shell.element.querySelector(".creator-drawer.is-open"));
  await pause(400);
  // Both editions list a Wizard; the drawer's edition filter hides one, and a hidden row has no box.
  const row = [...shell.element.querySelectorAll('.creator-drawer .creator-pickrow[data-name="Wizard"]')]
    .find(el => el.getBoundingClientRect().width > 0);
  const img = row?.querySelector(".creator-pickrow-img")?.getBoundingClientRect();
  const dots = row?.querySelector(".creator-complexity")?.getBoundingClientRect();
  const role = row?.querySelector(".creator-pickrow-role")?.getBoundingClientRect();
  if ( !img?.width || !dots?.width || !role?.width ) r.failures.push("the Wizard row could not be measured (drawer not open?)");
  else {
    const centre = dots.left + (dots.width / 2);
    if ( dots.top < img.bottom - 1 ) r.failures.push(`pips are not below the icon (pips top ${dots.top}, icon bottom ${img.bottom})`);
    if ( (centre < img.left) || (centre > img.right) ) r.failures.push("pips are not centred under the icon");
    if ( role.left < img.right ) r.failures.push("the role line starts under the icon rather than in the text column");
    else seen.push("pips under the icon");
  }
  await closeAll();

  // The quick screen, reached through the chooser as a player would.
  const quick = new CreatorShell(null, launchWindowOptions());
  await quick.render(true);
  await waitForStage(quick);
  const path = quick.element.querySelector('[data-action="entryPath"][data-path="quick"]');
  if ( !path ) { r.failures.push("the chooser has no Quick path"); await closeAll(); return; }
  path.click();
  const card = () => quick.element.querySelector('.creator-threshold-card[data-category="class"]');
  if ( !(await until(() => card()?.querySelector(".creator-threshold-name")?.textContent.trim())) ) {
    r.failures.push("the quick screen never showed a class");
  } else {
    const shown = card().querySelector(".creator-threshold-name").textContent.trim();
    const guide = card().querySelector(".creator-threshold-guide");
    const known = Object.keys(expected).includes(shown);
    if ( known && !guide ) r.failures.push(`the quick screen's ${shown} card has no guide line`);
    else if ( guide ) seen.push(`quick card: ${shown}`);
  }
  await closeAll();
  if ( !r.failures.length ) r.notes.push(seen.join("; "));
}

/** 5. A typed name survives Quick Build's Create. */
async function quickTypedName(r, ctx) {
  await closeAll();
  const shell = new CreatorShell(null, launchWindowOptions());
  await shell.render(true);
  await waitForStage(shell);
  shell.element.querySelector('[data-action="entryPath"][data-path="quick"]')?.click();
  const input = () => shell.element.querySelector("#threshold-name");
  if ( !(await until(() => input() && shell.state.classUuid)) ) return r.failures.push("the quick screen never finished seeding");

  const typed = `${PREFIX}Typed Name`;
  // What a keyboard does: set the value and fire `input`, with no click on the box afterwards.
  input().value = typed;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  if ( shell.state.details.name !== typed ) r.failures.push(`typing reached the state as "${shell.state.details.name}"`);
  // The quick build's own party switch default would add this character; not what this case is about.
  shell.state.joinParty = false;

  const create = shell.element.querySelector('[data-action="thresholdCreate"]');
  if ( !create ) return r.failures.push("no Create Character button on the quick screen");
  const before = new Set(game.actors.map(a => a.id));
  create.click();
  const built = await until(() => game.actors.some(a => !before.has(a.id)), 120_000);
  await pause(2500);
  await closeAll();
  const actor = game.actors.find(a => !before.has(a.id));
  if ( actor ) ctx.made.push(actor.id);
  if ( !built || !actor ) return r.failures.push("Create Character built nothing");
  if ( actor.name !== typed ) r.failures.push(`created as "${actor.name}", not the typed "${typed}"`);
  else r.notes.push(`created as "${actor.name}"`);
}

/**
 * 6. Origin art for a player who can't browse files. Foundry withholds "Use File Browser" from
 * players by default, and the art lookup used to depend on it, so players saw icons where the GM saw
 * the book's art. The harness is the GM, so this case wears a player's permissions for its duration:
 * not a GM, and `FILES_BROWSE` refused. `FilePicker.browse` is watched, so a regression back to
 * browsing fails here rather than silently resolving nothing.
 */
async function artWithoutBrowse(r) {
  const { source } = getSources();
  const cls = classCard("Wizard");
  const bg = source.backgrounds().find(c => (c.identifier === "acolyte") && c.uuid.includes("dnd-players-handbook"));
  if ( !cls?.uuid.includes("dnd-players-handbook") || !bg ) return r.failures.push("the PHB's Wizard or Acolyte is not in this world");

  const Picker = foundry.applications.apps.FilePicker.implementation;
  const realBrowse = Picker.browse;
  const realCan = game.user.can.bind(game.user);
  let browsed = 0;
  Picker.browse = async (...args) => { browsed += 1; return realBrowse.apply(Picker, args); };
  Object.defineProperty(game.user, "isGM", { value: false, configurable: true });
  game.user.can = action => (action === "FILES_BROWSE" ? false : realCan(action));
  invalidateArtCache();
  try {
    const art = await resolveArtFor([{ card: cls, category: "class" }, { card: bg, category: "background" }]);
    for ( const [label, card] of [["Wizard", cls], ["Acolyte", bg]] ) {
      const found = art.get(card.uuid);
      if ( !found ) { r.failures.push(`no art resolved for the ${label} as a player`); continue; }
      // The answer has to be a real image, not merely a path that looked plausible.
      const response = await fetch(foundry.utils.getRoute(found.path));
      if ( !response.ok ) r.failures.push(`${label}: resolved ${found.path}, which does not load (${response.status})`);
      else r.notes.push(`${label}: ${found.path}`);
    }
    if ( browsed ) r.failures.push(`the lookup still browsed ${browsed} time(s) for a user who may not`);
  } finally {
    Picker.browse = realBrowse;
    game.user.can = realCan;
    delete game.user.isGM;
    invalidateArtCache();
  }

  // The Forge case, as the GM: every listing comes back empty although the files are served (Bazaar
  // packages live outside the plain `data` source). The art must still be found, file by file.
  Picker.browse = async () => ({ files: [], dirs: [] });
  invalidateArtCache();
  try {
    const art = await resolveArtFor([{ card: cls, category: "class" }, { card: bg, category: "background" }]);
    for ( const [label, card] of [["Wizard", cls], ["Acolyte", bg]] ) {
      if ( !art.get(card.uuid) ) r.failures.push(`GM with empty listings (as on The Forge): no art for the ${label}`);
    }
    if ( art.size === 2 ) r.notes.push("GM with empty listings (as on The Forge): both still resolved");
  } finally {
    Picker.browse = realBrowse;
    invalidateArtCache();
  }
}

/**
 * 7. "Maximum only" level-up hit points, through the real wizard. The Fighter from case 1 goes from
 * 1 to 2 (a level with no other decision), so nothing but the seed answers the hit points: the
 * screen must offer the Max button alone, and the applied level must add the full hit die plus Con.
 */
async function maxHitPoints(r, ctx) {
  const actor = ctx.outside;
  if ( !actor ) return r.failures.push("case 1 did not leave a Fighter to level");
  const before = game.settings.get(MODULE_ID, SETTINGS.levelUpHpMode);
  await game.settings.set(MODULE_ID, SETTINGS.levelUpHpMode, "max");
  try {
    const hpBefore = actor.system.attributes.hp.max;
    const levelBefore = actor.system.details.level;
    await closeAll();
    await triggerLevelUp(actor);
    const live = () => [...(foundry.applications.instances?.values() ?? [])].find(a => a.constructor?.name === "LevelUpShell");
    if ( !(await until(() => live(), 30_000)) ) return r.failures.push("no level-up wizard opened");
    const shell = live();
    if ( !shell.state.driver && shell.state.needsClassChoice ) {
      const classItem = actor.items.find(i => i.type === "class");
      await shell._dispatch("pick-levelup-class", { dataset: { kind: "existing", id: classItem?.id }, getAttribute: () => null });
    }
    if ( !(await until(() => shell.state.driver && shell.state.hpSteps?.length, 30_000)) ) {
      return r.failures.push("the wizard raised no hit-point decision");
    }
    const rec = shell.state.hpSteps[0];
    if ( rec.mode !== "max" ) r.failures.push(`the hit points started on "${rec.mode}", not the maximum`);

    await until(() => shell.element?.querySelector(".creator-hp-buttons"), 15_000);
    const actions = [...(shell.element?.querySelectorAll(".creator-hp-buttons [data-step-action]") ?? [])]
      .map(b => b.dataset.stepAction);
    if ( actions.join() !== "hpMax" ) r.failures.push(`the screen offers [${actions.join(", ")}], expected only the Max button`);
    if ( shell.state.hasPlayerInput() ) r.failures.push("an untouched maximum counts as unsaved changes");

    const expectedGain = Math.max(rec.advancement.hitDieValue + (shell.state.driver.clone.system.abilities.con.mod ?? 0), 1);
    await shell._finish();
    await until(() => actor.system.details.level === levelBefore + 1, 30_000);
    await pause(800);
    const gained = actor.system.attributes.hp.max - hpBefore;
    if ( actor.system.details.level !== levelBefore + 1 ) r.failures.push("the level-up did not apply");
    else if ( gained !== expectedGain ) r.failures.push(`gained ${gained} HP, expected the maximum ${expectedGain}`);
    else r.notes.push(`level ${levelBefore} → ${levelBefore + 1}: +${gained} HP (full d${rec.advancement.hitDieValue} + Con)`);
  } finally {
    await closeAll();
    await game.settings.set(MODULE_ID, SETTINGS.levelUpHpMode, before);
  }
}

/* -------------------------------------------- */

export async function checkFeatures() {
  await closeAll();
  const summaryBefore = game.settings.get(MODULE_ID, SETTINGS.creationSummary);
  const partyBefore = game.actors.party?.id ?? null;
  const messagesBefore = new Set(game.messages.map(m => m.id));
  const party = await Actor.implementation.create({ name: `${PREFIX}Party`, type: "group" }, { renderSheet: false });
  const ctx = { party, made: [] };

  await game.settings.set(MODULE_ID, SETTINGS.creationSummary, "public");
  await game.settings.set("dnd5e", "primaryParty", { actor: party.id });

  const cases = [
    ["Add to party from the Review page", partyFromReview],
    ["Add to party from the chat card", partyFromCard],
    ["The level-up-ready card's button", levelUpReadyCard],
    ["Suggest for a class", suggest],
    ["Class guide on the drawer and the quick screen", classGuide],
    ["The quick screen keeps a typed name", quickTypedName],
    ["Origin art for a player who can't browse files", artWithoutBrowse],
    ["Maximum only level-up hit points", maxHitPoints]
  ];
  const results = [];
  const failures = [];
  try {
    for ( const [label, fn] of cases ) {
      const r = { label, failures: [], notes: [] };
      try {
        await fn(r, ctx);
      } catch ( err ) {
        r.failures.push(`threw: ${err.message}`);
      } finally {
        await closeAll();
      }
      r.ok = !r.failures.length;
      results.push(r);
      for ( const f of r.failures ) failures.push(`${label}: ${f}`);
    }
  } finally {
    await game.settings.set("dnd5e", "primaryParty", { actor: partyBefore });
    await game.settings.set(MODULE_ID, SETTINGS.creationSummary, summaryBefore);
    const ids = [...ctx.made, party.id].filter(id => game.actors.get(id));
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids, { render: false }).catch(() => {});
    const posted = game.messages.filter(m => !messagesBefore.has(m.id)).map(m => m.id);
    if ( posted.length ) await ChatMessage.implementation.deleteDocuments(posted).catch(() => {});
  }
  return { ok: !failures.length, failures, cases: results };
}
