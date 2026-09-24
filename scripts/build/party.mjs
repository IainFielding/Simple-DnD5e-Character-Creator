import { t, log } from "../config.mjs";

/**
 * Adding a finished character to dnd5e's primary party (`game.actors.party`).
 *
 * Two front doors share this: the creation Review page's "Add to {party}" switch, for someone who
 * owns the party and is building the character themselves, and the button on the creation chat
 * card (see {@link module:build/chat-summary}), for a party owner — usually the GM — adding a
 * character somebody else built.
 *
 * Both are gated on the same thing: ownership of the party actor. Adding a member is an ordinary
 * update to that actor, so ownership is exactly the permission it needs; a GM always has it.
 */

/**
 * The primary party, if there is one and the current user may add to it.
 * @returns {Actor5e|null}
 */
export function editableParty() {
  const party = game.actors?.party ?? null;
  return party?.isOwner ? party : null;
}

/**
 * The Review page's switch, or null when this user has no party to add to.
 * @param {boolean} active  Whether the switch is on.
 * @returns {{active: boolean, label: string, note: string}|null}
 */
export function partyJoinContext(active) {
  const party = editableParty();
  if ( !party ) return null;
  return {
    active: !!active,
    label: t("party.join", { party: party.name }),
    note: t("party.joinNote")
  };
}

/**
 * Add a character to the primary party. Never throws: a character that was built must not look
 * failed because the party update didn't land, so a failure is a notification and a log line.
 * @param {Actor5e|null} actor
 * @returns {Promise<boolean>}  Whether the character is now a member.
 */
export async function addToParty(actor) {
  const party = editableParty();
  if ( !party || !actor ) return false;
  try {
    await party.system.addMember(actor);
    return true;
  } catch ( err ) {
    log("could not add the character to the party", err);
    ui.notifications?.error(t("party.failed", { party: party.name }));
    return false;
  }
}
