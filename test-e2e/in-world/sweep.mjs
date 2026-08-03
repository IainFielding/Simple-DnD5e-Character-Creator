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
 * The module a pack belongs to. A pack collection is `<packageId>.<packName>`, so this is the
 * publisher — `dnd-tashas-cauldron`, `dnd-forge-artificer`, `dnd5e` for the system's own.
 */
function packageOf(packCollection) {
  return String(packCollection).split(".")[0];
}

/**
 * Every class item in the world, keyed by its identifier — **all** candidates per identifier,
 * sorted by uuid.
 *
 * Index-scanned rather than loaded: a class document is large and all this needs is the uuid and the
 * identifier its subclasses point at.
 *
 * Two modules can publish a class under one identifier — `dnd-forge-artificer` and
 * `dnd-tashas-cauldron` both ship `artificer` — and they are *different classes*, with different
 * features at different levels. Which one a subclass is built onto is not a detail: a Tasha's
 * Artillerist grew up alongside Tasha's Artificer, and pairing it with the Forge one tests a
 * combination its author never wrote. So the choice is made per subclass rather than once per
 * identifier — see {@link classFor}.
 */
async function classesByIdentifier() {
  const out = new Map();
  const found = [];
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    for ( const entry of index ) {
      if ( entry.type !== "class" ) continue;
      const identifier = entry.system?.identifier;
      if ( identifier ) found.push({ identifier, uuid: entry.uuid, name: entry.name, pack: pack.collection });
    }
  }
  found.sort((a, b) => a.uuid.localeCompare(b.uuid));
  for ( const cls of found ) {
    if ( !out.has(cls.identifier) ) out.set(cls.identifier, []);
    out.get(cls.identifier).push(cls);
  }
  return out;
}

/**
 * Which classes a module's subclasses belong on, when the module does not ship the class itself.
 * Keyed by the subclass's package, valued with a pack collection.
 *
 * Tasha's Cauldron is 2014 content. Its Path of the Beast was written against the 2014 Barbarian —
 * different features at different levels from the 2024 one — so building it onto the Player's
 * Handbook 2024 Barbarian would be testing a pairing that never existed. The system still ships the
 * 2014 classes in `dnd5e.classes`, so that is where they go. Its *own* Artificer is unaffected: the
 * same-pack tier in {@link classFor} runs first and keeps Tasha's four Artificer subclasses on
 * Tasha's Artificer.
 */
const CLASS_SOURCE = { "dnd-tashas-cauldron": "dnd5e.classes" };

/**
 * Where a subclass lands when its own module ships no class for it and the identifier is contested.
 *
 * Only `artificer` needs saying: three modules publish Artificer subclasses and two publish an
 * Artificer class, so Ravenloft's Reanimator — which ships neither — would otherwise be decided by
 * whichever module id sorts first. It does currently resolve to the Forge Artificer that way, which
 * is the right answer; this states the intent rather than inheriting it from the alphabet, so a
 * module named `dnd-a…` appearing later cannot silently move it.
 */
const CLASS_FALLBACK = { artificer: "dnd-forge-artificer" };

/**
 * The class a subclass should be built onto, nearest publisher first.
 *
 * A subclass and the class it was written for travel together, so proximity is the tie-break that
 * matters. Three tiers, narrowest first:
 *
 *  1. **Same pack.** Decides the two the system itself ships: a `dnd5e.classes24` subclass belongs
 *     on the 2024 class beside it, not on the 2014 one in `dnd5e.classes`, and package alone cannot
 *     tell those apart.
 *  2. **The module's stated class source** in {@link CLASS_SOURCE} — Tasha's subclasses onto the
 *     2014 classes the system still ships, because that is the edition they were written for.
 *  3. **Same module**, for a module that ships both without needing to be named here.
 *  4. **The stated fallback** in {@link CLASS_FALLBACK}, then first by uuid — stable across runs,
 *     and what every uncontested identifier resolves to. This is where a subclass whose module ships
 *     no class of its own lands: Ravenloft's Reanimator onto the Forge Artificer, every 2014 SRD
 *     subclass onto the 2014 SRD class.
 * @param {object[]} candidates    Class records for one identifier, uuid-sorted.
 * @param {string} subclassPack    The subclass's pack collection.
 */
function classFor(candidates, subclassPack) {
  const home = packageOf(subclassPack);
  const source = CLASS_SOURCE[home];
  const fallback = CLASS_FALLBACK[candidates[0].identifier];
  return candidates.find(c => c.pack === subclassPack)
    ?? (source ? candidates.find(c => c.pack === source) : null)
    ?? candidates.find(c => packageOf(c.pack) === home)
    ?? (fallback ? candidates.find(c => packageOf(c.pack) === fallback) : null)
    ?? candidates[0];
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
    const candidates = sub.classIdentifier ? classes.get(sub.classIdentifier) : null;
    const cls = candidates?.length ? classFor(candidates, sub.pack) : null;
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
      // The class pack is named only when the identifier was contested, because that is the only
      // time a reader could be wrong about which class the subclass was built onto.
      name: `Sweep: ${cls.name} ${level} — ${sub.name} (${sub.pack})`
        + (candidates.length > 1 ? ` [class: ${cls.pack}]` : ""),
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
