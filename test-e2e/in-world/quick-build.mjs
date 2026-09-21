/**
 * End-to-end check of Quick Build (`scripts/data/quick-build.mjs`), across every class in the world.
 *
 * An **invariant** check, not an equivalence one. There is no native Quick Build to diff against —
 * the system has no "fill this character in for me" — so the oracle has to be the rules a finished
 * character must obey whatever route produced it.
 *
 * ## Why this exists
 *
 * Quick Build was already driven in-world, but only by `hooks.mjs`, and only as a **Fighter** —
 * chosen there precisely because it is "the simplest complete character in the world: no spell
 * picks, no level-1 subclass". That is the right call for a hooks test, which needs a valid
 * character and nothing more. It also means the one Quick Build path carrying real risk was the one
 * never exercised: the spellcasters.
 *
 * The risk is specific. Quick Build picks spells from the class list directly. It *does* filter out
 * anything an origin already grants, the same set the Spells step filters (`originGrantedSpellCards`)
 * — but that filter had never been run against real content, and the cost of it being wrong is not
 * cosmetic: the granted copy is always-prepared and cast for free, while a chosen duplicate eats a
 * prepared slot and burns a real one. `reconcileGrantedSpells` is the safety net; this asks whether
 * the net is ever needed.
 *
 * ## The oracle
 *
 * Spells are counted **by name**, deliberately, exactly as `checkGrantedSpells` counts them. Using
 * the module's own `spellKey` would be asking it to mark its own homework, since a broken key is one
 * of the things this is here to catch. A character holding two spells of the same name is wrong
 * whatever the module believes about them.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const { applyQuickBuild } = await import(`${MODULE}/data/quick-build.mjs`);
const { getSources } = await import(`${MODULE}/data/source-cache.mjs`);
const { CreatorState } = await import(`${MODULE}/state/creator-state.mjs`);
const { assembleActor } = await import(`${MODULE}/build/actor-assembler.mjs`);
const { REQUIRED_STEPS } = await import(`${MODULE}/steps/registry.mjs`);
const { spellKey } = await import(`${MODULE}/data/spell-identity.mjs`);

const PREFIX = "[e2e] ";

/** The standard array Quick Build assigns. Any other set of base scores means it did not run. */
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/**
 * The seeded RNG `shots.mjs` and `hooks.mjs` both use. Seeded because an unseeded Quick Build picks
 * a random species: a failure that re-rolls its way to a different character next run reads as
 * fixed, which is the worst thing a check can do.
 */
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Let Foundry finish the writes a build kicks off before anything reads the actor back. */
const pause = ms => new Promise(r => setTimeout(r, ms));

/* -------------------------------------------- */

/**
 * Every class the world offers, each with an origin pair Quick Build is told to use.
 *
 * Driven off the world's own content rather than a hand-written list, because the point is coverage
 * of whatever is installed — a hard-coded thirteen would silently stop covering the fourteenth.
 *
 * **The origins are passed as options, not written onto the state.** `applyQuickBuild` nulls
 * `speciesUuid` and `backgroundUuid` at the top of its run and picks its own, so a state-written
 * origin is discarded without a word. Its `speciesUuid`/`backgroundUuid` options are the pinning
 * mechanism, and are what the three-card screen uses.
 *
 * **Both are chosen edition-correctly**, from `source.backgrounds({rules})` for that class's own
 * rules: handing a 2024 background to a 2014 class would build a character the grids would never
 * have offered, and any difference it produced would be the test's fault rather than the module's.
 * A background granting Magic Initiate is preferred where the edition has one, because that is the
 * origin grant most likely to collide with a spellcaster's own list — the collision this exists for.
 */
function casesFor(source, level) {
  const classes = source.classes();
  if ( !classes.length ) throw new Error("no classes in the world's compendiums");

  const cases = [];
  for ( const cls of classes ) {
    const rules = source.rulesOf(cls.uuid);
    const species = source.species({ rules });
    const backgrounds = source.backgrounds({ rules });
    if ( !species.length || !backgrounds.length ) continue;   // nothing legal to build this class with

    // Sage grants Magic Initiate in both editions that ship it. Fall back to the first legal
    // background rather than skipping the class: coverage of the class still matters without it.
    const background = backgrounds.find(c => /^sage$/i.test(c.name)) ?? backgrounds[0];
    const human = species.find(c => /^human$/i.test(c.name)) ?? species[0];

    const slug = cls.identifier || cls.name.toLowerCase().replace(/\s+/g, "-");
    cases.push({
      id: `quick:${slug}${level > 1 ? `-l${level}` : ""}`,
      label: `Quick Build: ${cls.name} (${background.name})${level > 1 ? ` at level ${level}` : ""}`,
      classUuid: cls.uuid,
      speciesUuid: human.uuid,
      backgroundUuid: background.uuid,
      level
    });
  }
  return cases;
}

/* -------------------------------------------- */

/**
 * Run one Quick Build end to end: fill the state exactly as the button does, then build the actor.
 */
async function runCase(spec) {
  const { source, spells, equipment } = getSources();

  const actor = await Actor.implementation.create({
    name: `${PREFIX}${spec.label}`,
    type: "character"
  }, { render: false });

  try {
    const state = new CreatorState(actor);
    // The only thing the screen sets before pressing the button. The other two choices go in as
    // options below — see the note on `casesFor`.
    state.classUuid = spec.classUuid;
    if ( spec.level > 1 ) state.targetLevel = spec.level;

    const result = await applyQuickBuild(
      { state, source, spells, equipment },
      { rng: mulberry32(7), speciesUuid: spec.speciesUuid, backgroundUuid: spec.backgroundUuid }
    );
    if ( !result?.ok ) {
      return {
        ok: false, spells: 0, items: 0,
        failures: [`quick build declined to fill: ${result?.warnings?.join(", ") || "no reason given"}`]
      };
    }

    // `targetLevel` is re-read from the state after the fill: `resetClassDependent` runs inside
    // `applyQuickBuild`, and a climb has to be asked for after it, not before.
    if ( spec.level > 1 ) state.targetLevel = spec.level;

    await assembleActor(state, source, null);
    await pause(250);

    return assertQuickBuild(actor, state, spec, result);
  } finally {
    await actor.delete().catch(() => {});
  }
}

/**
 * The invariants, read off the finished actor wherever possible rather than off the state that
 * produced it — the sheet is what the player gets.
 */
function assertQuickBuild(actor, state, spec, result) {
  const failures = [];

  // 1. Quick Build must leave nothing for the player to finish. An incomplete required step means
  //    the screen's "Create Character" would refuse, which is the whole promise broken.
  const incomplete = REQUIRED_STEPS.filter(s => !s.isComplete(state)).map(s => s.id);
  if ( incomplete.length ) failures.push(`required step(s) left incomplete: ${incomplete.join(", ")}`);

  // 2. A warning is Quick Build reporting that it could not do part of its job. There is no
  //    acceptable one here: the screen shows the player a finished character either way.
  if ( result.warnings?.length ) failures.push(`filled with warnings: ${result.warnings.join(", ")}`);

  // 3. No spell twice, by name. The duplicate's signature — see the note at the top of this file
  //    for why the oracle is the name and not the module's own identity function.
  const spellItems = actor.items.filter(i => i.type === "spell");

  // A spell dnd5e provisions itself from a feature's **Cast activity** is not a copy of ours, and
  // must not be counted as one. The 2024 Ranger is the case: Favored Enemy carries both an
  // `ItemGrant` advancement for Hunter's Mark (which our driver applies, always-prepared) *and* a
  // cast activity, which the system materialises separately with `system.sourceItem` pointing back
  // at the feature. Two Hunter's Marks is what the content asks for, and the sweep confirms native
  // does exactly the same — `Ranger 20 — Hollow Warden` is identical on both sides. Counting them
  // would make this check fail on correct behaviour, which is worse than not checking at all.
  const ours = spellItems.filter(i => !i.system?.sourceItem);

  const byName = new Map();
  for ( const s of ours ) {
    if ( !byName.has(s.name) ) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  for ( const [name, copies] of byName ) {
    if ( copies.length < 2 ) continue;
    // The identity key of each copy is reported, not just the count. A duplicate is almost always
    // a *matching* failure rather than a picking one, and the key says which half is at fault:
    // two `id:…` keys that differ is a real pair of spells, while an `id:…` beside a
    // `Compendium.…` key means one copy ships without `system.identifier` and fell back to its
    // source — which cannot match the same spell from another package. See spell-identity.mjs.
    const describe = c => [
      spellKey(c) ?? "(no key)",
      `prepared=${c.system?.prepared ?? "—"}`,
      `origin=${c.flags?.dnd5e?.advancementOrigin ?? c.system?.sourceItem ?? "—"}`,
      `src=${c._stats?.compendiumSource ?? "—"}`
    ].join(" ");
    failures.push(`${copies.length} copies of the spell "${name}" on one character`
      + copies.map(c => `\n      ${describe(c)}`).join(""));
  }

  // 4. Nothing Quick Build *chose* may be a spell an origin already grants. Checked separately from
  //    (3) because the two fail differently: reconciliation can collapse a duplicate pair after the
  //    fact, leaving one item on the sheet and the wrong decision still recorded in the build. An
  //    always-prepared spell (`prepared === 2`) is a grant; the chosen list should never name one.
  //    Matched on the *chosen entry* by identity, not by hunting for its item by uuid. Looking the
  //    item up failed open — a chosen spell whose `compendiumSource` did not match was skipped in
  //    silence, so this check could pass on a build it should have caught. Comparing the recorded
  //    pick straight against the granted keys asks the question directly, and distinguishes the two
  //    failures that look identical on the sheet: a pick that should have been filtered (this), and
  //    two grants of one spell that should have merged (the duplicate count above, without this).
  const grantedKeys = new Set(spellItems
    .filter(i => Number(i.system?.prepared ?? 0) === 2)
    .map(i => spellKey(i))
    .filter(Boolean));
  for ( const entry of [...(state.selectedCantrips ?? []), ...(state.selectedSpells ?? [])] ) {
    if ( typeof entry === "string" ) continue;   // a bare uuid carries no level, so it has no key
    const key = spellKey(entry);
    if ( key && grantedKeys.has(key) ) {
      failures.push(`"${entry.name ?? key}" was chosen by Quick Build although the build already grants it`);
    }
  }

  // 5. The standard array, which is the method the screen names on the player's behalf. Compared
  //    before origin increases (`resolvedScores`), because those land on top and would mask it.
  const assigned = Object.values(state.resolvedScores?.() ?? {}).map(Number).filter(Number.isFinite);
  if ( assigned.length === STANDARD_ARRAY.length ) {
    const sorted = [...assigned].sort((a, b) => b - a);
    if ( sorted.join(",") !== STANDARD_ARRAY.join(",") ) {
      failures.push(`base ability scores ${sorted.join("/")} are not the standard array ${STANDARD_ARRAY.join("/")}`);
    }
  } else {
    failures.push(`resolved ${assigned.length} ability score(s), expected ${STANDARD_ARRAY.length}`);
  }

  // 6. The character has to have actually been built. A fill that produced no class item is a
  //    failure every check above could otherwise pass over in silence.
  if ( !actor.items.some(i => i.type === "class") ) failures.push("no class item on the finished character");

  const levels = actor.items.filter(i => i.type === "class")
    .reduce((n, i) => n + Number(i.system?.levels ?? 0), 0);
  if ( levels !== spec.level ) failures.push(`class levels total ${levels}, expected ${spec.level}`);

  return { ok: !failures.length, failures, spells: spellItems.length, items: actor.items.size };
}

/* -------------------------------------------- */

/**
 * Quick Build every class in the world.
 *
 * **Level 1 only, and deliberately so.** Quick Build is the class step's button: it fills the
 * *creation* decisions, and the climb to a higher starting level is the LevelUpDriver's separate
 * pass, which the subclass sweep already covers at every level to 20. A higher `targetLevel` here
 * would only change which optional steps gate — it would not give Quick Build a second round of
 * spell picks to get wrong, because there is no such round. An earlier version of this check ran a
 * level-5 pass and proved only that `assembleActor` builds a 1st-level character, which is its job.
 * @param {{only?: string|null}} options
 */
export async function checkQuickBuild({ only = null } = {}) {
  const { source } = getSources();

  let cases = casesFor(source, 1);
  if ( only ) {
    const want = only.toLowerCase();
    cases = cases.filter(c => c.id.includes(want) || c.label.toLowerCase().includes(want));
  }
  if ( !cases.length ) throw new Error(`no quick-build case matches ${JSON.stringify(only)}`);

  const failures = [];
  const results = [];
  for ( const spec of cases ) {
    let report;
    try {
      report = { ...spec, ...(await runCase(spec)) };
    } catch ( err ) {
      report = { ...spec, ok: false, failures: [], error: err.message };
    }
    results.push(report);
    for ( const f of report.failures ?? [] ) failures.push(`${spec.id}: ${f}`);
    if ( report.error ) failures.push(`${spec.id}: ${report.error}`);
  }

  return { ok: !failures.length, failures, cases: results };
}
