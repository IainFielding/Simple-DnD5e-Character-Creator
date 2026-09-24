/**
 * End-to-end check of building into a blank character the GM prepared (`scripts/app/blank-build.mjs`).
 *
 * The feature exists for a player who may not create actors, so the claims worth pinning are about
 * *where the character lands* and *what the button does*, neither of which a unit test can see:
 *
 *   1. The gate, on real documents: a blank owned character qualifies; one holding a class, species
 *      or background does not; other items don't block it.
 *   2. The three entry points exist on a blank sheet and vanish once it is built — the gold header
 *      button, the ⋯ header control and the sidebar's right-click entry.
 *   3. Clicking the button opens the creator *on that actor*, and Create builds into it: no second
 *      actor appears, the sheet keeps its id, ownership and non-origin items, and gains exactly one
 *      class, species and background.
 *   4. It works without the Create Actor permission, which is the reason it exists.
 *   5. A build that fails part-way puts the sheet back as it was, so a retry does not stack a second
 *      class onto a half-built one.
 *   6. Ready-made into a blank sheet fills that sheet rather than creating an actor, and the pregen's
 *      advancements still find the items they granted (the `keepId` import).
 *
 * Runs as the GM, so ownership is always satisfied. Case 4 stubs `game.user.can("ACTOR_CREATE")` to
 * false for its duration, which is the one permission the feature has to route around; a real player
 * login is still worth a manual check.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";

const { canBuildInto, buildInto } = await import(`${MODULE}/app/blank-build.mjs`);
const { applyQuickBuild } = await import(`${MODULE}/data/quick-build.mjs`);
const { getSources } = await import(`${MODULE}/data/source-cache.mjs`);
const { MODULE_ID, t } = await import(`${MODULE}/config.mjs`);
const { REQUIRED_STEPS } = await import(`${MODULE}/steps/registry.mjs`);
const { foundryPregens } = await import(`${MODULE}/data/premades.mjs`);
const { takePregen } = await import(`${MODULE}/app/entry-chooser.mjs`);
const { canRepair } = await import(`${MODULE}/levelup/repair.mjs`);

/** Every actor this file builds carries the harness prefix, so `cleanup()` reclaims them. */
const PREFIX = "[e2e] ";
const ORIGINS = ["class", "race", "background"];

const pause = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Close every non-core window, so cases cannot bleed into each other. See hooks.mjs `closeAll`. */
async function closeAll() {
  const core = new Set(Object.values(ui).filter(v => v && (typeof v === "object")));
  for ( const app of [...(foundry.applications.instances?.values() ?? [])] ) {
    if ( !app || core.has(app) || (typeof app.close !== "function") ) continue;
    await Promise.resolve(app.close({ force: true })).catch(() => {});
  }
  await pause(200);
}

/** A blank character, with a non-origin item on it the build must leave alone. */
async function makeBlank(name, { withLoot = true } = {}) {
  const actor = await Actor.implementation.create({
    name,
    type: "character",
    // A default level for everyone, so "ownership was left alone" has something to compare.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }
  }, { renderSheet: false });
  if ( withLoot ) {
    await actor.createEmbeddedDocuments("Item", [{ name: "GM's Pouch", type: "loot" }], { render: false });
  }
  return actor;
}

/** The creator window open on a given actor, polling until it appears and has loaded. */
async function shellFor(actor, timeout = 420_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    for ( const app of foundry.applications.instances?.values() ?? [] ) {
      if ( (app.constructor?.name === "CreatorShell") && (app.state?.actor?.id === actor.id) ) {
        const stage = app.element?.querySelector(".creator-stage");
        if ( stage && !stage.querySelector(".creator-loading") ) return app;
      }
    }
    await pause(300);
  }
  return null;
}

/** Fill a Fighter with the real Quick Build, as hooks.mjs does. Throws with the missing step. */
async function fill(shell) {
  const { source, spells, equipment } = getSources();
  const classes = source.classes();
  const pick = classes.find(c => (c.name === "Fighter") && c.uuid.includes("dnd-players-handbook"))
    ?? classes.find(c => c.name === "Fighter") ?? classes[0];
  if ( !pick ) throw new Error("no classes in the world's compendiums");
  shell.state.classUuid = pick.uuid;
  const result = await applyQuickBuild({ state: shell.state, source, spells, equipment }, { rng: () => 0.42 });
  if ( !result?.ok ) throw new Error(`quick build did not fill: ${result?.warnings?.join(", ") || "no reason"}`);
  shell.state.details.name = shell.state.actor.name;
  shell.state.targetLevel = 1;
  // The party switch is on by default; a world with a party would otherwise gain members.
  shell.state.joinParty = false;
  for ( const id of ["details", "review"] ) {
    if ( !shell.gotoStep(id) ) throw new Error(`could not reach the "${id}" step`);
  }
  await pause(300);
  const incomplete = REQUIRED_STEPS.filter(s => !s.isComplete(shell.state)).map(s => s.id);
  if ( incomplete.length ) throw new Error(`incomplete after quick build: ${incomplete.join(", ")}`);
}

/** How many of each origin type the actor holds. */
function originCounts(actor) {
  return Object.fromEntries(ORIGINS.map(type => [type, actor.items.filter(i => i.type === type).length]));
}

/** Render the actor's sheet and return its root element once it is in the DOM. */
async function renderSheet(actor) {
  await actor.sheet.render(true);
  const started = Date.now();
  while ( (Date.now() - started) < 20_000 ) {
    if ( actor.sheet.rendered && actor.sheet.element ) return actor.sheet.element;
    await pause(200);
  }
  throw new Error("the character sheet never rendered");
}

/**
 * Right-click the actor in the real Actors sidebar and read the labels of the menu Foundry draws.
 *
 * A real right-click, not a call to the hook: the directory asks for its entries once, at its first
 * render, so an entry registered too late is absent from the menu even though calling the hook by
 * hand would still return it. That is exactly how the first version of this test was fooled.
 * @returns {Promise<string[]|null>}  The menu's labels, or null if the actor has no sidebar row.
 */
async function sidebarMenu(actor) {
  await ui.sidebar?.changeTab?.("actors", "primary");
  await ui.actors.render();
  await pause(300);
  const li = ui.actors.element?.querySelector(`.directory-item[data-entry-id="${actor.id}"]`);
  if ( !li ) return null;
  const box = li.getBoundingClientRect();
  li.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true, cancelable: true, button: 2, clientX: box.left + 5, clientY: box.top + 5
  }));
  const item = "#context-menu .context-item";
  const opened = await (async () => {
    for ( let i = 0; i < 25; i++ ) { if ( document.querySelector(item) ) return true; await pause(200); }
    return false;
  })();
  const labels = opened ? [...document.querySelectorAll(item)].map(el => el.textContent.trim()) : [];
  await ui.context?.close?.({ animate: false });
  await pause(200);
  return labels;
}

/**
 * Every item id an advancement on this actor says it granted, and whether each is present.
 *
 * `value.added` is `{itemId: uuid}` for an ItemGrant and `{level: {itemId: uuid}}` for an
 * ItemChoice. Either way the ids are keys whose values are uuid strings.
 */
function orphanedGrants(actor) {
  const missing = [];
  const walk = (added, where) => {
    for ( const [key, val] of Object.entries(added ?? {}) ) {
      if ( typeof val === "string" ) { if ( !actor.items.get(key) ) missing.push(`${where}: ${key} (${val})`); }
      else if ( val && (typeof val === "object") ) walk(val, where);
    }
  };
  for ( const item of actor.items ) {
    for ( const adv of item.system?.advancement ?? [] ) {
      walk(adv.value?.added, `${item.name} › ${adv.title || adv.constructor?.typeName || adv.type}`);
    }
  }
  return missing;
}

/* -------------------------------------------- */
/*  Cases                                       */
/* -------------------------------------------- */

/** 1. The gate, against real documents. */
async function gate(r, track) {
  const blank = track(await makeBlank(`${PREFIX}Blank gate`));
  if ( !canBuildInto(blank) ) r.failures.push("a blank owned character with only a loot item was refused");

  const npc = track(await Actor.implementation.create({ name: `${PREFIX}Blank npc`, type: "npc" }, { renderSheet: false }));
  if ( canBuildInto(npc) ) r.failures.push("an NPC was offered as a blank character");

  const { source } = getSources();
  const classUuid = source.classes()[0]?.uuid;
  const cls = classUuid ? await fromUuid(classUuid) : null;
  if ( !cls ) return r.failures.push("no class to put on the sheet");
  const withClass = track(await makeBlank(`${PREFIX}Blank with class`));
  await withClass.createEmbeddedDocuments("Item", [cls.toObject()], { render: false });
  if ( canBuildInto(withClass) ) r.failures.push("a character holding a class was still offered as blank");
  r.notes.push("blank accepted; NPC and class-holding character refused");
}

/** 2 + 3. The entry points, and a build through the sheet button. */
async function buildThroughButton(r, track) {
  const actor = track(await makeBlank(`${PREFIX}Blank build`));
  const countBefore = game.actors.size;
  const ownershipBefore = foundry.utils.deepClone(actor.ownership);

  const root = await renderSheet(actor);
  await pause(300);
  const button = root.querySelector(".sogrom-build-btn");
  if ( !button ) r.failures.push("no Build Character button on the blank sheet's header");

  // `_headerControlButtons()` is what fires `getHeaderControls*`; `_getHeaderControls()` alone
  // returns only the sheet's own declared controls.
  const controls = [...(actor.sheet._headerControlButtons?.() ?? [])];
  if ( !controls.some(c => c.action === "sogromBuildCharacter") ) {
    r.failures.push("no Build Character entry in the sheet's ⋯ menu");
  }
  const menu = await sidebarMenu(actor);
  if ( !menu ) r.failures.push("the blank character has no row in the Actors sidebar");
  else if ( !menu.includes(t("blankBuild.button")) ) {
    r.failures.push(`no Build Character in the sidebar's right-click menu (it offers: ${menu.join(", ") || "nothing"})`);
  }
  if ( !button ) return;

  button.click();
  const shell = await shellFor(actor);
  if ( !shell ) return r.failures.push("clicking the button did not open the creator on this actor");
  await fill(shell);
  await shell._finish(null);
  await pause(2500);
  await closeAll();

  if ( game.actors.size !== countBefore ) {
    r.failures.push(`the build created a new actor (${countBefore} → ${game.actors.size}) instead of filling the sheet`);
  }
  const counts = originCounts(actor);
  for ( const type of ORIGINS ) {
    if ( counts[type] !== 1 ) r.failures.push(`expected exactly one ${type} on the sheet, found ${counts[type]}`);
  }
  if ( !actor.items.some(i => i.name === "GM's Pouch") ) r.failures.push("the GM's non-origin item was removed");
  if ( actor.system.details?.level !== 1 ) r.failures.push(`built at level ${actor.system.details?.level}, not 1`);
  if ( actor.ownership?.default !== ownershipBefore.default ) r.failures.push("the sheet's ownership was changed");

  // The entry points are for blank sheets only; a built character must lose them.
  const after = await renderSheet(actor);
  await pause(300);
  if ( after.querySelector(".sogrom-build-btn") ) r.failures.push("the Build Character button survived the build");
  if ( (await sidebarMenu(actor))?.includes(t("blankBuild.button")) ) r.failures.push("the right-click entry survived the build");
  await closeAll();
  r.notes.push(`built ${actor.items.find(i => i.type === "class")?.name ?? "?"} into the same sheet; ${actor.items.size} items`);
}

/** 4. Without the Create Actor permission — the reason the feature exists. */
async function withoutCreatePermission(r, track) {
  const actor = track(await makeBlank(`${PREFIX}Blank no-create`));
  const realCan = game.user.can.bind(game.user);
  game.user.can = action => (action === "ACTOR_CREATE" ? false : realCan(action));
  try {
    const countBefore = game.actors.size;
    buildInto(actor);
    const shell = await shellFor(actor);
    if ( !shell ) return r.failures.push("the creator refused to open without Create Actor permission");
    await fill(shell);
    await shell._finish(null);
    await pause(2500);
    await closeAll();
    if ( game.actors.size !== countBefore ) r.failures.push("a build without Create Actor permission tried to create an actor");
    if ( originCounts(actor).class !== 1 ) r.failures.push("the character was not built without Create Actor permission");
    else r.notes.push("built with ACTOR_CREATE denied");
  } finally {
    game.user.can = realCan;
  }
}

/** 5. A failed build puts the sheet back; the retry builds exactly one character. */
async function rollbackAndRetry(r, track) {
  const actor = track(await makeBlank(`${PREFIX}Blank rollback`));
  const idsBefore = new Set(actor.items.map(i => i.id));
  buildInto(actor);
  const shell = await shellFor(actor);
  if ( !shell ) return r.failures.push("the creator did not open");
  await fill(shell);

  // Fail at the write straight after the driver commits the new items: the "created" flag. An
  // instance property shadows the prototype method for this one actor only.
  let tripped = false;
  actor.setFlag = async function(scope, key, ...rest) {
    if ( !tripped && (scope === MODULE_ID) && (key === "created") ) { tripped = true; throw new Error("e2e: forced failure"); }
    return Actor.implementation.prototype.setFlag.call(this, scope, key, ...rest);
  };
  try {
    await shell._finish(null);
    await pause(1500);
  } finally {
    delete actor.setFlag;
  }
  if ( !tripped ) return r.failures.push("the forced failure never tripped; the assembler no longer writes the created flag there");

  const leftover = actor.items.filter(i => !idsBefore.has(i.id)).map(i => i.name);
  if ( leftover.length ) r.failures.push(`the failed build left ${leftover.length} item(s) behind: ${leftover.slice(0, 5).join(", ")}`);
  if ( !actor.items.some(i => i.name === "GM's Pouch") ) r.failures.push("rollback removed the GM's own item");
  if ( !canBuildInto(actor) ) r.failures.push("after rollback the sheet is no longer blank");

  // The window stayed open for a retry, as it does after any failed build.
  await shell._finish(null);
  await pause(2500);
  await closeAll();
  const counts = originCounts(actor);
  for ( const type of ORIGINS ) {
    if ( counts[type] !== 1 ) r.failures.push(`after the retry: expected one ${type}, found ${counts[type]}`);
  }
  if ( !r.failures.length ) r.notes.push("failed build rolled back cleanly; retry built one character");
}

/** 6. Ready-made into a blank sheet. */
async function readyMadeInto(r, track) {
  const groups = await foundryPregens();
  const entry = groups.find(g => g.pack === "dnd5e.actors24")?.entries?.[0] ?? groups[0]?.entries?.[0];
  if ( !entry ) return r.failures.push("no pregens in the world");
  const source = (await fromUuid(entry.uuid)).toObject();

  for ( const [label, name, keepsName] of [
    ["named sheet", `${PREFIX}Blank ready-made`, true],
    // Foundry's own default name: the pregen's name should replace it.
    ["default-named sheet", Actor.implementation.defaultName({ type: "character" }), false]
  ] ) {
    const actor = track(await makeBlank(name));
    const countBefore = game.actors.size;
    buildInto(actor);
    const shell = await shellFor(actor);
    if ( !shell ) { r.failures.push(`${label}: the creator did not open`); continue; }
    await takePregen(shell._ctx(), entry.uuid);
    await pause(2000);
    await closeAll();

    if ( game.actors.size !== countBefore ) r.failures.push(`${label}: importing created a new actor`);
    const want = new Map();
    for ( const i of source.items ?? [] ) want.set(i.name, (want.get(i.name) ?? 0) + 1);
    const got = new Map();
    for ( const i of actor.toObject().items ) got.set(i.name, (got.get(i.name) ?? 0) + 1);
    for ( const [n, c] of want ) {
      if ( (got.get(n) ?? 0) !== c ) r.failures.push(`${label}: "${n}" expected ×${c}, got ×${got.get(n) ?? 0}`);
    }
    if ( !actor.items.some(i => i.name === "GM's Pouch") ) r.failures.push(`${label}: the GM's item was removed`);
    const orphans = orphanedGrants(actor);
    if ( orphans.length ) r.failures.push(`${label}: ${orphans.length} advancement grant(s) point at missing items: ${orphans.slice(0, 3).join("; ")}`);
    if ( canRepair(actor) ) r.failures.push(`${label}: the imported character reports an unanswered choice`);
    for ( const [key, val] of Object.entries(source.system?.abilities ?? {}) ) {
      if ( actor._source.system.abilities?.[key]?.value !== val?.value ) r.failures.push(`${label}: ability ${key} not copied`);
    }
    const expectedName = keepsName ? name : source.name;
    if ( actor.name !== expectedName ) r.failures.push(`${label}: named "${actor.name}", expected "${expectedName}"`);
  }
  if ( !r.failures.length ) r.notes.push(`${entry.name} imported into two blank sheets; every grant still resolves`);
}

/* -------------------------------------------- */

/** Run every case. Each tracks what it creates and deletes it, whatever its name ends up as. */
export async function checkBlankBuild() {
  await closeAll();
  // Actor builds never write a draft, but a stale one from another suite would not matter either;
  // cleared anyway so no modal can appear.
  await game.user?.unsetFlag(MODULE_ID, "creatorDraft").catch(() => {});
  const cases = [
    ["The gate, on real documents", gate],
    ["Entry points, and a build through the sheet button", buildThroughButton],
    ["Without the Create Actor permission", withoutCreatePermission],
    ["A failed build rolls back; the retry builds once", rollbackAndRetry],
    ["Ready-made into a blank sheet", readyMadeInto]
  ];
  const results = [];
  const failures = [];
  for ( const [label, fn] of cases ) {
    const r = { label, failures: [], notes: [] };
    const made = [];
    const track = actor => { made.push(actor.id); return actor; };
    try {
      await fn(r, track);
    } catch ( err ) {
      r.failures.push(`threw: ${err.message}`);
    } finally {
      await closeAll();
      const ids = made.filter(id => game.actors.get(id));
      if ( ids.length ) await Actor.implementation.deleteDocuments(ids, { render: false }).catch(() => {});
    }
    r.ok = !r.failures.length;
    results.push(r);
    for ( const f of r.failures ) failures.push(`${label}: ${f}`);
  }
  return { ok: !failures.length, failures, cases: results };
}
