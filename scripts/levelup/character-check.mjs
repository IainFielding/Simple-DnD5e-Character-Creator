import { tpl, t, log, levelUpEnabled } from "../config.mjs";
import { repairTargets, launchRepair } from "./repair.mjs";
import { computeSpellPlan } from "./steps/lvl-spells-step.mjs";
import { canLevelUp, hasLevelUpXp, triggerLevelUp } from "./intercept.mjs";
import { hasGrantedLevel, usesMilestones } from "./milestone.mjs";
import { spellKey } from "../data/spell-identity.mjs";

/**
 * "Check Character": a read-only report of what looks wrong or unfinished on a character.
 *
 * It changes nothing. Each finding is either a **problem** (something was skipped or is over a limit)
 * or a **note** (worth knowing, often the player's own choice), and a finding that has a fix in this
 * module carries a button to it: Repair for an unanswered level, Level Up for a waiting level.
 *
 * Every rule here is one the module already applies elsewhere, read off the live actor instead of a
 * level-up clone: the unanswered decisions are Repair's ({@link repairTargets}), and the spell counts
 * are the level-up Spells step's own plan ({@link computeSpellPlan}). A check with its own idea of
 * the rules could disagree with the wizard that fixes it, and the report would then send a player
 * to a screen that says there is nothing to do.
 *
 * Owners and the GM can run it: it only reads, and a player is the person best placed to act on it.
 */

/**
 * @typedef {object} CheckFinding
 * @property {"problem"|"note"} kind
 * @property {string} text
 * @property {{type: "repair", classId: string, level: number}|{type: "levelUp"}|null} action
 */

/**
 * Everything the check finds on a character, problems first. Each rule runs on its own, so one that
 * throws on odd data costs the report that rule rather than the whole report.
 * @param {Actor5e} actor
 * @returns {CheckFinding[]}
 */
export function checkCharacter(actor) {
  const findings = [];
  for ( const rule of [unansweredChoices, spellCounts, duplicateSpells, levelWaiting, xpBehind] ) {
    try {
      findings.push(...rule(actor));
    } catch ( err ) {
      log("a character check failed", rule.name, err);
    }
  }
  return findings.sort((a, b) => Number(a.kind !== "problem") - Number(b.kind !== "problem"));
}

/** Decisions a level left unmade, hit points included: Repair's own list, one finding per level. */
function unansweredChoices(actor) {
  return repairTargets(actor).flatMap(({ classItem, levels }) => levels.map(g => ({
    kind: "problem",
    text: t("check.unanswered", { class: classItem.name, level: g.level, titles: g.titles.join(", ") }),
    action: { type: "repair", classId: classItem.id, level: g.level }
  })));
}

/**
 * Each casting class's spells against what it may have, from the level-up Spells step's own plan.
 * Unpicked cantrips are a problem (nothing in play ever offers them back); leveled spells under the
 * limit are a note, since a prepared caster may leave room on purpose.
 */
function spellCounts(actor) {
  const out = [];
  for ( const classItem of actor.items.filter(i => i.type === "class") ) {
    const plan = computeSpellPlan(actor, classItem);
    if ( !plan.isSpellcaster ) continue;
    const name = classItem.name;
    const cantrips = plan.cantripTarget - plan.cantripHave;
    if ( cantrips > 0 ) out.push({ kind: "problem", text: t("check.cantrips", { class: name, count: cantrips }), action: null });
    if ( plan.maxSpellLevel > 0 ) {
      const spells = plan.spellTarget - plan.spellHave;
      if ( spells < 0 ) out.push({ kind: "problem", text: t("check.spellsOver", { class: name, count: -spells }), action: null });
      else if ( spells > 0 ) out.push({ kind: "note", text: t("check.spellsUnder", { class: name, count: spells }), action: null });
    }
    if ( plan.addBook > 0 ) out.push({ kind: "note", text: t("check.bookOwed", { class: name, count: plan.addBook }), action: null });
    const released = (plan.releasedSpells ?? 0) + (plan.releasedCantrips ?? 0);
    if ( released > 0 ) out.push({ kind: "note", text: t("check.alsoGranted", { class: name, count: released }), action: null });
  }
  return out;
}

/** The same spell owned twice from the same source: one copy is doing nothing. */
function duplicateSpells(actor) {
  const seen = new Map();
  for ( const item of actor.items ) {
    if ( item.type !== "spell" ) continue;
    const key = spellKey(item);
    if ( !key ) continue;
    const id = `${key}|${item.system?.sourceItem ?? ""}`;
    const entry = seen.get(id) ?? { name: item.name, count: 0 };
    entry.count++;
    seen.set(id, entry);
  }
  return [...seen.values()].filter(e => e.count > 1).map(e => ({
    kind: "problem", text: t("check.duplicate", { name: e.name, count: e.count }), action: null
  }));
}

/** A level the character has earned or been granted and not yet taken. */
function levelWaiting(actor) {
  if ( !levelUpEnabled() || !canLevelUp(actor) ) return [];
  if ( !hasLevelUpXp(actor) && !hasGrantedLevel(actor) ) return [];
  return [{ kind: "note", text: t("check.levelWaiting"), action: { type: "levelUp" } }];
}

/** In an XP world, a level the character's XP doesn't reach — usually a level set by hand. */
function xpBehind(actor) {
  if ( usesMilestones() ) return [];
  const xp = actor.system?.details?.xp;
  if ( !Number.isFinite(xp?.min) || ((xp?.value ?? 0) >= xp.min) ) return [];
  return [{ kind: "note", text: t("check.xpBehind", { value: xp.value ?? 0, min: xp.min }), action: null }];
}

/* -------------------------------------------- */
/*  Window                                      */
/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The report window's id for a character: one window per character.
 * @param {Actor5e} actor
 * @returns {string}
 */
function checkWindowId(actor) {
  return `sogrom-check-${actor.id}`;
}

/**
 * The report window. Its id carries the actor's id, so two characters can each have one open, and
 * {@link openCharacterCheck} brings an open one forward rather than building a second with the same
 * id (Foundry would swap the new one into the old one's place and orphan it).
 */
export class CharacterCheckApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sogrom-check",
    classes: ["sogrom-check"],
    window: { icon: "fa-solid fa-stethoscope", resizable: true },
    position: { width: 480, height: "auto" },
    actions: {
      repair: CharacterCheckApp.#onRepair,
      levelUp: CharacterCheckApp.#onLevelUp,
      recheck: CharacterCheckApp.#onRecheck
    }
  };

  static PARTS = { body: { template: tpl("character-check.hbs") } };

  /**
   * @param {Actor5e} actor
   * @param {object} [options]
   */
  constructor(actor, options = {}) {
    // The id is given whole: core overwrites any `uniqueId` passed in with its own counter.
    super({ ...options, id: checkWindowId(actor) });
    this.actor = actor;
  }

  /** @override */
  get title() {
    return t("check.title", { name: this.actor.name });
  }

  /** @override */
  async _prepareContext() {
    const findings = checkCharacter(this.actor).map((f, i) => ({
      ...f,
      index: i,
      problem: f.kind === "problem",
      actionLabel: f.action?.type === "repair" ? t("check.repairButton")
        : (f.action?.type === "levelUp" ? t("check.levelUpButton") : "")
    }));
    this.findings = findings;
    return {
      findings,
      clean: !findings.length,
      summary: t("check.summary", {
        problems: findings.filter(f => f.problem).length, notes: findings.filter(f => !f.problem).length
      })
    };
  }

  static async #onRepair(_event, target) {
    const action = this.findings?.[Number(target.dataset.index)]?.action;
    if ( action?.type !== "repair" ) return;
    await this.close();
    launchRepair(this.actor, action.classId, action.level);
  }

  static async #onLevelUp() {
    await this.close();
    triggerLevelUp(this.actor);
  }

  static #onRecheck() {
    this.render();
  }
}

/**
 * Open the report for a character, or bring forward the one already open for them.
 * @param {Actor5e} actor
 * @returns {CharacterCheckApp}
 */
export function openCharacterCheck(actor) {
  const open = foundry.applications.instances?.get(checkWindowId(actor));
  if ( open ) {
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new CharacterCheckApp(actor);
  app.render({ force: true });
  return app;
}

/**
 * Whether the check is offered for this actor: a character with a class, which this user owns.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function canCheckCharacter(actor) {
  return levelUpEnabled() && (actor?.type === "character") && !!actor.isOwner
    && actor.items.some(i => i.type === "class");
}

/** The sheet ⋯ menu's action name, namespaced so it cannot collide with a sheet's own. */
const CHECK_CONTROL = "sogromCheckCharacter";

/**
 * "Check Character" in the character sheet's ⋯ menu, its only entry point: an occasional tool with
 * no button of its own, so the overflow menu is where it belongs, and the Actors right-click menu is
 * left to the actions a player reaches for often.
 *
 * Uses the same `getHeaderControlsApplicationV2` seam as Level Up (see intercept.mjs
 * `onGetHeaderControls`), but is always offered rather than gated on the `headerMenu` setting,
 * since there is nowhere else to find it.
 */
export function registerCharacterCheck() {
  Hooks.on("getHeaderControlsApplicationV2", (application, controls) => {
    try {
      const actor = application?.actor;
      if ( !canCheckCharacter(actor) || (application instanceof CharacterCheckApp) ) return;
      if ( controls.some(c => c.action === CHECK_CONTROL) ) return;
      controls.push({
        action: CHECK_CONTROL,
        icon: "fa-solid fa-stethoscope",
        label: t("check.button"),
        onClick: () => openCharacterCheck(actor)
      });
    } catch ( err ) {
      // Fires for every application in the world; it must never be what stops one rendering.
      log("could not add the Check Character header control", err);
    }
  });
}
