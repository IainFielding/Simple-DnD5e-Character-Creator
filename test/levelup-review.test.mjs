import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { lvlReviewStep } from "../scripts/levelup/steps/lvl-review-step.mjs";

/**
 * The review step's origin-column bucketing, driven by the Eberron Artillerist shape
 * (module `dnd-forge-artificer`): the subclass's grants land on nested feature items, and
 * those features' own ItemGrants hand out the subclass spells —
 *
 *   Artificer (class)
 *   └─ Artillerist (subclass, flags stripped by SubclassAdvancement#apply)
 *      └─ Artillerist Spells (feat, advancementRoot -> subclass)
 *         └─ ItemGrant lvl 5 → Scorching Ray, Shatter (advancementRoot -> subclass)
 *
 * The review diffs the driver's clone against the real actor: anything on the clone the actor
 * lacks was gained this level-up, and every gained spell must appear — badged New — in the
 * levelled class's column, whatever depth of sub-item granted it.
 */

/** A Foundry-Collection-ish item store (same shape the other level-up tests use). */
function makeItems(initial = []) {
  const m = new Map(initial.map(i => [i.id, i]));
  return {
    get: id => m.get(id),
    set: item => m.set(item.id, item),
    delete: id => m.delete(id),
    map: fn => [...m.values()].map(fn),
    filter: fn => [...m.values()].filter(fn),
    find: fn => [...m.values()].find(fn),
    has: id => m.has(id),
    [Symbol.iterator]: () => m.values()
  };
}

/** Minimal actor/clone: items plus the system paths the review's character-wide diffs read. */
function makeActor(items, { level, hpMax = 30, prof = 2 } = {}) {
  return {
    img: "portrait.webp",
    items: makeItems(items),
    system: {
      details: { level },
      attributes: { hp: { max: hpMax }, prof },
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"]
        .map(k => [k, { value: 10 }])),
      spells: {},
      traits: { weaponProf: { mastery: { value: [] } } }
    }
  };
}

const CLS = "clsArtificer0000";
const SUB = "subArtillerist00";
const FEAT_SPELLS = "featArtiSpells00";
const GRANT_ADV = "advSpells5000000";

/** The items both sides share: class, subclass, and the nested Artillerist Spells feat. */
function baseItems(levels) {
  return [
    {
      id: CLS, type: "class", name: "Artificer", img: "artificer.webp",
      system: { identifier: "artificer", levels, hd: { denomination: "d8" } },
      advancement: { byId: {} }
    },
    {
      // dnd5e strips origin flags from subclass items; classIdentifier is the link back.
      id: SUB, type: "subclass", name: "Artillerist", img: "artillerist.webp",
      system: { classIdentifier: "artificer" },
      flags: {},
      advancement: { byId: {} }
    },
    {
      id: FEAT_SPELLS, type: "feat", name: "Artillerist Spells", img: "spells.webp",
      system: {},
      flags: { dnd5e: { advancementRoot: `${SUB}.advGrant30000000`, advancementOrigin: `${SUB}.advGrant30000000` } },
      advancement: { byId: {} }
    }
  ];
}

/** A spell the Artillerist Spells feat granted: origin points at the feat, root at the subclass. */
function grantedSpell(id, name) {
  return {
    id, type: "spell", name, img: `${name}.webp`,
    system: {},
    flags: { dnd5e: { advancementOrigin: `${FEAT_SPELLS}.${GRANT_ADV}`, advancementRoot: `${SUB}.advGrant30000000` } },
    _stats: { compendiumSource: `Compendium.dnd5e.spells24.Item.${id}` }
  };
}

function makeState(actor, clone) {
  return {
    actor,
    classItem: clone.items.get(CLS),
    grantSteps: [],
    selectedCantrips: [],
    selectedSpells: [],
    swapCantrip: null,
    swapSpell: null,
    spellPlan: () => ({ isSpellcaster: false, addCantrips: 0, addSpells: 0 })
  };
}

beforeEach(() => installFoundryShims());

describe("level-up review — spells granted by nested sub-items", () => {
  it("lists a spell granted by a subclass feature's own ItemGrant as New in the class column", () => {
    // Actor: Artificer 4 (Artillerist picked at 3, feat already owned). Clone: levelled to 5,
    // where the feat's level-5 grant landed Scorching Ray and Shatter.
    const actor = makeActor(baseItems(4), { level: 4 });
    const clone = makeActor(
      [...baseItems(5), grantedSpell("splScorchingRay0", "Scorching Ray"), grantedSpell("splShatter000000", "Shatter")],
      { level: 5, hpMax: 36, prof: 3 }
    );
    clone.reset = () => {};

    const ctx = lvlReviewStep.context({ state: makeState(actor, clone), driver: { clone } });

    const classSection = ctx.sections.find(s => s.name === "Artificer");
    expect(classSection).toBeDefined();
    const spellNames = classSection.spells.map(s => s.name);
    expect(spellNames).toContain("Scorching Ray");
    expect(spellNames).toContain("Shatter");
    for ( const s of classSection.spells ) expect(s.isNew).toBe(true);
  });

  it("labels a brand-new class (multiclass) as new instead of 'Level 0 → 1', leading the columns", () => {
    // Fighter 5 multiclassing into Wizard: the clone carries the new class at level 1 that the
    // actor lacks entirely.
    const fighter = {
      id: "clsFighter000000", type: "class", name: "Fighter", img: "fighter.webp",
      system: { identifier: "fighter", levels: 5, hd: { denomination: "d10" } },
      advancement: { byId: {} }
    };
    const wizard = {
      id: "clsWizard0000000", type: "class", name: "Wizard", img: "wizard.webp",
      system: { identifier: "wizard", levels: 1, hd: { denomination: "d6" } },
      advancement: { byId: {} }
    };
    const actor = makeActor([fighter], { level: 5 });
    const clone = makeActor([fighter, wizard], { level: 6, hpMax: 40, prof: 3 });
    clone.reset = () => {};
    const state = { ...makeState(actor, clone), classItem: clone.items.get(wizard.id) };

    const ctx = lvlReviewStep.context({ state, driver: { clone } });

    const wizSection = ctx.sections.find(s => s.name === "Wizard");
    expect(wizSection.leveled).toBe(true);
    // The shimmed t() echoes key + data: assert the new-class key fired with the class level.
    expect(wizSection.levelLabel).toContain("levelup.step.review.levelNew");
    expect(wizSection.levelLabel).toContain("\"level\":1");

    const ftrSection = ctx.sections.find(s => s.name === "Fighter");
    expect(ftrSection.leveled).toBe(false);
    expect(ftrSection.levelLabel).toContain("levelup.step.review.level:");

    // The levelled (new) class's column leads the review.
    expect(ctx.sections[0].name).toBe("Wizard");
  });

  it("also buckets the granting feature itself into the class column when gained this level-up", () => {
    // The subclass-pick level: actor Artificer 2, clone at 3 with subclass + feat + its spells all new.
    const actor = makeActor([baseItems(2)[0]], { level: 2 });
    const clone = makeActor(
      [...baseItems(3), grantedSpell("splShield0000000", "Shield"), grantedSpell("splThunderwave00", "Thunderwave")],
      { level: 3, hpMax: 24 }
    );
    clone.reset = () => {};

    const ctx = lvlReviewStep.context({ state: makeState(actor, clone), driver: { clone } });

    const classSection = ctx.sections.find(s => s.name === "Artificer");
    expect(classSection.features.map(f => f.name)).toContain("Artillerist Spells");
    const spellNames = classSection.spells.map(s => s.name);
    expect(spellNames).toContain("Shield");
    expect(spellNames).toContain("Thunderwave");
  });
});
