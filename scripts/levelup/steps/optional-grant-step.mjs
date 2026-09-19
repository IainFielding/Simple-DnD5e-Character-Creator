import { t, log } from "../../config.mjs";
import { atLevel, advancementHint } from "../levelup-state.mjs";
import { advancementTitle, grantItems, replacementGroups } from "../../data/advancement-util.mjs";

/**
 * Optional class features — the items an `ItemGrant` marks as declinable, and the base-or-alternative
 * pairs a replacement grant offers.
 *
 * Both shapes come from `dnd-tashas-cauldron`, which injects them into every 2014-rules class in the
 * world: *optional class features* as an ItemGrant with `configuration.optional`, and *replacement
 * features* as its own `TCOEReplacementGrant` type carrying a base→replacement map.
 *
 * The driver has already applied a default — everything for a plain optional grant (matching how
 * dnd5e's own manager pre-seeds the screen), the **base** of each pair for a replacement grant
 * (which is what "I did not take Tasha's alternative" means). So this block never blocks Next; it
 * exists so the player can say no, which without it they could not do at all.
 */
export const optionalGrantStep = {
  id: "optionalGrant",
  icon: "fa-solid fa-list-check",
  labelKey: "levelup.step.optionalGrant.label",
  template: "levelup/optional-grant",

  isCompleteAt() {
    // A default is always applied, so the block is satisfied on sight and never gates a level.
    return true;
  },

  async sectionsAt({ state, driver }, level) {
    const records = atLevel(state.optionalGrantSteps, level);
    if ( !records.length ) return null;
    const single = records.length === 1;

    const sections = await Promise.all(records.map(async record => {
      const st = driver.optionalGrantState(record);
      // A replacement grant's items are alternatives, so they are presented as groups of "this or
      // that" rather than as a flat list of independent tick-boxes.
      const groups = record.replacements ? buildGroups(record, st) : null;
      const items = await Promise.all(st.options.map(async o => ({
        uuid: o.uuid,
        selected: o.selected,
        ...(await itemCard(o.uuid))
      })));
      return {
        index: state.optionalGrantSteps.indexOf(record),
        title: advancementTitle(record.advancement) || record.item?.name || t("levelup.step.optionalGrant.label"),
        hint: await advancementHint(record),
        prompt: t(groups ? "levelup.step.optionalGrant.promptReplace" : "levelup.step.optionalGrant.prompt"),
        items: groups ? null : items,
        groups: groups ? await decorateGroups(groups) : null,
        collapsed: single
      };
    }));
    return { blockLabel: single ? sections[0].title : null, sections };
  },

  async handle(action, el, { state, driver }) {
    const record = state.optionalGrantSteps[Number(el.dataset.index)];
    if ( !record ) return;
    const st = driver.optionalGrantState(record);
    const uuid = el.dataset.uuid;
    if ( !uuid ) return;

    if ( action === "optionalGrantToggle" ) {
      // Independent items: flip just this one.
      const next = st.options.filter(o => (o.uuid === uuid) ? !o.selected : o.selected).map(o => o.uuid);
      await driver.setOptionalGrant(record, next);
      return;
    }
    if ( action === "optionalGrantPick" ) {
      // One of a base/alternative pair: take this side of the group and drop the other members,
      // leaving every item outside the group exactly as it was.
      const group = (el.dataset.group ?? "").split("|").filter(Boolean);
      const next = st.options
        .filter(o => group.includes(o.uuid) ? (o.uuid === uuid) : o.selected)
        .map(o => o.uuid);
      await driver.setOptionalGrant(record, next);
    }
  }
};

/* -------------------------------------------- */

/**
 * Group a replacement grant's items into base-and-alternatives sets — see {@link replacementGroups},
 * shared with the creation checklist so the two screens agree on what counts as a pair. A group is
 * exclusive: the handler above takes one member and drops the rest.
 */
function buildGroups(record, state) {
  const { groups, unattributed } = replacementGroups(record.replacements, grantItems(record.advancement));
  if ( unattributed.length ) {
    log(`replacement grant "${advancementTitle(record.advancement) || record.advancement.id}" has ${groups.length} bases `
      + `and ${unattributed.length} unattributable alternatives; leaving them out rather than sharing them`);
  }
  const selected = new Set(state.options.filter(o => o.selected).map(o => o.uuid));
  return groups.map(({ members }) => ({
    members,
    options: members.map(uuid => ({ uuid, selected: selected.has(uuid) }))
  }));
}

/** Resolve each group member to a rendered card. */
async function decorateGroups(groups) {
  return Promise.all(groups.map(async g => ({
    members: g.members.join("|"),
    options: await Promise.all(g.options.map(async o => ({ ...o, ...(await itemCard(o.uuid)) })))
  })));
}

/** Name and image for an item uuid, tolerating one that no longer resolves. */
async function itemCard(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  return { name: doc?.name ?? uuid, img: doc?.img ?? null };
}
