/**
 * The level-up Class step's two faces (lvl-class-step.mjs).
 *
 * The step used to be one scrolling pick-list mixing "advance the class you already play" with
 * every class in every installed compendium. It now opens on a *route* screen — a card per owned
 * class plus one muted card for taking a class the character doesn't have — and only shows the
 * class browser once that muted card is clicked.
 *
 * What's pinned here is the contract the templates render against: which cards each face offers,
 * how the muted card is worded and when it locks, and that the route ⇄ browse flip is purely
 * presentational (it must never disturb the pick or the driver, which cost real player decisions).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { lvlClassStep } from "../scripts/levelup/steps/lvl-class-step.mjs";
import { LevelUpState } from "../scripts/levelup/levelup-state.mjs";
import { MODULE_ID, SETTINGS } from "../scripts/config.mjs";

/** An actor carrying the named classes, each at the given level. */
function makeActor(classes) {
  const items = classes.map(({ name, level, identifier }, i) => ({
    id: `cls${i}`,
    uuid: `Actor.a.Item.cls${i}`,
    type: "class",
    name,
    img: `${name}.webp`,
    system: { levels: level, identifier: identifier ?? name.toLowerCase() }
  }));
  items.get = id => items.find(i => i.id === id);
  return { items, system: { details: { level: classes.reduce((s, c) => s + c.level, 0) } } };
}

/** The step's `source`: the compendium-backed class index the browse face draws from. */
const source = {
  classes: () => [
    { uuid: "Compendium.x.Item.fighter", name: "Fighter", img: "f.webp", identifier: "fighter" },
    { uuid: "Compendium.x.Item.wizard", name: "Wizard", img: "w.webp", identifier: "wizard" },
    { uuid: "Compendium.x.Item.rogue", name: "Rogue", img: "r.webp", identifier: "rogue" }
  ],
  detail: async () => ({ name: "Wizard", img: "w.webp", enriched: "<p>arcane</p>" }),
  advancementGroups: async () => []
};

function setMode(mode) {
  game.settings.set(MODULE_ID, SETTINGS.multiclass, mode);
}

describe("level-up Class step — route screen", () => {
  beforeEach(() => {
    installFoundryShims();
    setMode("free");
  });

  it("offers a card per owned class and names the character's current classes", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    const ctx = await lvlClassStep.context({ state, source });

    expect(ctx.browse).toBe(false);
    expect(ctx.existing.map(c => c.name)).toEqual(["Fighter"]);
    expect(ctx.current.map(c => c.name)).toEqual(["Fighter"]);
    // The level jump is on the card's own sub-line, not a badge sharing the name's row.
    expect(ctx.existing[0].tag).toContain('"from":5');
    expect(ctx.existing[0].tag).toContain('"to":6');
  });

  it("does not resolve the class browser's candidates while on the route screen", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    const ctx = await lvlClassStep.context({ state, source });
    expect(ctx.addable).toEqual([]);
  });

  it("words the new-class card by how many classes the character already has", async () => {
    const one = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    const two = new LevelUpState(
      makeActor([{ name: "Fighter", level: 3 }, { name: "Wizard", level: 2 }]), null, { chooseClass: true });

    expect((await lvlClassStep.context({ state: one, source })).newCard.title)
      .toContain("class.add.second");
    expect((await lvlClassStep.context({ state: two, source })).newCard.title)
      .toContain("class.add.third");
  });

  it("locks the new-class card when the world forbids multiclassing", async () => {
    setMode("off");
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    const ctx = await lvlClassStep.context({ state, source });

    expect(ctx.newCard.disabled).toBe(true);
    expect(ctx.newCard.reason).toContain("class.add.off");
  });

  it("locks the new-class card when the character already owns every class", async () => {
    const state = new LevelUpState(makeActor([
      { name: "Fighter", level: 3 }, { name: "Wizard", level: 2 }, { name: "Rogue", level: 1 }
    ]), null, { chooseClass: true });
    const ctx = await lvlClassStep.context({ state, source });

    expect(ctx.newCard.disabled).toBe(true);
    expect(ctx.newCard.reason).toContain("class.add.none");
  });

  it("shows an already-picked new class as a selected card on the route", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    state.classSelection = { kind: "new", uuid: "Compendium.x.Item.wizard" };
    const ctx = await lvlClassStep.context({ state, source });

    const pending = ctx.existing.find(c => c.kind === "new");
    expect(pending?.name).toBe("Wizard");
    expect(pending?.selected).toBe(true);
    // …and it is not mistaken for one of the character's current classes.
    expect(ctx.current.map(c => c.name)).toEqual(["Fighter"]);
  });
});

describe("level-up Class step — browse screen", () => {
  beforeEach(() => {
    installFoundryShims();
    setMode("free");
  });

  it("lists only the classes the character does not already own", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    state.classBrowse = true;
    const ctx = await lvlClassStep.context({ state, source });

    expect(ctx.browse).toBe(true);
    expect(ctx.addable.map(c => c.name)).toEqual(["Wizard", "Rogue"]);
  });

  it("locks a candidate whose multiclass prerequisites are unmet, naming the ability", async () => {
    setMode("prereq");
    const actor = makeActor([{ name: "Fighter", level: 5 }]);
    actor.system.abilities = { int: { value: 9 }, str: { value: 16 }, dex: { value: 16 } };
    actor.items[0].system.primaryAbility = { value: ["str"], all: true };
    // Wizard wants Int 13 and the character has 9; Rogue wants Dex 13 and it has 16.
    globalThis.fromUuid = async uuid => ({
      type: "class",
      name: uuid.endsWith("wizard") ? "Wizard" : "Rogue",
      system: { primaryAbility: { value: [uuid.endsWith("wizard") ? "int" : "dex"], all: true } }
    });

    const state = new LevelUpState(actor, null, { chooseClass: true });
    state.classBrowse = true;
    const ctx = await lvlClassStep.context({ state, source });

    const wizard = ctx.addable.find(c => c.name === "Wizard");
    expect(wizard.disabled).toBe(true);
    expect(wizard.reason).toBeTruthy();
  });

  it("resolves the detail pane for the selected candidate only", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    state.classBrowse = true;
    state.classSelection = { kind: "new", uuid: "Compendium.x.Item.wizard" };
    const ctx = await lvlClassStep.context({ state, source });

    expect(ctx.hasSelection).toBe(true);
    expect(ctx.detail.name).toBe("Wizard");
  });
});

describe("level-up Class step — navigating between the faces", () => {
  const el = { getAttribute: () => null, dataset: {} };

  beforeEach(() => {
    installFoundryShims();
    setMode("free");
  });

  it("flips to browse and back without disturbing the pick or the driver", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    state.classSelection = { kind: "existing", id: "cls0" };
    state.driver = { steps: [] };
    const ctx = { state };

    await lvlClassStep.handle("levelup-class-browse", el, ctx);
    expect(state.classBrowse).toBe(true);
    await lvlClassStep.handle("levelup-class-route", el, ctx);
    expect(state.classBrowse).toBe(false);

    expect(state.classSelection).toEqual({ kind: "existing", id: "cls0" });
    expect(state.driver).toBeTruthy();
  });

  it("ignores a click on the locked new-class card", async () => {
    const state = new LevelUpState(makeActor([{ name: "Fighter", level: 5 }]), null, { chooseClass: true });
    const locked = { getAttribute: () => "true", dataset: {} };

    const result = await lvlClassStep.handle("levelup-class-browse", locked, { state });
    expect(result).toBe(false);
    expect(state.classBrowse).toBe(false);
  });
});
