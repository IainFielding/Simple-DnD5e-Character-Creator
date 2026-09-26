import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { addToParty, editableParty, partyJoinContext } from "../scripts/build/party.mjs";
import { reviewStep } from "../scripts/steps/review-step.mjs";
import { CreatorState } from "../scripts/state/creator-state.mjs";

/**
 * Joining dnd5e's primary party. The one rule everything hangs on is ownership of the party actor:
 * adding a member is an update to it, so an owner (always including a GM) gets the Review switch and
 * the chat card button, and nobody else gets either.
 */
function makeParty({ isOwner = true, fail = false } = {}) {
  return {
    name: "The Company",
    isOwner,
    system: {
      addMember: vi.fn(async () => { if ( fail ) throw new Error("denied"); })
    }
  };
}

let errors;
beforeEach(() => {
  installFoundryShims();
  errors = [];
  globalThis.ui = { notifications: { error: msg => errors.push(msg), warn: () => {} } };
});

const withParty = party => { game.actors = { party }; };

describe("editableParty", () => {
  it("returns the primary party to its owner", () => {
    const party = makeParty();
    withParty(party);
    expect(editableParty()).toBe(party);
  });

  it("returns nothing to someone who doesn't own it", () => {
    withParty(makeParty({ isOwner: false }));
    expect(editableParty()).toBeNull();
  });

  it("returns nothing when the world has no primary party", () => {
    withParty(null);
    expect(editableParty()).toBeNull();
  });
});

describe("partyJoinContext", () => {
  it("names the party for its owner and reflects the switch", () => {
    withParty(makeParty());
    const ctx = partyJoinContext(true);
    expect(ctx.active).toBe(true);
    expect(ctx.label).toContain("The Company");
    expect(partyJoinContext(false).active).toBe(false);
  });

  it("hides the switch from a non-owner", () => {
    withParty(makeParty({ isOwner: false }));
    expect(partyJoinContext(true)).toBeNull();
  });
});

describe("addToParty", () => {
  it("adds the character through the party's own addMember", async () => {
    const party = makeParty();
    withParty(party);
    const actor = { id: "actor0000000000" };
    expect(await addToParty(actor)).toBe(true);
    expect(party.system.addMember).toHaveBeenCalledWith(actor);
  });

  it("does nothing without ownership, a party, or an actor", async () => {
    const party = makeParty({ isOwner: false });
    withParty(party);
    expect(await addToParty({ id: "a" })).toBe(false);
    expect(party.system.addMember).not.toHaveBeenCalled();
    withParty(makeParty());
    expect(await addToParty(null)).toBe(false);
  });

  // A built character must never look failed because the party update didn't land.
  it("reports a failed update instead of throwing", async () => {
    withParty(makeParty({ fail: true }));
    expect(await addToParty({ id: "a" })).toBe(false);
    expect(errors).toHaveLength(1);
  });
});

describe("the Review step's party switch", () => {
  it("is on by default and toggles", () => {
    const state = new CreatorState(null);
    expect(state.joinParty).toBe(true);
    reviewStep.handle("toggle-party", null, { state });
    expect(state.joinParty).toBe(false);
    reviewStep.handle("toggle-party", null, { state });
    expect(state.joinParty).toBe(true);
  });

  it("leaves the PDF switch alone", () => {
    const state = new CreatorState(null);
    reviewStep.handle("toggle-party", null, { state });
    expect(state.exportPdf).toBe(false);
  });
});
