/**
 * A button in the Actors directory's header — the creator's launch button and the GM's "Grant
 * Levels" both live there.
 *
 * The header's markup differs between Foundry and dnd5e versions, so the first container that
 * exists wins. The render hook fires on every directory render, so a button already present (by its
 * class) is not added twice.
 * @param {HTMLElement|null} root   The rendered directory element.
 * @param {object} options
 * @param {string} options.cls      The button's class, also its "already added" marker.
 * @param {string} options.icon     Font Awesome classes for its icon.
 * @param {string} options.label    Its text, already localised.
 * @param {() => void} options.onClick
 * @returns {HTMLButtonElement|null} The button added, or null when it was already there or the
 *   header could not be found.
 */
export function addDirectoryButton(root, { cls, icon, label, onClick }) {
  if ( !root || root.querySelector(`.${cls}`) ) return null;
  const container = root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header .action-buttons")
    ?? root.querySelector(".directory-header");
  if ( !container ) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = cls;
  button.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${label}`;
  button.addEventListener("click", event => { event.preventDefault(); onClick(); });
  container.appendChild(button);
  return button;
}
