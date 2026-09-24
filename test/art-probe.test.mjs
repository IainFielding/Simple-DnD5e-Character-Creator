import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { invalidateArtCache, resolveArtFor } from "../scripts/data/art-cache.mjs";
import { artPathsFor } from "../scripts/data/origin-art.mjs";

/**
 * Origin art for a user who may not browse directories — most players, since Foundry withholds the
 * "Use File Browser" permission by default. Without it every browse failed and every card fell back
 * to its icon; now each candidate file is checked with a HEAD request, and the plan's preference
 * order still decides between several that exist.
 */
const acolyte = { uuid: "Compendium.dnd-players-handbook.origins.Item.bgAcolyte0000000", name: "Acolyte", identifier: "acolyte" };

let browse;
let served;
beforeEach(() => {
  installFoundryShims();
  invalidateArtCache();
  served = new Set();
  browse = vi.fn(async () => { throw new Error("You do not have permission to browse files"); });
  foundry.applications = { apps: { FilePicker: { implementation: { browse } } } };
  foundry.utils.getRoute = path => `/${path}`;
  globalThis.fetch = vi.fn(async url => ({ ok: served.has(url) }));
});

const asPlayer = () => { game.user = { isGM: false, can: () => false }; };

describe("origin art without the file browser", () => {
  it("finds the art by checking candidate files, never browsing", async () => {
    asPlayer();
    const [first] = artPathsFor(acolyte, "background");
    served.add(`/${first.path}`);
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.get(acolyte.uuid)?.path).toBe(first.path);
    expect(browse).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
  });

  // Several candidates can exist; the plan's order decides, exactly as it does against a listing.
  it("prefers the earlier candidate when more than one exists", async () => {
    asPlayer();
    const plan = artPathsFor(acolyte, "background");
    served.add(`/${plan[2].path}`);
    served.add(`/${plan[1].path}`);
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.get(acolyte.uuid)?.path).toBe(plan[1].path);
  });

  it("leaves the card to its icon when no candidate exists", async () => {
    asPlayer();
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.has(acolyte.uuid)).toBe(false);
  });

  it("asks about each file once per session", async () => {
    asPlayer();
    await resolveArtFor([{ card: acolyte, category: "background" }]);
    const calls = fetch.mock.calls.length;
    await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it("still browses for a GM", async () => {
    game.user = { isGM: true, can: () => true };
    browse.mockImplementation(async dir => ({ files: [`${dir}/acolyte-origin.webp`] }));
    await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(browse).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
