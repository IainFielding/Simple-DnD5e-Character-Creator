/**
 * End-to-end check of "Repair this level" (`scripts/levelup/repair.mjs`).
 *
 * dnd5e never blocks Next on an unmade choice, so the native wizard can apply a level with a Fighting
 * Style never picked, a subclass never chosen or an ASI never spent. The check reproduces exactly
 * that, then asks whether the repair makes the character whole:
 *
 *  1. **reference** — the scenario built natively with every decision answered;
 *  2. **broken** — the same build natively, with chosen decisions deliberately left unanswered
 *     (answered `null`, which the native adapter leaves untouched before pressing Next);
 *  3. `repairTargets` must find those gaps and nothing else;
 *  4. each gap level is repaired through the real `LevelUpDriver`, answered from the reference build's
 *     own answer book, exactly as the headless creator adapter drives a level-up;
 *  5. the repaired character must match the reference, and nothing may be left to repair.
 *
 * An assertion rather than an equivalence test of the usual kind: the native side has no repair to
 * compare against, but it has the character a repair ought to produce.
 */

const BUST = new URL(import.meta.url).search;
const { buildNative } = await import(`./native.mjs${BUST}`);
const { AnswerBook } = await import(`./answers.mjs${BUST}`);
const { ScenarioChoiceProvider } = await import(`./provider.mjs${BUST}`);
const { sweepScenarios } = await import(`./sweep.mjs${BUST}`);
const { snapshot, diff } = await import(`./normalize.mjs${BUST}`);

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const { LevelUpDriver } = await import(`${MODULE}/levelup/manager-driver.mjs`);
const { repairTargets, buildRepairManager, foldToLevel } = await import(`${MODULE}/levelup/repair.mjs`);

const PREFIX = "[e2e] ";

/**
 * The cases: a sweep scenario id, the level to build to, and which decisions to skip. A skip rule names
 * an advancement type on the class or subclass and, for a multi-level one, the level to skip it at.
 */
const CASES = [
  {
    label: "Fighter 5 (Champion) — skipped Fighting Style, subclass and first ASI",
    id: "sweep:fighter/champion",
    level: 5,
    skip: [{ type: "ItemChoice", level: 1 }, { type: "Subclass" }, { type: "AbilityScoreImprovement", level: 4 }]
  },
  {
    // The subclass arrives late, so its level-3 Savant choice only exists once the repair picks it.
    label: "Wizard 5 (Conjurer) — skipped subclass, so its Savant choice arrives with the repair",
    id: "sweep:wizard/conjurer",
    level: 5,
    skip: [{ type: "Subclass" }]
  },
  {
    label: "Fighter 5 (2014 SRD Champion, Tasha's options) — skipped Fighting Style, subclass and first ASI",
    id: "sweep:fighter/champion-dnd5e-subclasses",
    level: 5,
    skip: [{ type: "ItemChoice", level: 1 }, { type: "Subclass" }, { type: "AbilityScoreImprovement", level: 4 }]
  },
  {
    label: "Fighter 4 (Champion) — skipped only the ASI, everything else answered",
    id: "sweep:fighter/champion",
    level: 4,
    skip: [{ type: "AbilityScoreImprovement", level: 4 }]
  }
];

/** Overrides answering `null` for every class advancement a skip rule matches. */
async function skipOverrides(scenario, rules) {
  const doc = await fromUuid(scenario.classUuid);
  const out = {};
  for ( const adv of Object.values(doc?.advancement?.byId ?? {}) ) {
    for ( const rule of rules ) {
      if ( adv.type !== rule.type ) continue;
      if ( rule.level === undefined ) { out[adv.id] = null; continue; }
      const tiers = Object.keys(adv.configuration?.choices ?? {}).map(Number);
      if ( (adv.level === rule.level) || tiers.includes(rule.level) ) {
        out[adv.id] = { ...(typeof out[adv.id] === "object" ? out[adv.id] : {}), [rule.level]: null };
      }
    }
  }
  return out;
}

/** Wait for the writes dnd5e makes off a commit to land before anything reads the actor. */
const settle = ms => new Promise(r => setTimeout(r, ms));

/** Repair one class level headlessly, answered from `book`. */
async function repairLevel(actor, classId, level, book) {
  const manager = buildRepairManager(actor, classId, level);
  if ( !manager.steps.length ) return { level, steps: 0 };
  const driver = new LevelUpDriver(manager);
  await driver.prepare();
  foldToLevel(driver, level);
  const records = () => [...driver.hpSteps, ...driver.sizeSteps, ...driver.grantSteps, ...driver.subclassSteps,
    ...driver.asiSteps, ...driver.traitSteps, ...driver.choiceSteps];
  for ( const rec of records() ) {
    await book.answer(rec.advancement, rec.level, { asker: "creator", phase: "levelup" });
  }
  await driver.autoResolve(new ScenarioChoiceProvider(book, { phase: "levelup" }));
  await driver.commit();
  await settle(600);
  return { level, steps: manager.steps.length };
}

/** Run every case. */
export async function checkRepair() {
  const cases = [];
  for ( const spec of CASES ) cases.push(await runCase(spec));
  cases.push(await runUiCase());
  cases.push(await runCheckCase());
  return { ok: cases.every(c => c.ok), cases };
}

/** Wait until `test()` holds. */
async function until(test, timeout = 10_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    if ( await test() ) return true;
    await settle(150);
  }
  return false;
}

/**
 * Check Character on the same skipped-ASI Fighter, through its one front door: the sheet's ⋯ menu,
 * clicked for real. It must not be in the Actors right-click menu (a real `contextmenu` event, since
 * the hook alone proves nothing about the built menu). The report must name level 4 as a problem, a
 * second open must reuse the one window, its Repair button must open the shell on level 4, and once
 * repaired the report must have no problems left.
 */
async function runCheckCase() {
  const out = { label: "Check Character reports the skipped level and its Repair button repairs it",
    ok: false, gaps: [], repaired: [], left: [], differences: [], error: null };
  const failures = [];
  let actor = null;
  let shell = null;
  const { MODULE_ID } = await import(`${MODULE}/config.mjs`);
  const label = game.i18n.localize(`${MODULE_ID}.check.button`);
  const openChecks = () => [...(foundry.applications.instances?.values() ?? [])]
    .filter(app => app.constructor?.name === "CharacterCheckApp");
  try {
    const { scenarios } = await sweepScenarios({ level: 4, incremental: true });
    const scenario = scenarios.find(s => s.id === "sweep:fighter/champion");
    const origins = [scenario.speciesUuid, scenario.backgroundUuid, scenario.classUuid].filter(Boolean);
    const skips = await skipOverrides(scenario, [{ type: "AbilityScoreImprovement", level: 4 }]);
    const book = new AnswerBook({ overrides: scenario.answers ?? {}, generate: true, origins });
    actor = await buildNative({ ...scenario, name: `${PREFIX}check [ui]`, incremental: true },
      { book: new AnswerBook({ overrides: { ...(scenario.answers ?? {}), ...skips }, generate: true, origins }) });

    // 1. Not in the Actors right-click menu, through a real contextmenu event.
    await ui.sidebar?.changeTab?.("actors", "primary");
    await ui.actors.render();
    await settle(300);
    const li = ui.actors.element?.querySelector(`.directory-item[data-entry-id="${actor.id}"]`);
    if ( !li ) throw new Error("the character is not in the Actors sidebar");
    const box = li.getBoundingClientRect();
    li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.left + 5, clientY: box.top + 5 }));
    await until(() => document.querySelector("#context-menu .context-item"));
    if ( [...document.querySelectorAll("#context-menu .context-item")].some(el => el.textContent.trim() === label) ) {
      failures.push(`"${label}" is still in the character's right-click menu`);
    }
    await ui.context?.close?.({ animate: false });
    await settle(200);

    // 2. The sheet's ⋯ menu opens it, through real clicks.
    await actor.sheet.render(true);
    await settle(1500);
    // The ⋯ button toggles, and the dropdown can still be open from the last pick, so look before
    // toggling and toggle at most twice.
    const findEntry = () => [...document.querySelectorAll("#context-menu .context-item, .controls-dropdown .header-control, menu.controls-dropdown li")]
      .find(el => (el.textContent.trim() === label) && el.isConnected && (el.offsetParent !== null));
    const fromMenu = async () => {
      let entry = findEntry();
      for ( let i = 0; !entry && (i < 2); i++ ) {
        actor.sheet.element?.querySelector('[data-action="toggleControls"]')?.click();
        await settle(400);
        entry = findEntry();
      }
      entry?.click();
      return !!entry;
    };
    if ( !(await fromMenu()) ) throw new Error(`no "${label}" in the sheet's ⋯ menu`);
    if ( !(await until(() => openChecks()[0]?.rendered)) ) throw new Error("the sheet's ⋯ entry opened no report");
    const report = openChecks()[0];
    if ( report.id !== `sogrom-check-${actor.id}` ) failures.push(`the report's id is ${report.id}, not per-actor`);

    // 3. The report: level 4 is a problem with a Repair button.
    const problems = () => [...report.element.querySelectorAll(".sogrom-check-item.is-problem")];
    const level4 = problems().find(el => el.textContent.includes("4"));
    out.gaps = problems().map(el => el.querySelector(".sogrom-check-text")?.textContent.trim());
    if ( !level4 ) throw new Error(`the report names no level-4 problem: ${out.gaps.join(" | ") || "none"}`);
    if ( !level4.querySelector('button[data-action="repair"]') ) failures.push("the level-4 problem has no Repair button");

    // A second open from the same menu reuses the one window.
    if ( !(await fromMenu()) ) failures.push(`the sheet's ⋯ menu lost "${label}" on a second open`);
    await settle(800);
    if ( openChecks().length !== 1 ) failures.push(`a second open left ${openChecks().length} report windows`);
    if ( document.querySelectorAll(`#sogrom-check-${actor.id}`).length !== 1 ) failures.push("a second open duplicated the report's element");

    // 4. Repair from the report opens the shell on level 4; answer and Apply as the wrench case does.
    // Re-read the row: the second open re-rendered the report, detaching the one found above.
    const repairButton = problems().find(el => el.textContent.includes("4"))?.querySelector('button[data-action="repair"]');
    if ( !repairButton ) throw new Error("the re-rendered report lost its level-4 Repair button");
    repairButton.click();
    const opened = await until(() => [...(foundry.applications.instances?.values() ?? [])]
      .some(app => (app.constructor?.name === "LevelUpShell") && app.rendered), 60_000);
    if ( !opened ) throw new Error("the report's Repair button opened no shell");
    shell = [...foundry.applications.instances.values()].find(app => app.constructor?.name === "LevelUpShell");
    if ( shell.state.repairLevel !== 4 ) failures.push(`the shell repairs level ${shell.state.repairLevel}, not 4`);
    const driver = shell.state.driver;
    for ( const rec of [...driver.asiSteps, ...driver.choiceSteps, ...driver.traitSteps, ...driver.subclassSteps] ) {
      await book.answer(rec.advancement, rec.level, { asker: "creator", phase: "levelup" });
    }
    await driver.autoResolve(new ScenarioChoiceProvider(book, { phase: "levelup" }));
    await shell._finish();
    await settle(2000);
    out.repaired.push({ level: 4, steps: driver.steps.length });

    // 5. Checked again, nothing is a problem any more.
    const { checkCharacter } = await import(`${MODULE}/levelup/character-check.mjs`);
    out.left = checkCharacter(actor).filter(f => f.kind === "problem").map(f => f.text);
    if ( out.left.length ) failures.push(`problems left after the repair: ${out.left.join(" | ")}`);
    out.differences = failures.map(f => ({ path: "ui", native: "expected", creator: f }));
    out.ok = !failures.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    for ( const app of openChecks() ) await app.close({ animate: false }).catch(() => {});
    if ( shell?.rendered ) await shell.close({ animate: false }).catch(() => {});
    if ( actor?.sheet?.rendered ) await actor.sheet.close().catch(() => {});
    if ( actor ) await actor.delete().catch(() => {});
  }
  return out;
}

/**
 * The same repair through the real front door: the sheet's wrench button, the prompt, and the
 * interactive `LevelUpShell` — whose title, rail and Apply are what a player actually meets. The
 * decisions are answered through the shell's own driver (as the hooks suite does), then Apply runs
 * `LevelUpShell#_finish` for real.
 */
async function runUiCase() {
  const out = { label: "The sheet's wrench opens the real shell on the one level, and Apply fixes it",
    ok: false, gaps: [], repaired: [], left: [], differences: [], error: null };
  const failures = [];
  const unhook = [];
  let actor = null;
  let shell = null;
  try {
    const { promptRepair } = await import(`${MODULE}/levelup/repair.mjs`);
    const { scenarios } = await sweepScenarios({ level: 4, incremental: true });
    const scenario = scenarios.find(s => s.id === "sweep:fighter/champion");
    const origins = [scenario.speciesUuid, scenario.backgroundUuid, scenario.classUuid].filter(Boolean);
    const skips = await skipOverrides(scenario, [{ type: "AbilityScoreImprovement", level: 4 }]);
    const book = new AnswerBook({ overrides: scenario.answers ?? {}, generate: true, origins });
    actor = await buildNative({ ...scenario, name: `${PREFIX}repair [ui]`, incremental: true },
      { book: new AnswerBook({ overrides: { ...(scenario.answers ?? {}), ...skips }, generate: true, origins }) });
    out.gaps = repairTargets(actor).flatMap(t => t.levels.map(g => `${t.classItem.name} ${g.level}: ${g.titles.join(", ")}`));

    // The button is on the rendered sheet.
    await actor.sheet.render(true);
    await settle(1500);
    if ( !actor.sheet.element?.querySelector(".sogrom-repair-btn") ) failures.push("no repair button on the sheet");

    // The public hooks a repair session announces (docs/API.md): started, then applied.
    const heard = [];
    for ( const name of ["levelUpStarted", "levelUpApplied", "levelUpCancelled"] ) {
      const hook = `simpleCharacterCreator.${name}`;
      const id = Hooks.on(hook, payload => heard.push({ name, repairLevel: payload?.state?.repairLevel ?? null }));
      unhook.push(() => Hooks.off(hook, id));
    }

    // One level to repair, so the prompt goes straight to the shell.
    shell = await promptRepair(actor);
    await settle(1500);
    if ( !shell ) throw new Error("promptRepair opened no shell");
    if ( shell.state.repairLevel !== 4 ) failures.push(`the shell repairs level ${shell.state.repairLevel}, not 4`);
    if ( !String(shell.title).includes("4") ) failures.push(`the window title does not name the level: "${shell.title}"`);
    // The rail as the shell builds it each render: the one level screen, then the review.
    const { buildSteps } = await import(`${MODULE}/levelup/registry.mjs`);
    const rail = buildSteps(shell.state).map(s => s.id);
    if ( rail.join(",") !== "level-4,review" ) failures.push(`unexpected rail: ${rail.join(", ")}`);

    // Answer through the shell's own driver, then Apply for real.
    const driver = shell.state.driver;
    for ( const rec of [...driver.asiSteps, ...driver.choiceSteps, ...driver.traitSteps, ...driver.subclassSteps] ) {
      await book.answer(rec.advancement, rec.level, { asker: "creator", phase: "levelup" });
    }
    await driver.autoResolve(new ScenarioChoiceProvider(book, { phase: "levelup" }));
    await shell._finish();
    await settle(2000);
    out.repaired.push({ level: 4, steps: driver.steps.length });

    out.left = repairTargets(actor).flatMap(t => t.levels.map(g => `${t.classItem.name} ${g.level}: ${g.titles.join(", ")}`));
    if ( out.left.length ) failures.push("Apply left the level unanswered");
    if ( (actor.system?.details?.level ?? 0) !== 4 ) failures.push(`the repair changed the character's level to ${actor.system?.details?.level}`);
    await actor.sheet.render(true);
    await settle(1000);
    if ( actor.sheet.element?.querySelector(".sogrom-repair-btn") ) failures.push("the repair button outlived the repair");
    const sequence = heard.map(h => h.name).join(" → ");
    if ( sequence !== "levelUpStarted → levelUpApplied" ) failures.push(`hooks heard: ${sequence || "none"}`);
    if ( heard.some(h => h.repairLevel !== 4) ) failures.push("a hook payload did not carry state.repairLevel = 4");
    out.differences = failures.map(f => ({ path: "ui", native: "expected", creator: f }));
    out.ok = !failures.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    for ( const off of unhook ) off();
    if ( shell?.rendered ) await shell.close({ animate: false }).catch(() => {});
    if ( actor?.sheet?.rendered ) await actor.sheet.close().catch(() => {});
    if ( actor ) await actor.delete().catch(() => {});
  }
  return out;
}

async function runCase(spec) {
  const out = { label: spec.label, ok: false, gaps: [], repaired: [], left: [], differences: [], error: null };
  let reference = null;
  let broken = null;
  try {
    const { scenarios } = await sweepScenarios({ level: spec.level, incremental: true });
    const scenario = scenarios.find(s => s.id === spec.id);
    if ( !scenario ) throw new Error(`no sweep scenario "${spec.id}"`);
    const origins = [scenario.speciesUuid, scenario.backgroundUuid, scenario.classUuid].filter(Boolean);

    // Broken first, with its own book: the reference book must not see the null answers.
    const skips = await skipOverrides(scenario, spec.skip);
    if ( !Object.keys(skips).length ) throw new Error("no class advancement matched the skip rules");
    const brokenBook = new AnswerBook({ overrides: { ...(scenario.answers ?? {}), ...skips }, generate: true, origins });
    broken = await buildNative({ ...scenario, name: `${PREFIX}repair [broken]`, incremental: true }, { book: brokenBook });

    const book = new AnswerBook({ overrides: scenario.answers ?? {}, generate: true, origins });
    reference = await buildNative({ ...scenario, name: `${PREFIX}repair [reference]`, incremental: true }, { book });

    const before = repairTargets(broken);
    out.gaps = before.flatMap(t => t.levels.map(g => `${t.classItem.name} ${g.level}: ${g.titles.join(", ")}`));
    if ( !before.length ) throw new Error("the broken build has nothing to repair — the skip rules did not bite");
    if ( !diff(snapshot(reference).source, snapshot(broken).source).length ) {
      throw new Error("the broken build already matches the reference — nothing to prove");
    }

    for ( const target of before ) {
      for ( const group of target.levels ) {
        const classItem = broken.items.get(target.classItem.id);
        out.repaired.push(await repairLevel(broken, classItem.id, group.level, book));
      }
    }

    out.left = repairTargets(broken).flatMap(t => t.levels.map(g => `${t.classItem.name} ${g.level}: ${g.titles.join(", ")}`));
    const a = snapshot(reference);
    const b = snapshot(broken);
    out.differences = [...diff(a.source, b.source, "source"), ...diff(a.derived, b.derived, "derived")];
    out.ok = !out.left.length && !out.differences.length;
  } catch ( err ) {
    out.error = `${err.message}\n${err.stack ?? ""}`;
  } finally {
    const ids = [reference?.id, broken?.id].filter(Boolean);
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids, { render: false }).catch(() => {});
  }
  return out;
}
