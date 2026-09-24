import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFoundryShims } from "./helpers/foundry-shims.mjs";
import { invalidateArtCache, resolveArtFor } from "../scripts/data/art-cache.mjs";
import { artPathsFor } from "../scripts/data/origin-art.mjs";

/**
 * Origin art when a directory listing can't be trusted: for a user who may not browse (most players,
 * since Foundry withholds "Use File Browser" by default), and for a GM on a host whose listings come
 * back empty for files that exist (The Forge serves Bazaar packages from outside the plain `data`
 * source). Either way each candidate is checked by loading it as an image, and the plan's preference
 * order still decides between several that exist.
 */
const acolyte = { uuid: "Compendium.dnd-players-handbook.origins.Item.bgAcolyte0000000", name: "Acolyte", identifier: "acolyte" };

let browse;
let served;
let loads;
beforeEach(() => {
  installFoundryShims();
  invalidateArtCache();
  served = new Set();
  loads = [];
  browse = vi.fn(async () => { throw new Error("You do not have permission to browse files"); });
  foundry.applications = { apps: { FilePicker: { implementation: { browse } } } };
  foundry.utils.getRoute = path => `/${path}`;
  // An image loader that "finds" whatever is in `served`, asynchronously, as a browser would.
  globalThis.Image = class {
    set src(url) {
      loads.push(url);
      queueMicrotask(() => (served.has(url) ? this.onload?.() : this.onerror?.()));
    }
  };
  globalThis.fetch = vi.fn();
});

const asPlayer = () => { game.user = { isGM: false, can: () => false }; };
const asGM = () => { game.user = { isGM: true, can: () => true }; };

describe("origin art without the file browser", () => {
  it("finds the art by loading candidate images, never browsing", async () => {
    asPlayer();
    const [first] = artPathsFor(acolyte, "background");
    served.add(`/${first.path}`);
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.get(acolyte.uuid)?.path).toBe(first.path);
    expect(browse).not.toHaveBeenCalled();
    // Image loads, not fetches: a redirect to another domain's CDN must not trip over CORS.
    expect(fetch).not.toHaveBeenCalled();
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
    const count = loads.length;
    await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(loads.length).toBe(count);
  });
});

describe("origin art for a GM", () => {
  it("uses the listing when it has the file, loading nothing", async () => {
    asGM();
    browse.mockImplementation(async dir => ({ files: [`${dir}/acolyte-origin.webp`] }));
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.get(acolyte.uuid)?.file).toBe("acolyte-origin.webp");
    expect(loads).toEqual([]);
  });

  // The Forge case: the listing is empty although the files are served.
  it("checks file by file when every directory lists empty", async () => {
    asGM();
    browse.mockImplementation(async () => ({ files: [] }));
    const [first] = artPathsFor(acolyte, "background");
    served.add(`/${first.path}`);
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.get(acolyte.uuid)?.path).toBe(first.path);
  });

  // A listing that has files but not this card's is an answer, not a gap: no probing.
  it("trusts a listing that has other files but not this one", async () => {
    asGM();
    browse.mockImplementation(async dir => ({ files: [`${dir}/something-else.webp`] }));
    const art = await resolveArtFor([{ card: acolyte, category: "background" }]);
    expect(art.has(acolyte.uuid)).toBe(false);
    expect(loads).toEqual([]);
  });
});
