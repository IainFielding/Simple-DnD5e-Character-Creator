/**
 * Recaptures the README screenshots from a real, running world.
 *
 *   node screenshots.mjs                     # every shot from the base world
 *   node screenshots.mjs --only=class,review # just those
 *   node screenshots.mjs --world=playwright-ember
 *   node screenshots.mjs --world=playwright-bare    # no content modules; writes to no-content/
 *   HEADED=1 node screenshots.mjs --only=class --hold   # watch it, then poke at the result
 *
 * Why this exists: the README's pictures are the module's shop window, and they go stale the
 * moment the UI is restyled. Taking fourteen of them by hand means fourteen chances to catch a
 * different character, a different window size, or a half-loaded portrait. Here the character is
 * seeded and identical every run, so a single screenshot can be retaken on its own and still
 * match the rest of the set.
 *
 * Output goes straight to `docs/screenshots/`, overwriting in place — review the diff in git
 * before keeping it. The bare world writes to `docs/screenshots/no-content/` instead, so the two
 * sets never overwrite one another.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { WORLDS } from "./config.mjs";
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";

/**
 * 1667x957 at a 2x pixel ratio gives 3334x1914 files — matching the most recent hand-taken
 * screenshots in `docs/screenshots`, so newly captured and older images sit at the same scale
 * in the README until the whole set has been replaced.
 */
const VIEWPORT = { width: 1667, height: 957 };
const SCALE = 2;

/**
 * The box every saved picture is shrunk to fit, so the files drop straight into the README at
 * their natural size. Rendering stays at the viewport and pixel ratio above — laying the page out
 * at 800 wide would squash the creator into its narrow layout — and the 2x capture is downscaled
 * afterwards, which keeps text sharper than a 1x render would. Full-screen shots come out 800x459;
 * element crops keep their own shape inside the box. `--full-size` keeps the raw 2x capture.
 */
const FIT = { width: 800, height: 460 };

/**
 * Where each world's pictures land. The bare world writes to its own folder rather than over the
 * main set: the two are both wanted, and they answer different questions — "what does this look
 * like" and "what does this look like before you have bought anything".
 */
const OUT_DIRS = {
  playwright: new URL("../docs/screenshots/", import.meta.url),
  "playwright-ember": new URL("../docs/screenshots/", import.meta.url),
  "playwright-bare": new URL("../docs/screenshots/no-content/", import.meta.url)
};

/**
 * The character every base-world picture is of — a Bard, so the spell screens have something to
 * show.
 *
 * The portrait is the Player's Handbook module's own journal art, so the pictures show a character
 * with a face rather than the default silhouette. It is a path into an installed module, not an
 * asset this repo ships. (Ember's own builder supplies a portrait, so the Ember shots don't set one.)
 */
const CHARACTER = {
  class: "Bard",
  name: "Aria Nightbreeze",
  portrait: "modules/dnd-players-handbook/assets/journal-art/college-of-glamour.webp",
  token: "modules/dnd-players-handbook/assets/tokens/college-of-glamour-bard.webp"
};

const argv = process.argv.slice(2);
const value = name => argv.find(a => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const hold = argv.includes("--hold");
const fullSize = argv.includes("--full-size");
const worldId = value("world") ?? "playwright";
const only = value("only")?.split(",").map(s => s.trim()).filter(Boolean) ?? null;

if ( !WORLDS[worldId] ) throw new Error(`Unknown world "${worldId}"`);

/* -------------------------------------------- */
/*  The shot list                               */
/* -------------------------------------------- */

/**
 * Each entry is one file in `docs/screenshots`. `setup` puts the world into the state the picture
 * wants; `clip` optionally narrows the capture to a single element, for the shots that are a panel
 * or a window rather than the whole screen.
 *
 * The order matters: shots run top to bottom against one open creator, each building on the last,
 * because re-opening and re-filling the wizard for every picture would triple the runtime.
 */
const SHOTS = {
  playwright: [
    {
      // The creator opens on the chooser now, not the class grid — so this is genuinely the first
      // thing a player sees, and the shot has to be taken before anything else touches the shell.
      name: "entry-chooser",
      note: "The three ways in: step by step, Quick Build, or a ready-made character.",
      async setup(call) {
        await call("openCreator");
        await call("entry", "chooser");
      }
    },
    {
      name: "quick-build-screen",
      note: "Quick Build: three choices, seeded, with everything else filled in below.",
      async setup(call) {
        // Species pinned rather than left to the seed's roll. The roll is right for a player and
        // wrong for a picture: it changes every run, and it landed on the one AI-generated
        // illustration in the installed content. Elf is hand-painted book art, like the rest.
        await call("entry", { view: "threshold", species: "Elf" });
      }
    },
    {
      name: "ready-made",
      note: "Ready-made characters, grouped by the book they came from, with one selected.",
      async setup(call) {
        await call("entry", "premade");
        await call("premadeSelect", { index: 0 });
      }
    },
    {
      name: "welcome",
      note: "The step-by-step build — the class grid, nothing chosen yet.",
      async setup(call) {
        // A *fresh* creator first: taking the Custom path deliberately keeps whatever the quick
        // screen seeded, so coming straight from the shot above would show a class already chosen
        // on a screen captioned "nothing chosen yet".
        await call("openCreator");
        // Then the chooser's Custom path, which is what dismisses it. `goto` alone moves the step
        // *underneath* the overlay and leaves it up, so this shot and every one after it came out
        // as a picture of the chooser.
        await call("entryPath", "custom");
        await call("goto", "class");
      }
    },
    {
      // Cropped to the grid itself: the complexity dots under each icon and the one-line role are
      // what the caption is about, and at full width they are too small to read.
      name: "class-guide",
      note: "The class grid's complexity dots and one-line summaries.",
      selector: ".creator-drawer-grid",
      async setup() { /* same screen as welcome */ }
    },
    {
      name: "class-step",
      note: "A class chosen, with its detail panel.",
      async setup(call) {
        await call("choose", { class: CHARACTER.class });
        await call("picker", false);
      }
    },
    {
      // Cropped to the detail page rather than the whole screen: the button is what the caption
      // is about, and at full width it is a 40px target lost in a 3334px picture.
      name: "quick-build",
      note: "The Quick Build button on the chosen class.",
      selector: ".creator-work-page",
      async setup() { /* same screen as class-step */ }
    },
    {
      name: "compare",
      note: "Three classes pinned and laid out side by side.",
      async setup(call) {
        await call("compare", { category: "class", count: 3 });
      }
    },
    {
      // Everything from here on shows a filled character. Quick Build is the fastest way to get
      // one, it is seeded, and it fills exactly the fields a player would have filled by hand.
      name: "abilities",
      note: "The ability-score panel, with points spent and the Suggest button.",
      selector: ".creator-work-side",
      async setup(call) {
        // Clears whatever overlay the previous shot left up — the comparison grid, here.
        await call("closeOverlays");
        await call("quickBuild", { seed: 7, goTo: "class" });
        await call("details", {
          name: CHARACTER.name,
          portrait: CHARACTER.portrait,
          token: CHARACTER.token,
          lockRotation: true
        });
      }
    },
    {
      name: "background",
      note: "The background grid, with one chosen.",
      async setup(call) {
        await call("goto", "background");
        await call("picker", true);
      }
    },
    {
      name: "species",
      note: "The species grid, with one chosen.",
      async setup(call) {
        await call("goto", "species");
        await call("picker", true);
      }
    },
    {
      name: "details",
      note: "Name, portrait and token.",
      async setup(call) { await call("goto", "details"); }
    },
    {
      name: "spells",
      note: "The spell browser, with one spell's description open.",
      async setup(call) {
        await call("goto", "spells");
        await call("focusSpell", { index: 0 });
      }
    },
    {
      name: "choices",
      note: "The gathered choices step.",
      async setup(call) { await call("goto", "choices"); }
    },
    {
      name: "equipment",
      note: "Starting equipment bundles, with the instrument choices made.",
      async setup(call) {
        await call("goto", "equipment");
        await call("pickEquipment", [
          { source: "class", label: "Instrument of Illusions" },
          { source: "background", label: "Bandore" }
        ]);
      }
    },
    {
      name: "store",
      note: "The optional starting-gold store, mid-shop.",
      async setup(call) {
        await call("enableStore", true);
        // The shop is only worth a picture with money in it and something in the cart, and the
        // gold branch is the path the README describes for this step.
        await call("takeGold");
        await call("goto", "store");
        await call("shop", { count: 4 });
      }
    },
    {
      name: "magic-shop",
      note: "The Magic Items step: free picks by rarity, rolled bonus gold, and a cart.",
      async setup(call) {
        // The shop ships empty and only appears on a level the wealth table grants something at,
        // so both have to be arranged before the step is reachable at all.
        await call("stockMagicShop", {});
        await call("startAtLevel", 5);
        await call("goto", "magicShop");
        await call("pickMagicItems", { count: 3 });
      }
    },
    {
      name: "review",
      note: "The review screen, with the Add to party option ticked.",
      async setup(call) {
        // A primary party the GM owns is what puts the "Add to {party}" switch on this page.
        await call("ensureParty");
        await call("startAtLevel", 1);
        await call("goto", "review");
      }
    },
    {
      // The finishing options sit at the foot of the scrolling Review page, below what the full-screen
      // shot shows; the crop scrolls them into view.
      name: "review-finish",
      note: "The Review page's finishing options: Add to party (and Export PDF when its module is installed).",
      selector: ".creator-review-finish",
      async setup() { /* same screen as review */ }
    },
    {
      name: "actor",
      note: "The finished character sheet.",
      selector: ".app.sheet, .application.sheet",
      async setup(call) {
        // Built outside the party, so the chat-card shot below shows its "Add to" button rather
        // than the spent "In The Company" state.
        await call("joinParty", false);
        await call("buildActor");
      }
    },
    {
      name: "levelup",
      note: "The level-up wizard on the character just built.",
      async setup(call) { await call("levelUp"); }
    },
    {
      // Cropped to the sheet's header: at full-sheet scale the outline is a few pixels wide.
      name: "levelup-ready",
      note: "The Level Up button's golden outline once the character has the XP for their next level.",
      selector: ".application.sheet .sheet-header",
      async setup(call) { await call("xpReadySheet"); }
    },
    {
      // The same header crop, on a copy of the character with one choice left unanswered.
      name: "repair-button",
      note: "The repair wrench in the sheet header, shown only while a level has a skipped choice.",
      selector: ".application.sheet .sheet-header",
      async setup(call) { await call("repairSheet"); }
    },
    {
      name: "chat-card",
      note: "The creation chat card, with the GM's Add to party button.",
      selector: ".sogrom-shot-target",
      async setup(call) { await call("creationCard"); }
    },
    {
      name: "blank-sheet",
      note: "A blank character the GM prepared, with the gold Build Character hammer.",
      selector: ".app.sheet, .application.sheet",
      async setup(call) { await call("blankSheet"); }
    },
    {
      // Clipped to the sidebar strip: the menu is fixed-position and appended to the page body, so no
      // element crop would include both the row and the menu.
      name: "blank-menu",
      note: "Build Character in the Actors sidebar's right-click menu.",
      clip: { x: 1290, y: 0, width: 377, height: 820 },
      async setup(call) { await call("blankMenu"); }
    },
    {
      name: "store-config",
      note: "The GM's store configuration window.",
      selector: ".application",
      async setup(call) { await call("storeConfig"); }
    },
    {
      name: "magic-shop-config",
      note: "The GM's magic-item shop: the per-level wealth table and the stocked inventory.",
      selector: ".application",
      async setup(call) { await call("magicShopConfig"); }
    },
    {
      name: "levelup-options",
      note: "The GM's Level-Up Options, including the hit-point choices.",
      selector: ".application",
      async setup(call) { await call("levelUpOptions"); }
    },
    {
      // Not a picture: puts the world back (no party, no blank character) for the next run.
      name: "cleanup",
      capture: false,
      async setup(call) { await call("cleanupShots"); }
    }
  ],

  /**
   * Ember runs creation itself and hands the level-1 questions to the system's AdvancementManager,
   * which this module claims — so the Ember pictures are of *our* wizard wearing Ember's skin.
   * See `scripts/levelup/ember-creation.mjs`.
   */
  /**
   * The same screens with **no content modules at all** — only what the dnd5e system ships free.
   *
   * Its own list rather than a reuse of the one above, because the base list is full of things a
   * bare world does not have: a portrait path into the Player's Handbook module, an equipment pick
   * named "Instrument of Illusions", a Ready-made group per book. Pointing the base list at this
   * world would not fail loudly — it would quietly produce pictures of a half-set-up character,
   * which is worse than no pictures.
   *
   * What is deliberately kept is every screen where the *absence* of content is the point: the
   * background grid (4 of 16 resolve to art, so most cards wear the frame tier), the species and
   * class grids, and the entry screens a new player meets first.
   */
  "playwright-bare": [
    {
      name: "entry-chooser",
      note: "The three ways in, with only the system's free content installed.",
      async setup(call) {
        await call("openCreator");
        await call("entry", "chooser");
      }
    },
    {
      name: "quick-build-screen",
      note: "Quick Build on a bare install — art-free frames where no book supplies a picture.",
      // No species pinned: the point of this set is what the world actually offers, and the free
      // content's species list is short enough that the seed's roll is representative of it.
      async setup(call) { await call("entry", { view: "threshold" }); }
    },
    {
      name: "ready-made",
      note: "Ready-made characters — the twelve the system itself ships.",
      async setup(call) {
        await call("entry", "premade");
        await call("premadeSelect", { index: 0 });
      }
    },
    {
      name: "welcome",
      note: "The class grid with free content only — twelve of the thirteen classes.",
      async setup(call) {
        // See the base list's `welcome`: a fresh creator, then the Custom path, which is what
        // dismisses the chooser without carrying the quick screen's seeded picks in with it.
        await call("openCreator");
        await call("entryPath", "custom");
        await call("goto", "class");
      }
    },
    {
      name: "class-step",
      note: "A class chosen, with its detail panel.",
      async setup(call) {
        await call("choose", { class: CHARACTER.class });
        await call("picker", false);
      }
    },
    {
      name: "background",
      note: "The background grid — the case where most cards have no art to show.",
      async setup(call) {
        // Filled first so the rest of the set shows a real character, as the base list does.
        await call("quickBuild", { seed: 7, goTo: "background" });
        await call("picker", true);
      }
    },
    {
      name: "species",
      note: "The species grid on a bare install.",
      async setup(call) {
        await call("goto", "species");
        await call("picker", true);
      }
    },
    {
      name: "spells",
      note: "The spell browser, drawing on the system's own spell list.",
      async setup(call) {
        await call("goto", "spells");
        await call("focusSpell", { index: 0 });
      }
    },
    {
      name: "choices",
      note: "The gathered choices step.",
      async setup(call) { await call("goto", "choices"); }
    },
    {
      // No `pickEquipment`: its option labels are the Player's Handbook's. The default selection is
      // what a bare world offers, and is what this set is for.
      name: "equipment",
      note: "Starting equipment, at its default selection.",
      async setup(call) { await call("goto", "equipment"); }
    },
    {
      name: "review",
      note: "The review screen.",
      async setup(call) { await call("goto", "review"); }
    },
    {
      name: "actor",
      note: "The finished character sheet.",
      selector: ".app.sheet, .application.sheet",
      async setup(call) { await call("buildActor"); }
    }
  ],

  "playwright-ember": [
    {
      name: "ember-handoff",
      note: "The creator's steps inside Ember's character creation, in Ember's skin.",
      async setup(call) { await call("emberCreation"); }
    },
    {
      name: "ember-store",
      note: "The starting-gold store inside Ember's creation flow.",
      async setup(call) {
        await call("enableStore", true);
        await call("takeGold");
        // No `gotoStep` here: the Ember rail is rebuilt from the driver's steps each render and a
        // later screen is unreachable until the earlier ones are answered. So walk the whole way
        // once, answering as it goes, which makes every step reachable — then jump back.
        await call("walkTo", { until: "Review" });
        await call("gotoRail", "Store");
        await call("shop", { count: 4 });
      }
    },
    {
      name: "ember-review",
      note: "The summary Ember's build ends on, before handing back.",
      async setup(call) { await call("gotoRail", "Review"); }
    },
    {
      name: "ember-levelup",
      note: "The level-up wizard restyled to match Ember.",
      async setup(call) {
        await call("emberActor");
        await call("levelUp");
      }
    }
  ]
};

/* -------------------------------------------- */
/*  Runner                                      */
/* -------------------------------------------- */

const OUT_DIR = OUT_DIRS[worldId] ?? OUT_DIRS.playwright;
mkdirSync(OUT_DIR, { recursive: true });
ensureWorld(worldId);

const server = await startFoundry(worldId);
console.log(`Foundry up with world "${worldId}"`);

let session;
let exitCode = 0;
try {
  session = await Session.open({ viewport: VIEWPORT, deviceScaleFactor: SCALE, canvas: true });
  const call = await load(session);

  const shots = SHOTS[worldId];
  if ( only && !shots.some(s => only.includes(s.name)) ) {
    throw new Error(`No shots matched --only=${only.join(",")}`);
  }

  /**
   * Every shot's `setup` runs, even the ones being skipped — they are steps in a single walk
   * through the wizard, so "just retake the review screen" still has to fill the character first.
   * `--only` filters the *capture*, not the walk. Shots after the last requested one are dropped,
   * since nothing later can change a picture already taken.
   */
  const lastWanted = only ? shots.findLastIndex(s => only.includes(s.name)) : shots.length - 1;

  for ( const shot of shots.slice(0, lastWanted + 1) ) {
    // `capture: false` marks a step that only changes the world (the cleanup at the end of a list).
    const capture = (shot.capture !== false) && (!only || only.includes(shot.name));
    process.stdout.write(`  ${shot.name} … `);
    await shot.setup(call);
    if ( !capture ) {
      console.log("(setup only)");
      continue;
    }
    await sleep(600);
    // Last thing before the shutter. A step that loads asynchronously — the magic shop reads its
    // whole index — re-renders after its `setup` returned, which puts back the `#{VERSION}#` pill
    // and any toast that `depersonalise` had already cleared. Doing it here means no shot can be
    // caught by that, rather than each helper having to remember.
    await call("depersonalise");
    const path = new URL(`./${shot.name}.png`, OUT_DIR).pathname.slice(1);
    let png;
    if ( shot.clip ) {
      png = await session.page.screenshot({ clip: shot.clip });
    } else if ( shot.selector ) {
      const target = session.page.locator(shot.selector).last();
      await target.waitFor({ timeout: 15_000 });
      png = await target.screenshot();
    } else {
      png = await session.page.screenshot();
    }
    const out = fullSize ? png : await fit(session, png);
    writeFileSync(path, out);
    console.log("ok");
  }

  if ( hold ) {
    console.log("Holding — Ctrl+C to exit.");
    await sleep(3_600_000);
  }
} catch ( err ) {
  exitCode = 1;
  console.error(`\n${err.message}`);
  if ( session ) {
    writeFileSync(new URL("./console.log", import.meta.url), session.consoleLog.join("\n"), "utf8");
    await session.page.screenshot({ path: new URL("./failure.png", import.meta.url).pathname.slice(1) })
      .catch(() => {});
    console.error("wrote console.log and failure.png");
  }
} finally {
  if ( session ) await session.close();
  await server.stop();
}
process.exit(exitCode);

/**
 * Shrink a PNG to fit inside `FIT`, keeping its aspect ratio; one already inside is left alone.
 * The resize runs in a scratch browser page rather than the Foundry one, so the world is never
 * touched, and uses the browser's own high-quality scaler, so the harness needs no image library.
 * @param {Session} session
 * @param {Buffer} png
 * @returns {Promise<Buffer>}
 */
async function fit(session, png) {
  const page = await session.page.context().newPage();
  try {
    const b64 = await page.evaluate(async ({ src, box }) => {
      const blob = await (await fetch(`data:image/png;base64,${src}`)).blob();
      const full = await createImageBitmap(blob);
      const ratio = Math.min(box.width / full.width, box.height / full.height, 1);
      if ( ratio === 1 ) return src;
      const width = Math.round(full.width * ratio);
      const height = Math.round(full.height * ratio);
      const scaled = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d").drawImage(scaled, 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let bin = "";
      for ( let i = 0; i < bytes.length; i += 0x8000 ) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, { src: png.toString("base64"), box: FIT });
    return Buffer.from(b64, "base64");
  } finally {
    await page.close();
  }
}

/**
 * Import `in-world/shots.mjs` into the page and return a caller for its exports — the same
 * loader pattern `run.mjs` uses, cache-busted so an edit takes effect without a server restart.
 * @param {Session} session
 * @returns {Promise<(fn: string, arg?: any) => Promise<any>>}
 */
async function load(session) {
  await session.eval(async bust => {
    const url = `/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs?v=${bust}`;
    globalThis.__shots = await import(url);
  }, Date.now());
  return (fn, arg) => session.eval(
    ({ fn, arg }) => globalThis.__shots[fn](arg),
    { fn, arg }
  );
}
