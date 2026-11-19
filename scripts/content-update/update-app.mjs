import { HOOKS, MODULE_ID, SETTINGS, fireCancellableHook, fireHook, log, t, tpl } from "../config.mjs";
import { newlyOpenLevels, repairKeys, repairInSequence } from "../levelup/repair.mjs";
import { cachedScan, hasUpdates, invalidateScan, scanActor, sourceUuidOf } from "./scan.mjs";
import { commitRehearsal, refreshPreview, rehearse } from "./rebuild.mjs";
import { packageOfUuid, readStamp } from "./fingerprint.mjs";
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

/* -------------------------------------------- */
/*  Grouping                                    */
/* -------------------------------------------- */

/** Where each heading sits on the page: classes first, then origins, then everything else. */
const CATEGORY_ORDER = ["class", "species", "background", "feats", "spells", "equipment", "other"];

const EQUIPMENT_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/** The item at the top of an item's grant chain (itself when nothing granted it). */
function rootOf(item) {
  const items = item.parent?.items;
  let cur = item;
  for ( let i = 0; i < 10; i++ ) {
    const origin = cur.flags?.dnd5e?.advancementOrigin;
    const next = origin ? items?.get(String(origin).split(".")[0]) : null;
    if ( !next || (next === cur) ) break;
    cur = next;
  }
  return cur;
}

/** The class a subclass belongs to, on the same character. */
function classOfSubclass(subclass) {
  const id = subclass.system?.classIdentifier;
  return subclass.parent?.items?.find(i => (i.type === "class") && (i.system?.identifier === id)) ?? null;
}

/**
 * Which heading an item belongs under: the class, species or background that granted it, else what it
 * is. Spells always go under Spells, whatever granted them: that is where a player looks for them.
 * @param {Item5e} item
 * @returns {{key: string, kind: string, classItem?: Item5e}}
 */
export function categoryOf(item) {
  if ( item.type === "spell" ) return { key: "spells", kind: "spells" };
  const root = rootOf(item);
  if ( root.type === "class" ) return { key: `class:${root.id}`, kind: "class", classItem: root };
  if ( root.type === "subclass" ) {
    const cls = classOfSubclass(root) ?? root;
    return { key: `class:${cls.id}`, kind: "class", classItem: cls };
  }
  if ( root.type === "race" ) return { key: "species", kind: "species" };
  if ( root.type === "background" ) return { key: "background", kind: "background" };
  if ( item.type === "feat" ) return { key: "feats", kind: "feats" };
  if ( EQUIPMENT_TYPES.has(item.type) ) return { key: "equipment", kind: "equipment" };
  return { key: "other", kind: "other" };
}

/** Order inside a heading: the class, subclass, species or background itself first; spells by level. */
function itemRank(item) {
  return { class: 0, race: 0, background: 0, subclass: 1 }[item.type] ?? 2;
}

/* -------------------------------------------- */
/*  Versions                                    */
/* -------------------------------------------- */

/** A package's display title: the system, a module, or this world (a world compendium). */
function packageTitle(pkg) {
  if ( !pkg ) return "";
  if ( pkg === game.system?.id ) return game.system.title ?? pkg;
  if ( pkg === "world" ) return game.world?.title ?? pkg;
  return game.modules?.get(pkg)?.title ?? pkg;
}

/**
 * Where an item came from and where it goes: "Player's Handbook 2.1.0 → 3.0.0". The old version is
 * known only from the stamp the creator records on the items it adds (since 3.5.0); an older item
 * says "earlier version".
 * @param {import("./scan.mjs").ScanEntry} e
 * @returns {{text: string, tip: string}}
 */
export function versionLine(e) {
  const toPkg = packageOfUuid(e.sourceUuid);
  if ( !toPkg ) return { text: "", tip: "" };
  const stamp = readStamp(e.item, MODULE_ID);
  const fromPkg = stamp?.package ?? packageOfUuid(sourceUuidOf(e.item)) ?? toPkg;
  const to = e.toVersion ?? "";
  const from = e.fromVersion ?? "";
  const pkg = packageTitle(toPkg);
  const fromPackage = packageTitle(fromPkg);
  const moved = fromPkg !== toPkg;
  if ( !from ) {
    const text = moved
      ? t("contentUpdate.version.movedUnknown", { fromPackage, package: pkg, to })
      : t("contentUpdate.version.unknownFrom", { package: pkg, to });
    return { text: text.trim(), tip: t("contentUpdate.version.unknownTip") };
  }
  if ( moved ) return { text: t("contentUpdate.version.moved", { fromPackage, from, package: pkg, to }).trim(), tip: "" };
  if ( from === to ) return { text: t("contentUpdate.version.same", { package: pkg, to }).trim(), tip: "" };
  return { text: t("contentUpdate.version.changed", { package: pkg, from, to }).trim(), tip: "" };
}

export class ContentUpdateApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sogrom-content-update",
    // The creator's own window chrome and theme (styles/creator/01-foundation.css, 02-window.css),
    // so the review reads as part of the module rather than a stock Foundry dialog.
    classes: ["sogrom-creator", "sogrom-creator-windowed", "sogrom-content-update"],
    window: { icon: "fa-solid fa-arrows-rotate", resizable: true },
    // A fixed height (see the constructor): a long review scrolls inside the window, with the
    // Update / Cancel footer pinned below it, instead of growing past the bottom of the screen.
    // The width of dnd5e's character sheet (CharacterActorSheet: 800), the window it opens from.
    position: { width: 800 },
    actions: {
      update: ContentUpdateApp.#onUpdate,
      cancel: ContentUpdateApp.#onCancel,
      download: ContentUpdateApp.#onDownload,
      keep: ContentUpdateApp.#onKeep,
      category: ContentUpdateApp.#onCategory,
      skipBackup: ContentUpdateApp.#onSkipBackup
    }
  };

  // `scrollable`: a re-render (a "Keep mine" tick) leaves the reader where they were.
  static PARTS = { body: { template: tpl("content-update.hbs"), scrollable: [".sogrom-cu-scroll"] } };

  /** @type {"loading"|"ready"|"error"|"working"|"empty"} */
  #phase = "loading";

  #scan = null;

  #rehearsal = null;

  #error = "";

  /** item id → true to keep the player's copy: the per-item "Keep mine" boxes. Starts pre-ticked. */
  #keep = new Map();

  /** Headings switched off in "Update which things": every item under one is kept as it is. */
  #off = new Set();

  /** item id → heading key, worked out once per scan. */
  #category = new Map();

  /**
   * The answers the rehearsal reads: a heading switched off, else the item's own box. One Map for the
   * window's life, refilled in place, because the rehearsal's transform holds it and reads it live.
   */
  #answers = new Map();

  #downloaded = false;

  /** A "Keep mine" answer is walking the rebuild again. */
  #recalculating = false;

  /** Enriched descriptions, by item id and side: enrichment is the slow part of a render. */
  #enriched = new Map();

  #skipBackup = false;

  constructor(actor, options = {}) {
    const height = Math.min(820, Math.round((globalThis.innerHeight || 900) * 0.85));
    super({ ...options, id: windowId(actor), position: { height, ...(options.position ?? {}) } });
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
        if ( !this.#category.has(e.item.id) ) this.#category.set(e.item.id, categoryOf(e.item).key);
      }
      this.#syncAnswers();
      this.#rehearsal = await rehearse(this.actor, this.#scan, { keep: this.#answers });
      this.#phase = "ready";
    } catch ( err ) {
      log("content update: rehearsal failed", err);
      this.#error = err?.message ?? String(err);
      this.#phase = "error";
    }
    return this.render();
  }

  /** Refill {@link #answers}; returns the ids whose answer changed. */
  #syncAnswers() {
    const changed = [];
    for ( const e of this.#scan?.entries ?? [] ) {
      const id = e.item.id;
      const value = this.#off.has(this.#category.get(id)) || (this.#keep.get(id) ?? e.keepDefault ?? false);
      if ( this.#answers.get(id) !== value ) changed.push(id);
      this.#answers.set(id, value);
    }
    return changed;
  }

  /** Whether an item will be left as it is, by its own box or its heading's toggle. */
  #kept(id) {
    return this.#answers.get(id) ?? false;
  }

  /** @override */
  async _prepareContext() {
    const phase = this.#phase;
    const base = { phase, loading: phase === "loading", error: phase === "error" ? this.#error : "",
      empty: phase === "empty", working: phase === "working" };
    if ( (phase !== "ready") && (phase !== "working") ) return base;

    const entries = this.#scan.entries;
    // Descriptions are shown as a sheet shows them: embeds, links and rolls enriched, each relative to
    // its own copy. Only for the items that offer the comparison, and once per window.
    const enrich = async (key, html, doc) => {
      if ( !this.#enriched.has(key) ) {
        this.#enriched.set(key, await foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "",
          { relativeTo: doc, secrets: false }).catch(() => html ?? ""));
      }
      return this.#enriched.get(key);
    };
    const describe = async e => {
      const descriptionChanged = e.customised && e.changed.includes("description");
      const version = versionLine(e);
      return {
        id: e.item.id,
        name: e.item.name,
        img: e.item.img,
        tier: e.tier,
        tierLabel: t(`contentUpdate.tier.${e.tier}`),
        groups: e.changed.filter(g => g !== "img").map(groupLabel).join(", "),
        version: version.text,
        versionTip: version.tip,
        matchedBy: (e.how === "split")
          ? t("contentUpdate.matchedBy.split", { species: e.source?.name ?? "", lineage: e.lineage?.name ?? "" })
          : (["identifier", "name"].includes(e.how) ? t(`contentUpdate.matchedBy.${e.how}`) : ""),
        customised: e.customised,
        keep: this.#keep.get(e.item.id) ?? false,
        skipped: this.#off.has(this.#category.get(e.item.id)),
        descriptionChanged,
        oldDescription: descriptionChanged ? await enrich(`${e.item.id}|old`, e.item.system?.description?.value, e.item) : "",
        newDescription: descriptionChanged ? await enrich(`${e.item.id}|new`, e.source?.system?.description?.value, e.source) : ""
      };
    };

    // One heading per class (a multiclass character gets one each), then species, background, feats,
    // spells, equipment: what granted or holds the item, rather than how the update treats it.
    const changing = entries.filter(e => ["refresh", "rebuild"].includes(e.tier));
    const byKey = new Map();
    for ( const e of changing ) {
      const cat = categoryOf(e.item);
      if ( !byKey.has(cat.key) ) byKey.set(cat.key, { ...cat, entries: [] });
      byKey.get(cat.key).entries.push(e);
    }
    const originalClass = this.actor.system?.details?.originalClass;
    const sortedGroups = [...byKey.values()].sort((a, b) => {
      const kind = CATEGORY_ORDER.indexOf(a.kind) - CATEGORY_ORDER.indexOf(b.kind);
      if ( kind || (a.kind !== "class") ) return kind;
      if ( a.classItem?.id === originalClass ) return -1;
      if ( b.classItem?.id === originalClass ) return 1;
      return (b.classItem?.system?.levels ?? 0) - (a.classItem?.system?.levels ?? 0);
    });
    const groups = await Promise.all(sortedGroups.map(async g => {
      g.entries.sort((a, b) => (itemRank(a.item) - itemRank(b.item))
        || ((a.item.system?.level ?? 0) - (b.item.system?.level ?? 0))
        || a.item.name.localeCompare(b.item.name, game.i18n?.lang));
      const label = (g.kind === "class")
        ? t("contentUpdate.category.class", { name: g.classItem?.name ?? "" })
        : t(`contentUpdate.category.${g.kind}`);
      return { key: g.key, label, count: g.entries.length, on: !this.#off.has(g.key),
        items: await Promise.all(g.entries.map(describe)) };
    }));

    // The packages behind the update, once each: "Player's Handbook 2.1.0 → 3.0.0 · 12 items".
    const sourceCounts = new Map();
    for ( const e of changing ) {
      const line = versionLine(e).text;
      if ( line ) sourceCounts.set(line, (sourceCounts.get(line) ?? 0) + 1);
    }
    const sources = [...sourceCounts].map(([text, count]) => ({ text, count: t("contentUpdate.version.count", { count }) }));
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
      groups, sources, untouched,
      hasSources: sources.length > 0,
      hasRebuilt: changing.some(e => e.tier === "rebuild"),
      hasUntouched: untouched.length > 0,
      recalculating: this.#recalculating,
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
      nothingToDo: changing.every(e => this.#kept(e.item.id)),
      updateDisabled: !backupReady || (phase === "working") || this.#recalculating
        || changing.every(e => this.#kept(e.item.id))
    };
  }

  /** Toggle "Keep mine" on one item. */
  static async #onKeep(_event, target) {
    const id = target.dataset.itemId;
    if ( !id || (this.#phase !== "ready") || this.#recalculating ) return;
    this.#keep.set(id, !!target.checked);
    return this.#reanswer();
  }

  /** Toggle a heading in "Update which things": off keeps every item under it as it is. */
  static async #onCategory(_event, target) {
    const key = target.dataset.category;
    if ( !key || (this.#phase !== "ready") || this.#recalculating ) return;
    if ( target.checked ) this.#off.delete(key);
    else this.#off.add(key);
    return this.#reanswer();
  }

  /**
   * Bring the preview up to date with changed answers. Most answers are read only when the rehearsed
   * character is reconciled with the old one, so the preview is re-derived at once; only a class,
   * species or background the rebuild staged needs the walk run again.
   */
  async #reanswer() {
    const changed = this.#syncAnswers();
    if ( !changed.length ) return this.render();
    if ( !changed.some(id => this.#rehearsal?.walked?.has(id)) ) {
      try {
        refreshPreview(this.#rehearsal);
      } catch ( err ) {
        log("content update: preview refresh failed", err);
        return this.#prepare();
      }
      return this.render();
    }
    this.#recalculating = true;
    await this.render();
    try {
      this.#rehearsal = await rehearse(this.actor, this.#scan, { keep: this.#answers });
    } catch ( err ) {
      log("content update: rehearsal failed", err);
      this.#error = err?.message ?? String(err);
      this.#phase = "error";
    }
    this.#recalculating = false;
    return this.render();
  }

  /** Keep each opened heading and description comparison open across a re-render. */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);
    for ( const open of priorElement.querySelectorAll("details[data-item-id][open]") ) {
      newElement.querySelector(`details[data-item-id="${CSS.escape(open.dataset.itemId)}"]`)?.setAttribute("open", "");
    }
    for ( const open of priorElement.querySelectorAll("details[data-group][open]") ) {
      newElement.querySelector(`details[data-group="${CSS.escape(open.dataset.group)}"]`)?.setAttribute("open", "");
    }
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
      // What was already unanswered before the update is the player's own business; what the update
      // opens, it walks them through straight after (below).
      const openBefore = repairKeys(actor);
      await commitRehearsal(rehearsal);
      invalidateScan(actor);
      // What actually changed: an item kept by its box or its heading is not counted.
      const done = this.#scan.entries.filter(e => !this.#kept(e.item.id));
      const refreshed = done.filter(e => e.tier === "refresh").length;
      const rebuilt = done.filter(e => e.tier === "rebuild").length;
      const asked = (rehearsal.decisions ?? []).filter(d => d.status === "ask").length;
      await postSummary(actor, { refreshed, rebuilt, asked, backup });
      fireHook(HOOKS.contentUpdated, { actor, backup, rehearsal });
      await this.close();
      // One process: the choices the update could not carry open at once, a level at a time, in the
      // level-up window — no prompt, no hunting for the wrench.
      const opened = newlyOpenLevels(actor, openBefore);
      if ( opened.size ) await repairInSequence(actor, opened);
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
 * Register the one entry point, the character sheet's ⋯ menu, and the invalidation that keeps cached
 * scans honest. (There is deliberately no Actors right-click entry: the update is offered from the
 * character's own sheet only.)
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

  const forget = doc => invalidateScan(doc?.actor ?? doc);
  for ( const hook of ["updateActor", "createItem", "updateItem", "deleteItem"] ) Hooks.on(hook, forget);
}

