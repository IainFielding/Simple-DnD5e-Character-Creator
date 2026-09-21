/**
 * End-to-end check of the Ready-made path (`scripts/data/premades.mjs`).
 *
 * The claim worth pinning is a negative one: a pregenerated character is **imported whole, not
 * rebuilt**. Running a correct finished character back through our own engine could only introduce
 * differences, so `importPregen` copies the document and changes exactly two things — it drops the
 * `_id` so Foundry mints a new one, and it grants the importing user ownership so the character they
 * just made is one they can open.
 *
 * That makes the oracle unusually strong, and unusually cheap: the compendium document *is* the
 * expected result. Every item, every level, every ability score must survive the trip, and anything
 * that does not is either a copy that isn't a copy or a pack this code cannot read.
 *
 * It also covers the discovery half, which is where the fiddly rules live: "a character document
 * whose class levels total one", read from a partial index so a 471-entry pack is not loaded in
 * full. A source that silently stops matching leaves the Ready-made screen empty, which no unit test
 * can see because the packs are the input.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const { foundryPregens, invalidatePregenCache, importPregen } =
  await import(`${MODULE}/data/premades.mjs`);

const PREFIX = "[e2e] ";

/** Let Foundry finish the writes a create kicks off before anything reads the actor back. */
const pause = ms => new Promise(r => setTimeout(r, ms));

/** Total class levels on an actor or actor-like source object. */
function classLevels(items) {
  return (items ?? [])
    .filter(i => i.type === "class")
    .reduce((n, i) => n + Number(i.system?.levels ?? 0), 0);
}

/* -------------------------------------------- */

/**
 * Import one pregen and compare it against the compendium document it came from.
 *
 * Compared by **name and count** rather than by id: the copy is required to be a copy of the
 * content, and every `_id` on it is legitimately new. Comparing ids would fail on a correct import.
 */
async function runCase(entry) {
  const sourceDoc = await fromUuid(entry.uuid).catch(() => null);
  if ( !sourceDoc ) return { ok: false, failures: [`the pregen could not be resolved: ${entry.uuid}`] };

  const failures = [];
  const expected = sourceDoc.toObject();
  const actor = await importPregen(entry.uuid);

  if ( !actor ) return { ok: false, failures: ["importPregen returned nothing"] };

  try {
    // Carry the harness prefix, so a run that dies before the `finally` leaves something `cleanup`
    // is allowed to remove. Renaming after the compare would be too late; renaming before it is
    // safe because the name is not one of the things compared.
    await actor.update({ name: `${PREFIX}${actor.name}` }, { render: false }).catch(() => {});
    await pause(200);

    // 1. Every item, by name and multiplicity. A character who arrives missing a feature, or
    //    holding two of something, was rebuilt rather than copied.
    //
    //    **Both sides read as source data.** dnd5e enchantments rename the item they apply to —
    //    a Monk's Spear becomes "Spear (Martial Arts)" on the live document — so comparing the
    //    compendium's stored names against the created actor's *derived* ones reports three
    //    missing weapons and three unexpected ones for every Monk. That is the enchantment doing
    //    its job, not a failed copy, and `toObject()` on both sides is what makes them comparable.
    const mine = actor.toObject();
    const want = new Map();
    for ( const i of expected.items ?? [] ) want.set(i.name, (want.get(i.name) ?? 0) + 1);
    const got = new Map();
    for ( const i of mine.items ?? [] ) got.set(i.name, (got.get(i.name) ?? 0) + 1);

    for ( const [name, count] of want ) {
      const found = got.get(name) ?? 0;
      if ( found !== count ) failures.push(`"${name}": expected ${count} item(s), imported ${found}`);
    }
    for ( const [name, count] of got ) {
      if ( !want.has(name) ) failures.push(`"${name}" (×${count}) is on the import but not the source`);
    }

    // 2. Class levels. The discovery rule is "class levels total one", so an import that landed on
    //    a different total means either the wrong document or a rebuild that re-ran advancement.
    const sourceLevels = classLevels(expected.items);
    const actorLevels = classLevels(mine.items);
    if ( actorLevels !== sourceLevels ) {
      failures.push(`class levels: source has ${sourceLevels}, import has ${actorLevels}`);
    }
    if ( sourceLevels !== 1 ) {
      failures.push(`offered as a 1st-level pregen but its class levels total ${sourceLevels}`);
    }

    // 3. Ability scores, verbatim. The cheapest possible tell that the character was regenerated:
    //    a rebuild would re-roll or re-assign them.
    //    Source data on both sides again, for the same reason as the items: a derived score carries
    //    bonuses the stored one does not.
    for ( const [key, val] of Object.entries(expected.system?.abilities ?? {}) ) {
      const got = mine.system?.abilities?.[key]?.value;
      if ( Number(got) !== Number(val?.value) ) {
        failures.push(`ability ${key}: source ${val?.value}, import ${got}`);
      }
    }

    // 4. The importing user can open what they just made. Stated in `importPregen` as the reason
    //    ownership is touched at all, so it is worth asserting rather than assuming.
    const level = actor.ownership?.[game.user.id];
    if ( level !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER ) {
      failures.push(`imported without ownership for the creating user (got ${level})`);
    }

    // 5. The card the screen would draw. Asserted on the entry's own `img` — the value the screen
    //    actually renders — rather than re-deriving it, so this fails if the resolution changes
    //    anywhere in that path. A pregen with no portrait is a hole in a screen that is all pictures.
    if ( !entry.img ) failures.push("no portrait resolved for the Ready-made card");

    return { ok: !failures.length, failures, items: actor.items.size };
  } finally {
    await actor.delete().catch(() => {});
  }
}

/* -------------------------------------------- */

/**
 * Every pregen the world offers, from every book that ships them.
 * @param {{only?: string|null, limit?: number|null}} options
 */
export async function checkPregens({ only = null, limit = null } = {}) {
  invalidatePregenCache();
  const groups = await foundryPregens();

  if ( !groups.length ) {
    // Not a pass. The Ready-made path is one of the three the chooser offers, and an empty one is
    // a dead end for the player — which is exactly the failure this check exists to notice.
    return { ok: false, failures: ["no pregen sources resolved: the Ready-made screen would be empty"], cases: [] };
  }

  const failures = [];
  const results = [];
  for ( const group of groups ) {
    let entries = group.entries;
    if ( only ) entries = entries.filter(e => e.name.toLowerCase().includes(only.toLowerCase()));
    if ( limit ) entries = entries.slice(0, limit);

    for ( const entry of entries ) {
      const label = `${group.label ?? group.pack} — ${entry.name}`;
      let report;
      try {
        report = { label, pack: group.pack, ...(await runCase(entry)) };
      } catch ( err ) {
        report = { label, pack: group.pack, ok: false, failures: [], error: err.message };
      }
      results.push(report);
      for ( const f of report.failures ?? [] ) failures.push(`${label}: ${f}`);
      if ( report.error ) failures.push(`${label}: ${report.error}`);
    }
  }

  return { ok: !failures.length, failures, cases: results, groups: groups.length };
}
