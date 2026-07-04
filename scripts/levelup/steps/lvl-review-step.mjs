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

    return {
      title: t("levelup.step.review.gained", {
        class: state.classItem?.name ?? "",
        from: state.fromLevel,
        to: state.toLevel
      }),
      hpLabel: t("levelup.step.review.hp", { gain: hpGain, max: hpMax }),
      abilities,
      hasAbilities: abilities.length > 0,
      masteries: masteries.join(", "),
      hasMasteries: masteries.length > 0,
      gained,
      hasGains: gained.length > 0
    };
  }
};
