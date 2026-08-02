/**
 * The reference build: a character produced by the dnd5e system's own AdvancementManager.
 *
 * This is the oracle the creator is measured against, so it deliberately goes the long way round.
 * `AdvancementManager` keeps its whole pipeline private (`#forward`, `#synthesizeSteps`,
 * `#complete`) and reachable only from a click on a `[data-action]` button, and its per-step
 * flows apply themselves from their *rendered form* (`advancement-manager.mjs` line 691:
 * `flow._updateObject(event, flow._getSubmitData())`). Short-circuiting that by calling
 * `advancement.apply()` ourselves would mean re-implementing the very walk we are trying to
 * verify â€” a bug in step ordering or mid-walk synthesis would then be invisible to the test.
 *
 * So: render the manager for real, fill each step's actual form controls, and click Next. The
 * only per-advancement knowledge here is *which control holds which answer*, one small filler
 * per advancement type. Everything else is the system's.
 *
 * The module under test intercepts `dnd5e.preAdvancementManagerRender` and suppresses the native
 * UI for any level-up it can drive. `manager._sogromLevelUp` is the module's own re-entry guard
 * (see `levelup/intercept.mjs`), and setting it up front makes the hook stand down â€” so the
 * reference build runs the native wizard even with the module active.
 */

/* -------------------------------------------- */
/*  Small async helpers                          */
/* -------------------------------------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Poll a predicate until it holds.
 * @param {() => boolean} test
 * @param {string} what           Described in the timeout error.
 * @param {number} [timeout]
 */
async function until(test, what, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while ( Date.now() < deadline ) {
    if ( test() ) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * The live root element of an ApplicationV2 flow, once it has painted. Waits on `form` rather
 * than `element` because that is what the flow's own submit path reads (see `driveManager`).
 */
async function flowElement(flow) {
  await until(() => !!flow?.form, `flow ${flow?.advancement?.type} to render`);
  return flow.form;
}

/**
 * Poll until a lookup yields something, then return it.
 *
 * The flows paint their frame before their *content* is ready â€” an ItemChoice's pool and a
 * Trait's option list are both resolved from compendia asynchronously â€” so a control that is
 * merely late is indistinguishable from one that will never appear unless we wait for it.
 * @param {() => *} find      Returns the thing, or a falsy value while it is not there yet.
 * @param {() => string} describe   Builds the error message if it never appears.
 * @param {number} [timeout]
 */
async function untilFound(find, describe, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  for ( ;; ) {
    const found = find();
    if ( found ) return found;
    if ( Date.now() > deadline ) throw new Error(describe());
    await sleep(100);
  }
}

/**
 * Change a form control the way a user would, and give the flow's `submitOnChange` handler time
 * to apply and re-render. All the advancement flows we drive extend `AdvancementFlowV2`, whose
 * form options set `submitOnChange: true`, so a dispatched change event *is* the interaction.
 */
async function change(element) {
  element.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(150);
}

/* -------------------------------------------- */
/*  Per-advancement form fillers                 */
/* -------------------------------------------- */

/**
 * Fill the currently-rendered flow from the answer book.
 *
 * Advancements with nothing to answer (ItemGrant without an ability choice, ScaleValue, a
 * single-option Size) are handled by the system automatically and never reach here. Everything that
 * does reach here is *asked about*, answered or not, so the book's ledger is a complete record of
 * what this side of the build was offered â€” which is what makes it comparable with the creator's.
 * @param {object} step               The manager step being displayed.
 * @param {AnswerBook} book           The scenario's answers.
 * @param {Set<string>} [consumed]    Collects the ids an answer was read for.
 */
async function fillStep(step, book, consumed) {
  const flow = step.flow;
  const adv = flow?.advancement;
  if ( !adv ) return;

  // What this screen is actually showing. Some pools cannot be derived from the configuration —
  // an expertise Trait offers "skills you are already proficient in", and an ItemChoice hides the
  // options whose prerequisites the build fails — so the book takes the rendered list from whichever
  // side asks first and hands the same picks to the other.
  const offered = () => {
    const form = flow.form;
    if ( !form ) return [];
    if ( adv.type === "Trait" ) {
      return [...(form.querySelector("[name=added]")?.options ?? [])].map(o => o.value).filter(Boolean);
    }
    if ( adv.type === "ItemChoice" ) {
      // A restriction-driven pool renders a browse button instead of checkboxes and comes back
      // empty here, which is what sends the book to the compendium scan instead.
      return [...form.querySelectorAll("[name]")]
        .filter(el => (el.type === "checkbox" || el.tagName === "DND5E-CHECKBOX") && !el.disabled)
        .map(el => el.name).filter(Boolean);
    }
    return [];
  };
  const answer = await book.answer(adv, flow.level, { asker: "native", offered });
  if ( answer !== undefined ) consumed?.add(adv.id);

  switch ( adv.type ) {
    case "HitPoints": return fillHitPoints(flow, answer);
    case "Size": return fillSize(flow, answer);
    case "Trait": return fillTrait(flow, adv, answer);
    case "ItemChoice": return fillItemChoice(flow, adv, answer);
    case "ItemGrant": return fillGrantAbility(flow, answer);
    case "AbilityScoreImprovement": return fillAsi(flow, answer);
    case "Subclass": return fillSubclass(flow, adv, answer);
    default:
      // Nothing to answer, or a type this harness does not drive yet. Leave it as rendered and
      // let the manager apply whatever the flow defaults to.
      return;
  }
}

/**
 * Hit points. `"avg"` ticks Take Average; a number switches to manual entry and types it.
 * The original class's first level takes maximum automatically and renders no control at all.
 */
async function fillHitPoints(flow, answer) {
  const root = await flowElement(flow);
  const average = root.querySelector("[name=useAverage]");
  if ( !average ) return;                                   // first class level â€” nothing to choose

  if ( (answer ?? "avg") === "avg" ) {
    if ( !average.checked ) { average.checked = true; await change(average); }
    return;
  }
  if ( average.checked ) { average.checked = false; await change(average); }

  const manual = (await flowElement(flow)).querySelector("input[name=value]");
  if ( manual && Number.isFinite(Number(answer)) ) {
    manual.value = String(answer);
    await change(manual);
  }
}

/** Size: a single `<select name="size">`. */
async function fillSize(flow, answer) {
  if ( !answer ) return;
  const select = (await flowElement(flow)).querySelector("[name=size]");
  if ( !select ) return;
  select.value = Array.isArray(answer) ? answer[0] : answer;
  await change(select);
}

/**
 * Trait picks. The native flow takes them **one at a time**: choosing a key from the `added`
 * select applies it and re-renders with the select cleared and a new filled slot. So this loops,
 * re-reading the select each pass, until the advancement's own `value.chosen` holds every
 * requested key (or the pool stops offering them).
 */
async function fillTrait(flow, adv, answer) {
  const wanted = [...(answer ?? [])];
  if ( !wanted.length ) return;

  for ( const key of wanted ) {
    if ( adv.value.chosen?.has?.(key) ) continue;
    const root = await flowElement(flow);
    if ( !root.querySelector("[name=added]") ) break;        // pool exhausted / quota already full
    const select = await untilFound(
      () => {
        const el = flow.form?.querySelector("[name=added]");
        return [...(el?.options ?? [])].some(o => o.value === key) ? el : null;
      },
      () => {
        const el = flow.form?.querySelector("[name=added]");
        return `trait key "${key}" is not offered by "${adv.title}" `
          + `(offered: ${[...(el?.options ?? [])].map(o => o.value).filter(Boolean).join(", ") || "nothing"})`;
      }
    );
    select.value = key;
    await change(select);
    await until(() => adv.value.chosen?.has?.(key), `trait "${key}" to apply`);
  }
}

/**
 * Feature/spell choices: one `dnd5e-checkbox` per pool entry, named for the entry's uuid.
 * An `ability` select is present when the choice grants spells with a choosable casting ability.
 */
async function fillItemChoice(flow, adv, answer) {
  const uuids = Array.isArray(answer) ? answer : (answer?.uuids ?? []);
  const ability = answer?.ability ?? null;

  for ( const uuid of uuids ) {
    const root = await flowElement(flow);

    // A configured pool renders a checkbox per entry. A restriction-driven pool (Magic Initiate's
    // "any wizard cantrip") has no entries at all â€” the flow offers a browse button instead â€” so
    // fall back to that route when there is no checkbox to tick.
    const box = root.querySelector(`[name="${CSS.escape(uuid)}"]`);
    if ( box ) {
      if ( !box.checked ) { box.checked = true; await change(box); }
      continue;
    }
    if ( root.querySelector("[data-action=browse]") ) {
      await selectViaBrowser(flow, adv, uuid);
      continue;
    }

    // Neither route available: wait a beat in case the pool is merely late, then report.
    await untilFound(
      () => flow.form?.querySelector(`[name="${CSS.escape(uuid)}"]`)
        ?? flow.form?.querySelector("[data-action=browse]"),
      () => {
        const offered = [...(flow.form?.querySelectorAll("li.item[data-uuid]") ?? [])].map(li => li.dataset.uuid);
        return `choice "${adv.title}" does not offer ${uuid} `
          + `(offered: ${offered.join(", ") || "nothing, and no browse button"})`;
      }
    );
    await fillItemChoice(flow, adv, { uuids: [uuid] });
  }

  // Set the casting ability last. Each change here re-applies the advancement and re-renders the
  // flow; doing it after the picks keeps one fewer re-render in flight while the browser modal is
  // being driven, which is where the manager was observed tearing its own step down mid-render.
  if ( ability ) {
    const select = (await flowElement(flow)).querySelector("[name=ability]");
    if ( select && (select.value !== ability) ) { select.value = ability; await change(select); }
  }
}

/**
 * Pick one item for a choice through the flow's compendium browser.
 *
 * A restriction-driven pool is populated by the browser, not by the template, so this is the only
 * route to it. As with the ASI feat picker, `selectOne` is stubbed for a single call and the
 * flow's own handler runs for real around it â€” the stub replaces the user's click inside the
 * modal. Note this bypasses the browser's *filters*, so a scenario can pick something the
 * restriction would have excluded; the restriction itself is therefore not under test here.
 */
async function selectViaBrowser(flow, adv, uuid) {
  await withBrowserPick(uuid, async () => {
    // Each accepted pick re-applies the advancement and re-renders both the flow and the manager
    // around it. Clicking browse into a render that is still in flight has been seen to leave the
    // manager's `_onRender` dereferencing a torn-down flow element, so settle first.
    await flowElement(flow);
    await sleep(400);
    const button = (await flowElement(flow)).querySelector("[data-action=browse]");
    if ( !button ) throw new Error(`"${adv.title}" has no browse button to pick ${uuid} with`);
    button.click();
    await untilFound(
      () => Object.values(adv.value.added?.[flow.level] ?? {}).includes(uuid),
      () => `"${adv.title}" did not accept ${uuid} from the browser`,
      10_000
    );
  });
  await sleep(400);
}

/**
 * Run `fn` with the compendium browser's pickers stubbed to return `uuid`, restoring them
 * afterwards whatever happens. Shared by the ASI feat picker and restriction-driven item choices,
 * which are the two places the native flows can only be answered through the browser modal.
 *
 * Both entry points are stubbed because the flows do not agree on which to use: the ASI screen
 * calls `selectOne` (returning a uuid), while `ItemChoiceFlow` calls `select` (returning a Set,
 * since it may take several picks at once). Stubbing only one leaves the other opening a real
 * modal that nothing ever answers.
 */
async function withBrowserPick(uuid, fn) {
  const browser = dnd5e.applications?.CompendiumBrowser;
  if ( !browser ) throw new Error("CompendiumBrowser is unavailable");
  const originals = { selectOne: browser.selectOne, select: browser.select };
  browser.selectOne = async () => uuid;
  browser.select = async () => new Set([uuid]);
  try {
    return await fn();
  } finally {
    Object.assign(browser, originals);
  }
}

/**
 * Subclass. The flow has no form fields at all â€” selection happens either through the compendium
 * browser modal or by dropping a subclass onto it, and `_handleForm` is empty. Dropping is the
 * cheaper of the two to drive faithfully: the flow binds a `DragDrop` with `dropSelector: "form"`,
 * so a real `drop` event carrying the usual `{type: "Item", uuid}` payload lands in `_onDrop`,
 * which does its own type validation and applies the advancement. Driving the browser modal
 * instead would be a pile of fragile UI work for no extra fidelity.
 */
async function fillSubclass(flow, adv, answer) {
  const uuid = Array.isArray(answer) ? answer[0] : (typeof answer === "string" ? answer : answer?.uuid);
  if ( !uuid ) return;
  if ( adv.value?.uuid === uuid ) return;

  const form = await flowElement(flow);
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  form.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));

  await untilFound(
    () => adv.value?.uuid === uuid,
    () => `subclass ${uuid} was not accepted by "${adv.title}" `
      + `(the flow still holds ${adv.value?.uuid ?? "nothing"}) â€” is the uuid a subclass of this class?`,
    10_000
  );
  // `_onDrop` re-renders after applying; let that settle before the step is advanced.
  await sleep(300);
}

/** An ItemGrant that lets the player choose the casting ability of a granted spell. */
async function fillGrantAbility(flow, answer) {
  const ability = (typeof answer === "string") ? answer : answer?.ability;
  if ( !ability ) return;
  const select = (await flowElement(flow)).querySelector("[name=ability]");
  if ( select ) { select.value = ability; await change(select); }
}

/**
 * Ability score improvement. The inputs are named `abilities.<key>` and hold the *resulting
 * score*, with the pre-ASI score in `data-initial`; the flow derives the point assignment from
 * the difference. The scenario states the assignment (`{ int: 2, con: 1 }`), so each input is set
 * to `initial + assigned`.
 */
async function fillAsi(flow, answer) {
  if ( !answer ) return;
  if ( typeof answer.feat === "string" ) return takeAsiFeat(flow, answer.feat);

  // Under the 2024 rules a *class* ASI opens on a choice between points and a feat, and the ability
  // inputs are not rendered at all until the points side is picked — the flow's
  // `showImprovement = !modernRules || !allowFeat || isASI` (ability-score-improvement-flow.mjs).
  // Ticking `asi-selected` applies `{type: "asi"}` and re-renders with the inputs present. A
  // background increase offers no feat, so the checkbox is absent and this is skipped.
  const mode = (await flowElement(flow)).querySelector("[name=asi-selected]");
  if ( mode && !mode.checked ) {
    mode.checked = true;
    await change(mode);
    await untilFound(
      () => flow.form?.querySelector("input[name^='abilities.']"),
      () => `"${flow.advancement.title}" rendered no ability inputs after selecting the points mode`
    );
  }

  const root = await flowElement(flow);
  for ( const [key, points] of Object.entries(answer) ) {
    const input = root.querySelector(`input[name="abilities.${key}"]`);
    // Silence here is how a whole ASI went missing once: the inputs were behind the mode toggle
    // above, every lookup missed, and the build simply came out two points short.
    if ( !input ) {
      throw new Error(`"${flow.advancement.title}" offers no input for ${key} `
        + `(it shows: ${[...root.querySelectorAll("input[name^='abilities.']")].map(i => i.name).join(", ") || "none"})`);
    }
    const initial = Number(input.dataset.initial ?? input.value);
    const target = initial + Number(points);
    if ( Number(input.value) === target ) continue;
    input.value = String(target);
    await change(input);
  }
}

/**
 * Take a feat for an ASI decision instead of allocating points.
 *
 * The native flow's only route to a feat is `data-action="browse"`, which opens
 * `CompendiumBrowser.selectOne()` â€” a modal whose whole purpose is to return one uuid. Driving its
 * internals would be a large amount of fragile UI work to arrive at a value the scenario already
 * states, so the browser's `selectOne` is stubbed for exactly one call and the flow's own browse
 * handler runs for real around it: the click, the prerequisite check, the apply, the re-render.
 * The stub stands in for the user's click inside the modal, nothing more, and is always restored.
 */
async function takeAsiFeat(flow, uuid) {
  const adv = flow.advancement;
  if ( adv.value?.type === "feat" ) return;

  await withBrowserPick(uuid, async () => {
    const root = await flowElement(flow);
    const button = root.querySelector("[data-action=browse]");
    if ( !button ) {
      throw new Error(`the ASI screen for "${adv.title}" offers no feat browser `
        + "(does this advancement allow a feat?)");
    }
    button.click();
    await untilFound(
      () => adv.value?.type === "feat",
      () => `feat ${uuid} was not taken for "${adv.title}" â€” it may fail its own prerequisites `
        + "at this level, which the flow reports by declining silently",
      10_000
    );
  });
  await sleep(300);                                        // let the flow's re-render settle
}

/* -------------------------------------------- */
/*  Driving one manager                          */
/* -------------------------------------------- */

/**
 * Render a manager and walk it to completion, answering each step from the book.
 * @param {AdvancementManager} manager
 * @param {AnswerBook} book          The scenario's answers.
 * @param {Set<string>} [consumed]   Collects the ids an answer was read for.
 */
export async function driveManager(manager, book, consumed) {
  // Opt out of the module's takeover so the *native* wizard runs (see the file header).
  manager._sogromLevelUp = true;
  if ( !manager.steps.length ) return;

  await manager.render({ force: true });
  await until(() => !!manager.element, "the advancement manager to render");

  const trace = [];
  const describe = s => s
    ? `${s.flow?.advancement?.type ?? s.type}"${s.flow?.advancement?.title ?? ""}"@${manager.steps.indexOf(s)}`
    : "<none>";

  for ( let guard = 0; guard < 200; guard++ ) {
    const step = manager.step;
    if ( !step ) break;
    trace.push(describe(step));

    if ( step.flow ) await ensureFlowRendered(manager, step, trace, describe);

    await fillStep(step, book, consumed);

    const button = manager.element.querySelector("[data-action=next], [data-action=complete]");
    if ( !button ) throw new Error(`no next/complete button on step "${step.flow?.advancement?.title}"`);
    button.click();

    // The manager either moves to another step or closes itself via `#complete`.
    try {
      await until(() => (manager.step !== step) || !manager.rendered,
        `step "${step.flow?.advancement?.title ?? step.type}" to advance`);
    } catch ( err ) {
      throw new Error(`${err.message}\n${describeStuckStep(manager, step)}`);
    }
    if ( !manager.rendered ) break;
  }

  // `#complete` writes to the actor asynchronously after closing; wait for the window to go.
  await until(() => !manager.rendered, "the advancement manager to close");
  await sleep(300);
}

/**
 * Wait until the current step's flow has actually painted, nudging the manager if it hasn't.
 *
 * The manager paints its own frame and then swaps the step's flow into a `<template>` slot; but
 * `#forward` kicks that render off **without awaiting it**, and our own change events trigger
 * flow re-renders that can overlap it (ApplicationV2 drops a render that races another). The
 * result is a manager frame showing an empty placeholder forever. Clicking Next in that state
 * makes the flow submit with `this.form` undefined, which throws inside FormDataExtended and
 * strands the wizard â€” so the flow is nudged into existence here rather than clicked blind.
 */
async function ensureFlowRendered(manager, step, trace, describe) {
  const flow = step.flow;
  // Be patient before nudging. `AdvancementManager#render` pre-applies the step's advancement
  // (`apply(level, {}, {initial: true})`), so a nudge that overlaps the manager's own in-flight
  // render gives two `apply` calls that both read an empty `value.added` and both grant â€” which
  // shows up as duplicated items and looks like a creator bug. The first wait is therefore long
  // enough that the manager almost always wins on its own.
  for ( let attempt = 1; attempt <= 3; attempt++ ) {
    try {
      await until(() => !!flow.form, "flow form", attempt === 1 ? 12_000 : 8000);
      return;
    } catch {
      if ( manager.step !== step ) return;                 // it moved on by itself; nothing to do
      // Render the *flow*, not the manager. `AdvancementManager#render` re-runs
      // `advancement.apply(level, {}, {initial: true})` on the way through, so nudging it would
      // grant every ItemGrant a second time and invent differences. Rendering the flow and
      // slotting its element into the manager's placeholder is exactly what the manager's own
      // `_onRender` does, with none of the side effects.
      try {
        await flow.render({ force: true, error: step.error });
        const existing = document.getElementById(flow.element?.id);
        if ( existing && (existing !== flow.element) ) existing.replaceWith(flow.element);
      } catch { /* reported below if it never recovers */ }
    }
  }
  throw new Error(`the form of ${flow.advancement?.type} "${flow.advancement?.title}" never rendered\n`
    + `  trace        : ${trace.join(" -> ")}\n`
    + `  all steps    : ${manager.steps.map(describe).join(", ")}\n`
    + `  flow class   : ${flow.constructor.name}, rendered: ${flow.rendered}\n`
    + `  flow.element : ${flow.element ? `<${flow.element.tagName.toLowerCase()} id="${flow.element.id}">` : "null"}\n`
    + `  manager html : ${manager.element?.querySelector(".step")?.innerHTML?.slice(0, 300)}`);
}

/**
 * Explain why a step refused to advance. The manager swallows advancement errors into
 * `step.error` and simply re-renders the same step, which from the outside looks identical to a
 * click that never landed â€” so both possibilities are reported.
 */
function describeStuckStep(manager, step) {
  const adv = step.flow?.advancement;
  const buttons = [...(manager.element?.querySelectorAll("nav [data-action]") ?? [])]
    .map(b => `${b.dataset.action}${b.disabled ? " (disabled)" : ""}`);
  const lines = [
    `  advancement : ${adv?.type} "${adv?.title}" (${adv?.id}) at level ${step.flow?.level}`,
    `  step.error  : ${step.error?.message ?? "none"}`,
    `  nav buttons : ${buttons.join(", ") || "none"}`,
    `  steps       : ${manager.steps.length}, still rendered: ${manager.rendered}`
  ];
  // Foundry builds the submit payload from `form.elements`, then looks each name back up with
  // `namedItem()`. A name that does not resolve makes FormDataExtended throw, which is a common
  // way for a step to "not advance" â€” so report the resolution of every field.
  const form = step.flow?.form ?? step.flow?.element?.querySelector("form") ?? step.flow?.element;
  if ( form ) {
    lines.push(`  form        : <${form.tagName?.toLowerCase()}> `
      + `owner=${form.elements ? `${form.elements.length} elements` : "not a form"}`);
    for ( const el of form.elements ?? [] ) {
      const named = el.name ? form.elements.namedItem(el.name) : "(unnamed)";
      lines.push(`    <${el.tagName.toLowerCase()} name="${el.name}"> `
        + `-> ${named === "(unnamed)" ? named : (named ? named.constructor.name : "NULL â€” this is the crash")}`);
    }
  }
  return lines.join("\n");
}

/* -------------------------------------------- */
/*  The reference build                          */
/* -------------------------------------------- */

/**
 * Build a character the way a player would without this module: create a blank character, set
 * its base ability scores, then add species, background and class one at a time â€” each one
 * opening the system's advancement wizard, which we answer from the book.
 * @param {object} scenario
 * @param {object} [options]
 * @param {AnswerBook} options.book        The scenario's answers, shared with the creator build.
 * @param {Set<string>} [options.consumed] Collects the ids an answer was read for.
 * @returns {Promise<Actor5e>}
 */
export async function buildNative(scenario, { book, consumed } = {}) {
  const actor = await Actor.implementation.create({
    name: scenario.name,
    type: "character",
    system: { abilities: abilityUpdate(scenario.abilities) }
  }, { render: false });

  const { AdvancementManager } = dnd5e.applications.advancement;

  // Species â†’ background â†’ class, matching the order the creator stages them in.
  for ( const key of ["species", "background", "class"] ) {
    const uuid = scenario[`${key}Uuid`];
    if ( !uuid ) continue;
    const doc = await fromUuid(uuid);
    if ( !doc ) throw new Error(`${key} not found: ${uuid}`);

    const data = doc.toObject();
    if ( data._stats ) data._stats.compendiumSource = doc.uuid;
    if ( data.type === "class" ) data.system.levels = 1;

    const manager = AdvancementManager.forNewItem(actor, data);
    if ( manager.steps.length ) await driveManager(manager, book, consumed);
    else await actor.createEmbeddedDocuments("Item", [data], { render: false });
  }

  // A scenario above level 1 raises the class the rest of the way in one manager, which is what
  // the sheet's own level selector does â€” and what the creator's post-creation jump mirrors.
  const target = scenario.targetLevel ?? 1;
  if ( target > 1 ) {
    const classItem = actor.items.find(i => i.type === "class");
    if ( !classItem ) throw new Error("cannot level up: the scenario built no class");
    const levels = target - (classItem.system?.levels ?? 1);
    if ( levels > 0 ) {
      const manager = AdvancementManager.forLevelChange(actor, classItem.id, levels);
      if ( manager.steps.length ) await driveManager(manager, book, consumed);
      else await classItem.update({ "system.levels": target });
    }
  }

  // Multiclassing is adding a *new* class item, not raising the existing one â€” `forNewItem`
  // again, exactly as dropping a second class on the sheet would. The system knows it is a
  // multiclass because the actor already has a class, and applies the `classRestriction:
  // "secondary"` advancements instead of the primary ones.
  const mc = scenario.multiclass;
  if ( mc?.classUuid ) {
    const doc = await fromUuid(mc.classUuid);
    if ( !doc ) throw new Error(`multiclass not found: ${mc.classUuid}`);
    const data = doc.toObject();
    if ( data._stats ) data._stats.compendiumSource = doc.uuid;
    data.system.levels = mc.levels ?? 1;

    const manager = AdvancementManager.forNewItem(actor, data);
    if ( manager.steps.length ) await driveManager(manager, book, consumed);
    else await actor.createEmbeddedDocuments("Item", [data], { render: false });
  }

  return actor;
}

/** `{str: 15, â€¦}` â†’ the nested shape `Actor.create` wants. */
export function abilityUpdate(abilities = {}) {
  return Object.fromEntries(Object.entries(abilities).map(([key, value]) => [key, { value }]));
}
