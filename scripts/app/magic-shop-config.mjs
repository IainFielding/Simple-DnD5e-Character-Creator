import { MODULE_ID, SETTINGS, t } from "../config.mjs";
import { PHYSICAL_TYPES } from "../data/store-source.mjs";
import { sectionKey, groupCards, itemTypeLabel } from "../data/shelf-sections.mjs";
import {
  RARITIES, BANDS, MAX_INVENTORY, rarityLabel, sanitizeMagicEntry, sanitizeWealthTable, defaultWealthTable,
  magicEntryFromItem, stockability, mergeEntries, countByRarity, goldRange
} from "../data/magic-shop.mjs";
import { magicShopConfig, droppedMagicItems, droppedMagicItem } from "../data/magic-shop-source.mjs";
import { isTemplate, isShell, linkUuid } from "../data/magic-templates.mjs";
import { InventoryConfigApp } from "./inventory-config-base.mjs";

/**
 * The GM's Magic Item Shop window, opened from the module settings: the master toggle, the wealth
 * table (the DMG's gold and item counts per level band, overridable), and the inventory players
 * pick their free magic items from.
 *
 * Stocking is by drag and drop, three ways: a single item from a compendium or the Items sidebar;
 * a folder from a compendium (or the sidebar), which brings every magic item in that folder and
 * every subfolder beneath it; or a whole compendium. Mundane gear is left out — only items with a
 * rarity are magic items here.
 *
 * Like the Store window it edits a working copy that nothing writes until Save. It differs in one
 * way that matters: the inventory can run to thousands of rows, so removing or hiding a row edits
 * the working copy and that row's DOM in place, and only a drop (which can add hundreds at once)
 * re-renders. Inputs carry no `name`, for the same reason as the Store's — uuids contain dots, which
 * form serialisation would explode — and are read back by data attribute.
 */
export class MagicShopConfigApp extends InventoryConfigApp {

  static DEFAULT_OPTIONS = {
    id: "sogrom-magic-shop-config",
    tag: "form",
    classes: ["sogrom-magic-shop-config", "standard-form"],
    window: {
      title: `${MODULE_ID}.magicShopConfig.title`,
      icon: "fa-solid fa-wand-sparkles",
      contentClasses: ["standard-form"],
      resizable: true
    },
    position: { width: 760, height: 720 },
    actions: {
      switchTab: MagicShopConfigApp.#onSwitchTab,
      resetTable: MagicShopConfigApp.#onResetTable,
      removeEntry: MagicShopConfigApp.#onRemoveEntry,
      clearInventory: MagicShopConfigApp.#onClearInventory
    },
    form: {
      handler: MagicShopConfigApp.#onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    fields: { template: `modules/${MODULE_ID}/templates/magic-shop-config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** @type {object[]|null} Working copy of the inventory; null until the first prepare. */
  #inventory = null;

  /** @type {object|null} Working copy of the wealth table. */
  #table = null;

  #enabled = false;
  #tab = "table";
  #search = "";
  #rarity = "";

  /** @override */
  async _prepareContext() {
    if ( this.#inventory === null ) {
      const config = magicShopConfig();
      this.#enabled = config.enabled;
      this.#inventory = config.inventory;
      this.#table = config.wealthTable;
    }
    const rows = this.#inventory
      .map(entry => this.#rowContext(entry))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    const counts = countByRarity(this.#inventory);
    return {
      enabled: this.#enabled,
      tab: this.#tab,
      isTable: this.#tab === "table",
      isInventory: this.#tab === "inventory",
      rarities: RARITIES.map(r => ({ key: r, label: rarityLabel(r) })),
      bands: BANDS.map(band => {
        const row = this.#table[band.key];
        return {
          key: band.key,
          label: t("magicShopConfig.band", { level: band.from }),
          baseGp: row.baseGp,
          perD10Gp: row.perD10Gp,
          range: this.#rangeLabel(row),
          allowance: RARITIES.map(r => ({ key: r, value: row.allowance[r] }))
        };
      }),
      groups: groupCards(rows, key => {
        if ( key === "armor" ) return t("step.store.armorHeading");
        if ( key === "game" ) return t("step.store.gamingHeading");
        if ( key === "music" ) return t("step.store.instrumentHeading");
        return itemTypeLabel(key);
      }).map(g => ({ ...g, count: g.cards.length })),
      count: rows.length,
      hasRows: rows.length > 0,
      countsLine: this.#countsLine(counts),
      rarityOptions: RARITIES.filter(r => counts[r] > 0)
        .map(r => ({ value: r, label: rarityLabel(r), selected: r === this.#rarity })),
      search: this.#search,
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: t("magicShopConfig.save") }]
    };
  }

  /** One inventory row. Art and a missing-source flag come from the pack index, synchronously. */
  #rowContext(entry) {
    let resolved = null;
    try { resolved = fromUuidSync(linkUuid(entry.uuid)); } catch { resolved = null; }
    return {
      uuid: entry.uuid,
      link: linkUuid(entry.uuid),
      name: entry.name || entry.uuid,
      img: resolved?.img || "icons/svg/item-bag.svg",
      rarity: entry.rarity,
      rarityLabel: rarityLabel(entry.rarity),
      section: sectionKey(entry),
      broken: !resolved,
      hidden: entry.hidden,
      sourceLabel: this._sourceLabel(linkUuid(entry.uuid))
    };
  }

  #rangeLabel(row) {
    const { min, max } = goldRange(row);
    if ( !max ) return "—";
    return (min === max) ? t("magicShopConfig.rangeFixed", { gp: min }) : t("magicShopConfig.range", { min, max });
  }

  #countsLine(counts) {
    return RARITIES.filter(r => counts[r] > 0).map(r => `${counts[r]} ${rarityLabel(r)}`).join(" · ");
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    const search = root.querySelector("[data-inv-search]");
    if ( search ) {
      search.value = this.#search;
      search.addEventListener("input", () => { this.#search = search.value ?? ""; this.#applyFilter(); });
    }
    const rarity = root.querySelector("[data-inv-rarity]");
    if ( rarity ) {
      rarity.addEventListener("change", () => { this.#rarity = rarity.value ?? ""; this.#applyFilter(); });
    }
    // The gold range preview follows the inputs as the GM types, without a re-render.
    for ( const input of root.querySelectorAll("[data-band][data-field]") ) {
      input.addEventListener("input", () => this.#refreshRange(input.dataset.band));
    }
    this.#applyFilter();
  }

  /**
   * Client-side row filter. A search or rarity filter opens every section with a match and hides the
   * rest; clearing both collapses the sections back, so a 4000-row list isn't all open at once.
   */
  #applyFilter() {
    const needle = this.#search.trim().toLowerCase();
    const rarity = this.#rarity;
    const filtering = !!needle || !!rarity;
    for ( const group of this.element.querySelectorAll("[data-inv-group]") ) {
      let shown = 0;
      for ( const row of group.querySelectorAll("[data-uuid]") ) {
        const match = (!needle || (row.dataset.name ?? "").toLowerCase().includes(needle))
          && (!rarity || row.dataset.rarity === rarity);
        row.classList.toggle("is-hidden", !match);
        if ( match ) shown++;
      }
      group.classList.toggle("is-hidden", filtering && !shown);
      if ( filtering ) group.open = shown > 0;
    }
  }

  #refreshRange(bandKey) {
    const inputs = this.element.querySelectorAll(`[data-band="${bandKey}"]`);
    const row = { baseGp: 0, perD10Gp: 0 };
    for ( const input of inputs ) {
      if ( input.dataset.field in row ) row[input.dataset.field] = Math.max(0, Math.floor(Number(input.value) || 0));
    }
    const node = this.element.querySelector(`[data-band-range="${bandKey}"]`);
    if ( node ) node.textContent = this.#rangeLabel(row);
  }

  /** Pull the live inputs back into the working copies before any re-render or save. */
  #syncFormToWorkingCopy() {
    const form = this.element;
    const enabled = form.elements?.enabled;
    if ( enabled ) this.#enabled = !!enabled.checked;
    const table = structuredClone(this.#table);
    for ( const input of form.querySelectorAll("[data-band][data-field]") ) {
      const band = table[input.dataset.band];
      if ( !band ) continue;
      const field = input.dataset.field;
      if ( field.startsWith("allowance.") ) band.allowance[field.slice(10)] = input.value;
      else band[field] = input.value;
    }
    this.#table = sanitizeWealthTable(table);
    const byUuid = new Map(this.#inventory.map(e => [e.uuid, e]));
    for ( const box of form.querySelectorAll("[data-entry-hidden]") ) {
      const entry = byUuid.get(box.closest("[data-uuid]")?.dataset.uuid);
      if ( entry ) entry.hidden = box.checked;
    }
  }

  /** Show one tab without a re-render, so half-typed values stay put. */
  static #onSwitchTab(_event, target) {
    this.#showTab(target.dataset.tab);
  }

  #showTab(tab) {
    this.#tab = tab === "inventory" ? "inventory" : "table";
    for ( const el of this.element.querySelectorAll("[data-tab-panel]") ) {
      el.hidden = el.dataset.tabPanel !== this.#tab;
    }
    for ( const el of this.element.querySelectorAll("[data-action='switchTab']") ) {
      el.classList.toggle("active", el.dataset.tab === this.#tab);
      el.setAttribute("aria-selected", String(el.dataset.tab === this.#tab));
    }
  }

  /**
   * Stock whatever was dropped: an item, a folder (with all its subfolders) or a whole compendium.
   * @override
   */
  async _onDropData(data) {
    this.#syncFormToWorkingCopy();
    this.#showTab("inventory");
    if ( data.type === "Item" ) return this.#dropItem(data);
    if ( (data.type === "Folder") || (data.type === "Compendium") ) return this.#dropFolder(data);
    ui.notifications.warn(t("magicShopConfig.dropNotItem"));
  }

  async #dropItem(data) {
    const item = await Item.implementation.fromDropData(data).catch(() => null);
    if ( !item ) return void ui.notifications.warn(t("magicShopConfig.dropNotItem"));
    const verdict = (isTemplate(item) || isShell(item)) ? "ok" : stockability(item);
    if ( verdict === "notPhysical" ) return void ui.notifications.warn(t("magicShopConfig.dropNotPhysical", { name: item.name }));
    if ( verdict === "mundane" ) return void ui.notifications.warn(t("magicShopConfig.dropMundane", { name: item.name }));
    const uuid = item.uuid ?? data.uuid;
    if ( !uuid ) return;
    // A DMG template stands for every item its enchantments make, so it goes through the same
    // confirmation a folder does.
    if ( isTemplate(item) || isShell(item) ) return this.#confirmAndAdd(await droppedMagicItem(item));
    const result = mergeEntries(this.#inventory, [magicEntryFromItem(item, uuid)]);
    if ( result.duplicates ) return void ui.notifications.info(t("magicShopConfig.dropDuplicate", { name: item.name }));
    if ( result.overflow ) return void ui.notifications.warn(t("magicShopConfig.full", { max: MAX_INVENTORY }));
    this.#inventory = result.inventory;
    this.render();
  }

  async #dropFolder(data) {
    ui.notifications.info(t("magicShopConfig.reading"));
    const dropped = await droppedMagicItems(data).catch(err => {
      console.error(`${MODULE_ID} | reading a dropped folder failed`, err);
      return null;
    });
    if ( !dropped ) return void ui.notifications.warn(t("magicShopConfig.dropNotItemFolder"));
    return this.#confirmAndAdd(dropped);
  }

  /** Show what a drop would add, and add it on confirmation. */
  async #confirmAndAdd(dropped) {

    const preview = mergeEntries(this.#inventory, dropped.entries);
    if ( !preview.added.length ) {
      return void ui.notifications.warn(t("magicShopConfig.dropNothingNew", {
        name: dropped.name, duplicates: preview.duplicates, mundane: dropped.mundane
      }));
    }

    const counts = countByRarity(preview.added);
    const breakdown = RARITIES.filter(r => counts[r] > 0)
      .map(r => `<li><span class="cc-rarity-text rarity-${r}">${rarityLabel(r)}</span>: ${counts[r]}</li>`).join("");
    const skipped = [
      preview.duplicates && t("magicShopConfig.skippedDuplicates", { count: preview.duplicates }),
      dropped.mundane && t("magicShopConfig.skippedMundane", { count: dropped.mundane }),
      dropped.other && t("magicShopConfig.skippedOther", { count: dropped.other }),
      dropped.unbased && t("magicShopConfig.skippedUnbased", { count: dropped.unbased }),
      preview.overflow && t("magicShopConfig.skippedFull", { count: preview.overflow, max: MAX_INVENTORY })
    ].filter(Boolean);
    const esc = foundry.utils.escapeHTML ?? (s => s);
    const proceed = await this._confirm({
      title: t("magicShopConfig.dropFolderTitle"), icon: "fa-solid fa-folder-open",
      classes: ["sogrom-magic-shop-drop"],
      content: `<p>${t("magicShopConfig.dropFolderBody", { count: preview.added.length, name: esc(dropped.name) })}</p>
        ${dropped.templates ? `<p class="hint">${t("magicShopConfig.templatesExpanded", { count: dropped.templates })}</p>` : ""}
        ${dropped.shells ? `<p class="hint">${t("magicShopConfig.shellsExpanded", { count: dropped.shells })}</p>` : ""}
        <ul class="sogrom-magic-drop-breakdown">${breakdown}</ul>
        ${skipped.length ? `<p class="hint">${skipped.join(" · ")}</p>` : ""}`
    });
    if ( !proceed ) return;
    this.#syncFormToWorkingCopy();
    this.#inventory = mergeEntries(this.#inventory, dropped.entries).inventory;
    this.render();
  }

  /** Put the DMG's numbers back into the table (working copy only). */
  static async #onResetTable() {
    const proceed = await this._confirm({
      title: t("magicShopConfig.reset.title"), icon: "fa-solid fa-rotate-left",
      content: `<p>${t("magicShopConfig.reset.body")}</p>`
    });
    if ( !proceed ) return;
    this.#syncFormToWorkingCopy();
    this.#table = defaultWealthTable();
    this.render();
  }

  /** Remove one row in place — no re-render, which on a long list would cost a noticeable pause. */
  static #onRemoveEntry(_event, target) {
    const row = target.closest("[data-uuid]");
    const uuid = row?.dataset.uuid;
    if ( !uuid ) return;
    this.#syncFormToWorkingCopy();
    this.#inventory = this.#inventory.filter(e => e.uuid !== uuid);
    const group = row.closest("[data-inv-group]");
    row.remove();
    if ( group ) {
      const left = group.querySelectorAll("[data-uuid]").length;
      const count = group.querySelector("[data-group-count]");
      if ( count ) count.textContent = String(left);
      if ( !left ) group.remove();
    }
    const total = this.element.querySelector("[data-inv-count]");
    if ( total ) total.textContent = t("magicShopConfig.countLabel", { count: this.#inventory.length });
    const line = this.element.querySelector("[data-inv-counts]");
    if ( line ) line.textContent = this.#countsLine(countByRarity(this.#inventory));
  }

  static async #onClearInventory() {
    const proceed = await this._confirm({
      title: t("magicShopConfig.clear.title"), icon: "fa-solid fa-trash-can",
      content: `<p>${t("magicShopConfig.clear.body", { count: this.#inventory.length })}</p>`
    });
    if ( !proceed ) return;
    this.#syncFormToWorkingCopy();
    this.#inventory = [];
    this.render();
  }

  static async #onSubmit() {
    this.#syncFormToWorkingCopy();
    await game.settings.set(MODULE_ID, SETTINGS.magicShopEnabled, this.#enabled);
    await game.settings.set(MODULE_ID, SETTINGS.magicShopConfig, {
      inventory: this.#inventory.map(sanitizeMagicEntry).filter(e => e.uuid && e.rarity && PHYSICAL_TYPES.includes(e.type)),
      wealthTable: sanitizeWealthTable(this.#table)
    });
  }
}
