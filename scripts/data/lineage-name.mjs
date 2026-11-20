import { MODULE_ID, t, log } from "../config.mjs";

/**
 * How a species and its lineage are named together — "Elf (Drow)", "Goliath (Cloud Giant)" — on the
 * Species page's cards and, once built, on the character's species item.
 *
 * The built item is renamed outright, and takes the lineage's image where the lineage has real art.
 * (An enchantment would have kept the stored name, but dnd5e offers no way to manage an enchantment
 * on a species item, so the player could neither see nor remove it.) A flag records the lineage and
 * the compendium name and image. Nothing else is touched: the item keeps its compendium source, so
 * Update to New Content still finds it, and a content refresh always keeps an item's name and icon.
 *
 * Nothing here names a species or a lineage.
 */

/** The flag on a renamed species item: `{uuid, name, img}`, the lineage and the name and image it replaced. */
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
 * @param {string} species   The species' name.
 * @param {string} lineage   The lineage's own name.
 * @returns {string}
 */
export function lineageCardName(species, lineage) {
  return t("step.species.lineage.card", { species, lineage: lineageShortName(lineage) });
}

/**
 * A lineage's image, when it is art rather than one of Foundry's generic icons. The Player's
 * Handbook paints its Drow and Forest Gnome; most other lineages carry a core icon (`icons/…`), which
 * would be a poor swap for the species' own portrait. dnd5e's own stock images (`systems/dnd5e/icons/…`,
 * its default item placeholders among them) are icons in the same sense, for content that uses them.
 * @param {string|null|undefined} img
 * @returns {string|null}
 */
export function lineageArt(img) {
  const path = String(img ?? "");
  return (path && !GENERIC_ICONS.some(prefix => path.startsWith(prefix))) ? path : null;
}

/** Image folders that hold generic icons rather than a lineage's own art. */
const GENERIC_ICONS = ["icons/", "systems/dnd5e/icons/"];

/**
 * The update that names a species item for its lineage.
 * @param {{name: string, img?: string}} species                   The species item (or its data).
 * @param {{label: string, uuid?: string, img?: string}} lineage   The chosen lineage option.
 * @returns {object}   Item update data.
 */
export function lineageRename(species, lineage) {
  const art = lineageArt(lineage.img);
  return {
    name: lineageCardName(species.name, lineage.label),
    ...(art ? { img: art } : {}),
    [`flags.${MODULE_ID}.${LINEAGE_FLAG}`]: {
      uuid: lineage.uuid ?? null,
      name: species.name,
      img: species.img ?? null
    }
  };
}

/**
 * Name a freshly built character's species item for the lineage chosen on the Species page.
 * A no-op when the species has no lineage, or the item has already been named for one.
 * @param {Actor} actor
 * @param {{sources?: object[]}} resolved   The choice-resolver output the build was made from.
 */
export async function nameSpeciesForLineage(actor, resolved) {
  const species = actor?.items?.find(i => i.type === "race");
  if ( !species ) return;
  if ( species.getFlag?.(MODULE_ID, LINEAGE_FLAG) ?? species.flags?.[MODULE_ID]?.[LINEAGE_FLAG] ) return;
  const pick = (resolved?.sources ?? [])
    .filter(s => s.key === "species")
    .flatMap(s => s.requirements ?? [])
    .filter(r => r.lineage)
    .flatMap(r => r.options ?? [])
    .find(o => o.isSelected);
  if ( !pick ) return;
  try {
    await species.update(lineageRename(species, pick), { render: false });
  } catch ( err ) {
    log(`could not name ${species.name} for its lineage`, err);
  }
}

/**
 * The lineage option the player holds for their species, or null: read from the resolved choices
 * (`state.choiceCache`) and matched against the picks themselves, so a cache resolved before the
 * pick still finds it. The option carries its `selKey` and `source`, the decision it answers.
 * @param {object} state   A CreatorState.
 * @returns {{key: string, uuid: string, label: string, identifier?: string, selKey: string, source: string}|null}
 */
export function chosenLineage(state) {
  const reqs = (state?.choiceCache?.sources ?? [])
    .filter(s => s.key === "species")
    .flatMap(s => s.requirements ?? [])
    .filter(r => r.lineage);
  for ( const req of reqs ) {
    const picks = Array.from(state.advChoices?.[req.source ?? "species"]?.[req.selKey] ?? [])
      .map(k => (typeof k === "string" ? k : k?.uuid));
    const option = (req.options ?? []).find(o => picks.includes(o.key));
    if ( option ) return option;
  }
  return null;
}
