# Level-Up Takeover — Implementation Plan

> Status: planning. Verified against **dnd5e 5.3.3** source and the **hero-mancer 3.0.4** bundle.
> Goal: extend this module from a level-1 creation wizard to also own the **level-up** experience
> (single-class, multiclass, and spell progression), reusing the same calm shell chrome. Where
> creation is one-decision-per-screen, level-up presents **all of a level's choices on one screen**
> (one screen per gained level for multi-level jumps) — see §3.5.

## 1. Scope & approach (decided)

- **Scope:** single-class level-up, multiclassing, and spell progression + swaps. Phase 0 spike first.
- **Approach:** **wrap the native dnd5e `AdvancementManager`** rather than reimplement it — drive the
  system's own advancement engine and re-skin its prompts. (The one exception is spells; see §3.4.)
- **Coexistence:** if **Hero Mancer** is active, we stand down entirely (§6).
- **Toggle:** a module setting selects **creation only** vs **creation + level-up** (§5).

The creation flow is untouched. Level-up gets its own entry point, state, and step set, but shares the
shell chrome (rail/stage templates, drag-drop, dispatch).

## 2. What the dnd5e source confirms

All file references below are in the dnd5e 5.3.3 system.

### 2.1 Trigger & interception seam
- Level-up is triggered from the actor sheet's level selector: `base-actor-sheet.mjs` `#changeLevel`
  → `AdvancementManager.forLevelChange(actor, classId, delta)` → `_renderChild(manager)`. Dropping a
  class hits `forNewItem` (`character-sheet.mjs`). All paths are gated by the world setting
  `dnd5e.disableAdvancements`.
- Every native path funnels through `AdvancementManager.render()`, which calls the
  **`dnd5e.preAdvancementManagerRender`** hook *before* drawing. Returning `false` aborts the native
  render. At that point the manager already holds `actor`, an in-memory `clone`, and a fully-enumerated
  `steps` array — and **the real actor is untouched** (all mutation happens on the clone until commit),
  which gives us clean rollback for free.
- Caveat: the hook fires on *every* render (each step), before the auto-apply check — it's a blunt
  "suppress native UI" switch, not a per-step callback. Once we take over, our driver owns the loop.

### 2.2 Step enumeration is sequential, not fully known up front
- `createLevelChangeSteps` enumerates, per gained level: race/species, class, **subclass**, and
  class-linked item flows — covering HP, ASI, ItemGrant, ItemChoice, ScaleValue, Trait, Size, Subclass.
- **A subclass's own features are not in the initial step list** at the subclass level — the subclass
  item doesn't exist until the Subclass advancement applies. They're injected mid-flight by
  `#synthesizeSteps` during forward processing.
- **Design consequence:** a level-up cannot be fully known up front the way creation is. It is a
  *pipeline* where choosing the subclass (or an ASI→feat) reveals new choices. The UI must therefore
  re-resolve after such picks. We do this **in place** on a per-level screen (§3.5): a revealed
  choice appears as a new block on the level it belongs to, and the screen rebuilds every render —
  rather than splicing a surprise new step into a linear rail.

### 2.3 Apply mechanics — drive and commit the clone
- Every advancement's `apply(level, data)` mutates `this.actor` via **`updateSource`** (in-memory only):
  HitPoints, Trait, ASI, Subclass, etc. The canonical persist is the manager's private `#complete`:
  `clone.toObject()` diffed into an actor-update + item create/update/delete, written with
  `isAdvancement: true`.
- So the robust path is **apply choices onto the manager's `clone`, then commit the clone once** — not
  the creation module's "hand-apply on the live actor afterwards" trick (which works at level 1 partly
  by ordering luck). We already harvest exactly this shape via `dnd5e.preAdvancementManagerComplete` in
  [advancement-apply.mjs](../scripts/build/advancement-apply.mjs).
- Per-type `apply` data shapes for hand-driving:
  - **HitPoints:** `apply(level, { [level]: "avg" | "max" | <rolledNumber> })`
  - **ASI:** `apply(level, { type: "asi", assignments: { str: 1, … } })` or `{ type: "feat", uuid }`
  - **Subclass:** `apply(level, { uuid })`
  - **Trait:** `apply(level, { chosen: [keys] })`
  - **ItemGrant / ItemChoice / Size / ScaleValue:** already handled by the existing creation code.

### 2.4 There is NO spellcasting advancement
- The advancement types are exactly: AbilityScoreImprovement, HitPoints, ItemChoice, ItemGrant,
  ScaleValue, Size, Subclass, Trait. **No "spellcasting" type exists.**
- Spell slots are derived from class progression; learning / preparing / swapping spells on level-up is
  done manually on the sheet. So **spell progression cannot be done by wrapping the manager** — it is a
  fully custom feature (reusing our [spells-step](../scripts/steps/spells-step.mjs) and spell-source
  infra), and is the largest unknown. Sequence it last.

## 3. Architecture

```
scripts/
  levelup/
    intercept.mjs        # preAdvancementManagerRender hook + (gated) sheet button → launch shell
    manager-driver.mjs   # wraps AdvancementManager: enumerate steps, apply picks to clone, commit
    levelup-state.mjs    # session: actor, class, from→to level, picks, HP/ASI/spell selections
    levelup-shell.mjs    # ApplicationV2 shell (shares rail/stage templates with the creator)
    registry.mjs         # builds one step per gained level (§3.5) + a final review, each render
    steps/
      level-step.mjs     # composite: one screen carrying ALL of a level's choices, routes actions
      subclass-step.mjs  # subclass pick at the class's subclass level
      hp-step.mjs        # roll vs average
      asi-step.mjs       # +2 / +1+1 vs feat
      choices-step.mjs   # ItemChoice features (Fighting Style, Maneuvers, …)
      trait-step.mjs     # choice-bearing Trait advancements (Weapon Mastery, languages, …)
      lvl-review-step.mjs
      lvl-spells-step.mjs  # post-commit spell selection (Phase 4)
      # planned: multiclass-step.mjs (Phase 5)

The per-type modules (subclass/hp/asi/choices/trait) are no longer rail steps in their own right;
each is a **section provider** (`sectionsAt(ctx, level)` / `isCompleteAt(state, level)`) that
`level-step.mjs` composes into one screen and dispatches to by action prefix (§3.5).
```

### 3.1 Shared shell
Extract the common shell guts (PARTS, nav helpers, `#dispatch`, drag-drop) from
[creator-shell.mjs](../scripts/app/creator-shell.mjs) into a base mixin both shells extend. Do this in
Phase 1 once the level-up shell's needs are concrete — not speculatively.

### 3.2 Driver = clone-driven sequential stepper
Intercept `preAdvancementManagerRender` → return `false`, take the manager, and run our own loop over
`manager.steps`:
- automatic steps → apply `automaticApplicationValue` to the clone;
- renderable steps → pause for our UI, then `flow.advancement.apply(level, data)` on the clone;
- after steps that add items (Subclass, ASI→feat, ItemGrant), re-run the system's `flowsForLevel` on the
  new items to fold in their advancements (replicating `#synthesizeSteps`);
- commit by replicating `#complete` (`clone.toObject()` → create/update/delete), the same shape we
  already harvest via `preAdvancementManagerComplete`.

### 3.3 Phase 0 must also decide the synthesis strategy
Two ways to handle subclass-revealed steps:
- **(a)** re-implement `#synthesizeSteps` ourselves (more code, full control); or
- **(b)** let the native manager run with `automaticApplication: true` and inject choices through the
  `automaticApplicationValue` override seam, so dnd5e does its own synthesis and commit (less code, but
  couples to private re-entrant render behavior).
The spike picks one.

### 3.4 Spells (custom) — implemented
No manager involvement (there is no spellcasting advancement, §2.4). A standalone
[lvl-spells-step.mjs](../scripts/levelup/steps/lvl-spells-step.mjs) runs **after** the level grant
is committed to the actor and edits the actor directly: it reads the true derived capacity —
`preparation.max`/`.value` for leveled spells, the "Cantrips Known" scale, and `actor.system.spells`
for the top slot level — and lets the player add the cantrips and spells the level unlocked, from the
class's spell list via a generalised [SpellSource](../scripts/data/spell-source.mjs)
(`forClassAtLevel`). Picks are staged and written on finish, reusing the creation flow's
`prepared:1`/`method:"spell"`/`sourceItem` recipe. A caster may also **swap one spell** per bucket
(Phase 4b): marking a known spell frees a slot to learn a different one, and on finish the marked
spell is deleted only if that freed slot was used. Subclass casters (Eldritch Knight / Arcane
Trickster) are handled by detecting the spellcasting subclass and scoping the pool and `sourceItem`
tag to it. See Phase 4 / 4b for the full status.

### 3.5 UI: one screen per level (implemented)
Level-up groups **all of a level's choices onto a single screen** rather than the creation flow's
one-decision-per-screen rail. A multi-level (XP) jump produces one such screen per gained level, in
order; the rail lists the levels (`Level 4`, `Level 5`, …) followed by `Review`.

How it works:
- The driver stamps every surfaced decision with a `screenLevel` — the level on whose screen it
  belongs. This is normally the decision's own `level`; the one exception is a feat's synthesised
  sub-choices, which come off level-0 flows and inherit the granting ASI's level. Subclass-revealed
  features already carry their true class level, so in a multi-level jump a later level's subclass
  feature lands on that later level's screen automatically.
- `LevelUpState.gainedLevels()` derives the screen set (every gained level grants at least hit
  points, so the union of decision levels = the gained levels). `registry.buildSteps` maps each to a
  `levelStep(level)` and appends review.
- `levelStep` composes the per-type **section providers** in a fixed order — hit points, subclass
  (placed before features so its picks can reveal them), ASI/feat, features, traits — emitting one
  labelled block per non-empty section. The per-type `.hbs` templates are reused unchanged; actions
  are routed to the owning provider by prefix (`hp*`, `asi*`, `choice*`, `trait*`, `pick-subclass`),
  so no per-control tagging was needed.
- **Re-resolution is in place:** the shell rebuilds the step set every render, so a subclass/feat
  pick that reveals further choices makes a new block appear on its level's screen, and that level
  stays incomplete (blocking Next/Apply) until the revealed choices are made.

This is the §2.2 "re-resolve after such picks" requirement, satisfied by growing/shrinking the
blocks on a level's screen rather than splicing surprise steps into a linear rail.

## 4. Triggering: native hook + setting-gated fallback button

Primary path — transparent takeover of the system's own level-up:

```js
Hooks.on("dnd5e.preAdvancementManagerRender", manager => {
  if (!levelUpEnabled()) return;            // module mode setting (§5)
  if (heroMancerActive()) return;           // coexistence guard (§6)
  if (!shouldTakeOver(manager)) return;     // only class/level changes; owner; not already claimed
  launchLevelUpShell(manager);
  return false;                             // suppress dnd5e's native manager
});
```

Fallback path — only when the system never builds a manager:

```js
Hooks.on("renderActorSheet", (app, html) => {
  if (!levelUpEnabled() || heroMancerActive()) return;
  if (!game.settings.get("dnd5e", "disableAdvancements")) return;  // hook covers the normal case
  injectLevelUpButton(html, app.actor);     // mirrors the creator launch button in main.mjs
});
```

This split is mutually exclusive and avoids double-triggering:
- **`disableAdvancements` OFF (default):** system builds the manager → our hook takes over → no button.
- **`disableAdvancements` ON:** system builds no manager → the button is the only entry point, shown
  exactly when needed.

Guards for the spike: only claim managers that are genuine level-ups (inspect `manager.steps` / the
class step data, not deletions or config edits), and mark a claimed manager instance so re-entrant
renders don't double-launch.

## 5. New module setting: creation-only vs creation + level-up

Add a world setting so a table can opt level-up in or out independently of creation.

- Key (add to `SETTINGS` in [config.mjs](../scripts/config.mjs)): `mode: "mode"`.
- Type: `String` with choices:
  - `"creation"` — creation wizard only (current behavior).
  - `"creation-levelup"` — creation **and** level-up takeover.
- **Default:** `"creation"` (ship level-up off so existing worlds are unchanged until the GM opts in;
  flip the default in a later release once it's proven).
- Registration mirrors the existing world settings in [main.mjs](../scripts/main.mjs) `registerSettings()`.
- Helper in config.mjs:

```js
export function levelUpEnabled() {
  return game.settings.get(MODULE_ID, SETTINGS.mode) === "creation-levelup";
}
```

Both trigger paths in §4 are gated on `levelUpEnabled()`, so `"creation"` leaves the actor sheet and the
native advancement flow completely untouched.

## 6. Coexistence with Hero Mancer (decided: stand down — option 1)

Hero Mancer (3.0.4) occupies the same functional space — its own description says it *"handles level-ups
and multiclassing later from a button on the sheet."* But it takes the **opposite** architecture:

| Axis | This module (planned) | Hero Mancer |
|---|---|---|
| Mechanism | **Wraps** dnd5e's `AdvancementManager` (`preAdvancementManagerRender`) | **Replaces** it — no `AdvancementManager` refs in its bundle |
| Native engine | Relies on it (leaves `disableAdvancements` off) | Asks the GM to **disable** it (sets `dnd5e.disableAdvancements`, shows a consent prompt) |
| Trigger | Transparent on native level-up; button only as fallback | Dedicated sheet button (`hm-sheet-level-up-button`) |
| Footprint | Self-contained, dnd5e only | Suite: sockets, GM approval queue, level-up broadcasts, 2014/2024 rules awareness |
| Spells | In-module | Delegated to the separate **Spell Book** module |

The distinction is genuine: **we stay inside dnd5e's rails and re-skin them; Hero Mancer builds a
parallel system beside the rails.** Our positioning is the same minimal, native-feeling, zero-config,
no-extra-modules pitch that already differentiates the creator.

**The collision:** Hero Mancer turns `disableAdvancements` **ON** — which is exactly the condition that
(a) silences our `preAdvancementManagerRender` takeover and (b) *shows* our fallback button. With both
active you'd get duplicate "Level Up" buttons and the native engine our wrap depends on would be off.

**Decision — option 1: detect Hero Mancer and stand down.** Both trigger paths bail when Hero Mancer is
active:

```js
const heroMancerActive = () => !!game.modules.get("hero-mancer")?.active;
```

This keeps us distinct *and* a good neighbor: we're the lightweight native-wrap choice; if a table has
opted into the Hero Mancer suite, we don't compete for the same actor.

## 7. Phasing

- **Phase 0 — Spike (½–1 day):** confirm interception (`preAdvancementManagerRender`), step enumeration,
  the synthesis strategy (§3.3 a vs b), and clone-commit. Confirm the Hero Mancer + `disableAdvancements`
  behavior end-to-end. Throwaway probe + findings note, not production code.
- **Phase 1 — Single-class, no-choice levels:** intercept → minimal wizard (HP + review) → commit the
  clone. Add the mode setting and both trigger paths with their guards. Snapshot/rollback on cancel.
  _Status: implemented (`scripts/levelup/`). The `LevelUpDriver` reimplements the manager's private
  forward/synthesize/complete loop over the clone; `canDrive()` conservatively claims only level-ups
  whose every renderable step is hit points, so any level carrying an ASI/subclass/feature choice still
  falls through to the native flow until those phases land. Cancel discards the driver (actor untouched).
  Not yet exercised in a live Foundry — needs a manual run-through._
- **Phase 2 — Choice levels (features):** parameterize the `level ≤ 1` guards in
  [choice-resolver.mjs](../scripts/data/choice-resolver.mjs) and
  [advancement-apply.mjs](../scripts/build/advancement-apply.mjs) by the session's target level; reuse
  the choices-step rendering.
  _Status: feature choices (`ItemChoice` — Fighting Style, Maneuvers, etc.) implemented directly on the
  driver rather than via the creation choice-resolver: the driver surfaces each `ItemChoice` as a
  decision and applies the player's picks to the clone with the advancement's own grant/ungrant
  (`apply({selected})` / `reverse({uuid})`), rendered by a new `levelup/steps/choices-step.mjs`. Known
  gap: a chosen item that itself carries advancement choices won't re-resolve sub-steps (rare for
  level-up feature picks; subclass-driven synthesis is Phase 3). Not yet run live._
  _Also implemented: **species spell grants at class levels** (`ItemGrant` advancements that grant a
  spell with a choosable casting ability — a High Elf lineage's Detect Magic at L3, Misty Step at
  L5). Previously these were `supported: false`, so any level-up carrying one fell through to the
  native flow. The driver now grants the spell to the clone with a default ability (reusing the
  ability a sibling lineage grant already chose, else the first allowed) and surfaces an Int/Wis/Cha
  picker (`levelup/steps/grant-step.mjs`); only genuinely **optional** grants stay unsupported.
  `canDrive`/`isStepSupported` updated to match. Not yet run live._
- **Phase 3 — ASI/feat + subclass:** the +2/+1 vs feat screen and the subclass pick, with pipeline
  re-resolution after each.
  _Status: ASI implemented (`levelup/steps/asi-step.mjs`) — point-budget distribution with per-ability
  +/- steppers (caps + budget enforced via reverse→reapply for idempotency) and a "take a feat instead"
  path that picks through the system CompendiumBrowser and grants the feat. Choosing a feat now folds
  in the feat's *own* advancements via the shared `#ingestItemFeatures`/`#reverseSynth` helpers — a
  half-feat's fixed ability bonus auto-applies, granted features/traits land, and a sub-choice surfaces
  as a further decision (cleanly reversed if the feat changes). Remaining gap: a feat sub-choice that
  *restricts* which abilities a point may go to isn't yet limited in the UI. Review now lists ability
  increases.
  Subclass implemented (`levelup/steps/subclass-step.mjs`): the pick goes through the system
  CompendiumBrowser (filtered to the class), and `resolveSubclass` folds the subclass's features in by
  enumerating its flows up to the class level and ingesting each (auto-apply automatics, surface
  renderable ones as new decisions) — so a Features block can appear on the level's screen *after* the
  subclass is chosen. The shell rebuilds its step set every render, so the blocks grow/shrink in place
  with the pipeline (the re-resolution §2.2/§3.5 called for). Changing the subclass reverses
  everything it added.
  Known gap: a synthesised subclass feature that itself carries a choice isn't recursed into yet._
- **Phase 4 — Spells:** standalone custom build (no manager).
  _Status: implemented (`levelup/steps/lvl-spells-step.mjs`). The single "Apply" is now a two-phase
  finish in the shell: **Phase A** commits the driver's clone to the real actor (as before); if the
  leveled class gained cantrip/spell capacity, the shell stays open and reveals a **Spells** step
  (the level screens lock behind it), and **Phase B** ("Done") writes the staged picks. `computeSpellPlan`
  derives the add budget from the system's own spellcasting fields (`preparation.max`/`.value`, the
  cantrip scale, `system.spells`); the pool comes from `SpellSource.forClassAtLevel`, which
  generalises the creation loader from level-≤1 to the actor's full castable range. The step covers
  all single-class casters, prepared and pact, plus **subclass casters** (Eldritch Knight / Arcane
  Trickster) by scoping capacity, pool, and the `sourceItem` tag to the spellcasting subclass.
  Add-only — spell/cantrip swaps are a follow-up. If a caster gained no capacity (or is a non-caster)
  there is no spell step and Apply closes as before. Not yet run live — needs a manual run-through
  (Wizard L1→L2, Cleric L2→L3, Warlock pact, EK, multi-level jump, non-caster, cancel-after-commit).
  Known gap: a subclass caster's pool is only populated when its spell list is registered under the
  `subclass` registry type (the correct dnd5e authoring); otherwise the step still appears but lists
  no options._
- **Phase 4b — Spell swaps:** the 2024 level-up rule that lets a caster replace one known spell (and,
  with some features, one cantrip).
  _Status: implemented on the same spell step. Within any bucket that has add capacity, each owned
  spell appears as a swap-out candidate (leveled picks limited to regularly-prepared spells, so
  always-prepared/granted spells can't be traded away). Marking one (`state.swapCantrip`/`swapSpell`)
  frees one extra slot to learn a replacement; `spellChanges` deletes the marked spell only when the
  freed slot was actually used, so marking without replacing is a harmless no-op. One swap per bucket.
  Scoped for simplicity to buckets that also grant new spells (you replace a spell in the same breath
  as learning one) — a level that grants no capacity in a bucket offers no swap there. Not yet run
  live. Not modelled: multi-spell swaps, or class-specific "no swap" rules (prepared casters that
  re-prepare on rest are offered the swap as a harmless convenience)._
- **Phase 5 — Multiclassing:** add-a-class entry, ability prerequisites, multiclass slot table; reuses
  the creation class-pick UI and the level-0→1 path.

## 8. Cross-cutting risks

- **Manager coupling** — the whole wrap rests on Phase 0; if a flow type resists programmatic apply, fall
  back to dnd5e's own mini-dialog inside our frame for that type, and note it.
- **Rollback correctness** on a live, in-play actor — test cancel at every step (creation's empty-draft
  cleanup does not apply here).
- **Existing items / active effects** must survive a re-run without duplication.
- **XP-driven vs manual level-up** — confirm in the spike whether both should be intercepted.
- **Spells (§3.4)** — no system scaffolding to lean on; budget accordingly.
