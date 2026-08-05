import { describe, it, expect, beforeEach, vi } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";

/**
 * An ability-score-improvement decision has two modes, and until now only one of them could be
 * answered without a UI: `autoResolve` read `provider.asi(rec)` and passed the result straight to
 * `setAsi`, which is the *allocate points* mode. Taking a feat instead — the other half of what
 * the interactive screen offers, and the only way to reach a half-feat — went exclusively through
 * `chooseAsiFeat`, which opens the compendium browser.
 *
 * `applyAsiFeat` is the browser-free half of that path, and `autoResolve` now routes a
 * `{ feat: uuid }` answer to it. These tests pin both: that the answer reaches the right method,
 * and that the two modes stay distinguishable.
 */
describe("autoResolve: an ASI answered with a feat", () => {

  /** A decision record shaped like the ones `prepare()` pushes onto `asiSteps`. */
  const asiRecord = () => ({
    level: 4,
    screenLevel: 4,
    advancement: { id: "asi-adv-id", value: {}, configuration: { points: 2, cap: 2 } },
    item: { name: "Wizard" }
  });

  /**
   * A driver with its decision arrays stubbed, so `autoResolve`'s drain loop can be exercised
   * without a live AdvancementManager. Only the two apply methods under test are spied on.
   */
  function makeDriver(asiSteps) {
    const driver = Object.create(LevelUpDriver.prototype);
    Object.assign(driver, {
      hpSteps: [], sizeSteps: [], grantSteps: [], subclassSteps: [],
      traitSteps: [], choiceSteps: [], asiSteps
    });
    driver.setAsi = vi.fn(async () => {});
    driver.applyAsiFeat = vi.fn(async () => true);
    return driver;
  }

  /** A provider answering only the ASI decision, in whichever mode the test wants. */
  const provider = answer => ({
    hp: () => "avg",
    size: () => null,
    grantAbility: () => null,
    subclass: () => null,
    asi: () => answer,
    traitKeys: () => [],
    defer: () => false,
    choiceUuids: () => []
  });

  beforeEach(() => installFoundryShims());

  it("routes a { feat } answer to applyAsiFeat, not to setAsi", async () => {
    const record = asiRecord();
    const driver = makeDriver([record]);

    await driver.autoResolve(provider({ feat: "Compendium.dnd5e.feats24.Item.phbftActor00000" }));

    expect(driver.applyAsiFeat).toHaveBeenCalledTimes(1);
    expect(driver.applyAsiFeat).toHaveBeenCalledWith(
      record, "Compendium.dnd5e.feats24.Item.phbftActor00000", { showMessage: false }
    );
    expect(driver.setAsi).not.toHaveBeenCalled();
  });

  it("still routes a per-ability allocation to setAsi", async () => {
    const record = asiRecord();
    const driver = makeDriver([record]);

    await driver.autoResolve(provider({ int: 2 }));

    expect(driver.setAsi).toHaveBeenCalledWith(record, { int: 2 });
    expect(driver.applyAsiFeat).not.toHaveBeenCalled();
  });

  it("leaves the decision alone when the provider declines to answer", async () => {
    const driver = makeDriver([asiRecord()]);

    await driver.autoResolve(provider(null));

    expect(driver.setAsi).not.toHaveBeenCalled();
    expect(driver.applyAsiFeat).not.toHaveBeenCalled();
  });

  it("treats a non-string feat as an allocation, so a stray key can't hijack the mode", async () => {
    const record = asiRecord();
    const driver = makeDriver([record]);

    await driver.autoResolve(provider({ int: 2, feat: true }));

    expect(driver.setAsi).toHaveBeenCalledWith(record, { int: 2, feat: true });
    expect(driver.applyAsiFeat).not.toHaveBeenCalled();
  });
});
