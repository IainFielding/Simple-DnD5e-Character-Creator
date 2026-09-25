import { MODULE_ID, SETTINGS, DEFAULTS, storeConfig, t } from "../config.mjs";
import { defaultInventoryUuids } from "../data/store-defaults.mjs";
import {
  PHYSICAL_TYPES, sanitizeEntry, entryFromItem, hydrateEntries,
  effectiveCp, parsePriceInput, cpToPriceParts, priceCp, formatCp
} from "../data/store-source.mjs";
import { InventoryConfigApp } from "./inventory-config-base.mjs";

/** Currency keys offered by the override inputs when the system config is unavailable. */
const FALLBACK_DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"];

/**
 * The GM-facing store window, opened from the module's settings menu (registered via
 * `game.settings.registerMenu` in main.mjs): the one and only place the shelf inventory is
 * managed. The GM drags items in from any compendium or the Items sidebar, tweaks each
 * row's price override or hides it, and saves; a fresh world starts from the factory list
 * ({@link module:data/store-defaults}), which the Reset button restores at any time.
 *
 * The window edits a *working copy*: drops, removals, and resets mutate `#inventory` and
 * re-render, and nothing touches the world until Save writes the `storeEnabled` +
 * `storeConfig` settings in one go — closing without saving discards everything, which is
 * also the cheap undo for a botched drag. Because a re-render rebuilds the DOM, every
 * mutating handler first pulls the live inputs back into the working copy
 * ({@link StoreConfigApp##syncFormToWorkingCopy}) so half-typed overrides survive.
 *
 * The per-row inputs deliberately carry no `name` attribute: row identity is a UUID, and
 * UUIDs contain dots, which Foundry's form serialisation (`expandObject`) would explode
 * into nested objects. Only `enabled` and `priceMultiplier` are real form fields; the rows
 * are read by `data-` attribute instead.
 */
export class StoreConfigApp extends InventoryConfigApp {

  static DEFAULT_OPTIONS = {
    id: "sogrom-store-config",
    tag: "form",
    classes: ["sogrom-store-config", "standard-form"],
    window: {
      title: `${MODULE_ID}.storeConfig.title`,
      icon: "fa-solid fa-shop",
      contentClasses: ["standard-form"]
    },
    position: { width: 680, height: 640 },
    actions: {
      resetDefaults: StoreConfigApp.#onResetDefaults,
      removeEntry: StoreConfigApp.#onRemoveEntry
    },
    form: {
      handler: StoreConfigApp.#onSubmit,
      closeOnSubmit: true
    }
  };

  // Each PART must render exactly one root element, so the fields live in their own
  // template and the submit button uses Foundry's generic footer part (which builds its
  // buttons from the `buttons` context below).
  static PARTS = {
    fields: { template: `modules/${MODULE_ID}/templates/store-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** @type {object[]|null} Working copy of the inventory; null until the first prepare. */
  #inventory = null;

  /** Working copies of the two named form fields, surviving re-renders like the rows do. */
  #enabled = false;
  #multiplier = 1;

  /** The live search needle, restored into the input after every re-render. */
  #search = "";

  /** @override */
  async _prepareContext() {
    if ( this.#inventory === null ) {
      const config = storeConfig();
      this.#enabled = config.enabled;
      this.#multiplier = config.priceMultiplier;
      // A fresh world's factory list is bare uuids; resolve them into full display rows.
      this.#inventory = await hydrateEntries(config.inventory, uuid => fromUuid(uuid).catch(() => null));
    }
    const denominations = Object.keys(CONFIG.DND5E?.currencies ?? {});
    const denomKeys = denominations.length ? denominations : FALLBACK_DENOMINATIONS;
    const rows = this.#inventory
      .map(entry => this.#rowContext(entry, denomKeys))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return {
      enabled: this.#enabled,
      priceMultiplier: this.#multiplier,
      rows,
      count: rows.length,
      hasRows: rows.length > 0,
      search: this.#search,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: t("storeConfig.save") }]
    };
  }

  /**
   * One table row's render context. While the item still resolves, the stored snapshot is
   * opportunistically refreshed (renames, art and — where the resolved data carries a
   * price, i.e. world items and fully-loaded documents — price errata), so stale copies
   * heal themselves on the next Save. An unresolvable row renders flagged as broken.
   */
  #rowContext(entry, denomKeys) {
    const resolved = this.#resolveSync(entry.uuid);
    if ( resolved ) {
      if ( resolved.name ) {
        entry.name = resolved.name;
        entry.img = resolved.img || entry.img;
        entry.type = resolved.type ?? entry.type;
      }
      if ( resolved.system?.price !== undefined ) entry.baseCp = priceCp(resolved.system.price);
      if ( resolved.system?.type !== undefined ) entry.subtype = resolved.system.type?.value ?? "";
    }
    const override = entry.overrideCp !== null ? cpToPriceParts(entry.overrideCp) : null;
    const selectedDenom = override?.denomination ?? "gp";
    return {
      uuid: entry.uuid,
      name: entry.name || entry.uuid,
      img: entry.img,
      broken: !resolved,
      hidden: entry.hidden,
      sourceLabel: this._sourceLabel(entry.uuid),
      basePrice: entry.baseCp > 0 ? formatCp(entry.baseCp) : "—",
      overrideValue: override?.value ?? "",
      effective: formatCp(effectiveCp(entry, this.#multiplier)),
      denominations: denomKeys.map(d => ({ value: d, label: d, selected: d === selectedDenom }))
    };
  }

  /** Resolve a uuid without loading (index entry for compendia, document for world items). */
  #resolveSync(uuid) {
    try { return fromUuidSync(uuid); } catch { return null; }
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // The part content (and with it the search input) is rebuilt every render.
    const search = this.element.querySelector("[data-inv-search]");
    if ( search ) {
      search.value = this.#search;
      search.addEventListener("input", () => this.#applySearch(search.value));
      this.#applySearch(this.#search);
    }
  }

  /** Client-side row filter — no re-render, so in-progress edits are never disturbed. */
  #applySearch(raw) {
    this.#search = raw ?? "";
    const needle = this.#search.trim().toLowerCase();
    for ( const row of this.element.querySelectorAll("tr[data-uuid]") ) {
      row.classList.toggle("is-hidden", !!needle && !(row.dataset.name ?? "").toLowerCase().includes(needle));
    }
  }

  /**
   * Pull the live inputs back into the working copy. Called before every mutation that
   * re-renders (and on Save), so typed overrides and toggles survive the DOM rebuild.
   */
  #syncFormToWorkingCopy() {
    const form = this.element;
    const enabled = form.elements?.enabled;
    if ( enabled ) this.#enabled = !!enabled.checked;
    const mult = Number(form.elements?.priceMultiplier?.value);
    if ( Number.isFinite(mult) && mult > 0 ) this.#multiplier = mult;
    for ( const row of form.querySelectorAll("tr[data-uuid]") ) {
      const entry = this.#inventory.find(e => e.uuid === row.dataset.uuid);
      if ( !entry ) continue;
      entry.overrideCp = parsePriceInput(
        row.querySelector("[data-override-value]")?.value,
        row.querySelector("[data-override-denom]")?.value
      );
      const hiddenBox = row.querySelector("[data-entry-hidden]");
      if ( hiddenBox ) entry.hidden = hiddenBox.checked;
    }
  }

  /**
   * An item dropped anywhere on the window joins the inventory: Foundry's drag payload is
   * resolved back to the item, validated as priced physical gear, deduped by uuid, and
   * snapshotted into a row. Nothing is saved yet — the drop only edits the working copy.
   * @override
   */
  async _onDropData(data) {
    if ( data.type !== "Item" ) return;
    const item = await Item.implementation.fromDropData(data).catch(() => null);
    if ( !item ) return void ui.notifications.warn(t("storeConfig.dropNotItem"));
    if ( !PHYSICAL_TYPES.includes(item.type) ) {
      return void ui.notifications.warn(t("storeConfig.dropNotPhysical", { name: item.name }));
    }
    const uuid = item.uuid ?? data.uuid;
    if ( !uuid ) return;
    this.#syncFormToWorkingCopy();
    if ( this.#inventory.some(e => e.uuid === uuid) ) {
      return void ui.notifications.info(t("storeConfig.dropDuplicate", { name: item.name }));
    }
    const entry = entryFromItem(item, uuid);
    // Unpriced gear is stocked but stays off the players' shelf until an override prices it.
    if ( entry.baseCp <= 0 ) ui.notifications.warn(t("storeConfig.dropUnpriced", { name: item.name }));
    this.#inventory.push(entry);
    this.render();
  }

  /** Restore the factory default list (working copy only — Save still decides). */
  static async #onResetDefaults() {
    const proceed = await this._confirm({
      title: t("storeConfig.reset.title"), icon: "fa-solid fa-rotate-left",
      content: `<p>${t("storeConfig.reset.body")}</p>`
    });
    if ( !proceed ) return;
    this.#syncFormToWorkingCopy();
    this.#inventory = await hydrateEntries(
      defaultInventoryUuids().map(uuid => ({ uuid })),
      uuid => fromUuid(uuid).catch(() => null)
    );
    this.render();
  }

  /** Drop one row from the working copy (Save-or-close remains the safety net). */
  static #onRemoveEntry(_event, target) {
    this.#syncFormToWorkingCopy();
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if ( !uuid ) return;
    this.#inventory = this.#inventory.filter(e => e.uuid !== uuid);
    this.render();
  }

  /** Persist the working copy: the checkbox to its own setting, the rest to the hidden object. */
  static async #onSubmit(_event, _form, formData) {
    this.#syncFormToWorkingCopy();
    const data = formData.object;
    const mult = Number(data.priceMultiplier);
    await game.settings.set(MODULE_ID, SETTINGS.storeEnabled, !!data.enabled);
    await game.settings.set(MODULE_ID, SETTINGS.storeConfig, {
      priceMultiplier: Number.isFinite(mult) && mult > 0 ? mult : DEFAULTS.storeConfig.priceMultiplier,
      inventory: this.#inventory.map(sanitizeEntry)
    });
  }
}
