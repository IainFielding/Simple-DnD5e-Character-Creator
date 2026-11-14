import { HOOKS, MODULE_ID, SETTINGS, fireCancellableHook, fireHook, log, t, tpl } from "../config.mjs";
import { repairTargets, promptRepair } from "../levelup/repair.mjs";
import { cachedScan, hasUpdates, invalidateScan, scanActor } from "./scan.mjs";
import { commitRehearsal, rehearse } from "./rebuild.mjs";
import { canCopyActor, copyActor, downloadActor } from "./backup.mjs";

/**
 * "Update to new content": the one window the feature has.
 *
 * It scans the character, rehearses the whole update on a clone, and shows the result on one review
 * page — what changes, which of the player's decisions were carried over, and the before/after of the
 * numbers that matter. Nothing is written until **Update**, and then in one batch, after a backup.
 * Anything the update could not carry over is left unanswered and handed straight to the repair wrench.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** One window per character. */
function windowId(actor) {
  return `sogrom-content-update-${actor.id}`;
}

/** Localised label for a field group. */
const groupLabel = g => t(`contentUpdate.group.${g}`);

export class ContentUpdateApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sogrom-content-update",
    classes: ["sogrom-content-update"],
    window: { icon: "fa-solid fa-arrows-rotate", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      update: ContentUpdateApp.#onUpdate,
      cancel: ContentUpdateApp.#onCancel,
      download: ContentUpdateApp.#onDownload,
      keep: ContentUpdateApp.#onKeep,
      skipBackup: ContentUpdateApp.#onSkipBackup
    }
  };

  static PARTS = { body: { template: tpl("content-update.hbs") } };

  /** @type {"loading"|"ready"|"error"|"working"|"empty"} */
  #phase = "loading";

  #scan = null;

  #rehearsal = null;

  #error = "";

  /** item id → true to keep the player's copy. Starts from each item's pre-ticked answer. */
  #keep = new Map();

  #downloaded = false;

  #skipBackup = false;

  constructor(actor, options = {}) {
    super({ ...options, id: windowId(actor) });
    this.actor = actor;
  }

  /** @override */
  get title() {
    return t("contentUpdate.title", { name: this.actor.name });
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#prepare();
  }

  /** Scan and rehearse, then re-render with the result. */
  async #prepare() {
    this.#phase = "loading";
    try {
      this.#scan ??= await scanActor(this.actor);
      if ( !hasUpdates(this.#scan) ) {
        this.#phase = "empty";
        return this.render();
      }
      for ( const e of this.#scan.entries ) {
        if ( e.customised && !this.#keep.has(e.item.id) ) this.#keep.set(e.item.id, e.keepDefault);
      }
      this.#rehearsal = await rehearse(this.actor, this.#scan, { keep: this.#keep });
      this.#phase = "ready";
    } catch ( err ) {
      log("content update: rehearsal failed", err);
      this.#error = err?.message ?? String(err);
      this.#phase = "error";
    }
    return this.render();
  }

  /** @override */
  async _prepareContext() {
    const phase = this.#phase;
    const base = { phase, loading: phase === "loading", error: phase === "error" ? this.#error : "",
      empty: phase === "empty", working: phase === "working" };
    if ( (phase !== "ready") && (phase !== "working") ) return base;

    const entries = this.#scan.entries;
    const describe = e => ({
      id: e.item.id,
      name: e.item.name,
      img: e.item.img,
      groups: e.changed.filter(g => g !== "img").map(groupLabel).join(", "),
      versions: (e.fromVersion && e.toVersion && (e.fromVersion !== e.toVersion))
        ? t("contentUpdate.versions", { from: e.fromVersion, to: e.toVersion })
        : (e.toVersion ? t("contentUpdate.toVersion", { to: e.toVersion }) : ""),
      matchedBy: ["identifier", "name"].includes(e.how) ? t(`contentUpdate.matchedBy.${e.how}`) : "",
      customised: e.customised,
      keep: this.#keep.get(e.item.id) ?? false,
      descriptionChanged: e.customised && e.changed.includes("description"),
      oldDescription: e.item.system?.description?.value ?? "",
      newDescription: e.source?.system?.description?.value ?? ""
    });
    const refreshed = entries.filter(e => e.tier === "refresh").map(describe);
    const rebuilt = entries.filter(e => e.tier === "rebuild").map(describe);
    const untouched = entries.filter(e => (e.tier === "report") && !["noSource"].includes(e.how))
      .map(e => ({ name: e.item.name, reason: t(`contentUpdate.reason.${e.how}`) }));

    const statusIcon = { carried: "fa-circle-check", partial: "fa-circle-half-stroke", ask: "fa-circle-question",
      default: "fa-circle-info" };
    const decisions = (this.#rehearsal?.decisions ?? []).filter(d => d.status !== "none").map(d => ({
      ...d,
      icon: statusIcon[d.status] ?? "fa-circle",
      statusLabel: t(`contentUpdate.status.${d.status}`),
      isAsk: d.status === "ask"
    }));
    const toChoose = decisions.filter(d => d.isAsk).length;

    const canCopy = canCopyActor();
    const backupReady = canCopy || this.#downloaded || this.#skipBackup;
    return {
      ...base,
      refreshed, rebuilt, untouched,
      hasRefreshed: refreshed.length > 0,
      hasRebuilt: rebuilt.length > 0,
      hasUntouched: untouched.length > 0,
      decisions,
      hasDecisions: decisions.length > 0,
      toChoose,
      toChooseNote: toChoose ? t("contentUpdate.toChoose", { count: toChoose }) : "",
      summary: this.#rehearsal?.summary ?? { rows: [], added: [], removed: [] },
      hasRows: !!this.#rehearsal?.summary?.rows?.length,
      addedList: (this.#rehearsal?.summary?.added ?? []).join(", "),
      removedList: (this.#rehearsal?.summary?.removed ?? []).join(", "),
      canCopy,
      downloaded: this.#downloaded,
      skipBackup: this.#skipBackup,
      updateDisabled: !backupReady || (phase === "working")
    };
  }

  /** Toggle "Keep mine" on an item, and rehearse again with the new answer. */
  static async #onKeep(_event, target) {
    const id = target.dataset.itemId;
    if ( !id ) return;
    this.#keep.set(id, !!target.checked);
    await this.#prepare();
  }

  static #onDownload() {
    if ( downloadActor(this.actor) ) {
      this.#downloaded = true;
      this.render();
    }
  }

  static #onSkipBackup(_event, target) {
    this.#skipBackup = !!target.checked;
    this.render();
  }

  static #onCancel() {
    this.close();
  }

  /** Back up, write, announce, and hand anything left unanswered to the repair wrench. */
  static async #onUpdate() {
    if ( this.#phase !== "ready" ) return;
    const actor = this.actor;
    const rehearsal = this.#rehearsal;
    if ( !fireCancellableHook(HOOKS.preUpdateContent, { actor, scan: this.#scan, rehearsal }) ) return;

    this.#phase = "working";
    await this.render();
    try {
      let backup = null;
      if ( canCopyActor() ) {
        backup = await copyActor(actor);
        if ( !backup ) {
          ui.notifications?.error(t("contentUpdate.backup.failed"));
          this.#phase = "ready";
          return this.render();
        }
      }
      await commitRehearsal(rehearsal);
      invalidateScan(actor);
      const counts = this.#scan.counts;
      const asked = (rehearsal.decisions ?? []).filter(d => d.status === "ask").length;
      await postSummary(actor, { refreshed: counts.refresh, rebuilt: counts.rebuild, asked, backup });
      fireHook(HOOKS.contentUpdated, { actor, backup, rehearsal });
      await this.close();
      if ( repairTargets(actor).length ) promptRepair(actor);
    } catch ( err ) {
      log("content update: commit failed", err);
      ui.notifications?.error(t("contentUpdate.failed"));
      this.#error = err?.message ?? String(err);
      this.#phase = "error";
      this.render();
    }
  }
}

/**
 * The chat note an update leaves: whispered to the player and the GM, since it is about one character.
 * @param {Actor5e} actor
 * @param {{refreshed: number, rebuilt: number, asked: number, backup: Actor5e|null}} counts
 */
async function postSummary(actor, { refreshed, rebuilt, asked, backup }) {
  try {
    const lines = [t("contentUpdate.chat.body", { refreshed, rebuilt })];
    if ( asked ) lines.push(t("contentUpdate.chat.asked", { count: asked }));
    if ( backup ) lines.push(t("contentUpdate.chat.backup", { name: backup.name }));
    const whisper = [...new Set([game.user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])];
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      whisper,
      content: `<p><strong>${t("contentUpdate.chat.title", { name: foundry.utils.escapeHTML?.(actor.name) ?? actor.name })}</strong></p>`
        + lines.map(l => `<p>${l}</p>`).join("")
    });
  } catch ( err ) {
    log("content update: summary card failed", err);
  }
}

/* -------------------------------------------- */
/*  Entry points                                */
/* -------------------------------------------- */

/**
 * Whether this user may update this character: an owned character, and either a GM or a world that
 * lets players update their own (the default).
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function canUpdateContent(actor) {
  if ( (actor?.type !== "character") || !actor.isOwner ) return false;
  if ( actor.getFlag?.(MODULE_ID, "backupOf") ) return false;
  if ( game.user?.isGM ) return true;
  try {
    return game.settings.get(MODULE_ID, SETTINGS.contentUpdatePlayers) !== false;
  } catch {
    return true;
  }
}

/**
 * Open the window for a character, or bring forward the one already open.
 * @param {Actor5e} actor
 * @returns {ContentUpdateApp}
 */
export function openContentUpdate(actor) {
  const open = foundry.applications.instances?.get(windowId(actor));
  if ( open ) {
    open.bringToFront?.();
    return open;
  }
  const app = new ContentUpdateApp(actor);
  app.render({ force: true });
  return app;
}

/**
 * Whether the entry points should show: the character can be updated and its cached scan found
 * something. The first ask starts the scan and answers no; the entry appears once it lands.
 * @param {Actor5e} actor
 * @param {() => void} [onReady]
 */
export function updateAvailable(actor, onReady) {
  if ( !canUpdateContent(actor) ) return false;
  return hasUpdates(cachedScan(actor, onReady));
}

/** The sheet ⋯ menu's action name. */
const CONTROL = "sogromContentUpdate";

/**
 * Register the entry points: the character sheet's ⋯ menu, the Actors right-click menu, and the
 * invalidation that keeps cached scans honest. Called at load: the sidebar's context menu is built
 * before `ready`.
 */
export function registerContentUpdate() {
  Hooks.on("getHeaderControlsApplicationV2", (application, controls) => {
    try {
      // The actor's own sheet only. This hook fires for every window, and several carry an `actor`
      // without being its sheet — dnd5e's AdvancementManager among them. Scanning from there, and
      // re-rendering it when the scan landed, broke a native level-up mid-walk.
      const actor = application?.document;
      if ( (actor?.documentName !== "Actor") || (application.actor && (application.actor !== actor)) ) return;
      // Re-render the sheet once a first scan lands, so the entry appears without a second click.
      if ( !updateAvailable(actor, () => application.rendered && application.render()) ) return;
      if ( controls.some(c => c.action === CONTROL) ) return;
      controls.push({
        action: CONTROL, icon: "fa-solid fa-arrows-rotate", label: t("contentUpdate.button"),
        onClick: () => openContentUpdate(actor)
      });
    } catch ( err ) {
      log("could not add the content update header control", err);
    }
  });

  Hooks.on("getActorContextOptions", (_directory, options) => {
    if ( game.system?.id !== "dnd5e" ) return;
    const actorOf = li => game.actors?.get(li.dataset?.entryId ?? li.dataset?.documentId);
    options.push({
      label: t("contentUpdate.button"),
      icon: "fa-solid fa-arrows-rotate",
      visible: li => updateAvailable(actorOf(li)),
      onClick: (_event, li) => {
        const actor = actorOf(li);
        if ( actor ) openContentUpdate(actor);
      }
    });
  });

  const forget = doc => invalidateScan(doc?.actor ?? doc);
  for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, forget);
}

