import { describe, it, expect, vi } from "vitest";

vi.mock("../scripts/data/art-cache.mjs", () => ({
  resolveArtFor: async () => new Map(),
  creditFor: () => []
}));

/** Stands in for the pack reader: whatever `roster` holds is what this world ships. */
let roster = [];
vi.mock("../scripts/data/premades.mjs", async importOriginal => ({
  ...(await importOriginal()),
  foundryPregens: async () => roster
}));

const { premadeContext } = await import("../scripts/app/entry-chooser.mjs");

const pc = (id, level) => ({ id, uuid: `Actor.${id}`, name: id, line: "", img: "x.webp", level });
const group = (pack, ...entries) => ({ pack, label: pack, badge: null, entries });
/** A source with nothing configured in it, so only the pregens are listed. */
const source = { classes: () => [], species: () => [], backgrounds: () => [] };
const ids = ctx => ctx.groups.flatMap(g => g.entries.map(e => e.id));

/**
 * The ready-made list's level filter. It runs across every book, opens on level 1, and offers only
 * the levels something is actually at.
 */
describe("the ready-made level filter", () => {
  const world = () => {
    roster = [
      group("dnd5e.actors24", pc("akra1", 1), pc("akra5", 5), pc("akra11", 11)),
      group("dnd-heroes-borderlands.actors", pc("hero1", 1))
    ];
  };

  it("opens on level 1 across every group", async () => {
    world();
    const ctx = await premadeContext({ source });
    expect(ids(ctx)).toEqual(["akra1", "hero1"]);
    expect(ctx.levels.find(l => l.active).value).toBe("1");
  });

  it("offers the levels present, then All levels", async () => {
    world();
    const ctx = await premadeContext({ source });
    expect(ctx.levels.map(l => l.value)).toEqual(["1", "5", "11", "all"]);
  });

  it("narrows to one level and drops a group with nothing at it", async () => {
    world();
    const ctx = await premadeContext({ source }, null, 5);
    expect(ids(ctx)).toEqual(["akra5"]);
    expect(ctx.groups).toHaveLength(1);
  });

  it("shows everything on All levels", async () => {
    world();
    expect(ids(await premadeContext({ source }, null, "all"))).toHaveLength(4);
  });

  it("does not confirm a choice the filter hides", async () => {
    world();
    const ctx = await premadeContext({ source }, "akra5", 1);
    expect(ctx.chosen).toBeNull();
    expect(ctx.confirm).toBeNull();
  });

  it("falls back to the lowest level where there is no level 1", async () => {
    roster = [group("dnd5e.actors24", pc("akra5", 5), pc("akra11", 11))];
    expect(ids(await premadeContext({ source }))).toEqual(["akra5"]);
  });

  it("offers no filter where everything is one level", async () => {
    roster = [group("dnd5e.actors24", pc("akra1", 1))];
    expect((await premadeContext({ source })).levels).toBeNull();
  });
});
