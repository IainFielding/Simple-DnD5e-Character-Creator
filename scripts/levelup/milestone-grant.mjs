import { MODULE_ID, tpl, t, log, levelUpEnabled } from "../config.mjs";
import { MILESTONE_FLAG, usesMilestones, nextGrantTarget } from "./milestone.mjs";
import { noticeRecipients } from "./xp-notice.mjs";

/**
 * The GM's side of milestone levelling: granting a level to one character or several.
 *
 * Granting raises the character's milestone mark (see {@link module:levelup/milestone}) and whispers
 * them the same ready card the XP watcher posts, with its Level Up button. Nothing is levelled here;
 * the player still takes the level through the ordinary flow, whenever they like.
 *
 * Offered only to a GM, only while the world levels by milestone and the level-up flow is on. An XP
 * world already has dnd5e's own Award dialog, and its XP is what our ready card watches.
 */

/**
 * Whether the milestone tools are offered to this user at all.
 * @returns {boolean}
 */
export function milestonesOffered() {
  return !!game.user?.isGM && levelUpEnabled() && usesMilestones();
}

/**
 * Whether this character can be granted a level: a character with a class, below the level cap
 * once any grant already waiting is counted.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function canGrantLevel(actor) {
  if ( actor?.type !== "character" ) return false;
  if ( !actor.items?.some(i => i.type === "class") ) return false;
  return nextGrantTarget(actor) !== null;
}

/**
 * Grant each character one more level and tell their owners. A character that cannot take one is
 * skipped rather than failing the rest.
 * @param {Actor5e[]} actors
 * @returns {Promise<Actor5e[]>}  The characters granted a level.
 */
export async function grantLevels(actors) {
  const granted = [];
  for ( const actor of actors ) {
    const target = canGrantLevel(actor) ? nextGrantTarget(actor) : null;
    if ( target === null ) continue;
    try {
      await actor.setFlag(MODULE_ID, MILESTONE_FLAG, target);
      granted.push(actor);
      await postGrantCard(actor, target);
    } catch ( err ) {
      log("could not grant a level", actor.name, err);
    }
  }
  if ( granted.length ) {
    ui.notifications?.info(t("milestone.granted", { names: granted.map(a => a.name).join(", ") }));
  }
  return granted;
}

/**
 * Whisper the ready card to the character's owners and the GM. Always to the owners, whatever the
 * XP notice is set to: the grant is the GM telling the player, and a card the player never sees
 * would tell them nothing.
 * @param {Actor5e} actor
 * @param {number} target  The level granted up to.
 */
async function postGrantCard(actor, target) {
  const render = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  if ( typeof render !== "function" ) return;
  const content = await render(tpl("chat/levelup-ready.hbs"), {
    actorId: actor.id,
    name: actor.name,
    img: actor.img,
    eyebrow: t("chat.levelGranted.eyebrow"),
    sub: t("chat.levelGranted.sub", { level: target }),
    label: t("chat.levelUpReady.button")
  });
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: noticeRecipients(actor, "public"),
    flags: { [MODULE_ID]: { summary: "levelGranted" } }
  });
}

/**
 * The rows of the batch dialog: every character that can be granted a level, ticked when it is in
 * `preselect`. Player-owned characters first, then by name.
 * @param {Iterable<Actor5e>} actors
 * @param {Set<string>} preselect  Actor ids to tick.
 * @returns {{id: string, name: string, img: string, levelLine: string, checked: boolean}[]}
 */
export function grantRows(actors, preselect) {
  return [...actors].filter(canGrantLevel)
    .sort((a, b) => (Number(!!b.hasPlayerOwner) - Number(!!a.hasPlayerOwner)) || a.name.localeCompare(b.name))
    .map(actor => ({
      id: actor.id,
      name: actor.name,
      img: actor.img,
      levelLine: t("milestone.levelLine", {
        level: actor.system?.details?.level ?? 0, target: nextGrantTarget(actor)
      }),
      checked: preselect.has(actor.id)
    }));
}

/**
 * The characters the batch dialog lists, and which of them start ticked. From a group actor: that
 * group's characters only, all ticked. From the Actors sidebar header: every character, with the
 * primary party's ticked, or every player-owned one when there is no party.
 * @param {Actor5e|null} group  The group it was opened from.
 * @returns {{characters: Actor5e[], preselect: Set<string>}}
 */
export function grantCandidates(group) {
  if ( group ) {
    const members = group.system?.playerCharacters ?? [];
    return { characters: members, preselect: new Set(members.map(a => a.id)) };
  }
  const characters = game.actors?.filter(a => a.type === "character") ?? [];
  const party = game.actors?.party?.system?.playerCharacters ?? [];
  const ticked = party.length ? party : characters.filter(a => a.hasPlayerOwner);
  return { characters, preselect: new Set(ticked.map(a => a.id)) };
}

/**
 * The batch dialog: tick the characters to grant a level to (see {@link grantCandidates}).
 * @param {object} [options]
 * @param {Actor5e} [options.group]  The group it was opened from.
 * @returns {Promise<Actor5e[]>}  The characters granted a level; empty when cancelled.
 */
export async function promptGrantLevels({ group = null } = {}) {
  const { characters, preselect } = grantCandidates(group);
  const rows = grantRows(characters, preselect);
  if ( !rows.length ) {
    ui.notifications?.info(t("milestone.none"));
    return [];
  }

  const render = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
  const content = await render(tpl("grant-levels.hbs"), { intro: t("milestone.prompt"), rows });
  const { DialogV2 } = foundry.applications.api;
  const ids = await DialogV2.wait({
    window: { title: t("milestone.dialogTitle"), icon: "fa-solid fa-arrow-up-right-dots" },
    classes: ["sogrom-grant-dialog"],
    content,
    buttons: [
      {
        action: "grant", label: t("milestone.grantButton"), icon: "fa-solid fa-arrow-up-right-dots", default: true,
        callback: (_event, button) => [...button.form.querySelectorAll("input[type=checkbox]:checked")].map(i => i.name)
      },
      { action: "cancel", label: t("milestone.cancel") }
    ],
    rejectClose: false
  });
  if ( !Array.isArray(ids) || !ids.length ) return [];
  return grantLevels(ids.map(id => game.actors.get(id)).filter(Boolean));
}

/**
 * The GM's entry points: "Grant a level" on a character and "Grant levels" on a group in the Actors
 * right-click menu, and a "Grant Levels" button in the sidebar header.
 *
 * The menu entries are registered when the module loads, not at `ready`: Foundry builds the
 * directory's context menu once, before `ready` fires (see {@link registerBlankBuildMenu}). Their
 * `visible` checks run on every right-click, so the gates are still evaluated live.
 */
export function registerMilestoneGrants() {
  const actorOf = li => game.actors?.get(li.dataset?.entryId ?? li.dataset?.documentId);

  Hooks.on("getActorContextOptions", (_directory, options) => {
    if ( game.system?.id !== "dnd5e" ) return;
    options.push({
      label: t("milestone.grantOne"),
      icon: "fa-solid fa-arrow-up-right-dots",
      visible: li => milestonesOffered() && canGrantLevel(actorOf(li)),
      onClick: (_event, li) => {
        const actor = actorOf(li);
        if ( actor ) grantLevels([actor]);
      }
    });
    options.push({
      label: t("milestone.grantGroup"),
      icon: "fa-solid fa-arrow-up-right-dots",
      visible: li => milestonesOffered() && (actorOf(li)?.type === "group"),
      onClick: (_event, li) => {
        const group = actorOf(li);
        if ( group ) promptGrantLevels({ group });
      }
    });
  });

  Hooks.on("renderActorDirectory", (_app, html) => {
    if ( (game.system?.id !== "dnd5e") || !milestonesOffered() ) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if ( !root || root.querySelector(".sogrom-grant-levels") ) return;
    const container = root.querySelector(".header-actions")
      ?? root.querySelector(".directory-header .action-buttons")
      ?? root.querySelector(".directory-header");
    if ( !container ) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sogrom-grant-levels";
    button.innerHTML = `<i class="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i> ${t("milestone.headerButton")}`;
    button.addEventListener("click", ev => { ev.preventDefault(); promptGrantLevels(); });
    container.appendChild(button);
  });
}
