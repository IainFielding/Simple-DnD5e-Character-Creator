import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

/**
 * The art resolver, stubbed to *always* find every scene it is asked for.
 *
 * Without this the test is a false pass: there is no `FilePicker` in a unit run, so the real
 * resolver finds nothing whatever the world's module list says, and every card's banner is null
 * with or without the guard under test. Standing in a resolver that always succeeds is what makes
 * the activation check the only thing that can keep the art off the cards — which is precisely the
 * behaviour being pinned. (Confirmed by removing the guard and watching these fail.)
 */
vi.mock("../scripts/data/art-cache.mjs", () => ({
  resolveArtFor: async requests =>
    new Map(requests.map(r => [r.card.uuid, { path: `art/${r.card.identifier}.webp`, packageId: "dnd-players-handbook" }])),
  creditFor: () => []
}));

const { chooserContext } = await import("../scripts/app/entry-chooser.mjs");
const { invalidatePregenCache } = await import("../scripts/data/premades.mjs");

/**
 * The entry chooser illustrates its three cards with journal scenes from the Player's Handbook
 * module — the one art lookup in the module that names a package outright, rather than deriving it
 * from the uuid of the item being drawn.
 *
 * That makes it the one lookup that can show art from a book the world is not using. **Installed is
 * not the same as enabled:** Foundry serves a module's files from the filesystem whether or not the
 * world switches it on, so the `FilePicker.browse` existence check the resolver relies on cannot
 * tell the two apart. A world that deliberately disables the Player's Handbook still passed that
 * check and drew all three of its scenes.
 *
 * Found by taking reference screenshots in a world with no content modules and seeing the Player's
 * Handbook artwork turn up anyway.
 */
describe("the entry chooser's own artwork", () => {
  // The pregen list is memoised across calls, so it has to be dropped between cases or the first
  // world's answer is reused by the rest.
  beforeEach(() => invalidatePregenCache());
  afterEach(() => vi.unstubAllGlobals());

  /** A source with nothing in it: the chooser needs only counts from it here. */
  const source = { classes: () => [], species: () => [], backgrounds: () => [] };

  /** Stub `game.modules.get` to report the Player's Handbook at a given activation state. */
  function withPhb({ installed, active }) {
    vi.stubGlobal("game", {
      ...globalThis.game,
      // No pregen packs in this world: `foundryPregens` reads `game.packs.get` per source, and the
      // shared shim carries an array, which has no `get`.
      packs: { get: () => null },
      modules: {
        get: id => (installed && (id === "dnd-players-handbook")) ? { title: "PHB", active } : null
      }
    });
  }

  it("draws no scenes when the Player's Handbook is installed but disabled", async () => {
    withPhb({ installed: true, active: false });
    const ctx = await chooserContext({ source });
    // Every card falls back to the frame tier, which is what `seed` drives.
    expect(ctx.paths.length).toBeGreaterThan(0);
    for ( const path of ctx.paths ) expect(path.banner, path.id).toBeNull();
  });

  it("draws no scenes when the Player's Handbook is not installed at all", async () => {
    withPhb({ installed: false, active: false });
    const ctx = await chooserContext({ source });
    for ( const path of ctx.paths ) expect(path.banner, path.id).toBeNull();
  });

  it("draws them when the Player's Handbook is actually enabled", async () => {
    // The other side of the guard. Without this the suite would also pass on a chooser that never
    // drew any art at all, which is not the behaviour wanted — the scenes are the point of the
    // screen when the world has them.
    withPhb({ installed: true, active: true });
    const ctx = await chooserContext({ source });
    for ( const path of ctx.paths ) expect(path.banner, path.id).toBeTruthy();
  });

  it("still offers the three ways in without any artwork", async () => {
    // The art is decoration; losing it must not lose a path. Ready-made hides itself when the world
    // has no ready-made characters, so the two that never depend on content are the ones asserted.
    withPhb({ installed: true, active: false });
    const ctx = await chooserContext({ source });
    const ids = ctx.paths.map(p => p.id);
    expect(ids).toContain("custom");
    expect(ids).toContain("quick");
  });
});
