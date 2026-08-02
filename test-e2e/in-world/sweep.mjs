/**
 * The subclass sweep: one generated scenario per subclass in the world, each carried to level 20.
 *
 * The hand-written scenarios in `scenarios.mjs` are chosen — each one exists to exercise a specific
 * mechanism, and its answers are argued for in a comment. This is the opposite: breadth, no
 * judgement, every subclass the installed content offers, built both ways and diffed. Nothing here
 * is hand-written except the origins, which are deliberately the same Human/Sage the existing
 * scenarios use — their contribution to a diff is already characterised, so a difference that shows
 * up here is about the subclass and not about the species.
 *
 * Answers come from the {@link AnswerBook} generator (`generate: true`), with exactly one override:
 * the subclass itself, which is the variable being swept and the one decision generation refuses to
 * make for you.
 *
 * Level 20 because the interesting content is spread across it. A subclass grants features at four
 * or five levels, the class's ability-score improvements land at 4/8/12/16/19 (plus the Fighter's
 * and Rogue's extras), spell progression runs the whole way, and a level-3 build would test the
 * first tranche and nothing else. It is a long run — see `run.mjs --sweep`, which streams results
 * so a crash costs one scenario rather than all of them.
 */

/** Base ability scores, spread so no class is crippled and every ASI has somewhere to go. */
const ABILITIES = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

/** The characterised origins: see the file header. */
const SPECIES = "Compendium.dnd5e.origins24.Item.phbspHuman000000";
const BACKGROUND = "Compendium.dnd5e.origins24.Item.phbbgSage0000000";

/** A subclass name to an id-safe slug. */
function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* -------------------------------------------- */

/**
 * Every class item in the world, keyed by its identifier.
 *
 * Index-scanned rather than loaded: a class document is large and all this needs is the uuid and the
 * identifier its subclasses point at. A duplicate identifier (the same class shipped by two packs)
 * keeps the first by uuid order, so the sweep is stable across runs.
 */
async function classesByIdentifier() {
  const out = new Map();
  const found = [];
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    for ( const entry of index ) {
      if ( entry.type !== "class" ) continue;
      const identifier = entry.system?.identifier;
      if ( identifier ) found.push({ identifier, uuid: entry.uuid, name: entry.name });
    }
  }
  found.sort((a, b) => a.uuid.localeCompare(b.uuid));
  for ( const cls of found ) if ( !out.has(cls.identifier) ) out.set(cls.identifier, cls);
  return out;
}

/** Every subclass in the world, sorted by uuid so the sweep runs in the same order every time. */
async function allSubclasses() {
  const out = [];
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.classIdentifier"] });
    for ( const entry of index ) {
      if ( entry.type !== "subclass" ) continue;
      out.push({
        name: entry.name, uuid: entry.uuid, pack: pack.collection,
        classIdentifier: entry.system?.classIdentifier ?? null
      });
    }
  }
  return out.sort((a, b) => a.uuid.localeCompare(b.uuid));
}

/**
 * The id of a class's Subclass advancement — the decision the scenario has to answer.
 *
 * Read off the document rather than hard-coded, because an advancement id is specific to the content
 * version that shipped it: a module update reshuffles them and every hand-written id goes stale at
 * once. This is also why the sweep can cover third-party classes it has never seen.
 */
function subclassAdvancementId(classDoc) {
  const adv = Object.values(classDoc.advancement?.byId ?? {}).find(a => a.type === "Subclass");
  return adv?.id ?? null;
}

/* -------------------------------------------- */

/**
 * Build the sweep's scenario list.
 * @param {object} [options]
 * @param {number} [options.level]    Level to carry each build to.
 * @returns {Promise<{scenarios: object[], skipped: object[]}>}
 */
export async function sweepScenarios({ level = 20, incremental = false } = {}) {
  const classes = await classesByIdentifier();
  const subclasses = await allSubclasses();

  const scenarios = [];
  const skipped = [];
  const advIds = new Map();   // class uuid -> subclass advancement id, resolved once per class

  for ( const sub of subclasses ) {
    const cls = sub.classIdentifier ? classes.get(sub.classIdentifier) : null;
    if ( !cls ) {
      // A subclass whose class is not installed — common when a module ships content for a class
      // from a book the world does not have. Reported, not thrown: the sweep is about what is here.
      skipped.push({ subclass: sub.name, uuid: sub.uuid, reason: `no class "${sub.classIdentifier}" is installed` });
      continue;
    }

    if ( !advIds.has(cls.uuid) ) {
      const doc = await fromUuid(cls.uuid).catch(() => null);
      advIds.set(cls.uuid, doc ? subclassAdvancementId(doc) : null);
    }
    const advId = advIds.get(cls.uuid);
    if ( !advId ) {
      skipped.push({ subclass: sub.name, uuid: sub.uuid, reason: `"${cls.name}" has no Subclass advancement` });
      continue;
    }

    // Two packs can ship the same subclass name under the same class identifier — the SRD's Thief
    // and the Player's Handbook's, say. They are different documents and both are worth building, so
    // the collision is broken with the pack rather than dropped: an id has to be unique or `--resume`
    // would skip a scenario it never ran and `sweepOne` would build the wrong one.
    let id = `sweep:${sub.classIdentifier}/${slug(sub.name)}`;
    if ( scenarios.some(s => s.id === id) ) id += `-${slug(sub.pack)}`;

    scenarios.push({
      id,
      name: `Sweep: ${cls.name} ${level} — ${sub.name} (${sub.pack})`,
      generate: true,
      // One manager per level rather than one for the jump, snapshotted at each — see
      // `harness.mjs#compareLevels`.
      incremental,
      speciesUuid: SPECIES,
      backgroundUuid: BACKGROUND,
      classUuid: cls.uuid,
      targetLevel: level,
      abilities: { ...ABILITIES },
      // The one stated answer. Everything else is generated.
      answers: { [advId]: sub.uuid }
    });
  }

  return { scenarios, skipped };
}
