/**
 * End-to-end checks for the Wizard's spellbook and the spell-step changes that came with it, through
 * the real windows, real clicks and real writes:
 *
 *   1. **Creation, both editions.** The Spells step's tabs (Cantrips, Spellbook, Prepare), six book
 *      picks with the first four prepared and badged, the Prepare tab's limit (a fifth prepare is
 *      refused), swapping which spells are prepared, the completion hint, and the finished sheet.
 *   2. **Granted cards at creation.** An origin that grants a spell shows it as a locked card on the
 *      tab it belongs to, badged, with its granter named in the tooltip.
 *   3. **Level-up, Wizard 3 → 4.** Cantrips first, then Spellbook, then Prepare; new book picks
 *      auto-fill the prepared limit; no swap rows; Prepare tab changes to owned spells; the faded
 *      book-only chips; what Apply writes; the Review rows and the chat card lines.
 *   4. **Wizards built before the book was modelled.** A short book is offered the gap with its note;
 *      a 2014 Wizard over its prepared limit is warned and can still apply.
 *   5. **Cleric, any-number swaps.** Several prepared spells marked and replaced; the domain spells
 *      shown as locked "Always" cards.
 *   6. **A Wizard through Ember's builder** (the `playwright-ember` world only): the real hand-off
 *      window's Spells step, and the book, prepared count and free-pick ledger after Ember's write.
 *
 * Every screen checked here is also checked for raw translation keys, which is how a missing
 * `lang/en.json` entry shows to a player.
 */

const MODULE = "/modules/sogrom-dnd5e-character-creator/scripts";
const BUST = new URL(import.meta.url).search;

const { CreatorShell } = await import(`${MODULE}/app/creator-shell.mjs`);
const { applyQuickBuild } = await import(`${MODULE}/data/quick-build.mjs`);
const { getSources } = await import(`${MODULE}/data/source-cache.mjs`);
const { MODULE_ID, SETTINGS, launchWindowOptions } = await import(`${MODULE}/config.mjs`);
const { CreatorState } = await import(`${MODULE}/state/creator-state.mjs`);
const { assembleActor } = await import(`${MODULE}/build/actor-assembler.mjs`);
const { quickClimb } = await import(`${MODULE}/data/quick-climb.mjs`);
const { triggerLevelUp } = await import(`${MODULE}/levelup/intercept.mjs`);
const { buildSteps } = await import(`${MODULE}/levelup/registry.mjs`);
const { spellsStep } = await import(`${MODULE}/steps/spells-step.mjs`);
const { originGrantedSpellCards, grantedSpellCards } = await import(`${MODULE}/steps/feat-spells-step.mjs`);
const { BOOK_FREE_FLAG, bookSpells, bookTarget, spellbookRule } = await import(`${MODULE}/data/spellbook.mjs`);
const { captureLevelUpSummary } = await import(`${MODULE}/build/chat-summary.mjs`);
const { lvlReviewStep } = await import(`${MODULE}/levelup/steps/lvl-review-step.mjs`);
const LEVEL_COMPONENTS = await Promise.all([
  ["hp-step", "hpStep"], ["subclass-step", "subclassStep"], ["asi-step", "asiStep"], ["choices-step", "choicesStep"],
  ["trait-step", "traitStep"], ["grant-step", "grantStep"], ["optional-grant-step", "optionalGrantStep"],
  ["native-flow-step", "nativeFlowStep"]
].map(async ([file, name]) => (await import(`${MODULE}/levelup/steps/${file}.mjs`))[name]));
const { ScenarioChoiceProvider } = await import(`./provider.mjs${BUST}`);
const { AnswerBook } = await import(`./answers.mjs${BUST}`);
const { stageEmberManager } = await import(`./ember.mjs${BUST}`);
const { isEmberCreationManager } = await import(`${MODULE}/levelup/ember-creation.mjs`);
const { choicesStep } = await import(`${MODULE}/levelup/steps/choices-step.mjs`);
const { saveDraft, readDraft, applyDraft, clearDraft } = await import(`${MODULE}/state/draft-store.mjs`);
const { SpellSource } = await import(`${MODULE}/data/spell-source.mjs`);

const PREFIX = "[e2e] ";
const pause = ms => new Promise(r => setTimeout(r, ms));
const L = key => game.i18n.localize(`${MODULE_ID}.${key}`);

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Close every non-core window. */
async function closeAll() {
  const core = new Set(Object.values(ui).filter(v => v && (typeof v === "object")));
  for ( const app of [...(foundry.applications.instances?.values() ?? [])] ) {
    if ( !app || core.has(app) || (typeof app.close !== "function") ) continue;
    await Promise.resolve(app.close({ force: true })).catch(() => {});
  }
  await pause(200);
}

/** Wait until `test()` holds, re-checking every tick. */
async function until(test, timeout = 20_000) {
  const started = Date.now();
  while ( (Date.now() - started) < timeout ) {
    try { if ( await test() ) return true; } catch { /* the DOM is mid-render */ }
    await pause(150);
  }
  return false;
}

/** Resolve once a shell's stage has real content rather than its loading spinner. */
async function waitForStage(shell, timeout = 420_000) {
  const ok = await until(() => {
    const el = shell.element?.querySelector(".creator-stage");
    return el && !el.querySelector(".creator-loading");
  }, timeout);
  if ( !ok ) throw new Error("the stage never finished loading");
  await pause(200);
}

/** The world's copy of a class for an edition, preferring the Player's Handbook module's. */
function classFor(identifier, rules) {
  const { source } = getSources();
  const all = source.classes().filter(c => (c.identifier === identifier) && (source.rulesOf(c.uuid) === rules));
  return all.find(c => c.uuid.includes("dnd-players-handbook")) ?? all[0] ?? null;
}

/** An origin card by name for an edition. */
function originFor(kind, rules, name) {
  const { source } = getSources();
  const list = source[kind]({ rules });
  return list.find(c => c.name.toLowerCase() === name.toLowerCase()) ?? list[0] ?? null;
}

/** Any raw translation key left on a screen: what a missing `lang/en.json` entry looks like. */
function rawKeys(root) {
  const text = root?.textContent ?? "";
  const attrs = [...(root?.querySelectorAll("[data-tooltip],[aria-label],[title]") ?? [])]
    .map(el => `${el.dataset.tooltip ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`)
    .join(" ");
  return [...new Set(`${text} ${attrs}`.match(new RegExp(`${MODULE_ID}\\.[\\w.]+`, "g")) ?? [])];
}

/** The spell step's tabs, in order. */
function tabsOf(shell) {
  return [...(shell.element?.querySelectorAll(".creator-spell-tab") ?? [])].map(b => ({
    tab: b.dataset.tab, text: b.textContent.replace(/\s+/g, " ").trim(), active: b.classList.contains("is-active")
  }));
}

/** The rows of the spell list as the player sees them. */
function rowsOf(shell) {
  return [...(shell.element?.querySelectorAll(".creator-picklist > li") ?? [])].map(li => {
    const row = li.querySelector(".creator-pickrow");
    const flag = li.querySelector(".creator-pickrow-flag");
    return {
      uuid: row?.dataset.uuid, name: row?.dataset.name, level: Number(row?.dataset.level ?? 0),
      selected: row?.classList.contains("is-selected"), granted: row?.classList.contains("is-granted"),
      owned: row?.classList.contains("is-owned") && !row?.classList.contains("is-granted"),
      disabled: row?.classList.contains("is-disabled"),
      flag: flag?.textContent.trim() ?? "", tip: flag?.dataset.tooltip ?? ""
    };
  });
}

/** Click a spell tab and wait for it to be the active one. */
async function clickTab(shell, tab) {
  shell.element.querySelector(`.creator-spell-tab[data-tab="${tab}"]`)?.click();
  return until(() => tabsOf(shell).find(t => t.tab === tab)?.active);
}

/**
 * Click a row to focus it, then the detail pane's button for `action`, and wait for `settled`.
 * Waits for the pane to show *this* spell first: the focus re-renders asynchronously, and clicking
 * the button still on screen from the previous spell toggles that one instead.
 */
async function focusAndPress(shell, uuid, action, settled) {
  const row = shell.element.querySelector(`.creator-pickrow[data-uuid="${CSS.escape(uuid)}"]`);
  const name = row?.dataset.name ?? "";
  row?.click();
  const shown = await until(() => {
    const pane = shell.element.querySelector(".creator-detail");
    return pane && (pane.querySelector("h2")?.textContent.trim() === name)
      && pane.querySelector(`[data-step-action="${action}"]`);
  });
  if ( !shown ) return { ok: false, why: `no "${action}" button for ${name} after focusing it` };
  const button = shell.element.querySelector(`.creator-detail [data-step-action="${action}"]`);
  if ( button.disabled ) return { ok: false, disabled: true, why: "the button is disabled" };
  const focusedBefore = shell.state.focusedSpellUuid;
  const picksBefore = shell.state.selectedSpells?.length ?? 0;
  let dispatched = 0;
  const hook = shell._onDispatch;
  shell._onDispatch = (a, el) => { if ( a === action ) dispatched++; return hook?.call(shell, a, el); };
  button.click();
  const ok = await until(settled, 8_000);
  shell._onDispatch = hook;
  if ( ok ) return { ok };
  return {
    ok: false,
    why: `nothing happened (button "${button.textContent.trim()}", data-uuid ${button.dataset.uuid === uuid ? "matches" : `is ${button.dataset.uuid}`},`
      + ` focused ${focusedBefore === uuid ? "yes" : `no: ${focusedBefore}`}, dispatched ${dispatched}×,`
      + ` picks ${picksBefore} → ${shell.state.selectedSpells?.length ?? 0})`
  };
}

/**
 * The finished character's own dnd5e sheet, on its Spells tab: every Wizard spell's prepare button
 * must match the spell (lit only when prepared). Returns the mismatches, or a reason it couldn't look.
 */
async function sheetMismatches(actor) {
  const sheet = actor.sheet;
  await sheet.render(true);
  await until(() => sheet.rendered && sheet.element, 20_000);
  sheet.changeTab?.("spells", "primary");
  await pause(800);
  const out = [];
  const spells = actor.itemTypes.spell.filter(s => (s.system.level > 0) && (s.system.sourceItem === "class:wizard"));
  for ( const s of spells ) {
    const row = sheet.element?.querySelector(`[data-item-id="${s.id}"]`);
    if ( !row ) { out.push(`${s.name} isn't listed on the sheet's Spells tab`); continue; }
    const button = row.querySelector('[data-action="prepare"]');
    if ( !button ) { out.push(`${s.name} has no prepare button on the sheet`); continue; }
    const lit = button.classList.contains("active");
    if ( lit !== (s.system.prepared > 0) ) out.push(`${s.name}: sheet shows ${lit ? "prepared" : "unprepared"}, item is ${s.system.prepared}`);
  }
  await sheet.close();
  return out;
}

/** WCAG contrast ratio of an element's text against the first opaque background behind it. */
function contrastOf(el) {
  const rgba = str => (str.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => {
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return (0.2126 * f(r)) + (0.7152 * f(g)) + (0.0722 * f(b));
  };
  let bg = null;
  for ( let n = el; n && (n !== document.documentElement); n = n.parentElement ) {
    const c = rgba(getComputedStyle(n).backgroundColor);
    if ( (c.length >= 3) && ((c[3] ?? 1) > 0.5) ) { bg = c; break; }
  }
  if ( !bg ) return null;
  const fg = rgba(getComputedStyle(el).color);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * What can be measured about how the spell step looks: badge text is readable against its badge,
 * book-only chips are rendered faded with their book mark, and narrowing the window spills nothing
 * sideways. Whether it *looks right* is still a person's call.
 */
async function measureLook(shell, r) {
  const flags = [...shell.element.querySelectorAll(".creator-pickrow-flag")].filter(f => f.offsetParent);
  const ratios = flags.map(f => ({ text: f.textContent.trim(), ratio: contrastOf(f) })).filter(x => x.ratio !== null);
  const worst = ratios.sort((a, b) => a.ratio - b.ratio)[0];
  if ( worst && (worst.ratio < 4.5) ) r.failures.push(`the "${worst.text}" badge's text contrast is ${worst.ratio.toFixed(2)}:1, under 4.5:1`);
  const faded = [...shell.element.querySelectorAll(".creator-spell-chip.is-unprepared")];
  if ( faded.length ) {
    const style = getComputedStyle(faded[0]);
    if ( !(Number(style.opacity) < 1) ) r.failures.push("book-only chips aren't rendered faded");
    const mark = faded[0].querySelector(".creator-spell-chip-mark");
    if ( !mark || (getComputedStyle(mark).display === "none") ) r.failures.push("book-only chips don't show their book mark");
  }
  // Narrow the window and look for anything spilling sideways.
  const el = shell.element;
  const width = el.style.width;
  el.style.width = "720px";
  await pause(400);
  const spill = [".creator-spell-tabs", ".creator-spell-search-row", ".creator-picklist", ".creator-pick-desc",
    ".creator-stage-foot", ".creator-stage"]
    .map(sel => el.querySelector(sel)).filter(Boolean)
    .filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.className.split(" ")[0]);
  el.style.width = width;
  await pause(200);
  if ( spill.length ) r.failures.push(`at 720px wide, content spills sideways in: ${spill.join(", ")}`);
  r.notes.push(`look: ${ratios.length} badges, lowest contrast ${worst ? worst.ratio.toFixed(1) : "n/a"}:1;`
    + ` ${faded.length} faded chip(s); no sideways spill at 720px${spill.length ? " (failed)" : ""}`);
}

/**
 * Compare lives in the stage footer and nowhere in the filter row; the "Choose N more" label is gone;
 * pinning two spells enables the footer's Compare, and clicking it opens the comparison.
 */
async function checkFooterCompare(shell, r) {
  const el = shell.element;
  if ( el.querySelector(".creator-spell-search-row .creator-compare-btn") ) r.failures.push("Compare is still in the filter row");
  if ( el.querySelector(".creator-toolbar .creator-count") ) r.failures.push("the \"Choose N more\" label is still in the toolbar");
  const button = () => el.querySelector(".creator-stage-foot .creator-compare-btn");
  if ( !button() ) return r.failures.push("no Compare button in the footer");
  // Pin two spells from the list, then open the comparison from the footer.
  const pins = [...el.querySelectorAll(".creator-picklist .creator-pin:not(.is-pinned)")].slice(0, 2);
  for ( const pin of pins ) { pin.click(); await pause(300); }
  if ( !(await until(() => button() && !button().disabled, 8_000)) ) return r.failures.push("pinning two spells didn't enable the footer's Compare");
  button().click();
  if ( !(await until(() => el.querySelector(".creator-compare"), 15_000)) ) r.failures.push("the footer's Compare didn't open the comparison");
  else {
    el.querySelector('.creator-compare [data-action="closeCompare"]')?.click();
    await pause(400);
  }
  // Unpin again so later steps start clean.
  for ( const pin of el.querySelectorAll(".creator-picklist .creator-pin.is-pinned") ) { pin.click(); await pause(200); }
  r.notes.push("Compare is in the footer, opens the comparison; no \"Choose N more\" label");
}

/** Wizard spells on a sheet: the book and its prepared count. */
function bookCounts(actor) {
  const cls = actor.items.find(i => (i.type === "class") && spellbookRule(i));
  if ( !cls ) return null;
  const { all, counted } = bookSpells(actor, cls);
  const prep = cls.system?.spellcasting?.preparation ?? {};
  return {
    ledger: cls.getFlag(MODULE_ID, BOOK_FREE_FLAG),
    level: Number(cls.system?.levels ?? 1), held: counted.length, target: bookTarget(spellbookRule(cls), cls.system?.levels),
    prepared: Number(prep.value), max: Number(prep.max),
    unprepared: all.filter(s => Number(s.system?.prepared ?? 0) === 0).map(s => s.name)
  };
}

/** Build a character headlessly, the way Quick Build does, climbing to `level`. */
async function quickCharacter(label, cls, level, { speciesName = "human", backgroundName = null } = {}) {
  const { source, spells, equipment } = getSources();
  const rules = source.rulesOf(cls.uuid);
  const actor = await Actor.implementation.create({ name: `${PREFIX}${label}`, type: "character" }, { render: false });
  const state = new CreatorState(actor);
  state.classUuid = cls.uuid;
  const species = originFor("species", rules, speciesName);
  const background = backgroundName ? originFor("backgrounds", rules, backgroundName) : null;
  const result = await applyQuickBuild({ state, source, spells, equipment },
    { rng: () => 0.37, speciesUuid: species?.uuid, backgroundUuid: background?.uuid });
  if ( !result?.ok ) throw new Error(`quick build did not fill: ${result?.warnings?.join(", ") || "no reason"}`);
  if ( level > 1 ) state.targetLevel = level;
  await assembleActor(state, source, null);
  await pause(300);
  if ( level > 1 ) {
    const climb = await quickClimb(actor, level, source, spells);
    if ( climb.reached < level ) throw new Error(`the climb stopped at level ${climb.reached} of ${level}`);
    await pause(300);
  }
  return actor;
}

/**
 * Open the real level-up window on an actor, answer its level screens, and land on the Spells step.
 * `open` starts it: the sheet's level-up by default, or rendering a staged Ember hand-off, which
 * the module's takeover claims into the same window.
 */
async function openLevelUpOnSpells(actor, open = () => triggerLevelUp(actor), { classPick = null, subclass = null, log = null } = {}) {
  await closeAll();
  await game.user?.unsetFlag(MODULE_ID, "creatorDraft").catch(() => {});
  await open();
  let shell = null;
  await until(() => (shell = [...foundry.applications.instances.values()].find(a => a.constructor?.name === "LevelUpShell")), 30_000);
  if ( !shell ) throw new Error("the level-up window did not open");
  if ( !shell.state.driver && shell.state.needsClassChoice ) {
    // The class to level: a named pick (a new class for a multiclass), else the existing one.
    const classItem = actor.items.find(i => i.type === "class");
    const dataset = classPick ?? { kind: "existing", id: classItem?.id };
    await shell._dispatch("pick-levelup-class", { dataset, getAttribute: () => null });
  }
  if ( !(await until(() => shell.state.driver, 60_000)) ) throw new Error("the level-up never prepared a driver");
  // Every level decision answered from a generated book first (the subclass, the ability increase),
  // the way probeSpellChoice does; `autoResolve` alone leaves those to the player.
  const driver = shell.state.driver;
  const book = new AnswerBook({ generate: true });
  // A decision can reveal more (a subclass brings its features' choices), so answer in passes until
  // a pass adds nothing new.
  for ( let pass = 0; pass < 4; pass++ ) {
    const records = [...driver.hpSteps, ...driver.subclassSteps, ...driver.asiSteps, ...driver.traitSteps,
      ...driver.choiceSteps, ...driver.grantSteps];
    for ( const rec of records ) await book.answer(rec.advancement, rec.level, { asker: "creator" });
    // A subclass the book left open is picked here: the first the class offers in its edition.
    // (Only when unchosen: `selectSubclass` is a toggle.)
    for ( const rec of driver.subclassSteps ) {
      if ( driver.subclassState(rec).chosen ) continue;
      const classItem = actor.items.find(i => i.type === "class");
      const { source } = getSources();
      const rules = source.rulesOf(classItem._stats?.compendiumSource ?? "") ?? null;
      const options = await source.subclasses(classItem.system.identifier, { rules });
      // A named subclass when the case asks for one (the Evoker), else the class's first.
      const pick = (subclass && options.find(o => subclass.test(o.name))) ?? options[0];
      if ( pick?.uuid ) await driver.selectSubclass(rec, pick.uuid);
    }
    // Spell choices (a Savant's "add two spells to your book") are left to the player by the book;
    // take the first offered spells, through the level screen's own section, as probeSpellChoice does.
    const spells = new SpellSource();
    for ( const rec of driver.choiceSteps.filter(x => x.advancement?.configuration?.type === "spell") ) {
      const st = driver.choiceState(rec);
      if ( st.current >= st.max ) continue;
      const blocks = await choicesStep.sectionsAt({ state: shell.state, driver, spells }, rec.screenLevel ?? rec.level) ?? [];
      const section = blocks.flatMap(b => b.sections).find(sec => sec.index === driver.choiceSteps.indexOf(rec));
      const offered = (section?.options ?? []).filter(o => !o.owned && !o.disabled).slice(0, st.max - st.current);
      for ( const o of offered ) await driver.toggleChoice(rec, o.uuid);
      log?.(`${rec.advancement.title ?? "spell choice"} (level ${rec.level}): took ${offered.length} of ${st.max}`);
    }
    await driver.autoResolve(new ScenarioChoiceProvider(book));
    const after = driver.hpSteps.length + driver.subclassSteps.length + driver.asiSteps.length
      + driver.traitSteps.length + driver.choiceSteps.length + driver.grantSteps.length;
    if ( after === records.length ) break;
  }
  await shell.render();
  await waitForStage(shell);
  const index = buildSteps(shell.state).findIndex(s => s.id === "spells");
  if ( index < 0 ) {
    const plan = shell.state.spellPlan();
    throw new Error(`the level-up has no Spells step (levelling ${shell.state.classItem?.name ?? "?"};`
      + ` selection ${JSON.stringify(shell.state.classSelection)}; caster ${plan.isSpellcaster},`
      + ` book ${plan.addBook ?? 0}, spells ${plan.addSpells}, max level ${plan.maxSpellLevel})`);
  }
  shell._leaveStepFor(index);
  if ( !(await until(() => shell.element?.querySelector(".creator-spell-tab, .levelup-spells"), 60_000)) ) {
    throw new Error("the Spells step never rendered");
  }
  await pause(400);
  return shell;
}

/** Apply a level-up through the real finish path, and wait for the level to land. */
async function applyLevelUp(shell, actor, r = null) {
  const before = actor.system.details.level;
  // Which step, and for a level screen which of its decisions, is still open.
  const incomplete = buildSteps(shell.state).filter(s => !s.isComplete(shell.state)).map(s => {
    if ( !Number.isInteger(s.level) ) return s.id;
    const open = LEVEL_COMPONENTS.filter(c => !c.isCompleteAt(shell.state, s.level)).map(c => c.id ?? "?");
    return `${s.id}: ${open.join(", ")}`;
  });
  await shell._finish();
  const landed = await until(() => actor.system.details.level === before + 1, 60_000);
  await pause(1200);
  if ( !landed && r ) r.failures.push(`Apply didn't land; steps not complete: [${incomplete.join(", ") || "none"}]`);
  return landed;
}

/** The newest level-up chat card for an actor, as rendered text. */
async function levelUpCardText(actor) {
  const message = [...game.messages].reverse()
    .find(m => (m.getFlag(MODULE_ID, "summary") === "levelup") && (m.speaker?.actor === actor.id));
  if ( !message ) return null;
  const html = await message.renderHTML();
  return html?.textContent?.replace(/\s+/g, " ") ?? "";
}

/* -------------------------------------------- */
/*  Cases                                       */
/* -------------------------------------------- */

/** 1. Creation, through the real Spells step. */
async function creationBook(r, rules) {
  const cls = classFor("wizard", rules);
  if ( !cls ) return r.failures.push(`no ${rules} Wizard in the world`);
  await closeAll();
  await game.user?.unsetFlag(MODULE_ID, "creatorDraft").catch(() => {});
  const shell = new CreatorShell(null, launchWindowOptions());
  shell.state.classUuid = cls.uuid;
  await shell.render(true);
  await waitForStage(shell);
  const { source, spells, equipment } = getSources();
  const filled = await applyQuickBuild({ state: shell.state, source, spells, equipment }, { rng: () => 0.42 });
  if ( !filled?.ok ) return r.failures.push("quick build did not fill");
  const name = `${PREFIX}Spellbook creation ${rules}`;
  shell.state.details.name = name;
  shell.state.targetLevel = 1;
  // Start the book from nothing, as a player would.
  shell.state.selectedSpells = [];
  if ( !shell.gotoStep("spells") ) return r.failures.push("could not reach the Spells step");
  await waitForStage(shell);

  const tabs = tabsOf(shell);
  const order = tabs.map(t => t.tab).join(",");
  if ( order !== "cantrips,level1,prepare" ) r.failures.push(`tabs are [${order}], expected Cantrips, Spellbook, Prepare`);
  if ( !tabs.find(t => t.tab === "level1")?.text.includes(L("step.spells.spellbookTab")) ) {
    r.failures.push("the leveled tab isn't called Spellbook");
  }
  const { maxPrepared, maxSpells } = await (async () => {
    const { spellLimits } = await import(`${MODULE}/steps/spells-step.mjs`);
    return spellLimits(shell.state);
  })();
  if ( maxSpells !== 6 ) r.failures.push(`the book holds ${maxSpells} at 1st level, expected 6`);

  await clickTab(shell, "level1");
  await checkFooterCompare(shell, r);
  const picks = rowsOf(shell).filter(x => !x.granted && !x.selected).slice(0, 6);
  for ( const row of picks ) {
    const want = shell.state.selectedSpells.length + 1;
    const res = await focusAndPress(shell, row.uuid, "pick-spell", () => shell.state.selectedSpells.length === want);
    if ( !res.ok ) { r.failures.push(`picking ${row.name}: ${res.why ?? "nothing happened"}`); break; }
  }
  const flags = rowsOf(shell).filter(x => x.selected).map(x => x.flag);
  const preparedFlags = flags.filter(f => f === L("step.spells.flagPrepared")).length;
  const bookFlags = flags.filter(f => f === L("step.spells.flagBook")).length;
  if ( (preparedFlags !== maxPrepared) || (bookFlags !== (6 - maxPrepared)) ) {
    r.failures.push(`badges read ${preparedFlags} Prepared and ${bookFlags} In book, expected ${maxPrepared} and ${6 - maxPrepared}`);
  }

  // The Prepare tab: a fifth prepare is refused; swapping one works; the hint tracks it.
  await clickTab(shell, "prepare");
  const prepRows = rowsOf(shell).filter(x => !x.granted);
  if ( prepRows.length !== 6 ) r.failures.push(`the Prepare tab lists ${prepRows.length} spells, expected the 6 in the book`);
  const unprepared = prepRows.find(x => !x.selected);
  const prepared = prepRows.find(x => x.selected);
  if ( unprepared && prepared ) {
    const refused = await focusAndPress(shell, unprepared.uuid, "toggle-prepared", () => false);
    if ( !refused.disabled ) r.failures.push("a fifth prepare wasn't refused (its button isn't disabled)");
    const off = await focusAndPress(shell, prepared.uuid, "toggle-prepared",
      () => shell.state.selectedSpells.find(s => s.uuid === prepared.uuid)?.prepared === false);
    if ( !off.ok ) r.failures.push("unpreparing a spell on the Prepare tab didn't take");
    const hint = spellsStep.incompleteHint(shell.state) ?? "";
    if ( !hint.includes("1") ) r.failures.push(`with a prepared slot empty the hint reads "${hint}"`);
    const on = await focusAndPress(shell, unprepared.uuid, "toggle-prepared",
      () => shell.state.selectedSpells.find(s => s.uuid === unprepared.uuid)?.prepared === true);
    if ( !on.ok ) r.failures.push("preparing another spell after freeing a slot didn't take");
  }
  const leaked = rawKeys(shell.element);
  if ( leaked.length ) r.failures.push(`raw translation keys on the Spells step: ${leaked.join(", ")}`);
  if ( !spellsStep.isComplete(shell.state) ) r.failures.push(`the step isn't complete: ${spellsStep.incompleteHint(shell.state)}`);

  // A draft saved now and restored into a fresh build keeps every pick's prepared choice.
  await saveDraft(shell.state);
  const draft = readDraft();
  if ( !draft ) r.failures.push("no draft was saved");
  else {
    const restored = new CreatorState(null);
    applyDraft(restored, draft.data);
    const want = shell.state.selectedSpells.map(s => `${s.uuid}:${s.prepared !== false}`).sort().join("|");
    const got = restored.selectedSpells.map(s => `${s.uuid}:${s.prepared !== false}`).sort().join("|");
    if ( want !== got ) r.failures.push("a restored draft lost which spells are prepared");
  }
  await clearDraft();

  // Build it, and read the sheet.
  const wantPrepared = new Set(shell.state.selectedSpells.filter(s => s.prepared !== false).map(s => s.name));
  if ( !shell.gotoStep("review") ) return r.failures.push("could not reach Review");
  await waitForStage(shell);
  const reviewText = shell.element.textContent;
  if ( !reviewText.includes(L("step.spells.groupBookOnly")) ) r.failures.push("Review doesn't list the book-only spells under their own heading");
  const before = new Set(game.actors.map(a => a.id));
  await shell._finish(null);
  await pause(2500);
  await closeAll();
  const actor = game.actors.find(a => !before.has(a.id) && (a.name === name));
  if ( !actor ) return r.failures.push("the build produced no actor");
  r.made.push(actor.id);
  const counts = bookCounts(actor);
  if ( counts.held !== 6 ) r.failures.push(`the sheet's book holds ${counts.held}, expected 6`);
  if ( counts.ledger !== 6 ) r.failures.push(`the Wizard's class records ${counts.ledger} free picks, expected 6`);
  if ( counts.prepared !== maxPrepared ) r.failures.push(`the sheet has ${counts.prepared} prepared, expected ${maxPrepared}`);
  const onSheet = new Set(actor.itemTypes.spell.filter(s => (s.system.level > 0) && (s.system.prepared === 1)).map(s => s.name));
  if ( [...wantPrepared].some(n => !onSheet.has(n)) ) r.failures.push("the sheet's prepared spells aren't the ones chosen on the Prepare tab");
  for ( const m of await sheetMismatches(actor) ) r.failures.push(`character sheet: ${m}`);
  r.notes.push(`${rules}: book ${counts.held}/6, prepared ${counts.prepared}/${maxPrepared}, class ledger ${counts.ledger},`
    + ` unprepared ${counts.unprepared.join(", ")}`);
}

/** 2. An origin that grants spells shows them as locked, badged, named cards. */
async function creationGranted(r) {
  const { source } = getSources();
  // Find any origin in the world that grants a spell at 1st level, 2024 then 2014.
  let found = null;
  for ( const rules of ["2024", "2014"] ) {
    for ( const kind of ["species", "backgrounds"] ) {
      for ( const card of source[kind]({ rules }) ) {
        const doc = await fromUuid(card.uuid).catch(() => null);
        const grants = doc ? await grantedSpellCards(doc) : [];
        if ( grants.length ) { found = { rules, kind, card, grants }; break; }
      }
      if ( found ) break;
    }
    if ( found ) break;
  }
  if ( !found ) { r.notes.push("skipped: no origin in this world grants a spell at 1st level"); return; }

  const cls = classFor("wizard", found.rules);
  await closeAll();
  const shell = new CreatorShell(null, launchWindowOptions());
  shell.state.classUuid = cls.uuid;
  await shell.render(true);
  await waitForStage(shell);
  const { spells, equipment } = getSources();
  const pin = found.kind === "species" ? { speciesUuid: found.card.uuid } : { backgroundUuid: found.card.uuid };
  const filled = await applyQuickBuild({ state: shell.state, source, spells, equipment }, { rng: () => 0.42, ...pin });
  if ( !filled?.ok ) return r.failures.push("quick build did not fill");
  const cards = await originGrantedSpellCards(shell.state);
  if ( !shell.gotoStep("spells") ) return r.failures.push("could not reach the Spells step");
  await waitForStage(shell);

  for ( const [tab, wantLeveled] of [["cantrips", false], ["level1", true]] ) {
    const expected = cards.filter(c => (c.level > 0) === wantLeveled);
    if ( !expected.length ) continue;
    await clickTab(shell, tab);
    const rows = rowsOf(shell).filter(x => x.granted);
    for ( const card of expected ) {
      const row = rows.find(x => x.name === card.name);
      if ( !row ) {
        // A spell the build also picked keeps its ordinary row, so it can be un-picked.
        if ( !rowsOf(shell).some(x => (x.name === card.name) && x.selected) ) r.failures.push(`${card.name} isn't shown on the ${tab} tab`);
        continue;
      }
      if ( ![L("step.spells.flagAlways"), L("step.spells.flagGranted")].includes(row.flag) ) {
        r.failures.push(`${card.name}'s badge reads "${row.flag}"`);
      }
      if ( card.grantedBy && !row.tip.includes(card.grantedBy) ) r.failures.push(`${card.name}'s tooltip doesn't name ${card.grantedBy}`);
    }
  }
  const leaked = rawKeys(shell.element);
  if ( leaked.length ) r.failures.push(`raw translation keys: ${leaked.join(", ")}`);
  r.notes.push(`${found.card.name} (${found.rules} ${found.kind}) grants ${found.grants.map(g => g.name).join(", ")}`);
  await closeAll();
}

/** 3. Level-up, Wizard 3 → 4, through the real window. */
async function levelUpWizard(r, rules) {
  const actor = await quickCharacter(`Spellbook level-up ${rules}`, classFor("wizard", rules), 3);
  r.made.push(actor.id);
  const shell = await openLevelUpOnSpells(actor);
  try {
    const order = tabsOf(shell).map(t => t.tab).join(",");
    if ( order !== "cantrips,book,prepare" ) r.failures.push(`tabs are [${order}], expected Cantrips, Spellbook, Prepare`);
    if ( !tabsOf(shell)[0]?.active ) r.failures.push("the step didn't open on its first tab");
    const plan = shell.state.spellPlan();

    // A cantrip, from the Cantrips tab.
    if ( plan.addCantrips > 0 ) {
      await clickTab(shell, "cantrips");
      const row = rowsOf(shell).find(x => !x.granted && !x.owned && !x.selected && !x.disabled);
      if ( row ) {
        const res = await focusAndPress(shell, row.uuid, "pick-spell", () => shell.state.selectedCantrips.length === 1);
        if ( !res.ok ) r.failures.push(`picking a cantrip: ${res.why ?? "nothing happened"}`);
      }
    }

    // The book: two new spells; the first fills the one prepared slot the level added.
    await clickTab(shell, "book");
    await checkFooterCompare(shell, r);
    if ( rowsOf(shell).some(x => x.owned) || shell.element.querySelector('[data-step-action="swap-spell"]') ) {
      r.failures.push("the Spellbook tab offers swap rows to a Wizard");
    }
    for ( const row of rowsOf(shell).filter(x => !x.granted && !x.selected && !x.disabled).slice(0, plan.addBook) ) {
      const want = shell.state.selectedSpells.length + 1;
      const res = await focusAndPress(shell, row.uuid, "pick-spell", () => shell.state.selectedSpells.length === want);
      if ( !res.ok ) { r.failures.push(`picking ${row.name}: ${res.why ?? "nothing happened"}`); break; }
    }
    const room = plan.spellTarget - plan.spellHave;
    const autoPrepared = shell.state.selectedSpells.filter(s => s.prepared !== false).length;
    if ( autoPrepared !== Math.min(room, plan.addBook) ) {
      r.failures.push(`${autoPrepared} new spell(s) auto-prepared, expected ${Math.min(room, plan.addBook)} (room ${room})`);
    }

    // Prepare tab: unprepare one owned spell, prepare an owned book-only one.
    await clickTab(shell, "prepare");
    const rows = rowsOf(shell);
    const ownPrepared = rows.find(x => x.selected && !x.granted && (x.flag === L("levelup.step.spells.flagPrepared")));
    const ownBook = rows.find(x => !x.selected && !x.granted && (x.flag === L("levelup.step.spells.flagBook")));
    let offName = null;
    let onName = null;
    if ( !ownPrepared || !ownBook ) r.failures.push("the Prepare tab has no owned prepared and book-only spells to swap");
    else {
      const off = await focusAndPress(shell, ownPrepared.uuid, "toggle-prepared",
        () => Object.values(shell.state.preparedChanges).includes(0));
      if ( !off.ok ) r.failures.push("unpreparing an owned spell didn't take");
      const on = await focusAndPress(shell, ownBook.uuid, "toggle-prepared",
        () => Object.values(shell.state.preparedChanges).includes(1));
      if ( !on.ok ) r.failures.push("preparing an owned book-only spell didn't take");
      offName = ownPrepared.name;
      onName = ownBook.name;
    }

    // Faded chips in the known-spells list: one per book-only spell.
    const faded = shell.element.querySelectorAll(".creator-spell-known .creator-spell-chip.is-unprepared").length;
    if ( !faded ) r.failures.push("no faded book-only chips in the known-spells list");
    await measureLook(shell, r);
    const leaked = rawKeys(shell.element);
    if ( leaked.length ) r.failures.push(`raw translation keys: ${leaked.join(", ")}`);

    // What Review and the chat card will say.
    const summary = captureLevelUpSummary(shell.state);
    if ( onName && !summary?.prepared?.nowPrepared?.includes(onName) ) r.failures.push(`the summary doesn't list ${onName} as now prepared`);
    if ( offName && !summary?.prepared?.noLongerPrepared?.includes(offName) ) r.failures.push(`the summary doesn't list ${offName} as no longer prepared`);
    const { source, equipment } = getSources();
    const review = await lvlReviewStep.context({ state: shell.state, driver: shell.state.driver, source, equipment });
    const titles = JSON.stringify(review);
    if ( onName && !titles.includes(L("levelup.step.review.nowPrepared")) ) r.failures.push("Review has no \"Now prepared\" row");

    if ( !(await applyLevelUp(shell, actor, r)) ) return r.failures.push("the level-up did not apply");
    const counts = bookCounts(actor);
    if ( counts.held !== counts.target ) r.failures.push(`book holds ${counts.held}, expected ${counts.target}`);
    if ( counts.prepared !== counts.max ) r.failures.push(`${counts.prepared} prepared, limit ${counts.max}`);
    if ( counts.ledger !== counts.target ) r.failures.push(`the class records ${counts.ledger} free picks after Apply, expected ${counts.target}`);
    const byName = n => actor.itemTypes.spell.find(s => s.name === n);
    if ( offName && (byName(offName)?.system.prepared !== 0) ) r.failures.push(`${offName} is still prepared after Apply`);
    if ( onName && (byName(onName)?.system.prepared !== 1) ) r.failures.push(`${onName} isn't prepared after Apply`);
    if ( offName && !byName(offName) ) r.failures.push(`${offName} left the book`);
    for ( const m of await sheetMismatches(actor) ) r.failures.push(`character sheet: ${m}`);
    const card = await levelUpCardText(actor);
    if ( card === null ) r.failures.push("no level-up chat card");
    else if ( onName && !card.includes(L("chat.levelup.nowPrepared")) ) r.failures.push("the chat card has no \"Now prepared\" line");
    r.notes.push(`${rules} Wizard 4: book ${counts.held}/${counts.target}, prepared ${counts.prepared}/${counts.max}, class ledger ${counts.ledger}`
      + (onName ? `; swapped ${offName} → ${onName}` : ""));
  } finally {
    await closeAll();
  }
}

/** 4a. A short book is offered the gap, with its note. */
async function legacyShortBook(r) {
  const actor = await quickCharacter("Spellbook legacy short", classFor("wizard", "2024"), 5);
  r.made.push(actor.id);
  // Take the book back to the eight spells an old build would have left: unprepared ones first.
  const cls = actor.items.find(i => i.type === "class");
  const counted = bookSpells(actor, cls).counted.sort((a, b) => a.system.prepared - b.system.prepared);
  await actor.deleteEmbeddedDocuments("Item", counted.slice(0, counted.length - 8).map(s => s.id));
  // A build from before the free-pick ledger has none on its class.
  await cls.unsetFlag(MODULE_ID, BOOK_FREE_FLAG);
  await pause(400);
  const shell = await openLevelUpOnSpells(actor);
  try {
    const plan = shell.state.spellPlan();
    const target = bookTarget(spellbookRule(cls), 6);
    if ( plan.addBook !== target - 8 ) r.failures.push(`offered ${plan.addBook} book spells, expected ${target - 8}`);
    await clickTab(shell, "book");
    const note = shell.element.querySelector(".levelup-spells-releasedhint .fa-book")?.parentElement?.textContent ?? "";
    if ( !note.includes(String(plan.bookCatchUp)) ) r.failures.push("no catch-up note naming the missing spells");
    for ( const row of rowsOf(shell).filter(x => !x.granted && !x.selected && !x.disabled).slice(0, plan.addBook) ) {
      await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
    }
    await shell.render();
    if ( !(await applyLevelUp(shell, actor, r)) ) return r.failures.push("the level-up did not apply");
    const counts = bookCounts(actor);
    if ( counts.held !== counts.target ) r.failures.push(`book holds ${counts.held} after catching up, expected ${counts.target}`);
    if ( counts.ledger !== counts.target ) r.failures.push(`a legacy class records ${counts.ledger} free picks after catching up, expected ${counts.target}`);
    if ( counts.prepared !== counts.max ) r.failures.push(`${counts.prepared} prepared, limit ${counts.max}`);
    r.notes.push(`8-spell level-5 book offered ${plan.addBook} (catch-up ${plan.bookCatchUp}); now ${counts.held}/${counts.target}, prepared ${counts.prepared}/${counts.max}`);
  } finally {
    await closeAll();
  }
}

/** 4c. Spells copied into the book in play don't reduce the free picks. */
async function copiedSpells(r) {
  const actor = await quickCharacter("Spellbook copied spells", classFor("wizard", "2024"), 3);
  r.made.push(actor.id);
  const cls = actor.items.find(i => i.type === "class");
  const ledger = cls.getFlag(MODULE_ID, BOOK_FREE_FLAG);
  if ( ledger !== 10 ) r.failures.push(`the class records ${ledger} free picks after a level-3 climb, expected 10`);
  // Copy five wizard spells onto the sheet the way a player does: a plain create, which dnd5e tags
  // with the Wizard class itself (SpellData#_preCreate).
  const { spells } = getSources();
  const pool = await spells.forClassAtLevel(cls._stats?.compendiumSource ?? cls.uuid, 2, "class", { doc: cls });
  const owned = new Set(actor.itemTypes.spell.map(s => s.name));
  const picks = [...(pool.byLevel?.[1] ?? []), ...(pool.byLevel?.[2] ?? [])].filter(s => !owned.has(s.name)).slice(0, 5);
  const docs = (await Promise.all(picks.map(p => fromUuid(p.uuid)))).filter(Boolean).map(d => d.toObject());
  await actor.createEmbeddedDocuments("Item", docs);
  await pause(400);
  const tagged = actor.itemTypes.spell.filter(s => picks.some(p => p.name === s.name) && (s.system.sourceItem === "class:wizard")).length;
  const shell = await openLevelUpOnSpells(actor);
  try {
    const plan = shell.state.spellPlan();
    if ( plan.addBook !== 2 ) r.failures.push(`offered ${plan.addBook} book spells after copying ${docs.length}, expected 2`);
    r.notes.push(`copied ${docs.length} spells (${tagged} tagged to the Wizard by dnd5e); level-up still offers ${plan.addBook}`);
  } finally {
    await closeAll();
  }
}

/** 4b. A 2014 Wizard over its prepared limit is warned, and can still apply. */
async function legacyOverPrepared(r) {
  const actor = await quickCharacter("Spellbook legacy over", classFor("wizard", "2014"), 1);
  r.made.push(actor.id);
  const cls = actor.items.find(i => i.type === "class");
  // The old build: every book spell prepared.
  const updates = bookSpells(actor, cls).all.map(s => ({ _id: s.id, "system.prepared": 1 }));
  await actor.updateEmbeddedDocuments("Item", updates);
  await pause(400);
  const shell = await openLevelUpOnSpells(actor);
  try {
    const plan = shell.state.spellPlan();
    if ( !(plan.overPrepared > 0) ) r.failures.push(`not seen as over its limit (${plan.spellHave} prepared, limit ${plan.spellTarget})`);
    await clickTab(shell, "prepare");
    const warning = shell.element.querySelector(".levelup-spells-overprepared")?.textContent ?? "";
    if ( !warning.trim() ) r.failures.push("no over-limit warning on the Prepare tab");
    if ( rowsOf(shell).some(x => !x.selected && !x.granted && !x.disabled) ) r.failures.push("book-only spells can still be ticked while over the limit");
    if ( !(await applyLevelUp(shell, actor, r)) ) return r.failures.push("Apply was blocked while over the limit");
    r.notes.push(`${plan.spellHave} prepared against a limit of ${plan.spellTarget}: warned, applied`);
  } finally {
    await closeAll();
  }
}

/**
 * 6. A Wizard built through Ember's builder. The manager Ember hands over is staged exactly as Ember
 * builds it (see in-world/ember.mjs) and rendered, so the module's takeover claims it into the real
 * hand-off window. Its Spells step fills the book; Apply writes through Ember's path, where the
 * spells and the class's free-pick ledger are staged onto the clone and land with its one write.
 * Needs the `playwright-ember` world; skipped elsewhere.
 */
async function emberWizard(r) {
  if ( !game.modules.get("ember")?.active ) {
    r.notes.push("skipped: Ember isn't active in this world (run with playwright-ember)");
    return;
  }
  const cls = classFor("wizard", "2024");
  if ( !cls ) return r.failures.push("no 2024 Wizard in the world");
  const { actor, manager } = await stageEmberManager({
    name: `${PREFIX}Spellbook Ember Wizard`,
    ember: {
      ancestryUuid: "Compendium.ember.character.Item.emberAncHuman000",
      cultureUuid: "Compendium.ember.character.Item.emberBkgStrider0",
      pathUuid: "Compendium.ember.character.Item.monsterHunter000"
    },
    classUuid: cls.uuid,
    abilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }
  });
  r.made.push(actor.id);
  if ( !isEmberCreationManager(manager) ) return r.failures.push("the staged manager isn't recognised as Ember's hand-off");

  const shell = await openLevelUpOnSpells(actor, () => manager.render(true));
  try {
    if ( !shell.state.emberCreation ) r.failures.push("the window that opened isn't the Ember hand-off");
    const plan = shell.state.spellPlan();
    if ( plan.addBook !== 6 ) r.failures.push(`the hand-off offers ${plan.addBook} book spells, expected 6`);
    const order = tabsOf(shell).map(t => t.tab).join(",");
    if ( order !== "cantrips,book,prepare" ) r.failures.push(`tabs are [${order}], expected Cantrips, Spellbook, Prepare`);

    // Cantrips and the six book spells, through the step's own actions.
    for ( const [tab, count] of [["cantrips", plan.addCantrips], ["book", plan.addBook]] ) {
      await clickTab(shell, tab);
      for ( const row of rowsOf(shell).filter(x => !x.granted && !x.owned && !x.selected && !x.disabled).slice(0, count) ) {
        await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
      }
    }
    await shell.render();
    const preparedPicks = shell.state.selectedSpells.filter(s => s.prepared !== false).length;
    if ( preparedPicks !== plan.spellTarget ) r.failures.push(`${preparedPicks} picks auto-prepared, expected ${plan.spellTarget}`);
    const leaked = rawKeys(shell.element);
    if ( leaked.length ) r.failures.push(`raw translation keys: ${leaked.join(", ")}`);

    if ( !(await applyLevelUp(shell, actor, r)) ) return r.failures.push("the Ember hand-off did not apply");
    const counts = bookCounts(actor);
    if ( !counts ) return r.failures.push("no Wizard class on the finished character");
    if ( counts.held !== 6 ) r.failures.push(`the book holds ${counts.held}, expected 6`);
    if ( counts.prepared !== counts.max ) r.failures.push(`${counts.prepared} prepared, limit ${counts.max}`);
    if ( counts.ledger !== 6 ) r.failures.push(`the Wizard's class records ${counts.ledger} free picks, expected 6`);
    r.notes.push(`Ember Wizard 1: book ${counts.held}/6, prepared ${counts.prepared}/${counts.max}, class ledger ${counts.ledger},`
      + ` unprepared ${counts.unprepared.join(", ")}`);
  } finally {
    await closeAll();
  }
}

/**
 * 7. A Savant subclass at 3rd level writes spells into the book for free. They must be on the
 * Prepare tab, in the book afterwards, and cost none of the level's two free picks.
 *
 * The Arcana Unleashed Conjurer carries its Savant as a spell `ItemChoice` (see the savant-spell-
 * choice fix). The 2024 PHB Evoker's Savant is text only in the data: it grants nothing a module can
 * see, so there is nothing of it to test.
 */
async function evokerSavant(r) {
  const actor = await quickCharacter("Spellbook savant", classFor("wizard", "2024"), 2);
  r.made.push(actor.id);
  const shell = await openLevelUpOnSpells(actor, undefined, { subclass: /conjur/i, log: n => r.notes.push(n) });
  try {
    const sub = shell.state.driver.clone.items.find(i => i.type === "subclass");
    if ( !/conjur/i.test(sub?.name ?? "") ) {
      r.notes.push(`skipped: no Savant subclass in this world (took ${sub?.name ?? "none"})`);
      return;
    }
    const plan = shell.state.spellPlan();
    if ( plan.addBook !== 2 ) r.failures.push(`the level offers ${plan.addBook} free book spells, expected 2 (Savant's are extra)`);
    // The spells Savant granted on the clone, and whether the Prepare tab lists them.
    const cls = shell.state.driver.clone.items.find(i => i.type === "class");
    const granted = bookSpells(shell.state.driver.clone, cls).all.filter(s => s.flags?.dnd5e?.advancementOrigin).map(s => s.name);
    if ( !granted.length ) r.failures.push("Savant granted no spells into the book");
    await clickTab(shell, "prepare");
    const onTab = new Set(rowsOf(shell).map(x => x.name));
    const missing = granted.filter(n => !onTab.has(n));
    if ( missing.length ) r.failures.push(`Savant spells missing from the Prepare tab: ${missing.join(", ")}`);
    // Take the level's two free picks, then apply.
    await clickTab(shell, "book");
    for ( const row of rowsOf(shell).filter(x => !x.granted && !x.selected && !x.disabled).slice(0, plan.addBook) ) {
      await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
    }
    if ( !(await applyLevelUp(shell, actor, r)) ) return;
    const counts = bookCounts(actor);
    const inBook = new Set(bookSpells(actor, actor.items.find(i => i.type === "class")).all.map(s => s.name));
    const lost = granted.filter(n => !inBook.has(n));
    if ( lost.length ) r.failures.push(`Savant spells not in the book after Apply: ${lost.join(", ")}`);
    if ( counts.held !== counts.target ) r.failures.push(`free picks in the book ${counts.held}, expected ${counts.target}`);
    if ( counts.ledger !== counts.target ) r.failures.push(`the class records ${counts.ledger} free picks, expected ${counts.target}`);
    r.notes.push(`Savant granted ${granted.join(", ")}; free book ${counts.held}/${counts.target}, ledger ${counts.ledger},`
      + ` prepared ${counts.prepared}/${counts.max}`);
  } finally {
    await closeAll();
  }
}

/**
 * 8. Levels 18 and 20: Spell Mastery and Signature Spells. Reports how the content hands them over
 * (a spell choice, always-prepared grants, or nothing the data can see), and fails only if the book
 * or the prepared limit comes out wrong around them.
 */
async function highLevelFeatures(r) {
  const actor = await quickCharacter("Spellbook high level", classFor("wizard", "2024"), 17);
  r.made.push(actor.id);
  const { source, spells } = getSources();
  for ( const target of [18, 20] ) {
    if ( actor.system.details.level < target - 1 ) {
      const climb = await quickClimb(actor, target - 1, source, spells);
      if ( climb.reached < target - 1 ) return r.failures.push(`the climb stopped at ${climb.reached}`);
      await pause(300);
    }
    const alwaysBefore = new Set(actor.itemTypes.spell.filter(s => s.system.prepared === 2).map(s => s.name));
    const featuresBefore = new Set(actor.items.filter(i => i.type === "feat").map(i => i.name));
    const shell = await openLevelUpOnSpells(actor, undefined, { log: n => r.notes.push(`level ${target}: ${n}`) });
    try {
      await clickTab(shell, "prepare");
      const locked = rowsOf(shell).filter(x => x.flag === L("levelup.step.spells.flagAlways")).map(x => x.name);
      if ( shell.state.spellPlan().addBook ) await clickTab(shell, "book");
      for ( const row of rowsOf(shell).filter(x => !x.granted && !x.selected && !x.disabled).slice(0, shell.state.spellPlan().addBook) ) {
        await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
      }
      if ( !(await applyLevelUp(shell, actor, r)) ) return;
      const newFeatures = actor.items.filter(i => (i.type === "feat") && !featuresBefore.has(i.name)).map(i => i.name);
      const newAlways = actor.itemTypes.spell.filter(s => (s.system.prepared === 2) && !alwaysBefore.has(s.name)).map(s => s.name);
      const counts = bookCounts(actor);
      if ( counts.held !== counts.target ) r.failures.push(`level ${target}: free book ${counts.held}, expected ${counts.target}`);
      if ( counts.prepared !== counts.max ) r.failures.push(`level ${target}: ${counts.prepared} prepared, limit ${counts.max}`);
      if ( counts.ledger !== counts.target ) r.failures.push(`level ${target}: the class records ${counts.ledger}, expected ${counts.target}`);
      r.notes.push(`level ${target}: new features [${newFeatures.join(", ") || "none"}];`
        + ` new always-prepared spells [${newAlways.join(", ") || "none"}];`
        + ` locked on the Prepare tab [${locked.join(", ") || "none"}]; book ${counts.held}/${counts.target}, prepared ${counts.prepared}/${counts.max}`);
    } finally {
      await closeAll();
    }
  }
}

/**
 * 9. A Fighter who multiclasses into Wizard: the book is sized to Wizard level 1, its spells are held
 * to 1st level whatever the Fighter's slots, and the Wizard's class records its six free picks.
 */
async function multiclassWizard(r) {
  const actor = await quickCharacter("Spellbook multiclass", classFor("fighter", "2024"), 3);
  r.made.push(actor.id);
  // A Wizard needs Intelligence 13 to multiclass into.
  await actor.update({ "system.abilities.int.value": 16 });
  const before = game.settings.get(MODULE_ID, SETTINGS.multiclass);
  // "prereq": multiclassing on, with the rules' ability requirements enforced.
  await game.settings.set(MODULE_ID, SETTINGS.multiclass, "prereq");
  try {
    const wizard = classFor("wizard", "2024");
    const shell = await openLevelUpOnSpells(actor, undefined, { classPick: { kind: "new", uuid: wizard.uuid } });
    try {
      const plan = shell.state.spellPlan();
      if ( plan.listId !== "wizard" ) return r.failures.push(`the level-up is levelling ${plan.listId || "no caster"}, not the Wizard`);
      if ( plan.addBook !== 6 ) r.failures.push(`a new Wizard is offered ${plan.addBook} book spells, expected 6`);
      if ( plan.maxSpellLevel !== 1 ) r.failures.push(`a Wizard 1 may learn up to level ${plan.maxSpellLevel}, expected 1`);
      await clickTab(shell, "book");
      const rows = rowsOf(shell).filter(x => !x.granted && !x.selected && !x.disabled);
      if ( rows.some(x => x.level > 1) ) r.failures.push("spells above 1st level are offered to a Wizard 1");
      for ( const row of rows.slice(0, plan.addBook) ) {
        await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
      }
      if ( !(await applyLevelUp(shell, actor, r)) ) return;
    } finally {
      await closeAll();
    }
    const wiz = actor.items.find(i => (i.type === "class") && (i.system.identifier === "wizard"));
    if ( !wiz ) return r.failures.push("no Wizard class after the multiclass level-up");
    const counts = bookCounts(actor);
    if ( counts.level !== 1 ) r.failures.push(`the Wizard is level ${counts.level}, expected 1`);
    if ( counts.held !== 6 ) r.failures.push(`the Wizard's book holds ${counts.held}, expected 6`);
    if ( counts.ledger !== 6 ) r.failures.push(`the Wizard's class records ${counts.ledger} free picks, expected 6`);
    r.notes.push(`Fighter 3 / Wizard 1: book ${counts.held}/6, prepared ${counts.prepared}/${counts.max}, ledger ${counts.ledger}`);
  } finally {
    await game.settings.set(MODULE_ID, SETTINGS.multiclass, before);
  }
}

/** 5. A Cleric marks several prepared spells and replaces them; its domain spells show as Always. */
async function clericSwaps(r) {
  const actor = await quickCharacter("Spellbook cleric swaps", classFor("cleric", "2024"), 3);
  r.made.push(actor.id);
  const shell = await openLevelUpOnSpells(actor);
  try {
    const plan = shell.state.spellPlan();
    if ( plan.spellSwaps !== "any" ) r.failures.push(`a Cleric may mark "${plan.spellSwaps}" spell(s), expected any number`);
    await clickTab(shell, "spells");

    // The always-prepared domain spells, as locked Always cards.
    const always = actor.itemTypes.spell.filter(s => (s.system.level > 0) && (s.system.prepared === 2)).map(s => s.name);
    const grantedRows = rowsOf(shell).filter(x => x.granted);
    for ( const n of always ) {
      const row = grantedRows.find(x => x.name === n);
      if ( !row ) r.failures.push(`the domain spell ${n} isn't shown`);
      else if ( row.flag !== L("levelup.step.spells.flagAlways") ) r.failures.push(`${n}'s badge reads "${row.flag}"`);
    }

    // Mark three owned spells through the real Swap Out button.
    const owned = rowsOf(shell).filter(x => x.owned).slice(0, 3);
    if ( owned.length < 3 ) return r.failures.push(`only ${owned.length} prepared spell(s) offered to swap`);
    for ( const row of owned ) {
      const want = shell.state.swapSpells.length + 1;
      const res = await focusAndPress(shell, row.uuid, "swap-spell", () => shell.state.swapSpells.length === want);
      if ( !res.ok ) { r.failures.push(`marking ${row.name}: ${res.why ?? "nothing happened"}`); break; }
    }
    const budget = plan.addSpells + shell.state.swapSpells.length;
    for ( const row of rowsOf(shell).filter(x => !x.owned && !x.granted && !x.selected && !x.disabled).slice(0, budget) ) {
      await shell._dispatch("pick-spell", { dataset: { uuid: row.uuid, level: String(row.level) } });
    }
    await shell.render();
    const marked = shell.state.swapSpells.map(m => m.name);
    const added = shell.state.selectedSpells.map(s => s.name);
    if ( added.length !== budget ) r.failures.push(`picked ${added.length}, expected ${budget}`);
    const leaked = rawKeys(shell.element);
    if ( leaked.length ) r.failures.push(`raw translation keys: ${leaked.join(", ")}`);
    if ( !(await applyLevelUp(shell, actor, r)) ) return r.failures.push("the level-up did not apply");
    const names = new Set(actor.itemTypes.spell.map(s => s.name));
    const stillThere = marked.filter(n => names.has(n) && !always.includes(n));
    if ( stillThere.length ) r.failures.push(`still on the sheet after being swapped out: ${stillThere.join(", ")}`);
    const missing = added.filter(n => !names.has(n));
    if ( missing.length ) r.failures.push(`replacements missing: ${missing.join(", ")}`);
    r.notes.push(`swapped out ${marked.join(", ")}; learned ${added.join(", ")}; ${always.length} domain spell(s) shown as Always`);
  } finally {
    await closeAll();
  }
}

/* -------------------------------------------- */

/**
 * Run every case. Characters are deleted at the end; the level-up chat-card setting is set to post
 * for the run and put back.
 */
export async function checkSpellbook({ only = null } = {}) {
  let cases = [
    ["Creation: 2024 Wizard's book and Prepare tab", r => creationBook(r, "2024")],
    ["Creation: 2014 Wizard's book and Prepare tab", r => creationBook(r, "2014")],
    ["Creation: granted spells as locked cards", r => creationGranted(r)],
    ["Level-up: 2024 Wizard 3 → 4", r => levelUpWizard(r, "2024")],
    ["Level-up: 2014 Wizard 3 → 4", r => levelUpWizard(r, "2014")],
    ["Level-up: a short book catches up", r => legacyShortBook(r)],
    ["Level-up: spells copied in play don't reduce the free picks", r => copiedSpells(r)],
    ["Level-up: a 2014 Wizard over its prepared limit", r => legacyOverPrepared(r)],
    ["Level-up: a Cleric replaces several prepared spells", r => clericSwaps(r)],
    ["Level-up: a Savant subclass's free book spells at level 3", r => evokerSavant(r)],
    ["Level-up: Spell Mastery and Signature Spells at levels 18 and 20", r => highLevelFeatures(r)],
    ["Level-up: a Fighter multiclassing into Wizard", r => multiclassWizard(r)],
    ["Ember: a Wizard built through Ember's hand-off", r => emberWizard(r)]
  ];
  if ( only ) cases = cases.filter(([label]) => label.toLowerCase().includes(only.toLowerCase()));
  const chatBefore = game.settings.get(MODULE_ID, SETTINGS.levelUpSummary);
  const hpBefore = game.settings.get(MODULE_ID, SETTINGS.levelUpHpMode);
  await game.settings.set(MODULE_ID, SETTINGS.levelUpSummary, "public");
  // Average hit points, a decision made in advance, so no level screen waits on a hit-point click.
  await game.settings.set(MODULE_ID, SETTINGS.levelUpHpMode, "average");
  const results = [];
  const made = [];
  try {
    for ( const [label, fn] of cases ) {
      const r = { label, failures: [], notes: [], made };
      try {
        await fn(r);
      } catch ( err ) {
        r.failures.push(`threw: ${err.message}`);
        console.error(err);
        await closeAll();
      }
      results.push({ label, ok: !r.failures.length, failures: r.failures, notes: r.notes });
    }
  } finally {
    await game.settings.set(MODULE_ID, SETTINGS.levelUpSummary, chatBefore);
    await game.settings.set(MODULE_ID, SETTINGS.levelUpHpMode, hpBefore);
    const ids = made.filter(id => game.actors.get(id));
    if ( ids.length ) await Actor.implementation.deleteDocuments(ids, { render: false }).catch(() => {});
    await closeAll();
  }
  const failures = results.flatMap(c => c.failures.map(f => `${c.label}: ${f}`));
  return { ok: !failures.length, failures, cases: results };
}
