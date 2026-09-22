import { describe, it, expect, beforeEach } from "vitest";
import { optionalGrantStep } from "../scripts/levelup/steps/optional-grant-step.mjs";

/**
 * The optional-class-feature screen. Two shapes reach it, and telling them apart is the whole job:
 *
 *  - a plain **optional** ItemGrant, whose items are independent — tick what you want;
 *  - a **replacement** grant, whose items are alternatives — Tasha's swaps a 2014 feature for its
 *    Tasha's version, so taking both would give a character something no edition grants.
 *
 * The grouping is the part worth pinning, because the obvious implementation is wrong: one base can
 * map to *several* replacements (Natural Explorer is swapped for Deft Explorer **and** Canny) while
 * `configuration.replacements` records only the first.
 */
describe("the optional-grant screen", () => {
  const uuid = id => `Compendium.dnd5e.classfeatures.Item.${id}`;
  // The pre-v10 shape the replacement map's keys are stored in — no `.Item.` segment.
  const bare = id => `Compendium.dnd5e.classfeatures.${id}`;

  let applied;
  let driver;
  let state;

  /** A record shaped like the driver's, with `selected` describing the current clone state. */
  function record({ items, replacements = null, selected = [] }) {
    const adv = { title: "Features", configuration: { items, replacements } };
    return { level: 1, screenLevel: 1, advancement: adv, item: { name: "Ranger" }, replacements, selected };
  }

  beforeEach(() => {
    // Tasha's own table, in its real shape: class -> level -> base -> [replacement, ...dependents].
    // The module records only `toAdd[0]` on the advancement, so this table is the only statement
    // anywhere that Canny belongs to Deft Explorer. Worlds without Tasha's have no CONFIG.TCOE.
    globalThis.CONFIG ??= {};
    globalThis.CONFIG.TCOE = {
      replacementFeatures: {
        ranger: {
          1: {
            [bare("naturalExplorer")]: [uuid("deftExplorer"), uuid("canny")],
            [bare("favoredEnemy")]: [uuid("favoredFoe")]
          }
        }
      }
    };
    applied = null;
    driver = {
      optionalGrantState: rec => ({
        options: rec.advancement.configuration.items.map(i => ({
          uuid: i.uuid, selected: rec.selected.includes(i.uuid)
        }))
      }),
      setOptionalGrant: (rec, uuids) => { applied = uuids; }
    };
  });

  /* -------------------------------------------- */

  it("never offers a dependent as a choice, with one base or with several", async () => {
    // Tasha's swaps Natural Explorer for Deft Explorer *and* Canny but records only the first, so
    // Canny reaches us looking like an unrelated optional extra. It is not a choice: their own flow
    // locks its checkbox to Deft Explorer's radio. Picking Deft Explorer is what takes Canny, so
    // the screen must not show it — with two bases the old code dropped it instead, which is the bug.
    const oneBase = record({
      items: [
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true },
        { uuid: uuid("canny"), optional: true },
        { uuid: uuid("rangerArchetype") }
      ],
      replacements: { [bare("naturalExplorer")]: uuid("deftExplorer") },
      selected: [uuid("naturalExplorer"), uuid("rangerArchetype")]
    });
    expect((await groupsOf(oneBase)).flat()).not.toContain(uuid("canny"));

    const twoBases = record({
      items: [
        { uuid: uuid("favoredEnemy"), optional: true },
        { uuid: uuid("favoredFoe"), optional: true },
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true },
        { uuid: uuid("canny"), optional: true }
      ],
      replacements: {
        [bare("favoredEnemy")]: uuid("favoredFoe"),
        [bare("naturalExplorer")]: uuid("deftExplorer")
      },
      selected: [uuid("favoredEnemy"), uuid("naturalExplorer")]
    });
    const groups = await groupsOf(twoBases);
    expect(groups).toHaveLength(2);
    expect(groups.flat()).not.toContain(uuid("canny"));
  });

  it("toggles an independent optional item without touching its neighbours", () => {
    const rec = record({
      items: [{ uuid: uuid("a") }, { uuid: uuid("b") }, { uuid: uuid("c") }],
      selected: [uuid("a"), uuid("b"), uuid("c")]
    });
    state = { optionalGrantSteps: [rec] };

    optionalGrantStep.handle("optionalGrantToggle",
      { dataset: { index: "0", uuid: uuid("b") } }, { state, driver });

    expect(applied).toEqual([uuid("a"), uuid("c")]);
  });

  it("lets every optional item be declined", () => {
    const rec = record({ items: [{ uuid: uuid("a") }], selected: [uuid("a")] });
    state = { optionalGrantSteps: [rec] };

    optionalGrantStep.handle("optionalGrantToggle",
      { dataset: { index: "0", uuid: uuid("a") } }, { state, driver });

    // An empty answer is a real one — "decline all" — and must not read as "no opinion".
    expect(applied).toEqual([]);
  });

  // A default is always applied by the driver, so this screen must never gate the level.
  it("never blocks Next", () => {
    expect(optionalGrantStep.isCompleteAt()).toBe(true);
  });

  /* -------------------------------------------- */
  /*  Grouping                                    */
  /* -------------------------------------------- */

  /** The `members` of each rendered group, as arrays. */
  async function groupsOf(rec) {
    const { sections } = await optionalGrantStep.sectionsAt({ state: { optionalGrantSteps: [rec] }, driver }, 1);
    return sections[0].groups.map(g => g.members.split("|"));
  }

  it("folds an unnamed alternative into the group of the grant's only base", async () => {
    // An optional item the map names nowhere and no table claims as a dependent. With one base
    // there is only one group it can belong to, so it belongs there — the fallback that still
    // applies to content we have no dependency table for.
    const rec = record({
      items: [
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true },
        { uuid: uuid("unclaimedExtra"), optional: true },
        { uuid: uuid("rangerArchetype") }
      ],
      replacements: { [bare("naturalExplorer")]: uuid("deftExplorer") },
      selected: [uuid("naturalExplorer"), uuid("rangerArchetype")]
    });

    const groups = await groupsOf(rec);
    expect(groups).toHaveLength(1);
    expect(new Set(groups[0]))
      .toEqual(new Set([uuid("naturalExplorer"), uuid("deftExplorer"), uuid("unclaimedExtra")]));
    // The non-optional item is in no group — it is granted either way, not a choice.
    expect(groups[0]).not.toContain(uuid("rangerArchetype"));
  });

  it("keeps two bases in separate groups instead of pooling their alternatives", async () => {
    // Each group is exclusive to the handler, so a shared member would let a click under one base
    // silently drop the *other* base's pick. Nothing must appear in both.
    const rec = record({
      items: [
        { uuid: uuid("favoredEnemy"), optional: true },
        { uuid: uuid("favoredFoe"), optional: true },
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true }
      ],
      replacements: {
        [bare("favoredEnemy")]: uuid("favoredFoe"),
        [bare("naturalExplorer")]: uuid("deftExplorer")
      },
      selected: [uuid("favoredEnemy"), uuid("naturalExplorer")]
    });

    const groups = await groupsOf(rec);
    expect(groups).toHaveLength(2);
    expect(new Set(groups[0])).toEqual(new Set([uuid("favoredEnemy"), uuid("favoredFoe")]));
    expect(new Set(groups[1])).toEqual(new Set([uuid("naturalExplorer"), uuid("deftExplorer")]));
    const shared = groups[0].filter(m => groups[1].includes(m));
    expect(shared).toEqual([]);
  });

  it("leaves an unattributable alternative out rather than sharing it between bases", async () => {
    // Two bases and an extra the map attributes to neither and no table claims: it cannot be placed
    // without guessing, and guessing wrong lets one group unpick the other. Dropping it is safe —
    // which is *not* the right answer for a dependent, whose owner is known. See the test above.
    const rec = record({
      items: [
        { uuid: uuid("favoredEnemy"), optional: true },
        { uuid: uuid("favoredFoe"), optional: true },
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true },
        { uuid: uuid("unclaimedExtra"), optional: true }
      ],
      replacements: {
        [bare("favoredEnemy")]: uuid("favoredFoe"),
        [bare("naturalExplorer")]: uuid("deftExplorer")
      },
      selected: [uuid("favoredEnemy"), uuid("naturalExplorer")]
    });

    const groups = await groupsOf(rec);
    expect(groups.flat()).not.toContain(uuid("unclaimedExtra"));
  });

  it("marks the currently-applied member of each group as selected", async () => {
    const rec = record({
      items: [
        { uuid: uuid("naturalExplorer"), optional: true },
        { uuid: uuid("deftExplorer"), optional: true }
      ],
      replacements: { [bare("naturalExplorer")]: uuid("deftExplorer") },
      selected: [uuid("deftExplorer")]
    });

    const { sections } = await optionalGrantStep.sectionsAt(
      { state: { optionalGrantSteps: [rec] }, driver }, 1);
    const picked = sections[0].groups[0].options.filter(o => o.selected).map(o => o.uuid);
    expect(picked).toEqual([uuid("deftExplorer")]);
  });
});
