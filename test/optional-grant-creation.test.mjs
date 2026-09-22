import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveChoices, choicesComplete } from "../scripts/data/choice-resolver.mjs";
import { choicesStep } from "../scripts/steps/choices-step.mjs";
import { CreationChoiceProvider } from "../scripts/build/creation-advancement.mjs";

/**
 * Optional class features at character creation. Tasha's injects them into every 2014-rules class —
 * a plain optional grant (a Cleric's extra spells) and replacement pairs (the Ranger's Favored Enemy
 * or Favored Foe). Both are applied by default, so the checklist row never blocks; what it adds is
 * the chance to decline or swap before level 2, which used to be the first place a player could.
 */

const uuid = id => `Compendium.dnd5e.classfeatures.Item.${id}`;
const bare = id => `Compendium.dnd5e.classfeatures.${id}`;
const FE = uuid("favoredEnemy"), FOE = uuid("favoredFoe"), ARCH = uuid("archetype");

/** Favored Enemy's own level-1 choice — the question that must vanish once it is swapped away. */
const favoredEnemy = {
  uuid: FE, name: "Favored Enemy", img: "fe.webp", type: "feat", system: {
    identifier: "favored-enemy",
    advancement: [{
      _id: "feLang", type: "Trait", level: 1, title: "Favored Enemy Language",
      configuration: { mode: "default", grants: [], choices: [{ count: 1, pool: ["languages:standard:elvish", "languages:standard:dwarvish"] }] }
    }]
  }
};
const docs = {
  [FE]: favoredEnemy,
  [FOE]: { uuid: FOE, name: "Favored Foe", img: "foe.webp", type: "feat", system: { identifier: "favored-foe" } },
  [ARCH]: { uuid: ARCH, name: "Ranger Archetype", img: "a.webp", type: "feat", system: { identifier: "ranger-archetype" } },
  [uuid("clericSpells")]: { name: "Additional Cleric Spells", img: "s.webp", type: "feat", system: {} }
};

function ranger() {
  return {
    uuid: "Class.ranger", name: "Ranger", img: "r.webp", type: "class",
    system: { identifier: "ranger", source: { rules: "2014" }, advancement: [{
      _id: "tcoeRep", type: "TCOEReplacementGrant", level: 1, title: "Features",
      configuration: {
        items: [{ uuid: bare("favoredEnemy") }, { uuid: bare("archetype") }, { uuid: bare("favoredFoe"), optional: true }],
        replacements: { [bare("favoredEnemy")]: bare("favoredFoe") }
      }
    }] }
  };
}
function cleric() {
  return {
    uuid: "Class.cleric", name: "Cleric", img: "c.webp", type: "class",
    system: { identifier: "cleric", source: { rules: "2014" }, advancement: [{
      _id: "tcoeOpt", type: "ItemGrant", level: 1, title: "Optional Class Features",
      configuration: { optional: true, items: [{ uuid: uuid("clericSpells") }] }
    }] }
  };
}

const NE = uuid("naturalExplorer"), DEFT = uuid("deftExplorer"), CANNY = uuid("canny");
Object.assign(docs, {
  [NE]: { uuid: NE, name: "Natural Explorer", img: "ne.webp", type: "feat", system: { identifier: "natural-explorer" } },
  [DEFT]: { uuid: DEFT, name: "Deft Explorer", img: "de.webp", type: "feat", system: { identifier: "deft-explorer" } },
  [CANNY]: { uuid: CANNY, name: "Canny", img: "ca.webp", type: "feat", system: { identifier: "canny" } }
});

/**
 * The level-1 Ranger as Tasha's really builds it: *two* bases, and a Canny pushed onto `items`
 * whose ownership is recorded only in `CONFIG.TCOE.replacementFeatures`.
 */
function tashasRanger() {
  return {
    uuid: "Class.ranger2", name: "Ranger", img: "r.webp", type: "class",
    system: { identifier: "ranger", source: { rules: "2014" }, advancement: [{
      _id: "tcoeRep", type: "TCOEReplacementGrant", level: 1, title: "Features",
      configuration: {
        items: [
          { uuid: bare("favoredEnemy") }, { uuid: bare("naturalExplorer") }, { uuid: bare("archetype") },
          { uuid: bare("favoredFoe"), optional: true }, { uuid: bare("deftExplorer"), optional: true },
          { uuid: bare("canny"), optional: true }
        ],
        replacements: {
          [bare("favoredEnemy")]: bare("favoredFoe"),
          [bare("naturalExplorer")]: bare("deftExplorer")
        }
      }
    }] }
  };
}

const source = { card: () => null, subclasses: async () => [] };
const blank = classUuid => ({ classUuid, speciesUuid: null, backgroundUuid: null, advChoices: {} });
const reqsOf = (resolved, type) => resolved.sources.flatMap(s => s.requirements).filter(r => r.type === type);

describe("optional class features at creation", () => {
  let classDocs;
  beforeEach(() => {
    classDocs = { "Class.ranger": ranger(), "Class.cleric": cleric(), "Class.ranger2": tashasRanger() };
    vi.stubGlobal("fromUuid", async u => classDocs[u] ?? docs[u] ?? docs[u?.replace(/\.(?!Item\.)(?=[^.]+$)/, ".Item.")] ?? null);
    // Tasha's own table: base -> [replacement, ...dependents]. The advancement records only the
    // first, so this is the only place Canny's owner is stated.
    globalThis.CONFIG ??= {};
    globalThis.CONFIG.TCOE = {
      replacementFeatures: {
        ranger: { 1: { [bare("naturalExplorer")]: [DEFT, CANNY], [bare("favoredEnemy")]: [FOE] } }
      }
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.CONFIG.TCOE;
  });

  it("offers a replacement pair as one group, the base taken by default, and never blocks", async () => {
    const resolved = await resolveChoices(blank("Class.ranger"), source);
    const [req] = reqsOf(resolved, "OptionalGrant");
    expect(req.groups).toHaveLength(1);
    expect(req.groups[0].options.map(o => [o.label, o.isSelected])).toEqual([["Favored Enemy", true], ["Favored Foe", false]]);
    // Ranger Archetype sits outside the pair: granted either way, never offered.
    expect(req.options.map(o => o.key)).not.toContain(ARCH);
    expect(req.complete).toBe(true);
    expect(choicesComplete(resolved)).toBe(false);   // the language is still open
  });

  it("asks the kept feature's questions, and stops asking once it is swapped away", async () => {
    const state = blank("Class.ranger");
    state.choiceCache = await resolveChoices(state, source);
    expect(reqsOf(state.choiceCache, "Trait").map(r => r.advId)).toEqual(["feLang"]);

    const el = { dataset: { choiceSource: "class", selKey: "tcoeRep", key: FOE, group: `${FE}|${FOE}` } };
    await choicesStep.handle("optional-grant", el, { state, source });

    // The whole keep list is recorded: the swap, plus the archetype outside the pair.
    expect(new Set(state.advChoices.class.tcoeRep)).toEqual(new Set([ARCH, FOE]));
    expect(reqsOf(state.choiceCache, "Trait")).toEqual([]);
    expect(choicesComplete(state.choiceCache)).toBe(true);
  });

  it("toggles a plain optional grant's items independently, and records declining all of them", async () => {
    const state = blank("Class.cleric");
    state.choiceCache = await resolveChoices(state, source);
    const [req] = reqsOf(state.choiceCache, "OptionalGrant");
    expect(req.groups).toBeNull();
    expect(req.options.map(o => o.isSelected)).toEqual([true]);

    const el = { dataset: { choiceSource: "class", selKey: "tcoeOpt", key: uuid("clericSpells") } };
    await choicesStep.handle("optional-grant", el, { state, source });
    expect(state.advChoices.class.tcoeOpt).toEqual([]);
    expect(reqsOf(state.choiceCache, "OptionalGrant")[0].options[0].isSelected).toBe(false);
  });

  it("grants Deft Explorer's Canny with it, without ever offering Canny as a choice", async () => {
    // The bug this pins: with two bases on the grant, Canny used to be unattributable and was
    // dropped, so a player who took Deft Explorer never got it. Tasha's grants the two together.
    const state = blank("Class.ranger2");
    state.choiceCache = await resolveChoices(state, source);
    const [req] = reqsOf(state.choiceCache, "OptionalGrant");

    expect(req.groups).toHaveLength(2);
    expect(req.options.map(o => o.key)).not.toContain(CANNY);
    // Default is both 2014 bases, and Canny is not among them.
    expect(new Set(req.keep)).toEqual(new Set([FE, NE, ARCH]));

    const el = { dataset: { choiceSource: "class", selKey: "tcoeRep", key: DEFT, group: `${NE}|${DEFT}` } };
    await choicesStep.handle("optional-grant", el, { state, source });
    expect(new Set(state.advChoices.class.tcoeRep)).toEqual(new Set([FE, ARCH, DEFT, CANNY]));

    // And swapping back takes it away again rather than leaving it stranded on the sheet.
    const back = { dataset: { choiceSource: "class", selKey: "tcoeRep", key: NE, group: `${NE}|${DEFT}` } };
    await choicesStep.handle("optional-grant", back, { state, source });
    expect(new Set(state.advChoices.class.tcoeRep)).toEqual(new Set([FE, ARCH, NE]));
  });

  it("hands the driver the recorded keep list, and nothing at all when the player never touched it", async () => {
    const state = blank("Class.ranger");
    const rec = { advancement: { id: "tcoeRep" } };
    expect(new CreationChoiceProvider(await resolveChoices(state, source), state).optionalGrant(rec)).toBeNull();

    state.advChoices.class = { tcoeRep: [ARCH, FOE] };
    expect(new CreationChoiceProvider(await resolveChoices(state, source), state).optionalGrant(rec)).toEqual([ARCH, FOE]);
  });
});
