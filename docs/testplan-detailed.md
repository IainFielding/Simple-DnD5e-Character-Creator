# Detailed Test Plan — Click-by-Click Procedures

Step-by-step companion to [testplan.md](testplan.md). Every case in the summary plan maps to a numbered
procedure here (matching section numbers). Follow the clicks exactly; each ends with a **✔ Verify** list.
Where the summary plan has a checklist matrix (classes, species), this document gives the *repeatable
procedure* to run for each row plus the row-specific things to look for.

> Labels below are the real UI strings. Key ones: sidebar button **"Simple Character Builder"**; creation
> finish button **"Create Character"**; level-up footer **"Apply Level-Up"** then **"Done"**; ability
> methods **Point Buy / Standard Array / Roll** with **Roll Stats** and **Reset**; spell detail buttons
> **+ Add / − Remove**, and for owned spells **Swap Out / Keep**.

## How to read a procedure

- **Do:** literal actions ("Click *Next*").
- **✔ Verify:** what must be true afterward. A single failed check fails the case.
- **⚠ Watch:** the console (F12) for `sogrom-dnd5e-character-creator | …` — any such line fails the case.

---

## 0. One-time environment prep

1. Launch Foundry; open a world running **dnd5e 5.3.3+** with the **2024 PHB** packs enabled.
2. Confirm the module **Simple D&D 5e Character Creator** is enabled: *Game Settings → Manage Modules*.
3. Open **Game Settings → Configure Settings → Simple D&D Character Creator**. Note the six settings.
4. For level-up sections, set **Mode → "Creation + Level-Up"** and **Save Changes**.
5. Confirm **Hero Mancer** is *disabled* (except §9.1).
6. Confirm **dnd5e → Disable Advancements** is *off* (except §9.2).
7. Press **F12** to open the browser console; leave it open for the whole session.
8. ✔ Verify: on world load the console shows `sogrom-dnd5e-character-creator | ready` and **no errors**.

---

## 1. Settings & entry points

### 1.1 Settings present
1. Open *Configure Settings → Simple D&D Character Creator*.
2. ✔ Verify all six are shown: **Show launch button**, **Show context menu**, **Point-buy budget**,
   **Ability roll formula**, **Display mode** (Fullscreen/Windowed), **Mode** (Creation / Creation+Level-Up).

### 1.2 Launch button toggle
1. Set **Show launch button = off**, **Save Changes**.
2. Open the **Actors** sidebar tab.
3. ✔ Verify no **"Simple Character Builder"** button in the sidebar header.
4. Set it back **on**, Save, reopen the Actors tab. ✔ Verify the button reappears.

### 1.3 Context menu toggle
1. Set **Show context menu = off**, Save. Right-click any character actor in the sidebar.
2. ✔ Verify there is **no** "Simple Character Builder" entry in the context menu.
3. Set it back **on**, Save. Right-click a character you own. ✔ Verify the entry is present.

### 1.4 Display mode
1. Set **Display mode = Windowed**, Save. Click **Simple Character Builder**.
2. ✔ Verify the creator opens as a **draggable, resizable window** (~90% of screen, centred). Drag the
   title bar and drag a corner to confirm. Close it.
3. Set **Display mode = Fullscreen**, Save. Click the button again.
4. ✔ Verify it opens **full-screen with no window chrome**. Close it.

### 1.5 Point-buy budget
1. Set **Point-buy budget = 20**, Save. Launch; on **Class & Abilities** click the **Point Buy** tab.
2. ✔ Verify the points readout shows **20** budget (`… / 20`).
3. Cancel. Restore budget to **27**, Save.

### 1.6 Ability roll formula
1. Set **Ability roll formula = 3d6**, Save. Launch; **Class & Abilities → Roll** tab; click **Roll Stats**.
2. ✔ Verify six scores appear consistent with 3d6 (max 18, can be as low as 3).
3. Cancel. Set the formula to an invalid value e.g. `abc`, Save. Launch → Roll → **Roll Stats**.
4. ✔ Verify it does **not** error; it falls back to `4d6kh3` behaviour (no console error). Restore `4d6kh3`.

### 1.7 Mode = Creation only leaves native flow
1. Set **Mode = Creation** (creation only), Save.
2. Open an existing character's sheet, click the class **level** selector, raise it by 1.
3. ✔ Verify the **native dnd5e** advancement dialog appears (not the module shell) and there is **no**
   extra "Level Up" button injected by the module.
4. Restore **Mode = Creation + Level-Up**, Save.

### 1.8 Mode = Creation + Level-Up takes over
1. With Mode = Creation+Level-Up, raise a character's class level by 1.
2. ✔ Verify the **module's calm level-up shell** opens (rail with a Level entry + Review, brand
   "Character Creator") instead of the native dialog. Cancel out.

---

## 2. New character creation — full walk-through

Baseline build: **Fighter + Human**.

1. **Launch.** Actors sidebar → click **Simple Character Builder**.
   - ✔ A new draft actor is created and the creator opens on **Class & Abilities**. The rail lists the
     steps along the top; **Cancel** (✕) is top-right.
2. **Pick a class.** In the left picklist click **Fighter**.
   - ✔ The centre panel shows the Fighter description and feature groups; the row shows a check tick.
3. **Set abilities — Point Buy.** In the right **Abilities** aside click the **Point Buy** tab.
   - Click **+**/**−** steppers to raise/lower scores. Try to exceed the budget.
   - ✔ The points readout decrements correctly; **+** is disabled when unaffordable; you cannot go over
     budget. Click **Reset**; ✔ scores return to base and points reset.
4. **Set abilities — Standard Array.** Click the **Standard Array** tab.
   - Use each ability's dropdown to assign values 15/14/13/12/10/8.
   - ✔ Each value can be used once; re-assigning frees the previous value; modifiers update live.
5. **Set abilities — Roll.** Click the **Roll** tab → **Roll Stats**.
   - ✔ Six scores are generated; assign them via dropdowns/drag; **Reset** clears the assignment.
   - Leave a valid set assigned. Click **Next**.
6. **Background.** Pick a background from the list.
   - ✔ Its description, proficiencies, and ability boosts show. Click **Next**.
7. **Species.** Pick **Human**.
   - ✔ Human traits list (Resourceful, Skillful, Versatile). Click **Next**.
8. **Details.** Type a **Name** (required, marked `*`).
   - Click the **🎲 dice** button beside the name → ✔ a random name appears; click again → a different name.
   - Click the **▾ caret** next to the dice → ✔ a popover offers **Gender** and **Name style**; change
     them and re-roll → names reflect the choice.
   - Click **Change portrait** and **Change token**; toggle **Lock rotation** / **Dynamic ring**.
   - ✔ Portrait/token previews update; toggles flip **On/Off**. All non-name fields are optional. Next.
9. **Spells.** ✔ Verify the Spells step is **absent/skipped** (Fighter is a non-caster) — the rail either
   marks it skipped (dash icon) or omits it. Continue.
10. **Choices.** ✔ Verify Fighter's **Fighting Style** and any background/Human skill choices appear as
    pick lists. Make each required pick. ✔ **Next** stays disabled until all required choices are done.
11. **Equipment.**
    - ✔ Class and background equipment sources are shown, each with option tabs (bundle **A/B/…** and a
      **gold** alternative showing "— N GP"). Click between options; click any **or-group** pill to swap
      an allowed item.
    - Select a bundle option, then Next.
12. **Review.** Read the summary. Click **Create Character**.
    - ✔ The window closes; the actor's sheet opens. Verify on the sheet: correct **HP**, ability scores,
      **proficiencies**, **Fighting Style** + class features, chosen skills, and the selected **equipment**
      are present. ⚠ No console errors.

### 2-cancel. Cancel safety
1. Launch again; advance to **Species**; click **Cancel** (✕) / close the window.
2. ✔ Verify **no** finished actor is created, and **no** leftover "New Character" draft actor is left in
   the Actors sidebar.

### 2-player. Repeat as a player
1. Log in as a **Trusted Player** with actor-create permission; run steps 1–12 for a quick build.
2. ✔ Verify the actor is created, **owned by that player**, and fully editable by them.

---

## 3. Class coverage — per-class procedure (all WotC classes)

Run this once for **each** class in the checklist of [testplan.md §3](testplan.md). Pair with any species.

**Procedure (repeat per class):**
1. Launch → **Class & Abilities** → pick the class → set abilities (any method) → **Next**.
2. **Background** → pick any → **Next**. **Species** → pick any → **Next**. **Details** → set a name → Next.
3. **Spells step:**
   - *Casters* — ✔ the Spells step appears with the right **tabs** (Cantrips and/or Level 1) and a
     `count/max` counter per tab. Pick the exact budget: click a spell row (left), read its description
     (right), click **+ Add**; repeat until the counter is full. ✔ You cannot exceed the budget (rows
     disable at max); typing in **search** filters live without losing focus. Click **− Remove** to free
     one, re-add. Cross-check the counts against the table below.
   - *Martials (no L1 spells)* — ✔ the Spells step is **skipped/absent**.
4. **Choices** → resolve every surfaced pick (see per-class notes). ✔ Next blocked until complete.
5. **Equipment** → pick a bundle → **Review** → **Create Character**.
6. ✔ On the sheet: features present, and for casters the spells are attached with the class as source and
   the correct prepared/known state. ⚠ Console clean.

**Level-1 caster budgets (2024) to check in step 3:**

| Class | Cantrips | Level-1 spells | Notes |
|---|---|---|---|
| Bard | 2 | 4 | known caster |
| Cleric | 3 | prepared list | divine order choice |
| Druid | 2 | prepared list | — |
| Sorcerer | 4 | 2 | origin subclass at L1 |
| Warlock | 2 | 2 | pact magic; patron at L1 |
| Wizard | 3 | 6 | spellbook |
| Artificer* | 2 | prepared | *only if installed |
| Paladin / Ranger | — | — | **no** spells at L1 (Spells step absent) |
| Barbarian / Fighter / Monk / Rogue | — | — | Spells step absent |

**Per-class choice notes to confirm in step 4:** Fighter → **Fighting Style**; Rogue → **Expertise**;
Cleric → divine order / domain; Sorcerer/Warlock → subclass at L1; others → any class/background/species
skill or tool picks.

---

## 4. Species coverage — per-species procedure (2024 PHB)

Run once for **each** species in [testplan.md §4](testplan.md). Use a caster for at least one species to
confirm species+spell interplay (e.g. **Elf (High)** granting a wizard cantrip).

**Procedure (repeat per species):**
1. Launch → pick any class + abilities → **Next** → **Background** (note its ability boosts) → **Next**.
2. **Species** → pick the species under test.
   - ✔ Its traits/features list on the right. If the species has a **lineage/ancestry choice** (Elf,
     Gnome, Dragonborn, Goliath, Tiefling, Aasimar), note it will resolve in **Choices**.
3. **Next** through Details/Spells.
4. **Choices** → make the species' lineage/ancestry pick (e.g. Elven Lineage → High; Draconic Ancestry →
   a damage type; Fiendish Legacy → Infernal). ✔ The choice's granted cantrip/feature/resistance is
   noted for verification.
5. **Equipment → Review → Create Character.**
6. ✔ On the sheet verify: species traits present (Darkvision, resistances, speeds), the chosen lineage's
   grant applied, and — importantly — **ability score increases come from the background, not the
   species** (confirm the species did **not** also add ASIs; no double-application). ⚠ Console clean.

**Row-specific checks:** Dragonborn → breath-weapon + resistance match the chosen ancestry; Elf → chosen
lineage cantrip present and, at higher levels, its spell grants (see §5.8); Tiefling → Legacy cantrip +
resistance; Human → bonus **skill** (Skillful) + **origin feat** (Versatile) both surfaced in Choices;
Goliath → Large Form / Powerful Build; Orc → Relentless Endurance + Adrenaline Rush.

---

## 5. Level-up — core mechanics

Prep: Mode = Creation+Level-Up; Disable Advancements off; Hero Mancer off. Have (or quickly build)
low-level actors of the classes named. Trigger level-up by opening the sheet and **raising the class
level** in the level selector (or award XP where the case says so).

### 5.1 Non-caster, no-choice level (Fighter L1→L2)
1. Open a level-1 Fighter's sheet; raise class level to **2**.
2. ✔ The calm level-up shell opens with a **Level 2** rail entry and **Review**; footer reads
   **Apply Level-Up**.
3. Open the **Hit Points** block; choose **Average** (or **Roll**). Click **Next** to Review.
4. Click **Apply Level-Up**.
5. ✔ No Spells step appears; the window closes; the sheet shows **level 2** and increased max HP. Footer
   read **Apply Level-Up** throughout (never "Done"). ⚠ Console clean.

### 5.2 HP step (roll vs average, multi-level)
1. On any level-up, open the **Hit Points** block.
2. ✔ Two options: **Average** and **Roll {die}**. Click **Roll** → ✔ a value is rolled and shown; the
   chosen value flows into max HP after apply.
3. For a multi-level jump (see 5.9) ✔ there is **one HP block per gained level**, each on its own screen.

### 5.3 ASI level (Fighter L3→L4)
1. Take a Fighter to **level 3**, then raise to **4**.
2. Open the **Ability Score Improvement** block.
3. ✔ Two paths offered: distribute **+2/+1+1** with per-ability **+/−** steppers, **or** "take a Feat".
   - Try to exceed the **+2 budget** or push an ability over **20** → ✔ blocked.
   - Distribute +2 to one ability. Click **Next → Review**.
4. ✔ Review lists the ability increase. Apply. ✔ Sheet reflects the raised ability.

### 5.4 Half-feat via ASI
1. Repeat 5.3 but in the ASI block choose **take a Feat** → the compendium browser opens; pick a
   **half-feat** (grants a fixed ability bonus, e.g. an Origin/General feat with +1).
2. ✔ The fixed ability bonus **auto-applies**; the feat's own features are folded in; any feat sub-choice
   appears as a **further block** on the same screen.
3. Change the feat to a different one. ✔ The previous feat's bonuses/features are **reversed** cleanly
   (no leftovers). Finish and apply. ✔ Sheet shows the final feat only.

### 5.5 Subclass level & re-resolution
1. Take a class to its **subclass level** (e.g. Cleric L1→2→3, or Fighter L2→3) and raise into it.
2. Open the **Subclass** block → the class-filtered compendium browser opens → choose a subclass.
3. ✔ After choosing, a **Features** block for the subclass **appears on the same level screen** (the step
   set rebuilt). Make any revealed picks.
4. Change the subclass to a different one. ✔ Everything the first subclass added is **reversed** and the
   new subclass's features replace them. Finish → apply. ✔ Sheet shows the subclass and its features.

### 5.6 Feature choice (ItemChoice)
1. Level a class into a feature-choice level (Fighter Fighting Style, Sorcerer Metamagic, Battle Master
   Maneuvers, Rogue/Bard Expertise).
2. Open the feature block → ✔ a **pick-N** list with a counter. Try to advance without picking → ✔
   **Next/Apply blocked** while required picks are outstanding.
3. Make the picks → ✔ the block shows complete (check pill). Apply → ✔ items appear on the sheet.

### 5.7 Trait choice
1. Level into a Trait-choice level (Weapon Mastery selections, or a bonus language/skill Trait).
2. Open the Trait block → ✔ selectable keys with a required count. Pick them → complete → apply.
3. ✔ The chosen weapon masteries / languages / skills appear on the sheet.

### 5.8 Species spell grant at a class level
1. Build (or use) a **High Elf** character; level it to the character level where the lineage grants a
   spell (e.g. **Misty Step at L5**).
2. Level up to that level. ✔ A **grant** block surfaces the granted spell **plus** an Int/Wis/Cha
   **casting-ability picker**.
3. Choose an ability → apply. ✔ The spell is on the sheet with the chosen casting ability.

### 5.9 Multi-level (XP) jump
1. On a level-1 actor, **award XP** sufficient to jump to **level 3** (or set XP directly).
2. ✔ The shell shows **one screen per gained level** (rail: `Level 2`, `Level 3`, `Review`), in order.
3. Complete each level's blocks in turn. ✔ Each incomplete level **blocks** moving on; a later level's
   subclass feature lands on that later level's screen.
4. Click **Apply Level-Up**. ✔ A **single** combined commit; the sheet jumps straight to level 3.

### 5.10 Nav lock after commit
1. On a **caster** level-up that will show a spell step, complete the level screens and click
   **Apply Level-Up**.
2. ✔ After commit: **Back** is disabled; the Level/Review rail entries are **frozen** (not clickable);
   only the post-commit **Spells** step is live and the footer now reads **Done**.

### 5.11 Cancel before commit
1. Start any level-up; open some blocks / make some picks; then **close the window** (✕) **before**
   pressing Apply.
2. ✔ The actor is **completely unchanged**: same level, no new items, no active effects, no duplication.

### 5.12 Cancel after commit, before spells
1. On a caster (e.g. Wizard L1→2), complete the levels and **Apply Level-Up** to reach the Spells step.
2. **Close the window** (✕) instead of clicking **Done**.
3. ✔ The **level-up stays applied** (level and HP gained) but **no spells** were added; the sheet is
   consistent (no duplicate/orphaned items); the spells can still be added later from the sheet.

### 5.13 Re-run safety
1. Take an actor with existing items/active effects up a level and apply; then lower it back down; then
   raise it again.
2. ✔ No item duplication; pre-existing features/effects survive intact. ⚠ Console clean.

---

## 6. Level-up — spells (add)

The Spells step appears **only after Apply Level-Up**, and only when the leveled class gained
cantrip/spell capacity. Footer reads **Done** here.

### 6.1 Full known caster (Wizard L1→L2)
1. Build a level-1 Wizard; on the sheet confirm **3 cantrips + 6 spells** from creation.
2. Raise class level to **2**; step HP → Review → **Apply Level-Up**.
3. ✔ A **Spells** step appears; footer is now **Done**. Only the **Spells** tab shows (no cantrip gain at
   L2); counter reads `0/1`; there is **no Cantrips tab**.
4. ✔ The list **excludes** the 6 spells already known. Click a spell → read it → **+ Add**; counter →
   `1/1` and the rest disable.
5. Click **Done**. ✔ The sheet shows **7** prepared/known wizard spells; the new one has
   `method:"spell"`, `sourceItem` = wizard class. ⚠ Console clean.

### 6.2 Prepared caster + new spell level (Cleric L2→L3)
1. Build a Cleric, level it to **2** (choosing spells each level). Raise to **3** → Apply Level-Up →
   Spells step.
2. ✔ The leveled **Spells** counter reads `0/1`; the pool now includes **level-2** spells (rows show a
   "Lvl 2" tag), proving the max spell level rose with the new slots.
3. Pick a level-2 spell → **Done**. ✔ It is added as a prepared cleric spell.

### 6.3 Cantrip gain
1. Level a caster into a level that grants a **new cantrip** (per the Cantrips-Known scale).
2. ✔ A **Cantrips** tab appears with the right `0/N` budget; add the cantrip(s). ✔ Counter enforces N.

### 6.4 Pact caster (Warlock)
1. Level a Warlock into a level that raises its prepared count → Apply → Spells step.
2. ✔ The leveled pool is bounded by the **pact** slot level (only ≤ that level's spells); the counter
   matches the warlock `preparation.max` delta. Add and **Done**.

### 6.5 Multi-level jump (Wizard L1→L3)
1. Level-1 Wizard; award XP to jump to **level 3**. Walk the per-level HP screens → Review → Apply.
2. ✔ A **single** Spells step for the whole jump: leveled counter `0/2`, pool includes level-2 spells.
   Add two → **Done**.

### 6.6 Subclass caster (Eldritch Knight / Arcane Trickster) — *if installed*
1. Take a Fighter to **level 3** and choose **Eldritch Knight** (or Rogue → Arcane Trickster) during the
   subclass block; finish the levels → Apply.
2. ✔ The Spells step appears **because of the subclass**; the pool is the wizard-scoped list; added spells
   carry `sourceItem` = the subclass.
3. **Known limitation:** if the subclass spell list isn't registered under the `subclass` registry type,
   the step still appears but the pool is empty ("No spells available") — note it but don't fail the build.

### 6.7 Non-caster
1. Level a Fighter/Barbarian/Monk/Rogue. ✔ No Spells step; **Apply Level-Up** simply closes.

### 6.8 Re-open the sheet
1. After any spell level, close and re-open the actor sheet.
2. ✔ Cantrips-known and prepared counts match the class table for the new level; the actor is **not
   over-prepared**; every added spell links back to its class/subclass via `sourceItem`.

---

## 7. Level-up — spell swaps (2024 replace-one rule)

Use a caster level-up that grants ≥1 leveled spell (e.g. Wizard L1→L2). Reach the Spells step.

### 7.1 Swap candidates shown
1. ✔ Below the addable pool, the caster's already-known **leveled** spells appear as dashed/muted rows
   with a **bookmark** icon; a swap hint shows above the tabs.

### 7.2 Swap frees a slot
1. Click a known (bookmarked) spell to focus it → click **Swap Out**.
2. ✔ The row shows the **swap** (⇄) icon; the tab counter rises by one freed slot (e.g. `0/1 → 0/2`).

### 7.3 Commit a swap
1. With the freed slot, **+ Add** two new spells (the base add + the replacement). Click **Done**.
2. ✔ The swapped-out spell is **deleted**; both new picks are added; net prepared count = old − 1 + 2 =
   old + 1. No duplicates. ⚠ Console clean.

### 7.4 No-op unless slot used
1. Reach the step again; **Swap Out** a known spell but only add the **base** amount (don't use the freed
   slot). Click **Done**.
2. ✔ The marked spell is **kept** (not deleted); only the base additions land.

### 7.5 Un-swap gives the slot back
1. **Swap Out** a spell (counter `0/1 → 0/2`); **+ Add** the extra one; then focus the marked spell and
   click **Keep**.
2. ✔ The counter drops back to `…/1` and the extra pick that filled the freed slot is **auto-removed**
   (never over budget).

### 7.6 Protected spells can't be swapped
1. On a Cleric with an **always-prepared** domain spell (`prepared:2`), reach the spell step.
2. ✔ The domain/granted spell does **not** appear as a swap-out candidate — only regularly-prepared picks
   do.

### 7.7 One swap per bucket
1. In a bucket (cantrips or leveled), Swap Out one spell, then try to Swap Out a second.
2. ✔ Only **one** swap per bucket is allowed (the second is prevented or replaces the mark).

---

## 8. Class-by-class level-up spot checks

For each row in [testplan.md §8](testplan.md), run the matching core procedure from §5–§7 at the noted
level transition and confirm a clean result. Quick pointers:

- **Barbarian L2→3 / Monk L2→3 / Bard L2→3:** §5.5 subclass; Bard also §6 spell add + §5.6 expertise.
- **Cleric L2→3:** §6.2 new spell level + domain feature block.
- **Druid L1→2 then into subclass level:** §6 spell add, §5.5 subclass.
- **Fighter L3→4 (ASI §5.3) and L2→3 (subclass §5.5; EK spells §6.6).**
- **Paladin L1→2 / Ranger L1→2:** half-caster **begins** casting — ✔ the Spells step appears for the
  first time at L2 (§6).
- **Rogue L2→3:** §5.5 subclass; Arcane Trickster spells §6.6.
- **Sorcerer L2→3:** §5.6 Metamagic + §6 spell add.
- **Warlock L2→3:** §5.6 Invocations + §6.4 pact add + §7 swap.
- **Wizard L1→2 (§6.1) and L3→4 (§5.3).**

✔ Each transition completes with correct sheet results and a clean console.

---

## 9. Coexistence & fallbacks

### 9.1 Hero Mancer active
1. Enable **Hero Mancer**; reload. Open a character sheet.
2. ✔ The module **stands down**: no duplicate "Level Up" button from this module, and raising the level
   defers to Hero Mancer (this module does not take over). ⚠ Console clean.
3. Disable Hero Mancer again; reload.

### 9.2 Disable Advancements ON (no Hero Mancer)
1. Set **dnd5e → Disable Advancements = on**; ensure Mode = Creation+Level-Up. Reload. Open a sheet.
2. ✔ The module's **fallback Level-Up button** appears on the sheet and is the **only** entry point; the
   native manager is not built. Click it → the module shell launches and drives the level-up.
3. Restore **Disable Advancements = off**.

### 9.3 Disable Advancements OFF (default)
1. With Disable Advancements off and Mode = Creation+Level-Up, raise a class level.
2. ✔ The `preAdvancementManagerRender` takeover fires (module shell opens) and the fallback button does
   **not** appear (no double entry point).

---

## 10. Regression sweep before tagging

1. Re-run **§2** (full creation smoke) once on the final build. ✔ Clean.
2. Take one **caster** and one **martial** from **L1 → L5** continuously, applying every level. ✔ The
   sheet is correct at each step; no duplication.
3. ✔ Console clean across the entire session — search the console for `sogrom-` and confirm no
   warnings/errors.
4. ✔ `module.json` version bumped; no raw `sogrom-dnd5e-character-creator.…` i18n keys visible anywhere in
   the UI checked above (a visible key = a missing `lang/en.json` string).
5. ✔ Created/leveled actors are fully playable: correct HP, proficiencies, features, spells, equipment,
   ownership.

---

### Result log

Record pass/fail per procedure here (or tick the matching box in [testplan.md](testplan.md)). A release is
**go** only when every procedure passes and the console stayed clean throughout.
