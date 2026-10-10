/**
 * Small, dependency-free readers for the keys content is matched on: a name folded into a slug,
 * and the package a compendium document came from. Several modules need each; one copy keeps them
 * from drifting apart, as two copies of `packageOf` already had.
 */

/**
 * Fold a display name or identifier into a lookup slug: lowercase, curly and straight apostrophes
 * dropped, every other run of non-alphanumerics collapsed to one hyphen. A fair amount of content
 * ships without a `system.identifier` (every Ravenloft lineage does), so a name has to be usable as
 * the fallback key: "Elf, Drow" → "elf-drow".
 * @param {string} [value]
 * @returns {string}
 */
export function slugify(value) {
  return String(value ?? "").trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The package a compendium document belongs to, read off its UUID.
 *
 * A compendium uuid is `Compendium.<package>.<pack>.<DocType>.<id>`, so the package id is the
 * second segment. Anything that is not a compendium uuid — a world item, an empty string — returns
 * null rather than whatever its second segment happens to be (a world item's would be its own id).
 * @param {string} [uuid]
 * @returns {string|null}
 */
export function packageOf(uuid) {
  const parts = String(uuid ?? "").split(".");
  if ( parts[0] !== "Compendium" || parts.length < 3 ) return null;
  return parts[1] || null;
}
