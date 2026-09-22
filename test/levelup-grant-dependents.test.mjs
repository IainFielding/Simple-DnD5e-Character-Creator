import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LevelUpDriver } from "../scripts/levelup/manager-driver.mjs";

/**
 * Items a replacement grant hands over *with* a choice rather than *as* one.
 *
 * Tasha's replaces a 2014 feature with a list — Natural Explorer becomes Deft Explorer **and**
 * Canny — but `configuration.replacements` records only the first of that list, so from the
 * advancement alone the rest is indistinguishable from an unrelated optional extra. Their own flow
 * hard-codes Canny back onto Deft Explorer by uuid; we read the table they hard-code *from*,
 * `CONFIG.TCOE.replacementFeatures`, where each base maps to `[replacement, ...dependents]`.
 *
 * Pinned at the driver rather than at either screen because that is where it is enforced: every
 * writer — both screens, the provider replaying a recorded answer, and the e2e harness — funnels
 * through `setOptionalGrant`. The bug this covers was a keep list written by the *harness*, which
 * no amount of correctness in the click handler would have caught.
 */
describe("dependent items on a replacement grant", () => {
  const uuid = id => `Compendium.dnd5e.classfeatures.Item.${id}`;
  const bare = id => `Compendium.dnd5e.classfeatures.${id}`;
  const NE = uuid("naturalExplorer"), DEFT = uuid("deftExplorer"), CANNY = uuid("canny");
  const FE = uuid("favoredEnemy"), FOE = uuid("favoredFoe");

  beforeEach(() => {
    globalThis.CONFIG ??= {};
    globalThis.CONFIG.TCOE = {
      replacementFeatures: {
        ranger: { 1: { [bare("naturalExplorer")]: [DEFT, CANNY], [bare("favoredEnemy")]: [FOE] } }
      }
    };
  });
  afterEach(() => delete globalThis.CONFIG.TCOE);

  /**
   * Drive one `setOptionalGrant` against the real Ranger shape — two bases, and a Canny pushed onto
   * `items` that the replacement map never names. Returns the uuids actually applied.
   */
  async function apply(keep, { added = [] } = {}) {
    let selected = null;
    const adv = {
      value: { added: Object.fromEntries(added.map((u, i) => [`k${i}`, u])) },
      configuration: {
        items: [
          { uuid: FE }, { uuid: NE }, { uuid: uuid("rangerArchetype") },
          { uuid: FOE, optional: true }, { uuid: DEFT, optional: true }, { uuid: CANNY, optional: true }
        ],
        replacements: { [bare("favoredEnemy")]: FOE, [bare("naturalExplorer")]: DEFT }
      },
      reverse: async () => { selected = []; },
      apply: async (level, data) => { selected = data.selected; }
    };
    const record = {
      level: 1,
      advancement: adv,
      replacements: adv.configuration.replacements
    };
    const driver = new LevelUpDriver({ actor: {}, clone: { reset: () => {} }, steps: [] });
    await driver.setOptionalGrant(record, keep);
    return selected;
  }

  it("grants a dependent with its host, however the keep list was written", async () => {
    // The e2e failure exactly: the answer book records the swap and says nothing about Canny.
    const applied = await apply([FE, DEFT, uuid("rangerArchetype")]);
    expect(new Set(applied)).toEqual(new Set([FE, DEFT, CANNY, uuid("rangerArchetype")]));
  });

  it("reverses a dependent when its host is swapped back out", async () => {
    const applied = await apply([FE, NE, uuid("rangerArchetype")], { added: [FE, DEFT, CANNY] });
    expect(applied).not.toContain(CANNY);
    expect(new Set(applied)).toEqual(new Set([FE, NE, uuid("rangerArchetype")]));
  });

  it("leaves a grant with no dependents exactly as it was handed over", async () => {
    delete globalThis.CONFIG.TCOE;
    const applied = await apply([FE, DEFT]);
    expect(new Set(applied)).toEqual(new Set([FE, DEFT]));
  });
});
