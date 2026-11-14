/**
 * End-to-end checks of "Update to New Content" (`scripts/content-update/`).
 *
 * **Rebuild is a no-op on unchanged content.** The strongest invariant the rebuild has: a character
 * built natively, then rebuilt against the very content it was built from, must come back exactly as
 * it was — same items, same ids, same advancement records, same derived numbers, same state. That
 * exercises every part of the rebuild that a real update uses (dnd5e's reversal of every advancement,
 * the fresh walk, answer harvesting and matching, id reconciliation, the state merge and the commit)
 * with a known right answer. The cases span the shapes that have bitten before: a 2024 class, Savant
 * choices, invocations, Arcane Trickster cantrips, expertise, metamagic, and 2014 classes carrying
 * Tasha's optional and replacement features.
 *
 * **Refresh in place keeps state and id.** An item whose definition is changed under it (standing in
 * for an older version) is refreshed back to its source, keeping its id, quantity and equipped state;
 * with *Keep mine* it is left alone.
 *
 * **Real old content** (PHB 2.1 → 3.0, dnd5e 6.0 → 6.1) is a separate suite: it needs the old packs
 * loaded as world compendia.
 */

const BUST = new URL(import.meta.url).search;
const { buildNative } = await import(`./native.mjs${BUST}`);
const { AnswerBook } = await import(`./answers.mjs${BUST}`);
const { sweepScenarios } = await import(`./sweep.mjs${BUST}`);
const { snapshot, diff } = await import(`./normalize.mjs${BUST}`);

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const { scanActor } = await import(`${MODULE}/content-update/scan.mjs`);
const { definitionGroups } = await import(`${MODULE}/content-update/fingerprint.mjs`);
const { rehearse, commitRehearsal } = await import(`${MODULE}/content-update/rebuild.mjs`);
const { repairTargets } = await import(`${MODULE}/levelup/repair.mjs`);

const PREFIX = "[e2e] ";

/** Scenario id fragment + level. The first scenario whose id contains the fragment is used. */
const NOOP_CASES = [
  { find: "sweep:fighter/champion", exact: true, level: 5 },
  { find: "sweep:wizard/conjurer", exact: true, level: 6 },
  { find: "sweep:warlock/archfey", level: 11 },
  { find: "sweep:rogue/arcane-trickster", level: 10 },
  { find: "sweep:bard/college-of-lore", level: 6 },
  { find: "sweep:sorcerer/draconic-sorcery", level: 10 },
  { find: "sweep:fighter/champion-dnd5e-subclasses", exact: true, level: 5 },
  { find: "sweep:ranger/hunter-dnd5e-subclasses", exact: true, level: 6 }
];

const settle = ms => new Promise(r => setTimeout(r, ms));

/**
 * Run the suite.
 * @param {object} [options]
 * @param {string} [options.only]   Run only cases whose label contains this text.
 */
export async function checkContentUpdate({ only = null } = {}) {
  const cases = [];
  const want = label => !only || label.toLowerCase().includes(String(only).toLowerCase());
  const byLevel = new Map();
  for ( const spec of NOOP_CASES ) {
    if ( !byLevel.has(spec.level) ) byLevel.set(spec.level, (await sweepScenarios({ level: spec.level, incremental: true })).scenarios);
    const scenario = byLevel.get(spec.level).find(s => spec.exact ? (s.id === spec.find) : s.id.startsWith(spec.find));
    const label = `rebuild is a no-op: ${spec.find.replace("sweep:", "")} at ${spec.level}`;
    if ( !want(label) ) continue;
    cases.push(scenario ? await runNoop(scenario, label) : { label, ok: false, error: `no scenario ${spec.find}`, differences: [] });
  }
  if ( want("refresh") ) cases.push(await runRefresh());
  for ( const spec of LEGACY_CASES ) {
    const label = `PHB ${spec.find.replace("sweep:", "")} at ${spec.level}: built on the legacy package, updated to the installed one`;
    if ( !want(label) || legacyMissing ) continue;
    if ( !byLevel.has(spec.level) ) byLevel.set(spec.level, (await sweepScenarios({ level: spec.level, incremental: true })).scenarios);
    const scenario = byLevel.get(spec.level).find(s => (s.id === spec.find) && s.classUuid?.startsWith(`Compendium.${LEGACY_PKG}.`));
    cases.push(scenario ? await runLegacy(scenario, label)
      : { label, ok: false, error: `no ${LEGACY_PKG} scenario ${spec.find}`, differences: [] });
  }
  if ( want("review window") && !legacyMissing ) {
    if ( !byLevel.has(5) ) byLevel.set(5, (await sweepScenarios({ level: 5, incremental: true })).scenarios);
    const scenario = byLevel.get(5).find(s => (s.id === "sweep:fighter/champion") && s.classUuid?.startsWith(`Compendium.${LEGACY_PKG}.`));
    if ( scenario ) cases.push(await runUi(scenario));
  }
  return { ok: cases.every(c => c.ok), cases };
}

/** A few bits of state the rebuild must carry: current hit points and a used-up feature. */
async function scribbleState(actor) {
  const marks = {};
  const hp = actor.system.attributes.hp;
  marks.hp = Math.max(1, (hp.max ?? 2) - 3);
  await actor.update({ "system.attributes.hp.value": marks.hp });
  const used = actor.items.find(i => (i.type === "feat") && Number(i.system?.uses?.max) >= 2);
  if ( used ) {
    marks.usesId = used.id;
    marks.spent = 1;
    await used.update({ "system.uses.spent": 1 });
  }
  return marks;
}

/** Build, rebuild against the same content, and compare. */
async function runNoop(scenario, label) {
  const out = { label, ok: false, error: null, differences: [], notes: [] };
  let actor = null;
  try {
    const origins = [scenario.speciesUuid, scenario.backgroundUuid, scenario.classUuid].filter(Boolean);
    const book = new AnswerBook({ overrides: scenario.answers ?? {}, generate: true, origins });
    actor = await buildNative({ ...scenario, name: `${PREFIX}content-update [${label}]`, incremental: true }, { book });
    await settle(500);
    const marks = await scribbleState(actor);
    await settle(300);

    const before = snapshot(actor);
    const beforeItems = actor.items.map(i => ({ id: i.id, src: i._stats?.compendiumSource ?? null, granted: !!i.flags?.dnd5e?.advancementOrigin }));
    const idsBefore = new Set(actor.items.map(i => i.id));
    const gapsBefore = repairTargets(actor).length;

    const scan = await scanActor(actor);
    const rehearsal = await rehearse(actor, { ...scan, needsRebuild: true });
    const asked = rehearsal.decisions.filter(d => d.status === "ask");
    for ( const d of asked ) out.notes.push(`not carried: ${d.title} (${d.host}, level ${d.level}) wanted ${d.wanted}; candidates: ${(d.candidates ?? []).join(" | ") || "none"}`);
    await commitRehearsal(rehearsal);
    await settle(1200);

    const after = snapshot(actor);
    // Two things the rebuild is allowed to change, reported as notes rather than failures: a feature
    // dnd5e granted twice over a level-by-level build comes back once (the second copy and its record
    // go), and an advancement the native walk wrote an empty `chosen: []` to is left without one.
    const dupSrcs = [...new Set(beforeItems.filter(i => dupIdsOf(beforeItems).includes(i.id)).map(i => i.src))];
    const allowed = d => dupSrcs.some(src => d.path.includes(src) || String(d.native).includes(src))
      || (d.path.startsWith("derived.itemsByType") && String(d.native).includes("×"))
      || ((d.native === "[]") && (d.creator === "<missing>"));
    const raw = diff(before, after);
    for ( const d of raw.filter(allowed) ) out.notes.push(`allowed: ${d.path}: ${d.native} → ${d.creator}`);
    out.differences = raw.filter(d => !allowed(d));
    const idsAfter = new Set(actor.items.map(i => i.id));
    const dupIds = new Set(dupIdsOf(beforeItems));
    const lost = [...idsBefore].filter(id => !idsAfter.has(id) && !dupIds.has(id)).map(id => `lost id ${id}`);
    const gained = [...idsAfter].filter(id => !idsBefore.has(id))
      .map(id => `new id ${id} (${actor.items.get(id)?.name})`);
    for ( const m of [...lost, ...gained] ) out.differences.push({ path: "ids", native: "same ids", creator: m });
    if ( actor.system.attributes.hp.value !== marks.hp ) {
      out.differences.push({ path: "hp.value", native: marks.hp, creator: actor.system.attributes.hp.value });
    }
    if ( marks.usesId && (actor.items.get(marks.usesId)?.system?.uses?.spent !== marks.spent) ) {
      out.differences.push({ path: "uses.spent", native: marks.spent, creator: actor.items.get(marks.usesId)?.system?.uses?.spent });
    }
    const gapsAfter = repairTargets(actor).length;
    if ( gapsAfter > gapsBefore ) out.differences.push({ path: "repair", native: gapsBefore, creator: `${gapsAfter} level(s) to repair` });
    // A decision the build never answered is "to choose" again, legitimately; a carried answer that was
    // lost shows up above as a source difference and as a level left to repair.
    out.ok = !out.differences.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    if ( actor && !globalThis.__keepActors ) await actor.delete().catch(() => {});
  }
  return out;
}

/** An item changed under the character is refreshed back, keeping its id and state; Keep mine leaves it. */
async function runRefresh() {
  const out = { label: "refresh in place keeps id and state; Keep mine leaves the item", ok: false, error: null,
    differences: [], notes: [] };
  let actor = null;
  const fail = (path, expected, got) => out.differences.push({ path, native: expected, creator: got });
  try {
    actor = await Actor.implementation.create({ name: `${PREFIX}content-update [refresh]`, type: "character" });
    const pack = game.packs.get("dnd5e.equipment24") ?? game.packs.find(p => p.metadata.id?.endsWith("equipment24"));
    const index = await pack.getIndex();
    const entry = index.find(e => e.name === "Longsword") ?? index.find(e => e.type === "weapon");
    const source = await pack.getDocument(entry._id);
    const [item] = await actor.createEmbeddedDocuments("Item", [game.items.fromCompendium(source, { keepId: false })]);

    // Stand in for an older version: different damage and description; and some state.
    const sourceDie = source.system.damage?.base?.denomination;
    await item.update({
      "system.damage.base.denomination": (sourceDie === 4) ? 6 : 4,
      "system.description.value": "<p>An older description.</p>",
      "system.quantity": 2, "system.equipped": false
    });

    let scan = await scanActor(actor);
    const e = scan.entries.find(x => x.item.id === item.id);
    if ( e?.tier !== "refresh" ) fail("tier", "refresh", e?.tier);
    if ( !e?.customised ) fail("customised", true, e?.customised);

    // Keep mine: nothing changes.
    let rehearsal = await rehearse(actor, scan, { keep: new Map([[item.id, true]]) });
    await commitRehearsal(rehearsal);
    await settle(500);
    if ( actor.items.get(item.id)?.system.damage.base.denomination === sourceDie ) fail("keep", "unchanged", "refreshed");

    // Update anyway.
    scan = await scanActor(actor);
    rehearsal = await rehearse(actor, scan, { keep: new Map([[item.id, false]]) });
    await commitRehearsal(rehearsal);
    await settle(500);
    const now = actor.items.get(item.id);
    if ( !now ) fail("id", item.id, "gone");
    else {
      if ( now.system.damage.base.denomination !== sourceDie ) fail("damage", sourceDie, now.system.damage.base.denomination);
      if ( now.system.description.value !== source.system.description.value ) fail("description", "source", "old");
      if ( now.system.quantity !== 2 ) fail("quantity", 2, now.system.quantity);
      if ( now.system.equipped !== false ) fail("equipped", false, now.system.equipped);
      if ( !now.getFlag("sogrom-dnd5e-character-creator", "source")?.groups ) fail("stamp", "present", "missing");
    }
    const again = await scanActor(actor);
    if ( again.counts.refresh || again.counts.rebuild ) fail("rescan", "nothing left", JSON.stringify(again.counts));
    out.ok = !out.differences.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    if ( actor && !globalThis.__keepActors ) await actor.delete().catch(() => {});
  }
  return out;
}

/* -------------------------------------------- */
/*  Real old content                             */
/* -------------------------------------------- */

/** The package whose legacy copy the fixture holds (see legacy-fixture.mjs). */
const LEGACY_PKG = "dnd-players-handbook";

/** PHB classes built on the legacy package and updated to the installed version. */
const LEGACY_CASES = [
  { find: "sweep:fighter/champion", level: 5 },
  { find: "sweep:wizard/conjurer", level: 6 },
  { find: "sweep:rogue/arcane-trickster", level: 10 },
  { find: "sweep:warlock/archfey-patron", level: 11 },
  { find: "sweep:bard/college-of-lore", level: 6 },
  { find: "sweep:ranger/hunter", level: 6 }
];

/** Set by a run that found no fixture, so the remaining legacy cases are skipped. */
let legacyMissing = false;

/** World pack name for a legacy pack. */
const legacyPack = pack => `legacy-${LEGACY_PKG}-${pack}`;

/**
 * Import the fixture into world compendia once. Returns the package version it holds, or null when
 * there is no fixture (run `node legacy-fixture.mjs` first).
 */
async function ensureLegacyPacks() {
  const url = `/modules/sogrom-dnd5e-character-creator/test-e2e/fixtures/legacy-${LEGACY_PKG}.json`;
  const res = await fetch(url);
  if ( !res.ok ) return null;
  const fixture = await res.json();
  const { CompendiumCollection } = foundry.documents.collections;
  for ( const def of Object.values(fixture.packs) ) {
    const items = def.documents.filter(d => !String(d._key ?? "").startsWith("!folders"));
    let pack = game.packs.get(`world.${def.name}`);
    if ( !pack ) pack = await CompendiumCollection.createCompendium({ type: "Item", label: def.label, name: def.name, package: "world" });
    const index = await pack.getIndex();
    if ( index.size >= items.length ) continue;
    const have = new Set(index.map(e => e._id));
    const todo = items.filter(d => !have.has(d._id)).map(d => {
      const data = structuredClone(d);
      delete data._key;
      data.folder = null;
      return data;
    });
    for ( let i = 0; i < todo.length; i += 100 ) {
      await Item.implementation.createDocuments(todo.slice(i, i + 100), { pack: pack.collection, keepId: true });
    }
  }
  return fixture.version;
}

/** Rewrite every uuid between the installed package and its legacy world copies. */
function swapPackage(value, toLegacy) {
  let text = JSON.stringify(value);
  for ( const pack of ["classes", "feats", "origins", "spells", "equipment"] ) {
    const installed = `Compendium.${LEGACY_PKG}.${pack}.`;
    const legacy = `Compendium.world.${legacyPack(pack)}.`;
    text = toLegacy ? text.split(installed).join(legacy) : text.split(legacy).join(installed);
  }
  return JSON.parse(text);
}

/** Ability scores, hit point maximum, proficient skills, level and subclass: what a carried build keeps. */
function vitals(actor) {
  const out = {};
  for ( const k of Object.keys(CONFIG.DND5E.abilities) ) out[`ability.${k}`] = actor.system.abilities[k]?.value;
  out["hp.max"] = actor.system.attributes.hp.max;
  for ( const [k, v] of Object.entries(actor.system.skills ?? {}) ) if ( v.value ) out[`skill.${k}`] = v.value;
  out.level = actor.system.details.level;
  out.subclass = actor.items.find(i => i.type === "subclass")?.name ?? null;
  return out;
}

/**
 * Build the scenario on the legacy package, make the character look as if it had been built before the
 * update (its uuids naming the installed package), then update it.
 *
 * Asserted: the update runs; a scan afterwards finds nothing left to update; no level is left with an
 * unanswered decision the review did not flag; and the character keeps its ability scores, hit point
 * maximum, proficient skills, level and subclass. Every decision the review could not carry is
 * printed, so a choice new in this version (expected) can be told from a lost one.
 */
async function runLegacy(scenario, label) {
  const out = { label, ok: false, error: null, differences: [], notes: [] };
  let legacyActor = null;
  let actor = null;
  const fail = (path, before, after) => out.differences.push({ path, native: before, creator: after });
  try {
    const built = await buildLegacyCharacter(scenario, label);
    ({ legacyActor, actor } = built);
    out.notes.push(`legacy ${LEGACY_PKG} ${built.version}`);
    const before = vitals(actor);
    const idsBefore = new Set(actor.items.map(i => i.id));

    const scan = await scanActor(actor);
    out.notes.push(`scan: ${JSON.stringify(scan.counts)}`);
    if ( !scan.needsRebuild ) out.notes.push("no advancement changed: refresh only");
    const rehearsal = await rehearse(actor, scan);
    const tally = {};
    for ( const d of rehearsal.decisions ) tally[d.status] = (tally[d.status] ?? 0) + 1;
    out.notes.push(`decisions: ${JSON.stringify(tally)}`);
    const asked = rehearsal.decisions.filter(d => d.status === "ask");
    for ( const d of asked ) out.notes.push(`to choose: ${d.title} (${d.host}, level ${d.level}) wanted ${d.wanted}; candidates: ${(d.candidates ?? []).join(" | ") || "none"}`);
    for ( const d of rehearsal.decisions.filter(x => x.status === "partial") ) {
      out.notes.push(`partly carried: ${d.title} (${d.host}, level ${d.level}): ${d.detail}`);
    }
    const head = html => String(html ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 50);
    const planned = rehearsal.preview.items.find(i => i.type === "class");
    out.notes.push(`planned class: id ${planned?._id}, ${Object.keys(planned?.system?.advancement ?? {}).length} adv, "${head(planned?.system?.description?.value)}"`);
    let completed = false;
    const hookId = Hooks.on("dnd5e.advancementManagerComplete", () => { completed = true; });
    await commitRehearsal(rehearsal);
    Hooks.off("dnd5e.advancementManagerComplete", hookId);
    await settle(1500);
    const cls = actor.items.find(i => i.type === "class");
    out.notes.push(`commit completed: ${completed}; class now: id ${cls?.id}, "${head(cls?.system?.description?.value)}"`);

    const after = vitals(actor);
    for ( const [k, v] of Object.entries(before) ) if ( after[k] !== v ) fail(k, v, after[k]);
    for ( const k of Object.keys(after) ) if ( !(k in before) ) fail(k, undefined, after[k]);
    const again = await scanActor(actor);
    for ( const e of again.entries.filter(x => ["refresh", "rebuild"].includes(x.tier)) ) {
      fail("still outdated", "none", `${e.item.name} (${e.tier}: ${e.changed.join(", ")})`);
      const mine = definitionGroups(e.item.toObject());
      const theirs = definitionGroups(e.source.toObject());
      for ( const g of e.changed ) out.notes.push(`  ${e.item.name}.${g}: ${firstDifference(JSON.parse(mine[g]), JSON.parse(theirs[g]))}`);
    }
    const kept = [...idsBefore].filter(id => actor.items.has(id)).length;
    out.notes.push(`item ids kept: ${kept} of ${idsBefore.size}`);
    const gaps = repairTargets(actor).flatMap(t => t.levels.map(g => `${t.classItem.name} ${g.level}: ${g.titles.join(", ")}`));
    if ( gaps.length > asked.length ) for ( const g of gaps ) fail("unanswered", "flagged on the review", g);
    else for ( const g of gaps ) out.notes.push(`left for the wrench: ${g}`);
    out.ok = !out.differences.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    if ( legacyActor ) await legacyActor.delete().catch(() => {});
    if ( actor && !globalThis.__keepActors ) await actor.delete().catch(() => {});
  }
  return out;
}

/** The first path at which two values differ, with both sides, for a diagnostic note. */
function firstDifference(a, b, path = "") {
  if ( JSON.stringify(a) === JSON.stringify(b) ) return null;
  if ( a && b && (typeof a === "object") && (typeof b === "object") ) {
    for ( const k of new Set([...Object.keys(a), ...Object.keys(b)]) ) {
      const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k);
      if ( d ) return d;
    }
  }
  const show = v => JSON.stringify(v)?.slice(0, 160);
  return `${path || "(root)"}: mine ${show(a)} / source ${show(b)}`;
}

/** Ids of the second and later copies of a granted item (same source, granted more than once). */
function dupIdsOf(items) {
  const seen = new Set();
  const out = [];
  for ( const i of items ) {
    if ( !i.granted || !i.src ) continue;
    if ( seen.has(i.src) ) out.push(i.id);
    seen.add(i.src);
  }
  return out;
}

/**
 * Build a scenario on the legacy package and turn it into a character "from before the update": the
 * same items, its uuids naming the installed package, no source stamps.
 * @returns {Promise<{legacyActor: Actor5e, actor: Actor5e, version: string}>}   Both must be deleted.
 */
async function buildLegacyCharacter(scenario, label) {
  const version = await ensureLegacyPacks();
  if ( !version ) {
    legacyMissing = true;
    throw new Error(`no fixture: run "node legacy-fixture.mjs H:/Code/DO-NOT-USE/${LEGACY_PKG} classes feats origins spells equipment"`);
  }
  // The scenario on the legacy copies. The subclass decision is keyed by the legacy class's own
  // Subclass advancement id, in case it differs from the installed class's.
  const legacy = swapPackage(scenario, true);
  const legacyClass = await fromUuid(legacy.classUuid);
  if ( !legacyClass ) throw new Error(`the legacy package has no ${legacy.classUuid}`);
  const subAdv = Object.values(legacyClass.advancement?.byId ?? {}).find(a => a.type === "Subclass")?.id;
  const subUuid = Object.values(legacy.answers ?? {})[0];
  if ( subAdv && subUuid ) legacy.answers = { [subAdv]: subUuid };
  const origins = [legacy.speciesUuid, legacy.backgroundUuid, legacy.classUuid].filter(Boolean);
  const book = new AnswerBook({ overrides: legacy.answers ?? {}, generate: true, origins });
  const legacyActor = await buildNative({ ...legacy, name: `${PREFIX}content-update [legacy build]`, incremental: true }, { book });
  await settle(800);

  // As if built before the update: the same character, its uuids naming the installed package.
  const data = swapPackage(legacyActor.toObject(), false);
  delete data._id;
  // A character from before this feature carries no source stamps. (Left on, they would also be
  // wrong here: the uuid rewrite above changes the very definitions they hashed.)
  for ( const item of data.items ) delete item.flags?.["sogrom-dnd5e-character-creator"]?.source;
  data.name = `${PREFIX}content-update [${label}]`;
  const actor = await Actor.implementation.create(data, { keepEmbeddedIds: true });
  await settle(800);
  return { legacyActor, actor, version };
}

/* -------------------------------------------- */
/*  The window                                   */
/* -------------------------------------------- */

/**
 * The review window on a legacy-built Fighter, through the real UI: the entry point offers it, the
 * window renders the rebuilt and refreshed lists and the carried choices; without Create Actor the
 * Update button is locked until "Proceed without backup" is ticked; with it, Update makes the backup
 * copy, writes the character, posts the chat note and closes, and nothing is left out of date.
 */
async function runUi(scenario) {
  const out = { label: "the review window: entry point, lists, backup gate, Update", ok: false, error: null,
    differences: [], notes: [] };
  const fail = (path, expected, got) => out.differences.push({ path, native: expected, creator: got });
  let legacyActor = null;
  let actor = null;
  let backup = null;
  const realCan = game.user.can.bind(game.user);
  try {
    const { openContentUpdate, updateAvailable } = await import(`${MODULE}/content-update/update-app.mjs`);
    ({ legacyActor, actor } = await buildLegacyCharacter(scenario, "ui"));

    // The entry point: the first ask starts the scan and says no; once it lands, yes.
    let ready = false;
    updateAvailable(actor, () => { ready = true; });
    for ( let i = 0; (i < 100) && !ready; i++ ) await settle(100);
    if ( !updateAvailable(actor) ) fail("entry point", "offered", "not offered");

    // Without Create Actor: locked until the box is ticked.
    game.user.can = perm => ((perm === "ACTOR_CREATE") ? false : realCan(perm));
    const app = openContentUpdate(actor);
    const button = () => app.element?.querySelector('button[data-action="update"]');
    for ( let i = 0; (i < 300) && !button(); i++ ) await settle(200);
    if ( !button() ) throw new Error(`the window never finished: ${app.element?.textContent?.trim().slice(0, 200)}`);
    const count = sel => app.element.querySelectorAll(sel).length;
    out.notes.push(`rebuilt ${count(".sogrom-cu-items li")} item row(s), ${count(".sogrom-cu-decisions li")} decision row(s)`);
    if ( !count(".sogrom-cu-items li") ) fail("lists", "items listed", "none");
    if ( !count(".sogrom-cu-decisions li.is-carried") ) fail("choices", "carried choices listed", "none");
    if ( !button().disabled ) fail("backup gate", "Update locked", "Update enabled");
    if ( !app.element.querySelector('button[data-action="download"]') ) fail("backup gate", "Download offered", "none");
    app.element.querySelector('input[data-action="skipBackup"]').click();
    await settle(800);
    if ( button()?.disabled ) fail("backup gate", "unlocked by Proceed without backup", "still locked");

    // With Create Actor: a backup copy, then the update.
    game.user.can = realCan;
    await app.render();
    await settle(800);
    if ( app.element.querySelector('button[data-action="download"]') ) fail("backup", "copy, not download", "download offered");
    const messages = game.messages.size;
    button().click();
    for ( let i = 0; (i < 300) && app.rendered; i++ ) await settle(200);
    await settle(1500);
    if ( app.rendered ) fail("window", "closed after Update", "still open");
    backup = game.actors.find(a => a.getFlag("sogrom-dnd5e-character-creator", "backupOf") === actor.uuid) ?? null;
    if ( !backup ) fail("backup", "a copy in the backups folder", "none");
    else if ( !backup.folder?.getFlag("sogrom-dnd5e-character-creator", "contentUpdateBackups") ) fail("backup", "in the backups folder", backup.folder?.name ?? "no folder");
    if ( game.messages.size <= messages ) fail("chat", "a summary note", "none");
    const again = await scanActor(actor);
    if ( again.counts.refresh || again.counts.rebuild ) fail("result", "nothing left to update", JSON.stringify(again.counts));
    if ( backup && updateAvailable(backup) ) fail("backup", "never offered an update itself", "offered");
    // The repair wrench opens for anything left to choose; close it.
    for ( const w of foundry.applications.instances?.values() ?? [] ) {
      if ( (w.constructor?.name === "LevelUpShell") || (w.constructor?.name === "DialogV2") ) await w.close?.({ animate: false });
    }
    out.ok = !out.differences.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    game.user.can = realCan;
    if ( legacyActor ) await legacyActor.delete().catch(() => {});
    if ( backup ) await backup.delete().catch(() => {});
    if ( actor && !globalThis.__keepActors ) await actor.delete().catch(() => {});
  }
  return out;
}
