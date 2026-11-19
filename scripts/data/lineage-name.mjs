import { MODULE_ID, t, log } from "../config.mjs";

/**
 * How a species and its lineage are named together — "Elf (Drow)", "Goliath (Cloud Giant)" — on the
 * Species page's cards and, once built, on the character's species item.
 *
 * The built item is not renamed. An `enchantment` effect on it overrides its name (dnd5e substitutes
 * the item's own name for `{}`, the way a "+1" weapon is named) and, where the lineage has real art,
 * its image. The stored item stays the compendium's, so Update to New Content still recognises it,
 * and deleting the effect from the item's Effects tab puts the plain species back.
 *
 * Nothing here names a species or a lineage.
 */

/** The flag marking the enchantment as ours, holding the lineage's uuid. */
export const LINEAGE_FLAG = "lineageName";

/**
 * The part of a lineage's name the species is qualified by. A lineage whose name ends in brackets
 * keeps only the bracketed part — the Goliath's "Cloud's Jaunt (Cloud Giant)" is the Cloud Giant
 * ancestry — so it reads "Goliath (Cloud Giant)" rather than nesting brackets.
 * @param {string} label
 * @returns {string}
 */
export function lineageShortName(label) {
  const match = /\(([^()]+)\)\s*$/.exec(String(label ?? ""));
  return match ? match[1].trim() : String(label ?? "");
}

/**
 * "Elf (Drow)": a species qualified by its lineage.
 * @param {string} species   The species' name — or `{}`, for dnd5e's name substitution.
 * @param {string} lineage   The lineage's own name.
 * @returns {string}
 */
export function lineageCardName(species, lineage) {
  return t("step.species.lineage.card", { species, lineage: lineageShortName(lineage) });
}

/**
 * A lineage's image, when it is art rather than one of Foundry's generic icons. The Player's
 * Handbook paints its Drow and Forest Gnome; most other lineages carry a core icon (`icons/…`), which
 * would be a poor swap for the species' own portrait.
 * @param {string|null|undefined} img
 * @returns {string|null}
 */
export function lineageArt(img) {
  return (img && !String(img).startsWith("icons/")) ? img : null;
}

/**
 * The enchantment that names a species item for its lineage.
 * @param {{label: string, uuid?: string, img?: string}} lineage   The chosen lineage option.
 * @param {string} [origin]   The built lineage item's uuid, recorded as where the effect came from.
 * @returns {object}          ActiveEffect data.
 */
export function lineageEnchantment(lineage, origin = null) {
  const art = lineageArt(lineage.img);
  const change = (key, value) => ({ key, value, type: "override", phase: "initial", priority: null });
  return {
    name: lineageShortName(lineage.label),
    img: lineage.img || "icons/svg/aura.svg",
    type: "enchantment",
    transfer: true,
    disabled: false,
    ...(origin ? { origin } : {}),
    flags: { [MODULE_ID]: { [LINEAGE_FLAG]: lineage.uuid ?? true } },
    system: {
      // Not magic: an antimagic field must not turn a Drow back into a plain Elf.
      magical: false,
      changes: [
        change("name", lineageCardName("{}", lineage.label)),
        ...(art ? [change("img", art)] : [])
      ]
    }
  };
}

/**
 * Name a freshly built character's species item for the lineage chosen on the Species page.
 * A no-op when the species has no lineage, or the item already carries the enchantment.
 * @param {Actor} actor
 * @param {{sources?: object[]}} resolved   The choice-resolver output the build was made from.
 */
export async function nameSpeciesForLineage(actor, resolved) {
  const species = actor?.items?.find(i => i.type === "race");
  if ( !species ) return;
  if ( species.effects.some(e => e.flags?.[MODULE_ID]?.[LINEAGE_FLAG]) ) return;
  const pick = (resolved?.sources ?? [])
    .filter(s => s.key === "species")
    .flatMap(s => s.requirements ?? [])
    .filter(r => r.lineage)
    .flatMap(r => r.options ?? [])
    .find(o => o.isSelected);
  if ( !pick ) return;
  const built = actor.items.find(i => i._stats?.compendiumSource === (pick.uuid ?? pick.key));
  try {
    await species.createEmbeddedDocuments("ActiveEffect", [lineageEnchantment(pick, built?.uuid ?? null)], { render: false });
  } catch ( err ) {
    log(`could not name ${species.name} for its lineage`, err);
  }
}
