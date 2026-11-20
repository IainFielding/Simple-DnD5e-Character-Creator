/**
 * Probe: World of Warcraft specializations and the Hunter's Roving-or-Pet-Specialization choice,
 * through the real creator — the Class page's buttons, Quick Build, Create, and the level-up window.
 * Screenshots go to the directory given.
 *
 *   node probe-spec.mjs <outdir>
 */
import { startFoundry } from "./lib/server.mjs";
import { Session } from "./lib/session.mjs";
import { ensureWorld } from "./lib/worlds.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
ensureWorld("playwright");
const server = await startFoundry("playwright");
let session;
const report = {};
try {
  session = await Session.open();
  await session.page.setViewportSize({ width: 1600, height: 1000 });
  const ev = (fn, arg) => session.eval(fn, arg);
  const shot = name => session.page.screenshot({ path: join(out, `${name}.png`) });
  const settle = () => new Promise(r => setTimeout(r, 1500));
  const pick = async (selector, value) => { await session.page.locator(selector).first().selectOption(value); await settle(); };

  // 1. What the reader made of the book.
  report.specs = await ev(async () => {
    const m = await import(`/modules/sogrom-dnd5e-character-creator/scripts/data/specializations.mjs?v=${Date.now()}`);
    // A specialization holds its picks as `refs` ({type, uuid, identifier, name}), in the book's order.
    const of = (s, type) => s.refs.filter(r => r.type === type);
    const show = async (cls, hero) => (await m.specializationsFor(cls, hero)).map(s =>
      `${s.name}: sub=${of(s, "subclass")[0]?.name ?? "-"} feats=${of(s, "feat").length} spells=${of(s, "spell").length}`);
    return { paladin: await show("paladin"), deathKnight: await show("paladin", "death-knight"),
      hunter: await show("ranger", "hunter"), mage: await show("wizard", "mage") };
  });

  /** Open the creator on the Class page with a class chosen (by the PHB card), then click through. */
  const startClass = async className => {
    await ev(async name => {
      globalThis.__shots = await import(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/shots.mjs?v=${Date.now()}`);
      await game.settings.set("sogrom-dnd5e-character-creator", "heroClassDisplay", "detail");
      await globalThis.__shots.openCreator();
      await globalThis.__shots.entryPath("custom");
      await globalThis.__shots.goto("class");
      await globalThis.__shots.choose({ class: name });
      await globalThis.__shots.picker(false);
    }, className);
    await settle();
  };
  /** Climb a built character headlessly, exactly as the shell does after a Quick Build. */
  const climb = (uuid, level) => ev(async ([u, lvl]) => {
    const M = "/modules/sogrom-dnd5e-character-creator/scripts";
    const { getSources } = await import(`${M}/data/source-cache.mjs`);
    const { quickClimb } = await import(`${M}/data/quick-climb.mjs`);
    const { source, spells } = getSources();
    const r = await quickClimb(await fromUuid(u), lvl, source, spells);
    return r.reached;
  }, [uuid, level]);
  const describeBuilt = uuid => ev(async u => {
    const a = await fromUuid(u);
    const cls = a.items.find(i => i.type === "class");
    return {
      class: `${cls?.name} ${cls?.system?.levels}`,
      specialization: cls?.flags?.["sogrom-dnd5e-character-creator"]?.specialization ?? null,
      subclass: a.items.find(i => i.type === "subclass")?.name ?? null,
      feats: a.items.filter(i => (i.type === "feat") && (i.system?.type?.value === "feat")).map(i => i.name).sort(),
      spells: a.items.filter(i => i.type === "spell").map(i => `${i.name}${i.flags?.dnd5e?.advancementOrigin ? " [" + i.flags.dnd5e.advancementOrigin + "]" : ""} p${i.system?.prepared}`).sort()
    };
  }, uuid);

  // 2. Paladin → Holy, on the Class page.
  await startClass("Paladin");
  report.specBlock = await ev(() => [...document.querySelectorAll(".creator-specialization option")].map(e => e.textContent.trim()));
  await pick('.creator-specialization select', "holy");
  report.specIntro = await ev(() => document.querySelector(".creator-spec-intro")?.textContent.trim().slice(0, 120) ?? null);
  await shot("1-class-paladin-holy");

  // 3. Quick Build at level 5, then Create: the climb should follow Holy.
  await ev(() => globalThis.__shots.quickBuild({ seed: 7, goTo: "review" }));
  const holyUuid = await ev(() => globalThis.__shots.buildActor());
  report.holyReached = await climb(holyUuid, 5);
  report.holy = await describeBuilt(holyUuid);

  // 4. Hunter (Ranger) → Beast Mastery, level 5, then level up to 6 in the real window.
  await startClass("Ranger");
  await session.page.locator(".creator-hero-class summary").first().click();
  await session.page.locator('.creator-hero-class [data-hero="hunter"]').first().click();
  await settle();
  await pick('.creator-specialization select', "beast-mastery");
  await ev(() => globalThis.__shots.quickBuild({ seed: 7, goTo: "review" }));
  const hunterUuid = await ev(() => globalThis.__shots.buildActor());
  report.hunterReached = await climb(hunterUuid, 5);
  report.hunter = await describeBuilt(hunterUuid);
  await ev(() => globalThis.__shots.levelUp());
  await settle();
  report.level6 = await ev(() => {
    const blocks = [...document.querySelectorAll("[data-step-action=optionalGrantPick], [data-step-action=optionalGrantToggle]")];
    return blocks.map(b => `${b.dataset.stepAction}: ${b.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}`);
  });
  await shot("2-hunter-level6");

  // 5. The level-up's own Specialization block: it shows the class's choice, and changing it writes
  // the flag to the class on the driver's clone (read back through the live window's state).
  const levelUpSpec = () => ev(() => {
    const sel = document.querySelector(".creator-levelup-specialization select");
    const app = [...foundry.applications.instances.values()].find(a => a.state?.driver && a.state?.classItem);
    return sel ? {
      options: [...sel.options].map(o => o.value), value: sel.value,
      status: sel.closest(".levelup-block")?.querySelector(".levelup-block-status")?.textContent.trim() ?? null,
      cloneFlag: app?.state.classItem.flags?.["sogrom-dnd5e-character-creator"]?.specialization ?? null
    } : null;
  });
  report.levelUpSpec = await levelUpSpec();
  await pick(".creator-levelup-specialization select", "survival");
  report.levelUpSpecAfter = await levelUpSpec();
  await shot("3-hunter-levelup-spec");
  console.log(JSON.stringify(report, null, 1));
} finally {
  await session?.close?.();
  await server.stop();
}
