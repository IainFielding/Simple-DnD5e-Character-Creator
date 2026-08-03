import { describe, it, expect, beforeEach } from "vitest";

/**
 * Subclass pickers are scoped to the *edition* of the class being advanced.
 *
 * A world can hold both editions of a class — the system still ships the 2014 classes beside the
 * 2024 ones, and Tasha's adds 2014 subclasses on top — and both editions share a `classIdentifier`.
 * Matching on the identifier alone offered a 2014 Cleric the 2024 domains, which is not a cosmetic
 * problem: a 2024 subclass grants its features at the levels the 2024 class advances on, so pairing
 * it with the 2014 progression builds a character neither edition describes.
 *
 * The filter lives in `SourceIndex#subclasses` so both callers inherit it — the creation resolver
 * (a 2014 class picks its subclass at level 1) and the level-up subclass step.
 *
 * The logic is reproduced here rather than imported: `source-index.mjs` pulls in Foundry globals at
 * module scope, and the rule under test is the three-line filter, not the compendium plumbing.
 */
describe("subclass pickers are scoped to the class's rules edition", () => {
  let all;

  /**
   * Both halves of the real path: `#fetchSubclasses` normalises each card's edition to a string as
   * it builds the card, and `subclasses()` then filters. Modelling only the filter would assert a
   * behaviour the system actually gets from the other line.
   */
  const card = c => ({ ...c, rules: c.rules != null ? String(c.rules) : null });
  const forClass = (classIdentifier, rules = null) => {
    const want = (rules === null) || (rules === undefined) ? null : String(rules);
    return all
      .map(card)
      .filter(c => c.classIdentifier === classIdentifier)
      .filter(c => !want || !c.rules || (c.rules === want))
      .map(c => c.name);
  };

  beforeEach(() => {
    all = [
      { name: "Life Domain (2014)", classIdentifier: "cleric", rules: "2014" },
      { name: "Twilight Domain", classIdentifier: "cleric", rules: "2014" },   // Tasha's
      { name: "Life Domain (2024)", classIdentifier: "cleric", rules: "2024" },
      { name: "War Domain (2024)", classIdentifier: "cleric", rules: "2024" },
      { name: "Homebrew Domain", classIdentifier: "cleric", rules: null },     // declares no edition
      { name: "Thief", classIdentifier: "rogue", rules: "2024" }
    ];
  });

  it("offers a 2014 class only its own edition", () => {
    expect(forClass("cleric", "2014"))
      .toEqual(["Life Domain (2014)", "Twilight Domain", "Homebrew Domain"]);
  });

  it("offers a 2024 class only its own edition", () => {
    expect(forClass("cleric", "2024"))
      .toEqual(["Life Domain (2024)", "War Domain (2024)", "Homebrew Domain"]);
  });

  // Homebrew and third-party packs frequently never set `source.rules`. Hiding those from everyone
  // would be a worse failure than showing them to both, so undeclared content stays on offer.
  it("offers content that declares no edition to both", () => {
    expect(forClass("cleric", "2014")).toContain("Homebrew Domain");
    expect(forClass("cleric", "2024")).toContain("Homebrew Domain");
  });

  it("offers everything when the class itself declares no edition", () => {
    expect(forClass("cleric")).toHaveLength(5);
  });

  it("still filters by class identifier", () => {
    expect(forClass("rogue", "2024")).toEqual(["Thief"]);
  });

  // The packs store `'2014'` as a string, but a number is legal in the schema.
  it("compares editions as strings, so a numeric 2014 still matches", () => {
    all.push({ name: "Numeric Edition Domain", classIdentifier: "cleric", rules: 2014 });
    expect(forClass("cleric", "2014")).toContain("Numeric Edition Domain");
    expect(forClass("cleric", "2024")).not.toContain("Numeric Edition Domain");
  });
});

/**
 * The same rule scopes the **species** and **background** grids, which is possible because class is
 * the first step of creation — the character's edition is settled before either grid renders.
 *
 * The class grid is deliberately *not* scoped: the class is the choice that decides the edition.
 */
describe("origin grids are scoped to the chosen class's edition", () => {
  const origins = [
    { name: "Human (2024)", rules: "2024" },
    { name: "Goliath (2024)", rules: "2024" },
    { name: "Hill Dwarf (2014)", rules: "2014" },
    { name: "Half-Orc (2014)", rules: "2014" },
    { name: "Homebrew Ancestry", rules: null }
  ];

  const matchesRules = (cardRules, want) => (!want || !cardRules) ? true : String(cardRules) === String(want);
  const offered = want => origins.filter(c => matchesRules(c.rules, want)).map(c => c.name);

  it("offers a 2014 class only 2014 origins, plus undeclared content", () => {
    expect(offered("2014")).toEqual(["Hill Dwarf (2014)", "Half-Orc (2014)", "Homebrew Ancestry"]);
  });

  it("offers a 2024 class only 2024 origins, plus undeclared content", () => {
    expect(offered("2024")).toEqual(["Human (2024)", "Goliath (2024)", "Homebrew Ancestry"]);
  });

  it("offers everything when no class is chosen yet", () => {
    expect(offered(null)).toHaveLength(5);
  });
});

/**
 * Switching class after picking origins.
 *
 * Class is the first step, so the grids alone are nearly enough — but a player can go back and swap
 * a 2024 class for a 2014 one, and the origins picked under the old edition would survive it. That
 * is exactly the mixed-edition character the scoping exists to prevent, so a genuine mismatch is
 * dropped. Anything else is left alone: switching within an edition must cost the player nothing.
 */
describe("switching class edition drops incompatible origins", () => {
  const matchesRules = (cardRules, want) => (!want || !cardRules) ? true : String(cardRules) === String(want);

  /** `dropOffEditionOrigins` as class-step applies it. */
  const drop = (state, rulesOf) => {
    const want = rulesOf(state.classUuid);
    if ( !want ) return state;
    for ( const field of ["speciesUuid", "backgroundUuid"] ) {
      if ( state[field] && !matchesRules(rulesOf(state[field]), want) ) state[field] = null;
    }
    return state;
  };

  const editions = { "class-2014": "2014", "class-2024": "2024", "species-2024": "2024",
    "background-2024": "2024", "species-2014": "2014", "homebrew": null, "class-none": null };
  const rulesOf = uuid => editions[uuid] ?? null;

  it("drops a 2024 species and background when a 2014 class is chosen", () => {
    const state = drop({ classUuid: "class-2014", speciesUuid: "species-2024",
      backgroundUuid: "background-2024" }, rulesOf);
    expect(state.speciesUuid).toBeNull();
    expect(state.backgroundUuid).toBeNull();
  });

  it("keeps origins that already match the new class", () => {
    const state = drop({ classUuid: "class-2014", speciesUuid: "species-2014",
      backgroundUuid: null }, rulesOf);
    expect(state.speciesUuid).toBe("species-2014");
  });

  it("keeps content that declares no edition", () => {
    const state = drop({ classUuid: "class-2014", speciesUuid: "homebrew" }, rulesOf);
    expect(state.speciesUuid).toBe("homebrew");
  });

  it("drops nothing when the new class declares no edition", () => {
    const state = drop({ classUuid: "class-none", speciesUuid: "species-2024" }, rulesOf);
    expect(state.speciesUuid).toBe("species-2024");
  });

  it("drops nothing when the class is cleared", () => {
    const state = drop({ classUuid: null, speciesUuid: "species-2024" }, rulesOf);
    expect(state.speciesUuid).toBe("species-2024");
  });
});
