import { ABILITIES, t } from "../../config.mjs";

/**
 * Final review for a level-up. Read-only: it shows the level gained, the resulting hit-point
 * maximum, and the new features/items the advancement granted — read straight off the driver's
 * clone (which already reflects every choice) so the player can confirm before it is committed.
 * The "Apply" control lives on the shell footer.
 */
export const lvlReviewStep = {
  id: "review",
  icon: "fa-solid fa-clipboard-check",
  labelKey: "levelup.step.review.label",
  template: "levelup/review",

  isComplete() { return true; },

  summary() { return ""; },

  context({ state, driver }) {
    const clone = driver.clone;
    const actor = state.actor;

    // Items present on the clone but not the real actor are this level-up's new grants.
    const gained = clone.items
      .filter(i => !actor.items.get(i.id))
      .map(i => ({ name: i.name, img: i.img, uuid: i._stats?.compendiumSource ?? i.uuid }))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

    const hpMax = clone.system?.attributes?.hp?.max ?? actor.system?.attributes?.hp?.max ?? 0;
    const prevHpMax = actor.system?.attributes?.hp?.max ?? 0;
    const hpGain = Math.max(0, hpMax - prevHpMax);

    // Ability increases this level-up (ASI). Diff the clone against the actor so any source counts.
    const abilities = ABILITIES.reduce((arr, key) => {
      const now = clone.system?.abilities?.[key]?.value ?? 0;
      const was = actor.system?.abilities?.[key]?.value ?? 0;
      if ( now > was ) arr.push({
        abbr: CONFIG.DND5E?.abilities?.[key]?.abbreviation ?? key.slice(0, 3).toUpperCase(),
        delta: `+${now - was}`,
        value: now
      });
      return arr;
    }, []);

    // Weapon masteries gained this level-up. They live on the actor (not as items), so diff the
    // mastery key set on the clone against the actor and label each new one.
    const masteryNow = new Set(clone.system?.traits?.weaponProf?.mastery?.value ?? []);
    const masteryWas = new Set(actor.system?.traits?.weaponProf?.mastery?.value ?? []);
    const masteries = [...masteryNow].filter(k => !masteryWas.has(k))
      .map(k => dnd5e.documents.Trait.keyLabel(`weapon:${k}`) || k)
      .sort((a, b) => a.localeCompare(b, game.i18n.lang));

    // The subclass chosen this level-up — it also appears among the gained items, but it's the
    // defining pick of the level, so call it out as its own line.
    const subclasses = state.subclassSteps
      .map(r => driver.subclassState(r))
      .filter(s => s.chosen)
      .map(s => s.name);

    // Proficiency bonus change (character levels 5/9/13/17).
    const profNow = clone.system?.attributes?.prof ?? 0;
    const profWas = actor.system?.attributes?.prof ?? 0;

    return {
      title: t("levelup.step.review.gained", {
        class: state.classItem?.name ?? "",
        from: state.fromLevel,
        to: state.toLevel
      }),
      hpLabel: t("levelup.step.review.hp", { gain: hpGain, max: hpMax }),
      subclasses: subclasses.join(", "),
      hasSubclasses: subclasses.length > 0,
      abilities,
      hasAbilities: abilities.length > 0,
      profLabel: `+${profWas} → +${profNow}`,
      profChanged: profNow !== profWas,
      slots: slotChanges(clone, actor),
      scales: scaleChanges(clone, actor, state),
      masteries: masteries.join(", "),
      hasMasteries: masteries.length > 0,
      gained,
      hasGains: gained.length > 0
    };
  }
};

/**
 * Spell-slot changes this level-up: each leveled slot rank whose maximum moved, plus Pact Magic,
 * diffed between the clone's and the actor's derived spellcasting data.
 * @returns {{label: string, change: string}[]}
 */
function slotChanges(clone, actor) {
  const now = clone.system?.spells ?? {};
  const was = actor.system?.spells ?? {};
  const changes = [];
  for ( let l = 1; l <= 9; l++ ) {
    const to = now[`spell${l}`]?.max ?? 0;
    const from = was[`spell${l}`]?.max ?? 0;
    if ( to !== from ) changes.push({
      label: CONFIG.DND5E?.spellLevels?.[l] ?? String(l),
      change: `${from} → ${to}`
    });
  }
  // Pact Magic moves on two axes — slot count and slot level — so report either changing.
  const pactTo = now.pact ?? {};
  const pactFrom = was.pact ?? {};
  if ( ((pactTo.max ?? 0) !== (pactFrom.max ?? 0)) || ((pactTo.level ?? 0) !== (pactFrom.level ?? 0)) ) {
    const levelLabel = CONFIG.DND5E?.spellLevels?.[pactTo.level] ?? "";
    changes.push({
      label: t("levelup.step.review.pactSlots"),
      change: `${pactFrom.max ?? 0} → ${pactTo.max ?? 0}${levelLabel ? ` (${levelLabel})` : ""}`
    });
  }
  return changes;
}

/**
 * Scale-value bumps this level-up (Sneak Attack dice, Rage uses, Channel Divinity…): every
 * ScaleValue advancement on the levelled class — and any subclass of it on the clone — whose
 * display changes between the old and new class level. A subclass added *this* level-up has no
 * "before", so only what it now grants is shown.
 * @returns {{label: string, change: string}[]}
 */
function scaleChanges(clone, actor, state) {
  if ( !state.classItem ) return [];
  const cloneClass = clone.items.get(state.classItem.id);
  if ( !cloneClass ) return [];
  const oldLevel = actor.items.get(state.classItem.id)?.system?.levels ?? 0;
  const newLevel = cloneClass.system?.levels ?? oldLevel;

  // Subclass scale values are keyed by the base class's level, so both diff over the same range.
  const items = [cloneClass, ...clone.items.filter(i =>
    (i.type === "subclass") && (i.system?.classIdentifier === cloneClass.system?.identifier))];

  const changes = [];
  for ( const item of items ) {
    const isNew = !actor.items.get(item.id);
    for ( const adv of Object.values(item.advancement?.byId ?? {}) ) {
      if ( adv.type !== "ScaleValue" ) continue;
      const before = isNew ? null : (adv.valueForLevel(oldLevel)?.display ?? null);
      const after = adv.valueForLevel(newLevel)?.display ?? null;
      if ( !after || before === after ) continue;
      changes.push({ label: adv.title, change: before ? `${before} → ${after}` : after });
    }
  }
  return changes.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}
