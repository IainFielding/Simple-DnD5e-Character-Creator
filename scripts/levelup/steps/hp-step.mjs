import { t } from "../../config.mjs";
import { atLevel } from "../levelup-state.mjs";

/**
 * Hit points — the one decision a no-choice level-up presents. One row per gained level
 * (usually just one): take the class average, or roll the hit die. The choice is applied
 * to the driver's clone immediately, so the Review step and the committed actor always
 * reflect what the player sees here.
 */

/** The HP this decision contributes: the average, the die max, or the rolled number. */
function contributed(record) {
  if ( record.value === "avg" ) return record.average;
  if ( record.value === "max" ) return record.advancement.hitDieValue;
  return Number.isInteger(record.value) ? record.value : record.average;
}

export const hpStep = {
  id: "hp",
  icon: "fa-solid fa-heart",
  labelKey: "levelup.step.hp.label",
  template: "levelup/hp",

  isCompleteAt(state, level) {
    return atLevel(state.hpSteps, level)
      .every(s => s.value === "avg" || s.value === "max" || Number.isInteger(s.value));
  },

  sectionsAt({ state }, level) {
    const records = atLevel(state.hpSteps, level);
    if ( !records.length ) return null;
    const className = state.classItem?.name ?? "";
    const total = records.reduce((sum, r) => sum + contributed(r), 0);
    return {
      // Hit points are buttons/inputs, not an option grid, so no card-density tier applies.
      density: "form",
      blockStatus: t("levelup.step.hp.summary", { hp: total }),
      intro: t("levelup.step.hp.intro", { class: className }),
      // One screen per level, so a level's hit-point row never needs its own level label.
      rows: records.map(record => ({
        index: state.hpSteps.indexOf(record),
        levelLabel: "",
        hitDie: record.hitDie,
        average: record.average,
        max: record.advancement.hitDieValue,
        rollLabel: t("levelup.step.hp.roll", { die: record.hitDie }),
        isAverage: record.mode === "avg",
        isMax: record.mode === "max",
        isRoll: record.mode === "roll",
        isManual: record.mode === "manual",
        // The roll button shows its result; the value box is seeded with the current number and
        // stays editable so the player can type a hit-point total directly.
        rolled: record.mode === "roll" ? contributed(record) : null,
        current: contributed(record),
        total: contributed(record)
      }))
    };
  },

  async handle(action, el, { state, driver }) {
    const record = state.hpSteps[Number(el.dataset.index)];
    if ( !record ) return;
    if ( action === "hpAverage" ) await driver.applyHitPoints(record, "avg");
    else if ( action === "hpMax" ) await driver.applyHitPoints(record, "max", "max");
    else if ( action === "hpRoll" ) await driver.rollHitPoints(record);
    else if ( action === "hpManual" ) {
      const n = Math.round(Number(el.value));
      // Ignore an empty or non-numeric field rather than clobbering the current value.
      if ( !Number.isFinite(n) || n < 1 ) return false;
      await driver.applyHitPoints(record, Math.min(n, record.advancement.hitDieValue), "manual");
    }
  }
};
