# Release Test Plan — Simple D&D 5e Character Creator

Manual pre-release validation to run **inside a live Foundry VTT world**. There is no automated
harness; a human plays through each case and ticks its **Expected** lines. When every box in this
document is checked with no console errors, the build is considered safe to publish.

> This document replaces the old `level-up-spells-test-plan.md` and widens coverage to the **whole
> module**: new-character creation, every WotC class, every 2024 PHB species, the full level-up
> takeover, and the GM settings.

---

## 0. Environment & setup

- **Foundry VTT** v14+.
- **dnd5e system** 5.3.3+ with the **2024 PHB** content packs enabled (classes, subclasses, species,
  backgrounds, feats, spells, equipment). Spell/prepared counts below assume 2024 rules.
- **Simple D&D 5e Character Creator** enabled. For the level-up sections set **Mode →
  "Creation + Level-Up"** (`sogrom-dnd5e-character-creator.mode = "creation-levelup"`); the creation
  sections work in either mode.
- **Hero Mancer** disabled (except §9, which tests coexistence).
- dnd5e's **Disable Advancements** world setting **off** (default) unless a case says otherwise.
- Open the browser console (F12) throughout. **Any** `sogrom-dnd5e-character-creator | …` error is a
  test failure even if the UI looks fine.
- Test as a **GM** and repeat the creation smoke test (§2) once as a **trusted player** to confirm
  permissions/ownership on the created actor.

**Pass criteria (global):** every Expected line holds, the console is free of module errors, and no
flow leaves a half-built actor, duplicated items, or orphaned spells/features behind.

---

## 1. Settings & entry points

| # | Test | Expected |
|---|------|----------|
| 1.1 | Open **Configure Settings → Module Settings**. | All six settings present: Launch button, Context menu, Point-buy budget, Ability roll formula, Display mode, Mode (creation vs creation+level-up). |
| 1.2 | Toggle **Launch button** off, reopen the Actors sidebar. | The **Create Character** button is hidden; on, it returns. |
| 1.3 | Toggle **Context menu** off, right-click an actor. | "Open in Character Creator" entry is hidden; on, it returns. |
| 1.4 | Set **Display mode = Windowed**, launch the creator. | Creator opens as a draggable/resizable window; **Fullscreen** opens immersive full-screen. |
| 1.5 | Set **Point-buy budget = 20**, start creation, choose Point Buy. | The budget counter starts at 20, not 27. Reset to 27 after. |
| 1.6 | Set **Ability roll formula = 3d6**, choose Roll in creation. | Each ability rolls 3d6. Enter an invalid formula → creator falls back to `4d6kh3` (no crash). |
| 1.7 | Set **Mode = Creation only**, open a character sheet and change its level. | Native dnd5e advancement runs; **no** module takeover, no extra Level-Up button. |
| 1.8 | Set **Mode = Creation + Level-Up**. | Level changes are taken over by the module shell (§4–§8). |

---

## 2. New character creation — full walk-through (smoke test)

Run this end-to-end once before the class/species matrices. Use a **Fighter + Human** as the baseline.

1. **Launch** via the sidebar button.
   - **Expected:** welcome/first screen renders; rail lists the steps; **Next** advances, **Back** returns.
2. **Class & Abilities**
   - **Expected:** all classes listed with descriptions; selecting one shows its detail. Ability-score
     method selector offers **Point Buy**, **Standard Array**, **Roll**.
   - Point Buy: spending over budget is blocked; counter is accurate; can't proceed over budget.
   - Standard Array: the fixed set (15,14,13,12,10,8) assigns each value exactly once; no duplicates.
   - Roll: rolls populate; assignment to abilities works.
3. **Background** — pick one.
   - **Expected:** description shown; the background's skills/tool/ability boost are noted for later.
4. **Species** — pick Human.
   - **Expected:** traits/features listed; any species choice (e.g. skills) is surfaced later in Choices.
5. **Details** — set name, portrait, token.
   - **Expected:** the **Name Generator** produces a name on demand and can be re-rolled; portrait/token
     fields accept a path; all detail fields are optional and can be left blank.
6. **Spells** — Fighter is a non-caster.
   - **Expected:** the Spells step is **skipped/absent** for a non-caster.
7. **Choices** — resolve any outstanding skill/tool/language picks.
   - **Expected:** every unresolved choice from class/background/species appears; the step blocks
     completion until all required choices are made; no duplicate choices.
8. **Equipment**
   - **Expected:** the class + background starting-equipment bundles are offered; swappable slots let you
     choose between allowed options; the "take gold instead" alternative works; a sensible default is
     preselected.
9. **Review** — read the summary; press **Create Character**.
   - **Expected:** actor is created in the world, owned correctly, sheet opens. HP, proficiencies,
     features, equipment, and chosen skills all match the picks. No console errors. No leftover draft/temp
     actor remains if you had cancelled earlier.

**Cancel safety:** repeat to the Species step, then close the window (X).
   - **Expected:** no actor is created; no orphaned draft actor is left in the sidebar.

---

## 3. Class coverage — all WotC classes at level 1

For **each** class below: create a level-1 character (any species), stepping through the whole flow, and
verify the class-specific expectations. Tick the class only when creation completes cleanly and the
sheet is correct.

> Casters must reach the **Spells** step; martials must **skip** it. Spell/cantrip counts follow 2024.

- [ ] **Barbarian** — no spells; Rage feature present; martial equipment bundle.
- [ ] **Bard** — Spells step: pick 2 cantrips + 4 level-1 spells; Bardic Inspiration present.
- [ ] **Cleric** — Spells step: 3 cantrips; prepared caster (prepared list, not "known"); a divine
      order / domain choice surfaces in Choices if the 2024 class asks at L1.
- [ ] **Druid** — Spells step: 2 cantrips, prepared caster; Druidic language/feature present.
- [ ] **Fighter** — no spells; Fighting Style choice surfaces in Choices; martial bundle.
- [ ] **Monk** — no spells; Martial Arts / Unarmored Defense present.
- [ ] **Paladin** — no spells at L1 (half-caster starts casting at L2); Lay on Hands present. Confirm
      Spells step is correctly **absent** at L1.
- [ ] **Ranger** — no spells at L1 (half-caster); favoured-enemy/expertise choices surface as expected.
- [ ] **Rogue** — no spells; Expertise choice surfaces in Choices; Sneak Attack present.
- [ ] **Sorcerer** — Spells step: 4 cantrips + 2 level-1 spells; Sorcerous Origin subclass at L1 if the
      2024 class grants it (surfaces as a choice).
- [ ] **Warlock** — Spells step: 2 cantrips + 2 level-1 spells; pact magic; Patron subclass at L1.
- [ ] **Wizard** — Spells step: 3 cantrips + 6 spells (spellbook); Arcane Recovery present.
- [ ] **Artificer** *(only if the WotC Artificer content is installed)* — Spells step: 2 cantrips,
      prepared half-caster; skip if the pack is not present.

**For every caster above also confirm:** each spell row shows a full description; the counter enforces
the exact cantrip/spell budget (can't over- or under-pick); the search box filters live without losing
focus; and on the finished sheet the spells are `prepared`/known with the correct `sourceItem` = class.

---

## 4. Species coverage — 2024 PHB species

Create a level-1 character of **each** species (pair with any class; pick a caster at least once to
confirm species+spell interplay). Verify traits/features apply and any species choice reaches the
Choices step.

- [ ] **Aasimar** — Celestial Resistance, Healing Hands, Light-bearer; lineage/wing choice if applicable.
- [ ] **Dragonborn** — Draconic Ancestry choice (damage type + breath weapon) surfaces and applies.
- [ ] **Dwarf** — Darkvision, Dwarven Resilience, Stonecunning; tremorsense as written.
- [ ] **Elf** — Elven Lineage choice (High/Wood/Drow); the chosen lineage's cantrip/features apply,
      including any **spell grant** with a spellcasting-ability pick.
- [ ] **Gnome** — Gnomish Lineage choice; Darkvision; Gnomish Cunning.
- [ ] **Goliath** — Giant Ancestry choice; Large Form; Powerful Build.
- [ ] **Halfling** — Brave, Halfling Nimbleness, Lucky, Naturally Stealthy.
- [ ] **Human** — Resourceful, Skillful (bonus skill choice), Versatile (origin feat choice) all surface.
- [ ] **Orc** — Adrenaline Rush, Darkvision, Relentless Endurance.
- [ ] **Tiefling** — Fiendish Legacy choice (Abyssal/Chthonic/Infernal); the granted cantrip/spells and
      resistance apply; spellcasting-ability pick where relevant.

**Confirm for each:** ability-score increases are applied per 2024 background rules (boosts come from
**background**, not species, in 2024 — verify the species does *not* double-apply ASIs); Darkvision,
resistances, and speeds land on the sheet.

---

## 5. Level-up — core mechanics (Mode = Creation + Level-Up)

Trigger level-up by changing the class level on the sheet (or awarding XP). The calm level-up shell
should open instead of the native dnd5e dialog.

- [ ] **5.1 Non-caster, no-choice level (Fighter L1→L2).** HP screen → Review → **Apply Level-Up**. No
      Spells step; window closes; sheet shows level 2; footer read "Apply Level-Up" throughout.
- [ ] **5.2 HP step.** Offers **Average** vs **Roll**; rolling produces a value; the chosen HP is applied
      to max HP. Multi-level jump shows one HP screen per gained level.
- [ ] **5.3 ASI level (Fighter L3→L4).** ASI screen offers **+2 to one** / **+1 to two** with per-ability
      steppers respecting the budget and the 20 cap; **or take a Feat instead** via the compendium
      browser. Review lists the ability increases / chosen feat.
- [ ] **5.4 Half-feat.** Choosing a feat that grants a fixed ability bonus auto-applies that bonus and
      folds in the feat's own features; a feat sub-choice surfaces as a further decision and reverses
      cleanly if you change the feat.
- [ ] **5.5 Subclass level.** At the class's subclass level the pick goes through the (class-filtered)
      compendium browser; after choosing, the subclass's **own features appear as a new block on the same
      level screen** (re-resolution). Changing the subclass reverses everything it added.
- [ ] **5.6 Feature choice (ItemChoice).** Fighting Style, Metamagic, Maneuvers, Expertise, etc. surface
      as pick-N lists; the level stays incomplete (blocks Next/Apply) until required picks are made.
- [ ] **5.7 Trait choice.** Weapon Mastery, extra languages/skills (choice-bearing Trait advancements)
      render and apply the chosen keys.
- [ ] **5.8 Species spell grant at a class level.** A lineage that grants a spell at a later level
      (e.g. High Elf Misty Step at character L5) surfaces the spell **and** an Int/Wis/Cha casting-ability
      picker; the spell lands with the chosen ability.
- [ ] **5.9 Multi-level (XP) jump.** Award XP to jump several levels at once. One screen per gained level,
      in order; the rail lists `Level N … Review`; each level's choices gate progression; a single
      combined commit at the end.
- [ ] **5.10 Nav lock after commit.** After **Apply Level-Up**, **Back** is disabled and the level/Review
      rail entries are frozen — only a post-commit Spells step (if any) is live.
- [ ] **5.11 Cancel before commit.** Close the shell before pressing Apply. The **actor is unchanged** —
      no level gained, no items added, no active effects, no duplication.
- [ ] **5.12 Cancel after commit (before spells).** With a caster, reach the post-commit Spells step then
      close the window. The level-up **stays applied**; no spells added; sheet is consistent; the spells
      can still be added later from the sheet.
- [ ] **5.13 Re-run safety.** Level a character with existing items/active effects up and down a level.
      No item duplication; existing features survive.

---

## 6. Level-up — spells (add), per caster archetype

The Spells step appears **only after** **Apply Level-Up** (level committed first) and only when the
leveled class gained cantrip/spell capacity. Footer reads **Done** on the spell step.

- [ ] **6.1 Full known caster (Wizard L1→L2).** Leveled **Spells** tab only (no cantrip gain), counter
      `0/1`; list excludes already-known spells; picking fills `1/1` and disables the rest; **Learn Spell**
      → **Done** adds a 5th prepared wizard spell (`method:"spell"`, `sourceItem` = class). Cantrips tab
      absent.
- [ ] **6.2 Prepared caster + new spell level (Cleric L2→L3).** Leveled counter `0/1`; the pool now
      includes **level-2** spells (each row shows a "Lvl 2" badge), proving `maxSpellLevel` rose with the
      new slots; picking one and **Done** adds a prepared cleric spell.
- [ ] **6.3 Cantrip gain.** Level a caster into a level that grants a new cantrip (per the Cantrips-Known
      scale); a **Cantrips** tab appears with the correct `0/N` budget alongside/instead of leveled spells.
- [ ] **6.4 Pact caster (Warlock).** Level into a prepared-count increase; the leveled pool is bounded by
      the **pact** slot level and the counter matches the warlock `preparation.max` delta.
- [ ] **6.5 Multi-level jump (Wizard L1→L3).** A **single** Spells step reflecting L3 capacity (leveled
      `0/2`, pool includes level-2 spells) — not one step per level.
- [ ] **6.6 Subclass caster (Eldritch Knight / Arcane Trickster)** *(only if EK/AT content installed).*
      Spells step appears **because of the subclass**; the pool is the wizard-scoped list; added spells
      carry `sourceItem` = the subclass. **Known limitation:** if the subclass spell list isn't registered
      under the `subclass` registry type, the step appears but the pool is empty ("No spells available").
- [ ] **6.7 Non-caster.** No Spells step; **Apply Level-Up** closes as normal.
- [ ] **6.8 Re-open the sheet after a spell level.** Cantrips-known and prepared counts match the class
      table for the new level; the actor is not over-prepared; every added spell links back to its
      class/subclass via `sourceItem`.

---

## 7. Level-up — spell swaps (2024 replace-one rule)

On any caster level-up that grants ≥1 leveled spell (e.g. Wizard L1→L2):

- [ ] **7.1 Swap candidates shown.** The caster's already-known leveled spells appear below the addable
      pool as dashed/muted rows with a bookmark icon, plus a swap hint above the tabs.
- [ ] **7.2 Swap frees a slot.** Focus a known spell → **Swap Out**: the row strikes through with swap
      arrows and the counter rises by one freed slot (`0/1 → 0/2`).
- [ ] **7.3 Commit a swap.** Learn two spells (add + replacement) → **Done**: the swapped-out spell is
      **deleted**, both picks added; net prepared count = old − 1 + 2 = old + 1. No duplicates, no errors.
- [ ] **7.4 No-op unless slot used.** Swap Out but only learn the base amount → **Done**: the marked spell
      is **kept** (not deleted); only base additions land.
- [ ] **7.5 Un-swap gives the slot back.** Swap Out, learn the extra, then **Keep**: counter drops back to
      `.../1` and the extra pick that filled the freed slot is auto-removed (never over budget).
- [ ] **7.6 Protected spells can't be swapped.** An always-prepared spell (Cleric domain spell,
      `prepared:2`) or a granted spell does **not** appear as a swap candidate — only regularly-prepared
      picks do.
- [ ] **7.7 One swap per bucket.** Only one swap-out is allowed per cantrip bucket and per leveled bucket.

---

## 8. Class-by-class level-up spot checks

Level at least one character of each archetype through a decision level to confirm the takeover handles
that class's advancement shape. Tick when the level-up completes cleanly with correct results.

- [ ] **Barbarian** L2→3 (subclass / Primal Path).
- [ ] **Bard** L2→3 (subclass + spell add + expertise).
- [ ] **Cleric** L2→3 (new spell level, domain feature).
- [ ] **Druid** L1→2 (Wild Shape / spells) and into subclass level.
- [ ] **Fighter** L3→4 (ASI) and L2→3 (subclass, incl. Eldritch Knight spells if installed).
- [ ] **Monk** L2→3 (subclass, martial features).
- [ ] **Paladin** L1→2 (half-caster **starts** casting — Spells step appears now).
- [ ] **Ranger** L1→2 (half-caster starts casting) and subclass level.
- [ ] **Rogue** L2→3 (subclass; Arcane Trickster spells if installed).
- [ ] **Sorcerer** L2→3 (Metamagic choice + spell add).
- [ ] **Warlock** L2→3 (Invocations choice + pact spell add/swap).
- [ ] **Wizard** L1→2 (spell add) and L3→4 (ASI).

---

## 9. Coexistence & fallbacks

- [ ] **9.1 Hero Mancer active.** Enable Hero Mancer. The module **stands down**: no duplicate Level-Up
      button, no module takeover of level changes; creation may still be available but level-up defers to
      Hero Mancer. No console errors.
- [ ] **9.2 Disable Advancements ON (no Hero Mancer).** With `dnd5e.disableAdvancements` on and Mode =
      Creation+Level-Up, the module's **fallback Level-Up button** appears on the sheet and is the only
      entry point; the native manager is not built; the button launches the shell correctly.
- [ ] **9.3 Disable Advancements OFF (default).** The `preAdvancementManagerRender` takeover fires and the
      fallback button does **not** appear (no double entry point).

---

## 10. Regression sweep before tagging

- [ ] Re-run §2 (full creation smoke) once more on the final build.
- [ ] Level one caster and one martial from L1 to L5 continuously; sheet stays correct at every step.
- [ ] Console clean across an entire session (no `sogrom-…` warnings/errors).
- [ ] `module.json` version bumped; `lang/en.json` has no missing keys (no raw `sogrom-…` i18n strings
      visible in any UI checked above).
- [ ] Created/leveled actors are fully playable: correct HP, proficiencies, features, spells, equipment,
      and ownership.

---

### Sign-off

| Section | Owner | Date | Result |
|---|---|---|---|
| 1 Settings | | | |
| 2 Creation smoke | | | |
| 3 Classes (12/13) | | | |
| 4 Species (10) | | | |
| 5 Level-up core | | | |
| 6 Level-up spells (add) | | | |
| 7 Level-up spell swaps | | | |
| 8 Class level-up spot checks | | | |
| 9 Coexistence | | | |
| 10 Regression | | | |

**Release is go when every box above is checked and the console is clean.**
