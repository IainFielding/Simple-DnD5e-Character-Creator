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
    const label = `rebuild is a no-op: ${scenario?.label ?? spec.find} at ${spec.level}`;
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
    const idsBefore = new Set(actor.items.map(i => i.id));
    const gapsBefore = repairTargets(actor).length;

    const scan = await scanActor(actor);
    const rehearsal = await rehearse(actor, { ...scan, needsRebuild: true });
    const asked = rehearsal.decisions.filter(d => d.status === "ask");
    for ( const d of asked ) out.notes.push(`not carried: ${d.title} (${d.host}, level ${d.level})`);
    await commitRehearsal(rehearsal);
    await settle(1200);

    const after = snapshot(actor);
    out.differences = diff(before, after);
    const idsAfter = new Set(actor.items.map(i => i.id));
    const lost = [...idsBefore].filter(id => !idsAfter.has(id)).map(id => `lost id ${id}`);
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
    if ( asked.length ) out.differences.push({ path: "decisions", native: "all carried", creator: `${asked.length} not carried` });
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
    const version = await ensureLegacyPacks();
    if ( !version ) {
      legacyMissing = true;
      throw new Error(`no fixture: run "node legacy-fixture.mjs H:/Code/DO-NOT-USE/${LEGACY_PKG} classes feats origins spells equipment"`);
    }
    out.notes.push(`legacy ${LEGACY_PKG} ${version}`);

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
    legacyActor = await buildNative({ ...legacy, name: `${PREFIX}content-update [legacy build]`, incremental: true }, { book });
    await settle(800);

    // As if built before the update: the same character, its uuids naming the installed package.
    const data = swapPackage(legacyActor.toObject(), false);
    delete data._id;
    data.name = `${PREFIX}content-update [${label}]`;
    actor = await Actor.implementation.create(data, { keepEmbeddedIds: true });
    await settle(800);
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
    for ( const d of asked ) out.notes.push(`to choose: ${d.title} (${d.host}, level ${d.level})`);
    for ( const d of rehearsal.decisions.filter(x => x.status === "partial") ) {
      out.notes.push(`partly carried: ${d.title} (${d.host}, level ${d.level}): ${d.detail}`);
    }
    await commitRehearsal(rehearsal);
    await settle(1500);

    const after = vitals(actor);
    for ( const [k, v] of Object.entries(before) ) if ( after[k] !== v ) fail(k, v, after[k]);
    for ( const k of Object.keys(after) ) if ( !(k in before) ) fail(k, undefined, after[k]);
    const again = await scanActor(actor);
    for ( const e of again.entries.filter(x => ["refresh", "rebuild"].includes(x.tier)) ) {
      fail("still outdated", "none", `${e.item.name} (${e.tier}: ${e.changed.join(", ")})`);
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
