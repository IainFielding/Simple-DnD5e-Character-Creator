import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { SETTINGS, levelUpHpDefault } from "../scripts/config.mjs";
import { hpStep } from "../scripts/levelup/steps/hp-step.mjs";
import { LevelUpState } from "../scripts/levelup/levelup-state.mjs";

/**
 * The level-up hit-point setting's "Maximum only" mode, beside the three it joined. In that mode a
 * gained level starts on — and can only take — the full hit die: the screen offers the Max button
 * alone, and the handler refuses the others even from a stale or hand-crafted click.
 */
beforeEach(() => installFoundryShims());
const setMode = mode => game.settings.set("sogrom-dnd5e-character-creator", SETTINGS.levelUpHpMode, mode);

function makeRecord(mode = "avg") {
  return {
    level: 4, screenLevel: 4, average: 6, hitDie: "d10", value: mode, mode, seedMode: mode,
    advancement: { hitDieValue: 10 }
  };
}
function makeState(record) {
  return {
    hpSteps: [record],
    classItem: { name: "Fighter" },
    driver: { clone: { system: { abilities: { con: { mod: 2 } } } } }
  };
}

describe("levelUpHpDefault", () => {
  it("starts on the maximum only in a Maximum only world", () => {
    setMode("max");
    expect(levelUpHpDefault()).toBe("max");
  });

  // The default mode is unchanged by this feature, and every other mode keeps dnd5e's average.
  it("starts on the average in every other mode, including the default", () => {
    expect(game.settings.get("sogrom-dnd5e-character-creator", SETTINGS.levelUpHpMode)).toBe("choice");
    for ( const mode of ["choice", "average-roll", "average"] ) {
      setMode(mode);
      expect(levelUpHpDefault(), mode).toBe("avg");
    }
  });
});

describe("the hit-point screen per mode", () => {
  const flags = mode => {
    setMode(mode);
    const { allowAverage, allowMax, allowRoll, allowManual } = hpStep.sectionsAt({ state: makeState(makeRecord()) }, 4);
    return { allowAverage, allowMax, allowRoll, allowManual };
  };

  it("offers only the Max button in Maximum only", () => {
    expect(flags("max")).toEqual({ allowAverage: false, allowMax: true, allowRoll: false, allowManual: false });
  });

  it("leaves the other three modes as they were", () => {
    expect(flags("choice")).toEqual({ allowAverage: true, allowMax: true, allowRoll: true, allowManual: true });
    expect(flags("average-roll")).toEqual({ allowAverage: true, allowMax: false, allowRoll: true, allowManual: false });
    expect(flags("average")).toEqual({ allowAverage: true, allowMax: false, allowRoll: false, allowManual: false });
  });

  it("shows the full hit die plus Con as the level's gain", () => {
    setMode("max");
    const { rows, blockStatus } = hpStep.sectionsAt({ state: makeState(makeRecord("max")) }, 4);
    expect(rows[0].current).toBe(10);
    expect(rows[0].isMax).toBe(true);
    expect(blockStatus).toContain("\"hp\":12");
  });
});

describe("the hit-point handler in Maximum only", () => {
  const act = async (action, value) => {
    setMode("max");
    const record = makeRecord("max");
    const driver = { applyHitPoints: vi.fn(), rollHitPoints: vi.fn() };
    const result = await hpStep.handle(action, { dataset: { index: "0" }, value }, { state: makeState(record), driver });
    return { result, driver };
  };

  it("refuses average, roll and a typed value", async () => {
    for ( const [action, value] of [["hpAverage"], ["hpRoll"], ["hpManual", "7"]] ) {
      const { result, driver } = await act(action, value);
      expect(result, action).toBe(false);
      expect(driver.applyHitPoints).not.toHaveBeenCalled();
      expect(driver.rollHitPoints).not.toHaveBeenCalled();
    }
  });

  it("accepts the maximum", async () => {
    const { driver } = await act("hpMax");
    expect(driver.applyHitPoints).toHaveBeenCalledWith(expect.anything(), "max", "max");
  });
});

// A level that starts on the maximum and was never touched is not unsaved work.
describe("close confirmation", () => {
  const stateWith = hp => {
    const state = new LevelUpState({ system: { details: { level: 3 } }, items: Object.assign(new Map(), { filter: () => [] }) }, null, { chooseClass: true });
    state.adoptDriver({
      steps: [], hpSteps: hp, asiSteps: [], choiceSteps: [], traitSteps: [], subclassSteps: [], grantSteps: [],
      subclassState: () => ({ chosen: false }), traitState: () => ({ chosen: new Set() }),
      choiceState: () => ({ selected: new Set(), replacing: null }), asiState: () => ({ type: "asi", assigned: 0 })
    });
    state.hasStagedSpells = () => false;
    return state;
  };

  it("doesn't count a seeded maximum as a change", () => {
    expect(stateWith([makeRecord("max")]).hasPlayerInput()).toBe(false);
  });

  it("counts switching away from the seed as a change", () => {
    const moved = { ...makeRecord("avg"), mode: "roll", value: 7 };
    expect(stateWith([moved]).hasPlayerInput()).toBe(true);
  });
});
