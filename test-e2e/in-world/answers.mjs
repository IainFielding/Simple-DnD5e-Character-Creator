/**
 * The answer book: one decision-answering strategy, consumed identically by both build adapters.
 *
 * A hand-written answer table (`scenarios.mjs`) works for a handful of characters and not at all for
 * a sweep — ninety-odd subclasses carried to level 20 raise thousands of choices, and every one of
 * them has to be answered the *same way* on both sides or the diff reports answer differences
 * dressed up as character differences.
 *
 * Two guarantees make that safe:
 *
 * **Memoised.** An answer is computed once, on the first ask, and keyed by `advId@level`. Whoever
 * asks second gets the identical value — not an equivalent one, the same one. That is the whole
 * contract: the two adapters walk the build at different times, off different clones, in different
 * orders, and none of that can make them disagree about what was chosen.
 *
 * **Preferably static.** Generation reads `advancement.configuration` wherever it can, so a pick is
 * stable across runs and across the two sides independently. Where a choice genuinely depends on the
 * character (an expertise pool is "skills you are already proficient in"; an invocation's item
 * prerequisites are "features you already hold") the first asker resolves it against its own clone
 * and the memo carries that to the second. If the second side then does not offer that key, it says
 * so loudly — `distribute()` on the creator side and `untilFound()` on the native side both refuse a
 * pick that was never offered — which is a real finding, not a false failure.
 *
 * Answers come out in the shapes `scenarios.mjs` documents and the adapters already consume, so a
 * generated scenario and a hand-written one are indistinguishable downstream:
 *
 *   HitPoints                 "avg"
 *   Size                      "med"
 *   Trait                     ["skills:ath", "skills:ins"]
 *   ItemChoice                { uuids: [...], ability: "int" }
 *   ItemGrant                 "int"
 *   AbilityScoreImprovement   { int: 2, con: 1 }   — the total per ability, fixed part included
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const { findRestrictedItems, evalItemPrereq } = await import(`${MODULE}/data/choice-resolver.mjs`);

/** Ability keys in the order points are spent, so an allocation is reproducible. */
const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Whether an advancement's choice is deliberately routed around the driver rather than through it.
 *
 * During **creation**, spell-type `ItemChoice`s (Magic Initiate and every variant of it) are owned by
 * the creator's own feat-spells step, which applies the spells straight to the actor after commit.
 * The advancement therefore records nothing on that side by design. Both adapters read this one
 * predicate so they agree on which choices are in that category.
 *
 * During a **level-up** nothing is routed around: the wizard's choices step presents a spell choice
 * like any other (a Paladin's Blessed Warrior, Arcana Unleashed's Savants), so it is answered. It used
 * to be deferred in every phase, which made both builds apply nothing and agree — the reason the
 * sweep never saw the Savant pick being silently skipped.
 *
 * The phase is the asker's, not a level: a feat's advancements all sit at level 0 whether the feat
 * came from a background at creation or from an ASI at level 8.
 * @param {Advancement} adv
 * @param {"creation"|"levelup"} [phase="creation"]
 * @returns {boolean}
 */
export function isDeferred(adv, phase = "creation") {
  return (phase === "creation") && (adv?.type === "ItemChoice") && (adv?.configuration?.type === "spell");
}

/* -------------------------------------------- */
/*  Per-type generation                          */
/* -------------------------------------------- */

/** Sorted copy — every pool is ordered by its own key before slicing, so picks never drift. */
const sorted = keys => [...keys].sort((a, b) => String(a).localeCompare(String(b)));

/** Whether an advancement can raise this ability, tolerating a plain-object stand-in. */
function canImprove(adv, key) {
  if ( typeof adv.canImprove === "function" ) return adv.canImprove(key);
  return CONFIG.DND5E.abilities[key]?.improvement !== false;
}

/**
 * The first configured size, in the system's own size order rather than the configuration's, so two
 * species offering {sm, med} in different orders still answer the same.
 */
function generateSize(adv) {
  const sizes = new Set(adv.configuration?.sizes ?? []);
  if ( !sizes.size ) return { missing: "the Size advancement configures no sizes" };

  // One configured size is not a decision — the 2014 SRD species are all plain Medium. Both paths
  // apply it without asking anyone, so answering would only make the ledger report a decision
  // neither side made: the native manager renders a step for an automatic advancement and therefore
  // still asks, while the driver applies it silently. The same false positive `generateAsi` avoids
  // for a forced increase and `generateTrait` for a grants-only Trait.
  if ( sizes.size === 1 ) return { answer: null, note: "a single fixed size, nothing to choose" };

  const order = Object.keys(CONFIG.DND5E.actorSizes ?? {});
  const pick = order.find(s => sizes.has(s)) ?? sorted(sizes)[0];
  return { answer: pick };
}

/**
 * Trait picks: the first `count` keys of each choice group's expanded pool.
 *
 * Returned flat across every group, which is the shape the native flow's single select consumes and
 * which the creator adapter's `distribute()` splits back out per group. Keys an earlier group in the
 * same advancement already claimed are skipped so the two groups cannot both take one, and the
 * advancement's automatic `grants` are excluded — the driver and the native manager both seed those
 * before anyone is asked.
 *
 * The configured pool is never the whole story. What a character may actually pick is the pool minus
 * everything they already have — a Sage grants Arcana and History, so the Wizard's "choose 2 skills"
 * never offers those — and an **expertise** pool is not in the configuration at all, being "skills
 * this source already made you proficient in". So the asker's own rendered list, where it has one,
 * narrows each group; the memo then carries the result to the other side.
 */
async function generateTrait(adv, offered, reserved = new Set()) {
  const Trait = dnd5e.documents.Trait;
  const cfg = adv.configuration ?? {};
  const groups = Array.from(cfg.choices ?? []);
  // Grants only — the commonest Trait there is (saving throws, armour training, a class's weapon
  // proficiencies). Both sides apply it from the same seed and neither has anything to decide.
  if ( !groups.length ) return { answer: null, note: "grants only, nothing to choose" };

  const granted = (await Trait.mixedChoices(new Set(cfg.grants ?? []))).asSet();
  // Keys *another* origin grants outright, in this advancement's mode. The creator resolves the whole
  // build at once and never offers them (`collectTakenTraitKeys`); the native build adds species
  // before background, so a species pick is asked while the background's grants have not landed.
  // Answering with one handed the creator a pick it refuses: House Orien Heir grants Acrobatics, the
  // Human's Skillful was answered Acrobatics, and each side recorded it on a different item.
  const mode = cfg.mode || "default";
  for ( const entry of reserved ) {
    const [m, key] = entry.split("|");
    if ( (m === mode) && !(cfg.grants ?? new Set()).has?.(key) ) granted.add(key);
  }
  const taken = new Set(adv.value?.chosen ?? []);
  const available = new Set((await offered?.()) ?? []);
  const picks = [];

  for ( const group of groups ) {
    const count = group.count ?? 1;
    if ( !count ) continue;

    // Expertise has no configured pool to start from, so the asker's list *is* the pool. Every other
    // mode starts from the configuration and is narrowed by it — keeping the groups distinct, which
    // a flat list would lose and which the creator's `distribute()` needs to split the picks back.
    let pool = (cfg.mode === "expertise")
      ? sorted(available)
      : sorted((await Trait.mixedChoices(group.pool)).asSet());
    if ( available.size && (cfg.mode !== "expertise") ) pool = pool.filter(k => available.has(k));

    let remaining = count;
    for ( const key of pool ) {
      if ( !remaining ) break;
      if ( granted.has(key) || taken.has(key) ) continue;
      picks.push(key);
      taken.add(key);
      remaining--;
    }
    if ( remaining ) {
      // A pool big enough for the choice, emptied by what the character already has, is *exhausted*
      // rather than too small — an Eberron background whose one offered proficiency it also grants
      // outright is the case in the wild. Neither side can pick anything, so both apply nothing and
      // the two agree; reporting it as unanswerable failed the scenario over a non-difference.
      //
      // A pool genuinely shorter than the choice is a different thing and still reported: that is
      // content the generator cannot satisfy, and silence would hide it.
      if ( pool.length >= count ) continue;
      // An *empty* pool is the same symmetry once more: neither side can pick anything, so both
      // apply nothing and agree. The 2024 Criminal background ships a "Background Proficiencies"
      // choice of 1 over no options at all. Recorded as a note so the oddity stays visible in the
      // report rather than failing a scenario over a non-difference.
      if ( !pool.length ) {
        return { answer: null, note: `"${adv.title}" offers no options for a choice of ${count}` };
      }
      return {
        missing: `"${adv.title}" offers ${pool.length} key(s) for a choice of ${count}`
          + `${available.size ? "" : " (the asker showed no pool, so this is the configured one)"}`
      };
    }
  }
  if ( !picks.length ) return { answer: null, note: "every choice group is already fulfilled" };
  return { answer: picks };
}

/**
 * Feature picks for an `ItemChoice`: the first `count` eligible uuids of the pool, plus the casting
 * ability when the choice grants spells.
 *
 * Eligibility mirrors the gate the level-up choices screen and the native flow both apply — an
 * option whose prerequisite level exceeds this feature's level, or whose item prerequisites the
 * build does not hold, is not pickable (a Warlock's Improved Pact Weapon before Pact of the Blade).
 * A drop-restricted pool (the Artificer's "Replicate Magic Item") carries no authored options at
 * all; those come from the same compendium scan the creator uses.
 */
async function generateItemChoice(adv, level, offered, reserved = new Set()) {
  const cfg = adv.configuration ?? {};
  const count = cfg.choices?.[level]?.count ?? 0;
  const ability = sorted(cfg.spell?.ability ?? [])[0] ?? null;
  // Nothing to pick at this level. A casting ability is still an answer; without one there is no
  // decision here at all.
  if ( !count ) {
    return ability ? { answer: { uuids: [], ability } } : { answer: null, note: "no picks at this level" };
  }

  const featureLevel = level || adv.actor?.system?.details?.level || null;
  const owned = new Set(adv.actor?.identifiedItems?.keys() ?? []);
  // Anything this advancement already granted at another level is not on offer again.
  const already = new Set(Object.values(adv.value?.added ?? {}).flatMap(m => Object.values(m ?? {})));

  // The asker's own pool, when it has one, is the authority: it has already been gated by the
  // prerequisites the compendium documents alone cannot decide (a Warlock's Improved Pact Weapon
  // needing Pact of the Blade). Falling back to the configuration and re-deriving the gate is for
  // the asker that has no rendered pool to read.
  let candidates = (await offered?.())?.filter(u => !already.has(u)) ?? [];

  if ( !candidates.length ) {
    for ( const entry of Array.from(cfg.pool ?? []) ) {
      const uuid = entry?.uuid ?? entry;
      if ( !uuid ) continue;
      const doc = await fromUuid(uuid).catch(() => null);
      if ( !doc ) continue;
      // The document's own uuid, not the configured one. Older content stores the pre-v10 form
      // (`Compendium.<pack>.<id>`, no `.Item.` segment) — the Ranger's "Hunter's Prey" is one — and
      // the rendered checkboxes are named with the modern form, so answering with the pool's string
      // verbatim names a control that does not exist. `fromUuid` resolves both; `doc.uuid` is
      // whichever one the rest of the world uses.
      const canonical = doc.uuid ?? uuid;
      if ( already.has(canonical) ) continue;
      const prereq = doc.system?.prerequisites ?? {};
      if ( (featureLevel != null) && (Number(prereq.level ?? 0) > featureLevel) ) continue;
      const { hasReq, met } = evalItemPrereq(prereq.items, owned);
      if ( hasReq && !met ) continue;
      candidates.push(canonical);
    }
  }

  // A restriction-driven pool has no authored entries at all; the compendium browser is the only
  // route natively, and this scan is what the creator's own screen lists.
  if ( !candidates.length && (cfg.restriction?.type || cfg.restriction?.subtype) ) {
    for ( const opt of await findRestrictedItems(cfg, featureLevel) ) {
      if ( already.has(opt.uuid) ) continue;
      const { hasReq, met } = evalItemPrereq(opt.prereqItems, owned);
      if ( hasReq && !met ) continue;
      candidates.push(opt.uuid);
    }
  }

  // A non-repeatable feat another origin grants is not a legal pick, and the creator does not offer
  // it. Native asks before the background's grant has landed, so its rendered pool still lists it:
  // a Human's Versatile was answered Alert while the Criminal background grants Alert, building two
  // copies natively and a refused pick in the creator.
  const uuids = [];
  for ( const uuid of sorted(candidates) ) {
    if ( uuids.length >= count ) break;
    const name = (await fromUuid(uuid).catch(() => null))?.name?.trim().toLowerCase();
    if ( name && reserved.has(`feat|${name}`) ) continue;
    uuids.push(uuid);
  }
  if ( uuids.length < count ) {
    return { missing: `"${adv.title}" has ${uuids.length} eligible option(s) for a choice of ${count} at level ${level}` };
  }
  return { answer: ability ? { uuids, ability } : uuids };
}

/**
 * The pack a duplicated spell is taken from, most preferred first.
 *
 * With the PHB module installed, most class spells exist twice — the module's copy and dnd5e's own
 * SRD 5.2 copy — and a spell list names both. A player picking natively takes the PHB copy they own
 * the book for, so the book does too. This only breaks a tie between copies of one spell; which
 * spells are *eligible* comes from dnd5e alone (see {@link generateSpellChoice}).
 */
const SPELL_PACK_PREFERENCE = ["Compendium.dnd-players-handbook.spells.", "Compendium.dnd5e.spells24."];

/** How far down {@link SPELL_PACK_PREFERENCE} a uuid sits; unlisted packs rank last. */
function spellPackRank(uuid) {
  const i = SPELL_PACK_PREFERENCE.findIndex(p => uuid.startsWith(p));
  return i < 0 ? SPELL_PACK_PREFERENCE.length : i;
}

/** Spell index entries by pack, fetched once per session with the fields a restriction reads. */
const spellIndexes = new Map();
async function spellIndexEntry(uuid) {
  const parsed = foundry.utils.parseUuid(uuid);
  const pack = parsed?.collection;
  if ( !pack?.getIndex ) return fromUuid(uuid).catch(() => null);
  if ( !spellIndexes.has(pack.collection) ) {
    spellIndexes.set(pack.collection, pack.getIndex({ fields: ["system.level", "system.school"] }));
  }
  return (await spellIndexes.get(pack.collection)).get(parsed.documentId) ?? null;
}

/** Every spell the Compendium Browser can see, as dnd5e's own flow fetches them. Once per session. */
let allSpells = null;
function allSpellEntries() {
  allSpells ??= dnd5e.applications.CompendiumBrowser.fetch(Item, {
    types: new Set(["spell"]),
    indexFields: new Set(["system.level", "system.school"])
  }).then(entries => Array.from(entries ?? []));
  return allSpells;
}

/**
 * The highest spell-slot level for an "available" restriction when no native flow is at hand to ask.
 * The same arithmetic as dnd5e's `ItemChoiceFlow#_maxSpellSlotLevel`: a casting class or subclass
 * item reads its own progression — at the decision's level, which is the class level the native
 * manager's clone stands at when it renders the step — and anything else reads the actor's slots.
 */
function fallbackMaxSpellSlot(adv, level) {
  const Actor5e = CONFIG.Actor.documentClass;
  const sc = adv.item?.spellcasting;
  let spells;
  if ( sc?.type ) {
    const progression = Object.fromEntries(Object.keys(CONFIG.DND5E.spellcasting).map(k => [k, 0]));
    const maxSpellLevel = Object.keys(CONFIG.DND5E.spellLevels).length - 1;
    spells = Object.fromEntries(Array.from({ length: maxSpellLevel }, (_, i) => [`spell${i + 1}`, {}]));
    const spellcasting = level ? { ...sc, levels: Math.min(sc.levels ?? level, level) } : sc;
    Actor5e.computeClassProgression(progression, adv.item, { spellcasting });
    Actor5e.prepareSpellcastingSlots(spells, sc.type, progression);
  } else spells = adv.actor?.system?.spells ?? {};
  return Object.values(spells).reduce((slot, s) => (s?.max ? Math.max(slot, s.level || -1) : slot), 0);
}

/**
 * Picks for a **spell** `ItemChoice` restricted to a spell list — "learn two Cleric cantrips", or a
 * Savant's "two wizard spells of a level you have slots for".
 *
 * The native flow renders no options for these, only a compendium-browser button, and the creator's
 * choices step builds its own grid. Taking the pool from either side's screen would make that side
 * its own oracle: if our screen offered nothing (the Savant bug), the book would answer nothing and
 * both builds would agree. So the pool comes from dnd5e alone — the spell-list registry, the
 * restriction's level and school, and for "available" the slot level dnd5e's own flow computes
 * (`maxSpellSlot`, handed over by the native adapter, which asks first). The creator adapter then
 * checks each pick against what its choices step actually offers (`creator.mjs#checkSpellOffers`).
 *
 * Spells the character already holds, by name, are skipped. The native browser would let a player
 * take one twice while the creator shows it as taken — a known, deliberate difference, and not the
 * one under test.
 */
async function generateSpellChoice(adv, level, { offered, reserved, maxSpellSlot } = {}) {
  const cfg = adv.configuration ?? {};
  const restriction = cfg.restriction ?? {};
  const lists = Array.from(restriction.list ?? []);
  // An authored pool (a fixed handful of spells) renders checkboxes like any feature choice.
  if ( Array.from(cfg.pool ?? []).length ) return generateItemChoice(adv, level, offered, reserved);

  const count = cfg.choices?.[level]?.count ?? 0;
  const ability = sorted(cfg.spell?.ability ?? [])[0] ?? null;
  if ( !count ) {
    return ability ? { answer: { uuids: [], ability } } : { answer: null, note: "no picks at this level" };
  }

  const raw = restriction.level;
  let levels = null;
  if ( (raw === "available") || (raw === "availableNoCantrips") ) {
    const max = (await maxSpellSlot?.()) ?? fallbackMaxSpellSlot(adv, level);
    const min = raw === "availableNoCantrips" ? 1 : 0;
    levels = new Set(Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i));
  } else if ( (raw !== "") && (raw != null) && Number.isInteger(Number(raw)) ) {
    levels = new Set([Number(raw)]);
  }
  const schools = new Set(restriction.school ?? []);

  const already = new Set(Object.values(adv.value?.added ?? {}).flatMap(m => Object.values(m ?? {})));
  const held = new Set((adv.actor?.itemTypes?.spell ?? []).map(s => s.name.trim().toLowerCase()));
  const byName = new Map();
  const consider = (uuid, entry) => {
    if ( !uuid || !entry || already.has(uuid) ) return;
    if ( levels && !levels.has(Number(entry.system?.level)) ) return;
    if ( schools.size && !schools.has(entry.system?.school) ) return;
    const name = entry.name?.trim().toLowerCase();
    if ( !name || held.has(name) ) return;
    const current = byName.get(name);
    const better = !current || (spellPackRank(uuid) < spellPackRank(current))
      || ((spellPackRank(uuid) === spellPackRank(current)) && (uuid < current));
    if ( better ) byName.set(name, uuid);
  };
  if ( lists.length ) {
    for ( const list of lists ) {
      const spellList = dnd5e.registry?.spellLists?.forType?.(list);
      for ( const uuid of spellList?.uuids ?? [] ) consider(uuid, await spellIndexEntry(uuid));
    }
  } else {
    // No list: "any spell of this level" — the 2014 Bard's Magical Secrets, the 2014 Wizard's
    // Signature Spells. dnd5e's flow opens its browser filtered by level alone, so the pool is what
    // that browser fetches, not anything of ours.
    for ( const entry of await allSpellEntries() ) consider(entry.uuid, entry);
  }

  const uuids = [...byName.keys()].sort().slice(0, count).map(n => byName.get(n));
  if ( uuids.length < count ) {
    const shown = levels ? [...levels].join("/") : "any";
    return { missing: `"${adv.title}" has ${uuids.length} eligible spell(s) on ${lists.join(", ") || "any list"} `
      + `at level(s) ${shown} for a choice of ${count} at level ${level}` };
  }
  return { answer: ability ? { uuids, ability } : uuids };
}

/**
 * The casting ability for a spell-granting ItemGrant: the first the configuration allows.
 *
 * Only a genuine choice counts. A grant that allows exactly one ability — which is most of them, a
 * subclass's "Cartographer Spells" being `["int"]` — has nothing to decide, and dnd5e's
 * `automaticApplicationValue` says so: both the native manager and our driver apply it without
 * asking anyone. Reporting a value for it would make every such grant look like a one-sided decision
 * on the sweep, because the native wizard still renders a step for an automatic advancement (and so
 * still asks the book) while the driver applies it silently. A prepared-caster subclass has one of
 * these at five levels; that is a lot of noise for nothing.
 */
function generateGrantAbility(adv) {
  const abilities = sorted(adv.configuration?.spell?.ability ?? []);
  if ( abilities.length < 2 ) {
    return { answer: null, note: `casting ability is fixed at ${abilities[0] ?? "n/a"}` };
  }
  return { answer: abilities[0] };
}

/**
 * An ability-score allocation: spend the whole point budget on the first improvable, unlocked
 * abilities in {@link ABILITY_ORDER}, respecting the per-ability cap.
 *
 * Reported as the *total* per ability with the configuration's fixed part folded in, which is the
 * shape the native form takes and the shape a hand-written scenario states.
 *
 * A feat is never taken in place of the points. Which feat a build can legally take depends on its
 * prerequisites and pulls a second advancement tree in behind it; that belongs in a scenario written
 * for it, not in a sweep whose subject is the subclass.
 */
/**
 * Every *general* feat in the world, uuid-sorted, memoised for the session.
 *
 * Only `subtype: "general"` — origin feats come from a background and epic boons and fighting styles
 * are taken through their own advancements, none of which is what an ASI offers. Feats carrying
 * `prerequisites.items` are excluded outright rather than evaluated: deciding whether the character
 * satisfies one is exactly the gating logic under test elsewhere, and a book that re-implemented it
 * would be marking its own homework. What is left is the large majority, and every one of them is
 * takeable by anyone of the right level.
 */
let generalFeats = null;
async function loadGeneralFeats() {
  if ( generalFeats ) return generalFeats;
  const out = [];
  for ( const pack of game.packs.filter(p => p.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.type.value", "system.type.subtype",
      "system.prerequisites.level", "system.prerequisites.items", "system.prerequisites.repeatable",
      "system.advancement"] });
    for ( const e of index ) {
      if ( (e.type !== "feat") || (e.system?.type?.value !== "feat") ) continue;
      if ( e.system?.type?.subtype !== "general" ) continue;
      if ( Array.from(e.system?.prerequisites?.items ?? []).length ) continue;
      const advancement = e.system?.advancement ?? [];
      out.push({
        uuid: e.uuid, name: e.name,
        level: e.system?.prerequisites?.level ?? 0,
        repeatable: !!e.system?.prerequisites?.repeatable,
        // Source data stores advancement as an array, a prepared document as a map; take either.
        advTypes: new Set((Array.isArray(advancement) ? advancement : Object.values(advancement))
          .map(a => a?.type).filter(Boolean))
      });
    }
  }
  generalFeats = out.sort((a, b) => a.uuid.localeCompare(b.uuid));
  return generalFeats;
}

/**
 * Prerequisites that content enforces inside an advancement **flow** rather than in
 * `system.prerequisites`, keyed by advancement type. A feat carrying one of these types is only
 * taken when its gate passes for the character.
 *
 * Written from the content module's own flow, deliberately *not* imported from the creator's
 * `CONTENT_FEAT_PREREQS`: the native side is the oracle here, and a book that borrowed the creator's
 * gate would mark its own homework.
 *
 * **PotentDragonmark** (Forge of the Artificer): `PotentDragonmarkFlow#_updateObject` throws unless
 * the actor holds a `dragonmark` feat whose identifier starts `mark-`. Its feat, Potent Dragonmark,
 * declares only `level: 4` — "Any Dragonmark Feat" is free text — so it passed the filter above and,
 * sorting first by uuid, was the feat every character took. Every character without a dragonmark
 * then stranded natively on *"No Dragonmark feat found!"*: 13 of the first 15 background scenarios
 * on the 6.0.2 sweep. Earlier notes put that down to a type the step driver could not drive; the
 * step's own error said otherwise.
 * @type {Record<string, (actor: Actor5e) => boolean>}
 */
const CONTENT_GATES = {
  PotentDragonmark: actor => (actor?.itemTypes?.feat ?? []).some(i => (i.system?.type?.value === "feat")
    && (i.system?.type?.subtype === "dragonmark") && String(i.identifier ?? "").startsWith("mark-"))
};

/** Whether every content gate a feat's advancements carry passes for this actor. */
function passesContentGates(feat, actor) {
  return [...feat.advTypes].every(type => !CONTENT_GATES[type] || CONTENT_GATES[type](actor));
}

/**
 * Answer an ASI by taking a **feat** rather than allocating points — the `asiFeats` axis.
 *
 * The subclass sweep spends every ASI on ability scores, so across 122 level-20 characters not one
 * feat is ever taken and nothing a feat *brings* (its own ASI, its grants, its spell choices) is
 * compared. This answers each ASI with the first eligible general feat not already held, walking
 * further down one stable uuid-sorted list at each successive ASI so a character taking five of them
 * takes five different ones. "Eligible" includes the content-enforced gates in {@link CONTENT_GATES},
 * so a dragonmarked character still takes Potent Dragonmark and everyone else skips it.
 * @param {Advancement} adv
 * @param {number} level   The character level the decision is raised at.
 */
async function generateAsiFeat(adv, level) {
  const cfg = adv.configuration ?? {};
  // Only a *class* ASI offers a feat. Ask the advancement rather than re-deriving the rule: the
  // system's own `allowFeat` getter is `(item.type === "class") && <the allowFeats setting> …`,
  // which also picks up the world's variant settings for free.
  //
  // This used to test `points > 0` on the reasoning that a background increase offers no feat. It
  // does not — a 2024 background's "+2/+1 to distribute" *has* points, so every origin increase
  // sailed through and was answered with a feat, and the native side then failed with "the ASI
  // screen … offers no feat browser". Invisible until the axis was first actually wired up
  // (2026-08-16), because this function had never executed.
  if ( !adv.allowFeat || ((cfg.points ?? 0) <= 0) ) return generateAsi(adv);

  const feats = await loadGeneralFeats();
  const held = new Set(adv.actor?.items?.map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId) ?? []);
  const characterLevel = level || adv.actor?.system?.details?.level || 0;
  const pick = feats.find(f => (f.level <= characterLevel) && (f.repeatable || !held.has(f.uuid))
    && passesContentGates(f, adv.actor));
  if ( !pick ) return { missing: `no general feat is takeable at level ${characterLevel}` };
  return { answer: { feat: pick.uuid } };
}

function generateAsi(adv) {
  const cfg = adv.configuration ?? {};
  const fixed = cfg.fixed ?? {};
  const cap = cfg.cap ?? Infinity;
  const budget = cfg.points ?? 0;

  const open = ABILITY_ORDER.filter(k => canImprove(adv, k) && !cfg.locked?.has?.(k));

  // Nothing to decide: a capstone's fixed `+4` (Primal Champion, Body and Mind), a half-feat's `+1`,
  // or a budget with a single legal target. Both sides apply these without asking anyone — the
  // driver holds them back and applies them in level order, the native manager's pre-render seed
  // lands them — so answering would only make the ledger report a decision neither side made.
  if ( (budget <= 0) || (open.length <= 1) ) {
    return { answer: null, note: "a forced increase, not an allocation" };
  }

  const totals = {};
  for ( const [key, value] of Object.entries(fixed) ) if ( value ) totals[key] = Number(value);
  let points = budget;
  for ( const key of open ) {
    if ( !points ) break;
    const spend = Math.min(points, cap);
    totals[key] = (totals[key] ?? 0) + spend;
    points -= spend;
  }
  if ( points ) return { missing: `"${adv.title}" has ${points} unspendable point(s) — every ability is locked or capped` };
  return { answer: totals };
}

/* -------------------------------------------- */

/**
 * Generate one answer.
 * @param {Advancement} adv
 * @param {number} level
 * @param {object} [options]
 * @param {Function} [options.offered]   The asker's own option list, for the choices that only exist
 *                                       against a character (see {@link generateTrait}).
 * @returns {Promise<{answer?: *, missing?: string, note?: string}>}
 */
async function generate(adv, level, { offered, asiFeats = false, reserved, phase, maxSpellSlot } = {}) {
  if ( isDeferred(adv, phase) ) return { answer: null, note: "deferred to the creator's feat-spells step" };
  if ( (adv?.type === "ItemChoice") && (adv.configuration?.type === "spell") ) {
    return generateSpellChoice(adv, level, { offered, reserved, maxSpellSlot });
  }
  switch ( adv?.type ) {
    case "HitPoints": return { answer: "avg" };   // never "roll" — a die is not an equivalence test
    case "Size": return generateSize(adv);
    case "Trait": return generateTrait(adv, offered, reserved);
    case "ItemChoice": return generateItemChoice(adv, level, offered, reserved);
    case "ItemGrant": return generateGrantAbility(adv);
    case "AbilityScoreImprovement": return asiFeats ? generateAsiFeat(adv, level) : generateAsi(adv);
    case "Subclass":
      // The subclass is the variable a sweep is sweeping. Generating one would defeat the point, so
      // a scenario that raises this decision must state it.
      return { missing: "a Subclass decision has to be stated by the scenario" };
    default:
      // ScaleValue and anything third-party: no answer is needed, both sides auto-apply. Recorded so
      // the report can show what a run walked past rather than leaving it invisible.
      return { answer: null, note: `${adv?.type ?? "unknown"} needs no answer` };
  }
}

/* -------------------------------------------- */

/**
 * The memo key for one decision: the owning item, the advancement id and the level.
 *
 * The item is part of it because advancement ids are **not** unique across items. Content built
 * from a template reuses them: every Heroes of Faerûn feat carries its half-ASI as
 * `v1EPmPE0rI7wlOYj`, and every feat's advancements run at level 0. Keyed on `advId@level` alone,
 * the first such feat's answer was handed to every later one — Cold Caster's `{int: 1}` reached
 * Street Justice, which locks Intelligence, so native applied nothing and the creator applied the
 * point anyway. The identifier is what both builds agree on; the item's id is minted per actor.
 * @param {Advancement} adv
 * @param {number} level
 */
function memoKey(adv, level) {
  const item = adv?.item?.identifier || adv?.item?.name || "";
  return `${item}:${adv?.id}@${level}`;
}

export class AnswerBook {

  /** @type {object} Hand-written answers keyed by advancement id; they win over generation. */
  #overrides;

  /** @type {boolean} Whether unanswered decisions are generated or simply left alone. */
  #generate;

  /**
   * @type {boolean} Whether a generated ASI takes a feat instead of allocating points. The axis that
   * exists because the subclass sweep never takes a feat at all.
   *
   * **This was stored and never read until 2026-08-16, so the axis did nothing.** The flag
   * travelled correctly as far as here — `sweep.mjs` sets `asiFeats: true`, `harness.mjs` passes it
   * to the constructor — but the generate call in {@link answer} read
   * `generate(adv, level, { offered })` without it, so the parameter fell back to its `false`
   * default and `generateAsiFeat` was unreachable. Every ASI on the background axis allocated
   * ability points instead of taking a feat, which is exactly the gap the axis was added to close
   * (see the README's "Feats: never taken"). Found by `no-unused-private-class-members` when the
   * harness was first brought into the lint scope — the field being unread *was* the bug, so the
   * rule that flagged it is the one worth keeping enabled here.
   *
   * **Consequence for baselines:** every archived `sweep-results-background-*.jsonl` predates the
   * fix and was recorded without feats, so it is not comparable with a run taken after it. Re-take
   * the baseline rather than diffing across the change.
   */
  #asiFeats;

  /** @type {Map<string, object>} `advId@level` → the ledger entry holding the settled answer. */
  #memo = new Map();

  /**
   * @param {object} [options]
   * @param {object} [options.overrides]   The scenario's `answers` table.
   * @param {boolean} [options.generate]   Generate an answer for anything the table does not cover.
   */
  constructor({ overrides = {}, generate = false, asiFeats = false, origins = [] } = {}) {
    this.#overrides = overrides ?? {};
    this.#generate = generate;
    this.#asiFeats = asiFeats;
    this.#origins = (origins ?? []).filter(Boolean);
  }

  /** @type {string[]} The scenario's species, background and class uuids. */
  #origins;

  /** @type {Promise<Set<string>>|null} `mode|key` for every trait an origin grants at level 0–1. */
  #reserved = null;

  /**
   * Every trait key an origin grants outright at creation, as `mode|key` — the same set, in the same
   * shape, the creator's `collectTakenTraitKeys` builds and hides from every other choice. See
   * {@link generateTrait} for why the generator has to know it before the native build has applied it.
   * Features an origin *grants* at level 0–1 are walked too, as the creator walks them
   * (`levelOneOwners`): Dragon Cultist grants Cult of the Dragon Initiate, whose Dragon's Tongue grants
   * Draconic, and the background's own language choice was answered Draconic before that landed.
   * Only fixed grants are followed; an `ItemChoice` pick is not known until it is answered.
   */
  #reservedKeys() {
    this.#reserved ??= (async () => {
      const out = new Set();
      const seen = new Set();
      const walk = async (uuid, depth) => {
        if ( !uuid || seen.has(uuid) || (depth > 3) ) return;
        seen.add(uuid);
        const doc = await fromUuid(uuid).catch(() => null);
        // A granted non-repeatable feat is reserved too, as `feat|<name>`: no feat choice may take it
        // again (the creator's `collectGrantedFeatNames`). The origins themselves are not feats.
        if ( (depth > 0) && (doc?.type === "feat") && !doc.system?.prerequisites?.repeatable ) {
          out.add(`feat|${doc.name.trim().toLowerCase()}`);
        }
        for ( const adv of Object.values(doc?.advancement?.byId ?? {}) ) {
          if ( (adv.level ?? 0) > 1 ) continue;
          if ( adv.type === "Trait" ) {
            const mode = adv.configuration?.mode || "default";
            for ( const key of adv.configuration?.grants ?? [] ) out.add(`${mode}|${key}`);
          } else if ( (adv.type === "ItemGrant") && !adv.configuration?.optional ) {
            for ( const entry of adv.configuration?.items ?? [] ) {
              if ( !entry?.optional ) await walk(entry?.uuid ?? entry, depth + 1);
            }
          }
        }
      };
      for ( const uuid of this.#origins ) await walk(uuid, 0);
      return out;
    })();
    return this.#reserved;
  }

  /* -------------------------------------------- */

  /**
   * Resolve an override for one decision.
   *
   * A per-level map (`{ 2: "avg", 3: "max" }`) selects by the decision's level — one advancement can
   * raise a decision at several levels, hit points being the obvious case. A scalar applies at every
   * level. Both adapters used to do this themselves, in two places that had to be kept in step.
   */
  #override(advId, level) {
    const value = this.#overrides[advId];
    if ( value === undefined ) return undefined;
    const isMap = value && (typeof value === "object") && !Array.isArray(value);
    return (isMap && (level in value)) ? value[level] : value;
  }

  /* -------------------------------------------- */

  /**
   * The answer for one decision, computed once and shared by every asker afterwards.
   * @param {Advancement} adv
   * @param {number} level
   * @param {object} [options]
   * @param {string} [options.asker]      "native" or "creator" — recorded, never used to decide.
   * @param {Function} [options.offered]  The asker's own option list, where generation needs one.
   * @param {string} [options.phase]      "creation" or "levelup": whether a spell choice is deferred
   *   (see {@link isDeferred}). Both sides ask any one decision in the same phase.
   * @param {Function} [options.maxSpellSlot]  The native flow's `_maxSpellSlotLevel`, for an
   *   "available" spell restriction (see {@link generateSpellChoice}).
   * @returns {Promise<*>}  The answer, or `undefined` when there is none.
   */
  async answer(adv, level, { asker, offered, phase = "creation", maxSpellSlot } = {}) {
    if ( !adv?.id ) return undefined;
    const key = memoKey(adv, level);

    let entry = this.#memo.get(key);
    if ( !entry ) {
      entry = {
        advId: adv.id, level, type: adv.type, title: adv.title ?? null,
        item: adv.item?.name ?? null, source: null, answer: undefined,
        missing: null, note: null, askedBy: []
      };
      this.#memo.set(key, entry);

      const override = this.#override(adv.id, level);
      if ( override !== undefined ) {
        entry.answer = override;
        entry.source = "override";
      } else if ( this.#generate ) {
        const result = await generate(adv, level, {
          offered, asiFeats: this.#asiFeats, reserved: await this.#reservedKeys(), phase, maxSpellSlot
        });
        entry.answer = result.answer;
        entry.missing = result.missing ?? null;
        entry.note = result.note ?? null;
        entry.source = result.missing ? "missing" : "generated";
      } else {
        // Not a generating scenario and the table says nothing: both sides fall through to the seed
        // the manager (and now the driver) applies, which is the same on either path.
        entry.source = "unanswered";
      }
    }

    if ( asker && !entry.askedBy.includes(asker) ) entry.askedBy.push(asker);
    return entry.answer;
  }

  /**
   * The already-settled answer for a decision, without computing one.
   *
   * `LevelUpDriver#autoResolve` reads its provider synchronously, so the creator adapter warms every
   * decision the driver surfaced before resolving and the provider reads the memo through this. A
   * miss means the warm did not cover that decision, which is a harness bug rather than an
   * unanswered choice — it surfaces as `undefined`, exactly as an unanswered one would.
   * @param {Advancement} adv
   * @param {number} level
   * @param {string} [asker]
   */
  peek(adv, level, asker) {
    const entry = this.#memo.get(memoKey(adv, level));
    if ( !entry ) return undefined;
    if ( asker && !entry.askedBy.includes(asker) ) entry.askedBy.push(asker);
    return entry.answer;
  }

  /** @see {isDeferred} — exposed here so an adapter needs only the book. */
  isDeferred(adv, phase) {
    return isDeferred(adv, phase);
  }

  /* -------------------------------------------- */

  /** Every decision either adapter asked about, in the order it was first raised. */
  get entries() {
    return [...this.#memo.values()];
  }

  /**
   * Decisions the book should have answered and could not — a content shape the generator does not
   * understand. Worth failing one scenario over: left alone it produces an inexplicable difference
   * in every scenario that touches the same content.
   */
  get missing() {
    return this.entries.filter(e => e.missing);
  }

  /**
   * Decisions raised by only one adapter. A choice the native wizard offers and our driver never
   * surfaces (or the reverse) is a real divergence, and one the character diff shows only
   * indirectly — as a missing item, or not at all.
   * @param {string[]} askers   The adapters that ran, e.g. `["native", "creator"]`.
   */
  asymmetric(askers = ["native", "creator"]) {
    return this.entries.filter(e => e.askedBy.length && (e.askedBy.length < askers.length));
  }
}
