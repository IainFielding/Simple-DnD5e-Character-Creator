import { t } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * What the GM's two stocking windows — the Store ({@link module:app/store-config}) and the Magic
 * Item Shop ({@link module:app/magic-shop-config}) — share: the whole window is a drop zone, each row
 * names the book it came from, and the destructive buttons ask first.
 *
 * Only the mechanics live here. What a drop *means* differs completely — the Store takes one priced
 * piece of gear, the Magic Item Shop a single item, a folder or a whole compendium — so a subclass
 * receives the parsed drag payload in {@link InventoryConfigApp#_onDropData} and decides.
 *
 * `DEFAULT_OPTIONS` and `PARTS` stay on each subclass, in full, for the same reason the shells keep
 * their own actions: nothing here depends on ApplicationV2 merging static options up the chain.
 */
export class InventoryConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Whether the root drag-and-drop listeners are attached (the form element persists). */
  #dndWired = false;

  /**
   * The form element persists across re-renders, so the drop zone is wired once; the part content
   * inside it is rebuilt every render, which is the subclass's to wire.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if ( this.#dndWired ) return;
    this.#dndWired = true;
    const root = this.element;
    root.addEventListener("dragover", ev => { ev.preventDefault(); root.classList.add("is-dragover"); });
    root.addEventListener("dragleave", ev => {
      if ( ev.relatedTarget && root.contains(ev.relatedTarget) ) return;
      root.classList.remove("is-dragover");
    });
    root.addEventListener("drop", ev => this.#onDrop(ev));
  }

  async #onDrop(event) {
    event.preventDefault();
    this.element.classList.remove("is-dragover");
    let data = null;
    try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event); } catch { data = null; }
    if ( !data?.type ) return;
    return this._onDropData(data);
  }

  /**
   * Handle a parsed drag payload dropped anywhere on the window.
   * @param {object} _data   Foundry's drag data; `type` is always present.
   * @returns {Promise<void>|void}
   * @abstract
   */
  _onDropData(_data) {}

  /**
   * Where a row's item lives, for the badge under its name: the pack's title, or the world.
   * @param {string} uuid   A document uuid, in its linkable form.
   * @returns {string}
   */
  _sourceLabel(uuid) {
    if ( uuid.startsWith("Compendium.") ) {
      const [, pkg, packName] = uuid.split(".");
      return game.packs.get(`${pkg}.${packName}`)?.title ?? `${pkg}.${packName}`;
    }
    return t("storeConfig.worldSource");
  }

  /**
   * Ask before a destructive change to the working copy. Closing the prompt counts as No.
   * @param {{title: string, icon: string, content: string, classes?: string[]}} prompt
   * @returns {Promise<boolean>}
   */
  async _confirm({ title, icon, content, classes }) {
    // `classes` only when given: an explicit undefined would merge over the dialog's own list.
    return !!await DialogV2.confirm({
      window: { title, icon }, content, rejectClose: false, ...(classes ? { classes } : {})
    });
  }
}
