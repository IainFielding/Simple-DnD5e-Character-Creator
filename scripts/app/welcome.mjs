import { MODULE_ID, SETTINGS, tpl, t, log, creationEnabled, levelUpEnabled } from "../config.mjs";

/**
 * The GM's welcome card, and a "what's new" card after an update that adds features.
 *
 * Whispered to every GM, once per world: the first time the module loads it says where everything
 * lives and which settings are worth a look; after a release that adds features it lists them; a
 * patch release says nothing. A world setting turns both off.
 *
 * Which release last added features is {@link WHATS_NEW}'s last entry, not the module's own version:
 * a patch must stay silent, and a development build's manifest carries a build placeholder rather
 * than a version. The world remembers the last entry it announced.
 */

/**
 * The releases that added something a GM should hear about, oldest first. Add an entry when a
 * feature release ships; a patch release adds nothing. Each line is a literal `t()` call so the
 * lang-key guard sees it.
 * @type {{version: string, lines: () => string[]}[]}
 */
export const WHATS_NEW = [
  {
    version: "3.4.0",
    lines: () => [
      t("welcome.new.milestones"),
      t("welcome.new.check"),
      t("welcome.new.cards")
    ]
  }
];

/**
 * Whether `a` is a later version than `b`, compared segment by segment as numbers.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function newerThan(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for ( let i = 0; i < Math.max(pa.length, pb.length); i++ ) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if ( x !== y ) return x > y;
  }
  return false;
}

/**
 * Which card is due, given the release this world last announced.
 * @param {string} seen  The last announced version; empty when the world has never had a card.
 * @param {typeof WHATS_NEW} [entries]
 * @returns {{kind: "welcome", version: string}|{kind: "whatsNew", version: string, entries: typeof WHATS_NEW}|null}
 */
export function cardDue(seen, entries = WHATS_NEW) {
  const latest = entries.at(-1)?.version;
  if ( !latest ) return null;
  if ( !seen ) return { kind: "welcome", version: latest };
  const fresh = entries.filter(e => newerThan(e.version, seen));
  return fresh.length ? { kind: "whatsNew", version: latest, entries: fresh } : null;
}

/**
 * Where to find things, for the welcome card: only what this world actually offers, so an Ember
 * world (level-up only) is not told about a creator it doesn't have.
 * @returns {string[]}
 */
function placesToFind() {
  const out = [];
  if ( creationEnabled() ) out.push(t("welcome.place.create"));
  if ( levelUpEnabled() ) {
    out.push(t("welcome.place.levelUp"), t("welcome.place.repair"), t("welcome.place.check"), t("welcome.place.grant"));
  }
  return out;
}

/**
 * The settings windows worth opening first, as card buttons keyed by their registered menu.
 * @returns {{menu: string, label: string, icon: string}[]}
 */
function settingsButtons() {
  const out = [{ menu: "houseRulesMenu", label: t("settings.houseRulesMenu.name"), icon: "fa-solid fa-scale-balanced" }];
  if ( levelUpEnabled() ) {
    out.push({ menu: "levelUpOptionsMenu", label: t("settings.levelUpOptionsMenu.name"), icon: "fa-solid fa-trophy-star" });
  }
  if ( creationEnabled() ) {
    out.push({ menu: "storeConfigMenu", label: t("settings.storeConfigMenu.name"), icon: "fa-solid fa-store" });
  }
  out.push({ menu: "magicShopConfigMenu", label: t("settings.magicShopConfigMenu.name"), icon: "fa-solid fa-wand-sparkles" });
  return out;
}

/**
 * Post whichever card is due, from the one active GM's client, whispered to every GM. The announced
 * version is recorded *before* the post, so a card that fails to render is not retried on every load.
 */
export async function postWelcomeIfDue() {
  try {
    if ( !game.user?.isActiveGM ) return;
    if ( !game.settings.get(MODULE_ID, SETTINGS.welcomeCards) ) return;
    const due = cardDue(game.settings.get(MODULE_ID, SETTINGS.welcomeVersion) ?? "");
    if ( !due ) return;
    await game.settings.set(MODULE_ID, SETTINGS.welcomeVersion, due.version);

    const module = game.modules.get(MODULE_ID);
    const context = due.kind === "welcome"
      ? {
        heading: t("welcome.heading"),
        intro: t("welcome.intro"),
        places: placesToFind(),
        newTitle: t("welcome.newTitle", { version: due.version }),
        newLines: WHATS_NEW.at(-1).lines()
      }
      : {
        heading: t("welcome.whatsNewHeading", { version: due.version }),
        newLines: due.entries.flatMap(e => e.lines())
      };
    const render = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    const content = await render(tpl("chat/welcome.hbs"), {
      ...context,
      eyebrow: module?.title ?? "",
      settingsTitle: t("welcome.settingsTitle"),
      buttons: settingsButtons(),
      readme: module?.readme ?? "",
      guide: t("welcome.guide"),
      optOut: t("welcome.optOut")
    });
    await ChatMessage.create({
      content,
      speaker: { alias: module?.title ?? MODULE_ID },
      whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
      flags: { [MODULE_ID]: { summary: due.kind } }
    });
  } catch ( err ) {
    log("could not post the welcome card", err);
  }
}

/**
 * The card's settings buttons: each opens the settings window its menu registered.
 *
 * One delegated listener on the document, registered when the module loads, rather than a listener
 * bound per render through `dnd5e.renderChatMessage`. The chat log renders its messages before
 * `ready`, so a card already in the log when the world loads never passed through a hook registered
 * there, and its buttons did nothing. Delegation also covers a popped-out chat log and any later
 * re-render, and the selector is our own attribute, so no other card is touched.
 */
export function registerWelcomeButtons() {
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("[data-sogrom-settings-menu]");
    if ( !button ) return;
    event.preventDefault();
    const menu = game.settings?.menus?.get(`${MODULE_ID}.${button.dataset.sogromSettingsMenu}`);
    if ( !menu || (menu.restricted && !game.user?.isGM) ) return;
    new menu.type().render({ force: true });
  });
}
