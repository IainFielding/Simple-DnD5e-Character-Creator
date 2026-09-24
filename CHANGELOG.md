# Changelog

All notable changes to the Simple D&D Character Creator.

## 3.3.0

### New

- **Build into a blank character.** Tables that don't let players create actors can still use the
  creator. The GM makes an empty character and gives the player ownership of it, and the sheet
  gets a **Build Character** button (the gold hammer, also in the sheet's ⋯ menu and the Actors
  sidebar's right-click menu). The creator builds straight into that sheet, so the character keeps its
  folder and permissions. Anything else the GM left on the sheet, such as starting gold, stays. A
  ready-made character fills the sheet the same way. The button only appears on a character with no
  class, species or background.
- **Add to the party.** If your world has a primary party and you own it, the review screen has an
  **Add to [party]** tick box beside the PDF export, and the character joins as soon as it's created.
  The creation chat card also has an **Add to [party]** button for anyone who owns the party, so a
  GM can add a character a player built. Both are hidden from anyone who can't change the party.
- **Suggest for [class].** Once you've picked a class, one click arranges your ability scores in the
  order that class relies on, the same order Quick Build uses. It works with point buy, the standard
  array and a set you've already rolled.
- **Class guide.** Every class in the list shows a one-line summary of what it does and a rating of
  how much there is to keep track of, from one dot to three. The ratings are the 2024 Player's
  Handbook's own. The Artificer, which the book doesn't rate, is rated high.
- **The Level Up button lights up when it's time.** Once a character has the XP for their next
  level, the Level Up button on their sheet gets a glowing golden outline. The button still shows
  whenever the character can level. In a milestone world it never lights, because there's no XP
  to reach.
- **Maximum only hit points.** A fourth choice for the level-up hit points setting: every level
  gained takes the full hit die, applied automatically, including the levels Quick Build climbs
  for you. The default is still Player's choice.

### Improved

- **Chat card buttons wait for dnd5e.** The Add to party and Level Up buttons on this module's chat
  cards are now attached after the D&D system has finished preparing each card, using the system's
  own `dnd5e.renderChatMessage` hook.
- **Complexity dots sit under the class icon** in the class list, leaving the summary line the whole
  width of the row.
- **Right-click entries use Foundry v14's menu format.** The Level Up, Repair and Build Character
  entries no longer trigger v14's deprecation warnings, and keep working when v16 drops the old format.

### Fixed

- **Players see the book artwork too.** The class, species and background art on the Quick screen
  and the entry chooser found its images by listing the art folders, which Foundry only allows for
  users with the "Use File Browser" permission. Most players don't have it, so they saw plain icons
  where the GM saw the Player's Handbook's paintings. Players now get the same artwork. The same
  change covers hosts such as The Forge, where the folder listing can come back empty for a GM too
  and module files may be served from another domain: the art is now found either way.
- **The Quick screen keeps the name you type.** A name typed into the Quick screen's name box never
  reached the character. The box only noticed its contents when clicked, and Create then rolled a
  new name anyway. The character is now created with the name in the box.
- **A failed build into an existing character is undone.** If a build stopped part-way, anything it
  had added to the sheet is removed, so trying again doesn't give the character two classes.

### Compatibility

- Verified against **dnd5e 6.0.5** on Foundry **14.368**: 135 of 135 subclasses built identically to
  the system's own advancement, levels 1 to 20.

## 3.2.0 — Quick Build & Ready-Made Characters

### New

- **Three ways in.** The creator now opens by asking how you want to build: **step by step** (the
  full wizard, unchanged), **Quick Build**, or a **ready-made character**. All three finish on the
  same review screen, and nothing any of them chooses is locked — every pick is still yours to edit.
  Your GM can mark one of the three as **Recommended** in the settings, for a player who has not
  built a character before. The chooser stands aside for Ember, and for a half-built draft you are
  coming back to.
- **Quick Build.** Choose a class, a species and a background — or press the die beside any of them,
  or **Roll everything** — and the rest of the character is filled in: ability scores (the standard
  array, spent down that class's priority), a name rolled in your species' style, skills, starting
  spells and a default equipment pack. You see all of it before you commit. **Build step by step
  instead** carries whatever you have chosen into the full wizard rather than starting over.
- **Quick Build can start you at 3rd or 5th level.** Pick the level on the same screen and the
  character arrives ready to play at it — subclass chosen, ability increase spent, new spells
  learned, features taken. It is still the same three choices: the levels are filled in for you
  rather than handed back as a wizard to work through. Everything it picked is ordinary and
  editable afterwards, and if some part of a level needs your eye, the wrench on the sheet
  (*Repair this level*) offers exactly that level.
- **Ready-made characters.** The D&D system ships twelve finished 1st-level characters, one per
  class, and some content modules ship more. Ready-made gathers up whichever your world has, grouped
  by the book they came from, and hands you one as a character of your own — already built and
  already correct. Selecting one does not take it; a second, deliberate press creates it.
- **Artwork on the origin screens.** Classes, species and backgrounds now show the illustrations
  from the content modules you already own, where a book provides one.
- **The Magic Item Shop now sells, as well as gives.** Alongside the free picks there is a shelf to
  buy from, with a cart, a running total and what you have left to spend. Your coins are tidied into
  the largest sensible denominations at the end of the build.
- **Magic items on the review screen.** The free picks, anything bought and the bonus gold are
  listed before you commit, on both the creation review and the review at the end of a climb.

### Improved

- **The magic-item wealth table is now one row per level, 1 to 20**, instead of the Dungeon Master's
  Guide's four bands. Any table you had already set up is carried across automatically. Because the
  table now has a 1st-level row, a GM who fills it in can give starting characters magic items and
  gold — which the four-band table could never express, since the book's bands begin at 2nd level.
- **A 1st-level character can reach the Magic Items step.** Previously it appeared only on the climb
  to a higher starting level, so a 1st-level build could never see it whatever the GM configured.
- The magic shop can be filtered by rules edition.
- Verified against D&D 5e **6.0.3** on Foundry **14.368**.

### Fixed

- **Deft Explorer now brings Canny with it.** On a 2014-rules Ranger using Tasha's alternatives,
  choosing Deft Explorer in place of Natural Explorer granted Deft Explorer alone — Canny, which the
  rules give you at the same time, was silently left off the character. Swapping back now removes it
  again. Characters built before this fix are not repaired automatically; the wrench (*Repair this
  level*) will pick it up.
- **Origin artwork no longer goes stale.** Enabling or disabling a content module mid-session left
  the class, species and background screens showing the art they had found before the change.
- **Spells you are already given are no longer offered to you again.** In a world running both the
  Player's Handbook module and the system's own compendiums — the common arrangement — every spell
  exists twice, and the creator only recognised one of them. So a spell your class or background
  already grants could still appear in the list for you to choose, wasting the pick: the granted
  copy is always prepared and free to cast, while the chosen one takes up a prepared slot and burns
  a real one. Both the Spells step and Quick Build now match spells by what they *are* rather than
  which book they came from.

### Compatibility

- Requires the D&D 5e system **5.3.3 or later**; verified on **6.0.3**.
- Foundry **v14** only. This release deliberately does **not** install on Foundry v15, which has not
  yet been tested against.

---

## 3.1.0 — Magic Shop Rework

### New

- Repair skipped choices. D&D 5e lets a level finish with a choice left unmade: a fighting style never picked, an ability score improvement never spent, a subclass never chosen. When that happens, a wrench appears beside the Level Up button, in the sheet's header menu and on the character's right-click menu in the Actors sidebar. It reopens the level-up wizard on just that level's missing choices. Everything you already chose stays as it was, and a subclass picked late brings every feature it would have given you since. It also works on a level-20 character.
- Tasha's optional class features at creation. A 2014-rules class now lists its level-1 Tasha's options in the Choices step. You can give one up, or swap one for its Tasha's version, such as Favored Foe in place of Favored Enemy. Before, you could only change these later, at level-up.
- Already-known spells on the level-up spell page. The sidebar lists every spell the character already has, grouped by level. You can weigh a new spell against them for synergies and overlaps.
- Support for advancement types from other modules. If a module adds its own advancement type, such as Potent Dragonmark, the level-up wizard now shows that module's own screen inside the wizard. Before, those steps were skipped.

### Improved

- Magic Item Shop reworked and documented. It now appears at the end of the climb to a starting level above 1st, just before the review, rather than in character creation.
- Bonus gold: the player rolls it with a Roll button (Dice So Nice supported), and it goes into the character's purse. The level-up can't be applied until the gold is rolled.
- Item cards note when the character isn't proficient with an item, isn't strong enough to wear it, or can't attune to it (for example, "Attunement by a Bard").
- Creation chat card: shows the roll and the items picked.
- Search: now works in the level-up window.
- Spell choices limited to one school (Arcana Unleashed Savants, Arcane Undertaker, the "Mastered" feats) now offer only spells of that school, at both creation and level-up.
- The Class & Abilities step always shows the class switcher and the Read the Rules link, with a "Choose a Class" placeholder before you pick one.
- Verified on dnd5e 6.0.3.

### Fixed

- Duplicate features on 2014 characters. With multiclassing enabled, 2014 characters got two copies of their level-1 features, such as Second Wind, Fighting Style and the background feature.
- Blocked multiclassing. When a character doesn't meet the multiclass prerequisites, a class dragged onto the sheet is now refused outright. Before, the character still got the class through dnd5e's own wizard.
- Magic Initiate–style feats. Spells chosen for these feats at creation can now be swapped at later level-ups, for example the Arcane Warrior cantrip. Characters built before this fix aren't repaired.
- "Available spell" choices no longer offer spells above the character's level when you level up several levels at once.
- Spell choices with no set spell list, such as 2014 Magical Secrets and Signature Spells, now offer spells instead of an empty list.
- Arcana Unleashed Savant features now run their spell choices at level-up instead of being skipped.
- Level-up window closing. Opening the Magic Items step, or a screen from another module, no longer closes the window with a "template could not be found" error.

---

## 3.0.1

- Arcana Unleashed Wizard Savants now work as intended.
- Feats that can't be taken more than once should no longer be offered to players a second time.

---

## 3.0.0 — D&D 6.0 Support

- Official D&D game system version 6 support.
- Support for the Arcana Unleashed series.
- Support for Tasha's Cauldron of Everything v4.
- Enhanced testing.
- Characters starting at a higher level now get a magic item shop.

---

## 2.7.5

- Resolved UI issues with the Feat Picker.
- Added a rules-version lookup.

---

## 2.7.4 — D&D Game System 6.x Support

- Added support for the D&D game system 6.0.
- Spells you know are shown better.
- The spell filter works again.
- The gold store now has musical instruments and artisan tooling.

---

## 2.7.3

- Bug fixes, and support for PDF export.

---

## 2.7.2 — Subclass Spell List Support

- The spell page can add subclass spell lists.
- Extra filters on the spells.
- Added a compare option.

---

Earlier releases are listed at
<https://github.com/IainFielding/Simple-DnD5e-Character-Creator/releases>.
