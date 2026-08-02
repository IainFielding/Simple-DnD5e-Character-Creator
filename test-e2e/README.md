# End-to-end equivalence harness

Builds the same character twice in a real Foundry world — once through the **dnd5e system's own
AdvancementManager**, once through the **Simple Character Creator** — and diffs the results.

Tracked in git, but **never shipped** — the release archive in `.github/workflows/main.yml` names
its contents explicitly rather than packaging the repo. Three things stay out of version control:
`config.mjs` (absolute paths to one machine's Foundry install), and the run output (`*.jsonl`,
`*.log`, `*.html`), which quotes item descriptions verbatim and so carries text from the paid content
packs under test.

Copy `config.example.mjs` to `config.mjs` and edit the paths before the setup steps below.

## Layout

| Path | Role |
| --- | --- |
| `config.mjs` | Machine paths, port, world definitions, module lists |
| `lib/server.mjs` | Spawns/stops the Foundry server |
| `lib/session.mjs` | Playwright: launches Chromium, joins the world as Gamemaster |
| `lib/worlds.mjs` | Writes `world.json` manifests |
| `provision.mjs` | One-time world setup: modules, adventure import |
| `run.mjs` | Runs the suite and prints the diff |
| `shell.mjs` | Diagnostics; `--hold` leaves the browser open |
| `in-world/*.mjs` | Everything that runs **inside** the world |
| `in-world/answers.mjs` | The answer book: one decision-answering strategy, both adapters |
| `in-world/sweep.mjs` | Generates one scenario per subclass in the world |

Playwright is only the boot loader — it launches a browser, logs in, and calls into
`in-world/harness.mjs`. There are no selectors for game UI on the Node side.

The `in-world/` files are served over HTTP from Foundry's own static route
(`/modules/sogrom-dnd5e-character-creator/test-e2e/in-world/…`), because the repo is
junction-linked into `Data/modules`. That means they are ordinary ES modules with real imports —
into each other, and into the module under test.

## Setup

```bash
cp config.example.mjs config.mjs   # then edit FOUNDRY_ROOT, DATA_PATH, MODULE_SOURCE
npm install                 # in test-e2e/
npx playwright install chromium
npm run link-module         # junction Data/modules/sogrom-dnd5e-character-creator -> repo
npm run provision           # create + configure both worlds
```

`provision.mjs` is idempotent — re-run it after changing the module list in `config.mjs`.
`--reset` deletes the world databases and rebuilds; `--force` re-imports adventures.

## Worlds

| World | Modules |
| --- | --- |
| `playwright` | creator + dice-so-nice, dnd-dungeon-masters-guide, dnd-forge-artificer, dnd-heroes-faerun, dnd-monster-manual, dnd-players-handbook, dnd-ravenloft-horrors-within |
| `playwright-ember` | the same plus `ember`, with the Ember adventure imported |

Both run dnd5e 5.3.3 on Foundry 14.365, on port 30099 (not 30000).

**Foundry locks its data directory**, so the harness cannot run while the Foundry desktop app is
open. A crashed run leaves a lock that goes stale after ~10s; `startFoundry` retries through that.

## Running

```bash
node run.mjs                          # base world, all scenarios
node run.mjs playwright-ember         # the Ember world
node run.mjs --only human-fighter-sage
node run.mjs --keep                   # leave both built actors in the world to inspect
node run.mjs --list
node run.mjs --ids <compendium-uuid>  # dump an item's advancement ids + options
node run.mjs --find "feat:Actor"      # find items by name (optionally type-prefixed)
node run.mjs --subclasses wizard      # subclasses for a class identifier
node run.mjs --sweep                  # every subclass in the world, at level 20 (see below)
HEADED=1 node run.mjs                 # watch the native wizard being driven
```

Two tools for chasing a difference once the suite reports one:

```bash
node run.mjs --probe <uuid>                              # where a field first appears:
                                                         # _source / toObject / fromCompendium /
                                                         # clone round-trip / after create
node run.mjs --compare-item "<scenario>/<item name>"     # that item's raw source from both builds
```

`--compare-item` is usually the one you want: the suite reports *normalised* differences, which is
right for spotting them and useless for diagnosing them, and normalisation deliberately hides
things (item ids, timestamps) that turn out to matter.

Exit code is 0 only when every scenario is byte-identical after normalisation.

## Writing a scenario

`in-world/scenarios.mjs`. A scenario names the origins, the base ability scores, and answers each
choice **keyed by advancement id** — the one identifier both adapters see. Use
`node run.mjs --ids <uuid>` to get the ids, titles, pools and option keys for an item.

Answer shapes mirror the native form for each advancement type:

| Type | Answer |
| --- | --- |
| `HitPoints` | `"avg"`, `"max"` or a number (omit for a level-1 original class — it takes max automatically) |
| `Size` | `"med"` |
| `Trait` | `["skills:ath", "skills:ins"]` — flat, across every choice pool |
| `ItemChoice` | `["<uuid>"]` or `{ uuids: [...], ability: "int" }` |
| `ItemGrant` (spell ability) | `"int"` |
| `AbilityScoreImprovement` | `{ int: 2, wis: 1 }` — the *total* per ability, fixed part included |

The creator adapter splits a flat Trait answer across the resolver's per-pool requirements
automatically; a pick no pool offers is an error rather than a silently wrong character.

## The answer book

Both adapters answer from one `AnswerBook` (`in-world/answers.mjs`) rather than reading the table
themselves. It resolves each decision **once**, keyed by `advId@level`, and hands the identical value
to whoever asks second — which is the whole guarantee. The two builds walk at different times, off
different clones, in different orders, and none of that can make them disagree about what was chosen.

A scenario with **`generate: true`** has the book invent an answer for anything its table does not
cover: `"avg"` hit points, the first configured size, the first *N* keys of each Trait pool, the
first *N* eligible uuids of an ItemChoice, the whole ASI budget spent in str/dex/con/int/wis/cha
order. Picks are sorted before slicing, so a content update that reorders a pool cannot silently
change them. The six hand-written scenarios do **not** set it and behave exactly as before.

Generation prefers the advancement's own configuration, but some pools only exist against a
character — an expertise Trait is "skills you are already proficient in", a class skill pool excludes
what your background already granted, an invocation's item prerequisites depend on what you hold. For
those the asker passes the list *it* is showing and the memo carries the result across. If the other
side then cannot offer that key, it says so: a hand-written scenario throws (its table has gone stale
against the content), a generated one reports `decision.offered.<type>.<advId>` and carries on,
because the two sides offering different pools is itself the finding.

Two things the book adds to every report:

- **`decision.raised.…`** — a decision one adapter raised and the other never did. The character diff
  shows the *consequences* of a divergence; this shows the divergence. Only answered decisions count:
  the native wizard renders a step for every advancement, automatic ones included, and the driver
  applies those without surfacing anything.
- **A totality assertion.** A decision the book should have answered and could not fails that
  scenario by name, rather than producing an unexplained difference in every scenario that touches
  the same content.

## Unanswered choices

They are now symmetric, and that is a property of the module rather than of the harness.

dnd5e's manager pre-seeds every interactive step before rendering it —
`advancement.apply(level, {}, { initial: true })` — which is how a Trait's automatic grants, an
ItemGrant's non-optional items, an ItemChoice's default casting ability and an ASI's fixed increase
all land whether or not the screen is touched. `LevelUpDriver#ingestFlow` had replaced that single
call with a hand-rolled seed per type and had **none at all for Trait**, so an untouched Trait
granted nothing on our path and everything on the native one. It now makes the same call the manager
does (`#seed`), with hit points the one documented exception.

That removed `mergeTraitGrants`, which existed only to fold the dropped grants back in, and it means
a granted trait now renders locked-and-selected in the level-up wizard from the start — as the native
flow shows it, and as the rules mean it.

## How the two sides are driven

**Native** (`in-world/native.mjs`) renders the real wizard and fills real form controls, because
`AdvancementManager` keeps `#forward`/`#complete` private and each flow applies itself from its
rendered form. Calling `advancement.apply()` directly would mean re-implementing the walk under
test, so step-ordering and mid-walk synthesis bugs would become invisible. `manager._sogromLevelUp`
(the module's own re-entry guard) is set up front so the module's takeover stands down.

**Creator** (`in-world/creator.mjs`) populates a `CreatorState` and calls the real
`assembleActor()`, exercising choice-resolver → creation manager → `LevelUpDriver` → commit. It
does not click through the wizard UI: the UI's only job is to fill that state, and UI bugs are not
what this comparison is about.

**Comparison** (`in-world/normalize.mjs`) re-keys every embedded item by its compendium source
instead of its random `_id`, rewrites id references (including `value.added` object keys and
`flags.dnd5e.advancementOrigin`), drops volatile and identity fields, and diffs both the source
document and the derived state (abilities, HP, proficiencies, scale values, item lists).

## Gotchas found the hard way

- **Do not pass `--noupnp`.** It also skips network-address discovery, leaving `express.addresses`
  null; the join then throws in `getInvitationLinks` and the client dies in `new Game()` with a
  *ReleaseData validation* error that has nothing to do with the real cause. `--noipdiscovery` is
  the flag you want.
- Foundry opens its port before the listen callback finishes, so the harness settles for 3s and
  retries the join once.
- Flows paint their frame before their content resolves. Never click Next until `flow.form` exists
  (submitting without it throws inside `FormDataExtended` and silently strands the wizard), and
  wait for a specific control to appear rather than reading the pool once. `ensureFlowRendered`
  handles the usual case, but a flow can still come up with an empty pool and time out — roughly one
  run in ten strands `human-fighter-sage` on "Versatile" with "offered: nothing". Re-run before
  chasing it. The tell is the scenario timings: a run where it happens is visibly *faster*, because a
  scenario died early.
- Never nudge with `manager.render()`. It re-runs `advancement.apply(level, {}, {initial: true})`,
  and a nudge overlapping the manager's own in-flight render gives two `apply` calls that both read
  an empty `value.added` — producing duplicated grants that look exactly like a creator bug.

## The subclass sweep

Every subclass the world has, built both ways at level 20. Breadth rather than judgement: the
scenarios above each exist to exercise one mechanism and argue for their answers in a comment; this
one just covers the content.

```bash
node run.mjs --sweep                  # 92 subclasses at level 20 (hours)
node run.mjs --sweep --level 6        # shallower
node run.mjs --sweep --shard 1/20     # every 20th, for a smoke test
node run.mjs --sweep --only artificer # substring match on the id, for chasing one finding
node run.mjs --sweep --resume         # skip what is already recorded
node run.mjs --sweep --plan           # list what it would run, and what it skips
```

Origins are the same Human/Sage the scenarios above use, so anything they contribute is already
characterised and will not be mistaken for a subclass finding. The class comes from the subclass's
own `classIdentifier`, and the Subclass advancement's id is read off the class document rather than
written down — an advancement id belongs to the content version that shipped it, so a hard-coded one
goes stale the moment a module updates. That is also why the sweep covers third-party classes it has
never seen.

**Node drives the loop**, one scenario per round trip, appending each report to
`sweep-results.jsonl` as it lands. A run this long must not lose two hours of results to one stranded
flow, and `--resume` reads that file back to decide what is left. The console gets one line per
scenario; the full difference list goes to the file. Triage by grouping on difference path — one root
cause spans many subclasses.

## Current status

`node run.mjs playwright` runs six scenarios:

| Scenario | Covers | Start of session | Now |
| --- | --- | --- | --- |
| `human-fighter-sage` | martial level 1: weapon mastery, fighting style, background ASI | 8 | 4 |
| `human-wizard-sage` | full caster level 1: spellcasting progression, ScaleValues, Int casting | 4 | **identical** |
| `human-wizard-sage-l3` | 1→3 in one manager: hit-point decisions, level-2 trait, subclass + its synthesised features | 6 | **identical** |
| `human-wizard-sage-l4-halffeat` | level-4 ASI answered with a feat, and the half-feat's own increase | 6 | 1 |
| `human-wizard-sage-featspells` | Magic Initiate's spells actually chosen, both routes | 18 | 11 |
| `fighter-multiclass-wizard` | a second class item: secondary advancements, a real first-level HP decision | 18 | **identical** |

What is left is entirely in the classes below: `human-fighter-sage` carries the four `source.book`
rows (they land on whichever scenario runs first, so an isolated `--only` run moves them), and
`featspells` carries the by-design feat-spells route.

The half-feat scenario's single row is a `decision.raised`, not a character difference: it reports
the Actor feat's own `+1 Cha` ASI as raised by the native side only. That is the known asymmetry the
"A forced increase still has to be stated" section below describes — the creator applies a
one-open-ability allocation at ingest without ever asking, so it never raises the decision. Both
characters end up with the +1; the harness reports the structural difference rather than leaving it
to prose.

The level-3 and level-4 scenarios each matched on their first run once the adapters supported
them, which is the useful result: subclass resolution, mid-walk feature synthesis, per-level hit
points, and a half-feat's grant-and-synthesise all agree between the rendered native wizard and
`LevelUpDriver.autoResolve`.

### Fixed (found by this harness, verified by it)

**1. Fighter fighting style was never offered at creation.**
`choice-resolver.mjs` gates each `ItemChoice` pool entry on its item prerequisites and bails
entirely when nothing survives (`if ( !options.length ) return;`). Every PHB fighting style
requires the *Fighting Style* feature — which carries no advancements of its own, so
`levelOneOwners()` skipped it, `collectOwnedIdentifiers()` never saw `fighting-style`, all four
styles were gated out, and the choice vanished. A creator-built Fighter got the Fighting Style
feature and no style. Fixed by recording advancement-less features as owner *leaves*.

**2. A Small-or-Medium species was silently forced to Small.**
dnd5e's `SizeAdvancement.automaticApplicationValue` compares the `sizes` **Set** to a number:

```js
if ( this.configuration.sizes > 1 ) return false;   // never true
return this.configuration.sizes.first() ?? "med";
```

so it reports the first size as automatic even for a real choice. `manager-driver.mjs`
`#ingestFlow` trusted it, applied Small, and never surfaced the decision — the player's pick was
discarded. The native flow escapes this because `forNewItem` leaves `automaticApplication` false.
Fixed by testing `configuration.sizes.size` directly, which is what `isStepSupported` already did
— the claim gate and the applied value had been disagreeing. **This affects level-up too, not just
creation.**

**3. New characters started below maximum hit points.**
dnd5e's `HitPointsAdvancement.apply` writes *current* HP as the hit die plus the Constitution
modifier **as it stands at that instant**. In the creation walk that instant is inside `prepare()`,
where the background's ability increase is only *surfaced* — its assignment happens later, in
`autoResolve()`. So a background that raised Constitution produced a character starting 1 HP
(or 2, for a +2 background) below its own maximum: `hp.max` is derived and self-corrected, the
stored `hp.value` did not. Re-applying the hit-point decisions cannot fix it — reverse and apply
both recompute from the *new* modifier, so the round trip is a no-op — so `actor-assembler.mjs`
now sets current to the prepared maximum once the walk commits.

Only the Wizard scenario caught this, because its background puts a point into Constitution and
the Fighter's does not. Worth remembering when judging how much coverage a scenario buys.

### Remaining differences, by class

Bisected with `--probe` (where a field first appears in an item's data) and `--compare-item`
(the same item's raw source from both builds). **An earlier note here called these one bug — that
was wrong.** They are two unrelated deviations, in opposite directions.

| Difference | Read |
| --- | --- |
| `flags.dnd5e.riders` `{activity:[],effect:[]}` on creator only | **The pack stores this flag** (`--probe` shows it in `_source`, and it survives `toObject()`, `fromCompendium()`, a clone round-trip, and `createEmbeddedDocuments`). So the creator is passing it through faithfully and the *native* side is dropping it — the opposite of what the shape of the diff suggests. It is dropped only on some items (Magic Initiate loses it, Second Wind keeps it), and the ones that lose it are ones the native flow *writes to* during the walk. Empty arrays either way, so nothing behaves differently; worth understanding, not worth fixing blind. |
| `system.source.book` `""` vs `"SRD 5.2"` | **Open.** A promising lead did not survive its own isolation test — see below before picking it up again. |
| Magic Initiate `value.ability` / `value.added`, and the granted spells' `advancementOrigin`, `advancementRoot`, `sourceId` | By design, and now measured. The creator defers spell `ItemChoice`s to its feat-spells step and `applyFeatSpells` creates the spells straight onto the actor, so the advancement records nothing and the spells are not tagged as advancement output. Consequence worth knowing: nothing links those spells back to the feat, so a later "modify choices" or a level-down will not clean them up. |

**4. Magic Initiate's free cast was uncastable** (fixed in `ace355b`).
`applyFeatSpells` re-derived the casting configuration by hand and got most of it right — method,
prepared state, `uses.max`, the long-rest recovery — but the native build's level-1 spell also
carried an activity the creator's did not:

```
system.activities.<id>
  native : { type: "forward", name: "(free casting)",
             consumption: { targets: [{ type: "itemUses", … }] }, … }
  creator: <missing>
```

That activity is *how* the once-per-long-rest free cast is cast. The creator set up the counter
that backs it and never created the activity, so the character had the charge and no button to
spend it with. Fixed by handing the created spell to the system's own `applySpellChanges` when the
feat carries a spell `ItemChoice` to borrow the configuration from; the hand-rolled block remains
only for the advancement-less PHB-module copy. The spell now matches the natively-granted one
exactly.

Exactly the drift this scenario was written to catch: two implementations of one spell
configuration, one of them the system's, kept in step by hand.

### `system.source.book`: still open, and two probes disagree

The difference in built characters is real and reproducible: creator `"SRD 5.2"`, native `""`,
on class-sourced items, order-dependent across scenarios.

`--probe <uuid> --warm` appeared to pin it on `SourceIndex.warmAll()` writing the derived value
into the cached compendium document's `_source`:

```
_source, before warm   ""
prepared               "SRD 5.2"
_source, after warm    "SRD 5.2"
```

**`--probe-warm` does not reproduce that**, and it is the more careful test — it runs each warm
call against a separate untouched document, then all three against another, then the real
`warmAll()` against the granted feature the symptom was first seen on. Every one comes back
`changed: false`, `_source` still `""`.

The two probes disagree on the same measurement, which most likely means they are not reading the
same document *instance*: `--probe` holds one `fromUuid` result and reads `_source` off it, while
`--probe-warm` re-fetches each time. If compendium `fromUuid` does not hand back a single shared
instance, then "the cached document got polluted" is the wrong frame for this entirely, and the
`--probe` reading says something narrower — that *that* instance was mutated, not the cache.

So: do not treat the warm as the culprit. The next step is to establish whether `fromUuid` on a
compendium entry returns a stable instance, because the answer decides which of the two probes is
measuring the thing that actually reaches a built character.

### CLOSED: a multiclass caster gets no spellcasting ability

**Not a creator bug.** The analysis below reasoned from the un-awaited hook to a race inside
`commit()`; the real cause was that this harness read the actor before that un-awaited write landed.
See "`attributes.spellcasting` was never a creator bug" above. The scenario is now 6 differences,
none of them spellcasting. Kept for the mechanism, which is worth knowing:

```
source.actor.system.attributes.spellcasting   native: "int"   creator: ""
derived.spellcasting.dc                       native: 12      creator: 10
```

A creator-built Fighter 1 / Wizard 1 has no spellcasting ability recorded, so its spell save DC
falls back to 10 instead of 12. User-visible and wrong.

Mechanism is the same shape as the `details.background` race below — dnd5e sets the field from an
**un-awaited** hook, `ClassData._onCreate` (`data/item/class.mjs:288`):

```js
if ( !actor.system.attributes?.spellcasting && this.parent.spellcasting?.ability ) {
  await actor.update({ "system.attributes.spellcasting": this.parent.spellcasting.ability });
}
```

while `LevelUpDriver#commit` writes the actor and creates the items concurrently, and the clone's
`attributes.spellcasting` is empty. If the clone's update lands last it overwrites what the hook
just set. Creation-time single-class casters come out right (the level-1 Wizard scenario is
clean); the multiclass leg loses the race.

That reasoning was sound and the conclusion was wrong: `Promise.all` starts the actor update first,
so the hook's write lands after it and survives. The lesson worth keeping is the general one — a
field a system hook sets from an un-awaited update is not readable the instant `commit()` resolves,
so anything comparing actors has to let those writes settle first.

### `system.details.background`: a race in the system, not a creator bug

This appeared in the feat-spells scenario only — null on the native build, set on the creator's —
which is exactly what a race looks like. It is one.

dnd5e links the background from `BackgroundData._onCreate`
(`data/item/background.mjs:103`):

```js
_onCreate(data, options, userId) {
  …
  this.parent.actor.update({"system.details.background": this.parent.id});   // not awaited
}
```

Meanwhile `AdvancementManager#complete` writes the actor and creates the items **concurrently**:

```js
await Promise.all([
  this.actor.update(updates),                              // updates.system.details.background === null
  this.actor.createEmbeddedDocuments("Item", toCreate, …), // triggers the _onCreate above
  …
]);
```

The clone never had the link, so `updates` carries `background: null`. Whether the character ends
up linked depends on which of those two writes lands last. The feat-spells scenario does more work
inside the background's manager — Magic Initiate's synthesised spell steps, driven through the
compendium browser — which is enough to flip the ordering.

The creator is unaffected because it sets `system.details.background` explicitly in
`assembleActor`'s own update *before* the manager runs, rather than relying on the hook. So the
creator is right here and the native reference is the unreliable one. Nothing to fix in the module;
worth knowing that this field cannot be trusted as an oracle, and worth remembering if a user ever
reports an unlinked background on a natively-built character.

The bisect also turned up something the diff could not show, because the normaliser rewrites it:
the creator was staging origin items with the **compendium's own `_id`**, so every Sage-background
character shared one item id and granted features recorded
`advancementOrigin: "phbbgSage0000000.<advId>"` instead of an actor-local id. Fixed in `c1ec61d`
(the system does the same thing itself in `forNewItem`). It did **not** fix `source.book`.

## Levels above 1

A scenario with `targetLevel: N` runs a second leg after the level-1 build, on both sides:

- **Native** — `AdvancementManager.forLevelChange(actor, classId, N - 1)`, driven through the
  rendered wizard exactly as the level-1 leg is.
- **Creator** — the same manager driven by `LevelUpDriver.autoResolve`, answered by
  `in-world/provider.mjs`. The creator's real hand-off (`intercept.mjs#launchLevelUpTo`) passes
  1→N to the interactive `LevelUpShell`, and the shell exists only to fill the provider interface
  `autoResolve` reads — so answering it directly exercises the whole driver with just the UI left
  out. It is the same one-manager, one-commit jump the module performs.

Subclass is the one answer with no form field behind it: the flow is drop-only, so the native
adapter dispatches a real `drop` event carrying `{type: "Item", uuid}` at the flow's form, which
lands in `_onDrop` and applies the advancement. `node run.mjs --subclasses wizard` lists candidates.

Keep hit points on `"avg"` or `"max"`. A rolled die is not reproducible, so a scenario that rolls
can never be an equivalence test.

## Taking a feat at an ASI level

An ASI answer of `{ feat: "<uuid>" }` takes a feat instead of allocating points. This needed
module support: `autoResolve` previously only ever called `setAsi`, so the headless path could
spend an ASI on ability points and nothing else — which also made half-feats unreachable, since
every one of them is a general feat taken at an ASI level. `applyAsiFeat` is now the browser-free
half of `chooseAsiFeat`, and `autoResolve` routes a feat answer to it.

The native side still needs the compendium browser, because `data-action="browse"` →
`CompendiumBrowser.selectOne()` is the flow's only route to a feat. The adapter stubs `selectOne`
for exactly one call and restores it in a `finally`; the flow's own browse handler, prerequisite
check, apply and re-render all run for real around it. The stub stands in for the user's click
inside the modal, nothing more.

**A forced increase still has to be stated.** A half-feat whose increase has one legal target
(Actor's "+1 Charisma" is one point with the other five abilities locked) is applied outright by
the creator — an allocation with nothing to allocate — but the native flow renders the score
un-incremented with a live "+" button (`ability-score-improvement-flow.mjs` sets
`value: sourceValue`, `canIncrease: true`) and assigns nothing until it is clicked. So a scenario
that leaves it unanswered gets +1 from the creator and nothing from the native reference. The
creator is the one following the rules there; state the answer anyway so the scenario tests that
both sides *can* apply it rather than re-reporting a known divergence every run.

### Found by the sweep, fixed

**A class ASI applied nothing on the native side.** The first thing the sweep caught, and the worst:
every subclass would have come out short at levels 4, 8, 12, 16 and 19. Under the 2024 rules a
*class* ASI opens on a choice between points and a feat, and the flow does not render the ability
inputs at all until the points side is picked —
`showImprovement = !modernRules || !allowFeat || isASI` in `ability-score-improvement-flow.mjs`.
`fillAsi` looked for `input[name="abilities.str"]`, found nothing, and `continue`d. The build came out
two points down and the diff blamed the creator for applying an increase the native reference had
simply dropped.

Two reasons the six scenarios never saw it. A *background* increase offers no feat, so
`showImprovement` is true and the inputs are there from the start — which is the only ASI the level-1
scenarios exercise. And `human-wizard-sage-l4-halffeat`, the one scenario that reaches a class ASI,
answers it with a feat and takes the browser path instead.

`fillAsi` now ticks `asi-selected` first, and a missing input throws rather than being skipped. The
silent `continue` was the actual defect; the missing checkbox was just what it hid.

**A subclass's spell grants looked one-sided, and were not.** "Always Prepared Spells",
"Cartographer Spells" and friends reported as `decision.raised` on the native side only. They are all
`spellAbility: ["int"]` — one allowed ability, so nothing to decide, so
`automaticApplicationValue` applies them on both paths without asking anyone. The native wizard still
*renders* a step for an automatic advancement and so still asked the book; the driver applied it
silently. The book now answers a single-ability grant with `null`, the same as it does a ScaleValue or
a grants-only Trait. A false positive, but an expensive-looking one: five per prepared-caster
subclass across a level-20 run.

**Tool proficiency keys disagreed.** The Artificer's "Tool Proficiencies" choice offered
`tool:art:alchemist` natively and `tool:alchemist` from our resolver, so neither side could consume
the other's answer.

`expandToolPool` flattened deliberately: dnd5e's Trait apply pops the last `:` segment to reach
`system.tools.<id>`, so the bare key does grant the proficiency. But applying is not the only thing
the system does with a recorded key. `Trait.actorValues` reports the character's existing tools in
the prefixed form, and `unfulfilledChoices` matches `value.chosen` against pools expanded by
`Trait.mixedChoices`, which is prefixed too. A flattened key matches neither, so the fulfilled choice
never gets spliced off `available` and the pick reads as neither owned nor made — a tool chosen at
creation reappeared as pickable on a later level-up's tool screen.

We were the outlier: our own level-up path already assumed the prefixed form (see
`test/levelup-quota.test.mjs`). `expandToolPool` now keeps the category. Both Artificer subclasses
drop to `riders` alone.

### The sweep, run to run

92 subclasses at level 20, ~40 s each, about 70 minutes. `node report.mjs` groups the results into a
ranked HTML/terminal report — a normalised signature per cause, so one root cause is one row rather
than one row per item it touched.

| | identical | differing | errored | rows | causes |
| --- | --- | --- | --- | --- | --- |
| First run | 0 | 91 | 1 | 514 | 23 |
| After the fixes below | **91** | 1 | 0 | 5 | 3 |

The one remaining difference is Artificer Battle Smith, and it is dnd5e's rather than ours — see
below. Every cause in the report is now a documented one.

`sweep-results-run1.jsonl` keeps the first run for comparison; `sweep-results-final.jsonl` is the
current one.

Two of the original 23 were the harness's own and are fixed (verified by re-running a five-subclass
subset, which came back with no errors and no language rows):

**Unordered collections were compared positionally** — 14/92 language rows and most of the 83
`itemsByType.spell[]` rows. `traits.languages.value` is a `Set` in the schema, serialised to an
array; the two builds insert in different orders, so a character who knew Draconic, Dwarvish and
Thieves' Cant read as three differences against a character who knew exactly the same three. The
same defect turned one missing spell into a row for every spell after it. `diff` now compares
primitive arrays as multisets, so a pure reordering reports nothing and a real gap reports once.

**A pre-v10 uuid was answered verbatim** — the run's only error. The Ranger's "Hunter's Prey" pool
stores `Compendium.<pack>.<id>` with no `.Item.` segment, while the rendered checkboxes use the
modern form, so the generated answer named a control that did not exist. `generateItemChoice`
already resolves each pool entry to check its prerequisites; it now answers with `doc.uuid`.

**Expertise only offered skills the same source granted** — 8/92, every Rogue and Bard, and the
most consequential thing the sweep found.

The Rogue's Expertise is `mode: "expertise"` over a pool of `skills:*`, which dnd5e intersects with
every skill the *character* is proficient in. `proficientSkillKeys` walked only the offering source's
own advancements, so a skill from the species or background was never offered. A Rogue with a Sage
background is proficient in Arcana and may take Expertise in it by the rules; the creator did not
offer it, and the character came out on proficiency 1 where the native build has 2.

Fixed by computing the pool across the whole build, beside the two things `resolveChoices` already
computes that way (`collectTakenTraitKeys`, `collectOwnedIdentifiers`) — Expertise belongs there for
the same reason. The three build-wide values now travel as one `shared` object rather than as
positional arguments. **Creation only**: the level-up path reads the system's own `actorSelected()`
and was always right.

Chasing it also exposed a harness bug worth keeping in mind: `unofferable` recorded on the first
resolver pass, but the fixed-point loop legitimately passes through empty pools on its way to the
answer — before the class's skill choice is answered, Expertise really does offer only what the
background granted. It now records the *settled* pass only. Before that, a transient was being
reported as a finding and the corrected state never surfaced.

All eight Rogue/Bard scenarios now come back with `riders` alone.

**An increase nobody decides was applied too early, and ate the player's points** — 6/92 with a real
ability difference (every Barbarian), 12/92 raising a one-sided decision (Barbarians and Monks).

`prepare()` walks *every* level before any decision is answered. A capstone's fixed increase —
Primal Champion's `+4 Strength`, Body and Mind's `+4 Dexterity/Wisdom` — was applied during that
walk, so by the time the level-4 improvement's points were allocated the score was already 19 and
four of the five placeable points clamped against the maximum and vanished. A Barbarian carried 1→20
finished on **20 Strength where the rules and the system's own wizard give 24**, because the wizard
applies one level at a time.

Fixed with `deferredAsi`: an improvement that raises no decision (a fixed increase, or a budget with
one legal target) is recorded rather than applied, and `#applyDeferredAsi` puts the set back on top
in level order — idempotently, so every ability edit suspends them first (`#withOwnHeadroom`) and
restores them after. `asiState` discounts them, so an ASI screen prices the player's budget against
their own score rather than against a capstone that has not happened yet. The Review screen still
reads the true total, because the increases *are* on the clone between edits.

Worth knowing when reading that code: reversing an ASI is only clean for `type: "asi"`. Reversing a
feat one deletes the granted item, which is why `#reverseSynth` prunes `deferredAsi` rather than
leaving records pointing at advancements that no longer exist.

Both classes then still reported a one-sided `decision.raised.AbilityScoreImprovement` — a ledger
false positive of the same kind as a grants-only Trait: the native wizard renders a step for an
automatic advancement and so asks the book, while the driver applies it without asking. `generateAsi`
now answers `null` when there is no allocation to make. Barbarians and Monks come back with the
`riders` family alone.

**`attributes.spellcasting` was never a creator bug — the harness read too early.** 2/92 (Eldritch
Knight, Arcane Trickster) plus the long-standing `fighter-multiclass-wizard` failure below.

`SubclassData._onCreate` and `ClassData._onCreate` set the field from an `actor.update` that
**subclass.mjs does not await**, so it lands a tick after `commit()` resolves. The native adapter
already waited for exactly this (`await sleep(300)` once its manager closes); the creator adapter
returned immediately, so the comparison was between a settled actor and an unsettled one. The
creator adapter now waits too, and all three come back with the `riders` family alone. The Arcane
Trickster's duplicate Mage Hand went with it — downstream of the missing casting ability.

Worth recording because the fix that suggested itself was wrong. `commit()` writes
`clone.toObject()` wholesale, which looks like it must race the hook, and the note below proposed
writing only changed keys instead. Built and measured, that changed nothing: `Promise.all` starts
the actor update first, so the hook's write always lands after and survives. Reverted, and
`commit()` left as the faithful port of `#complete`. **The multiclass entry below is closed by the
same finding** — that scenario is now 6 differences, all `riders`/`source.book`.

**An empty `riders` flag drowned everything else**, on 91 of 92 subclasses — enough that no scenario
could report identical and the pass/fail column carried no information at all. Measured across the
full run, all 242 rows held nothing on either side.

The mechanism, chased down afterwards: `flags.dnd5e.riders` records which of an item's activities and
effects ride along with an enchantment, and the system maintains it in `preUpdateActivities`
(`data/item/templates/activities.mjs`), which recomputes it on **update** and deletes whatever comes
out empty — the whole flag, or an individual empty list, which is why an item could differ on
`riders.effect` alone. Packs ship items whose flag is already empty. The native manager re-writes
*every* item the actor owns, so it clears them for free; `commit()` skips items that are
byte-identical (the Apply-speed optimisation) and so never gave the hook anything to fire on.

Fixed in `manager-driver.mjs`: an item carrying an empty rider list no longer counts as unchanged, so
it goes through one ordinary update and the system's own hook decides what to remove. Reusing the
rule rather than re-implementing it matters here — the partial `-=effect` case is easy to get wrong.
The cost is one extra write per affected item, once.

**This only reaches builds that level up.** At level 1 every item is *created* and never updated, so
`preUpdateActivities` has nothing to fire on; native's items are clean there purely because it runs
one manager per origin and each re-writes the previous one's items. `normalize.mjs` therefore still
strips empty rider lists, and `node run.mjs --keep-riders` turns that off to show what is underneath
— currently 9 rows, all on the three level-1-only scenarios. Cleaning those would mean stripping the
flag ourselves on creation, which is a rule the system does not have.

**Expertise was applied before the proficiency it upgrades.** Rogue Phantom, 1/92 — `skills.ani` came
out 2 natively and 1 for us.

`TraitAdvancement#apply` writes nothing for an expertise-mode trait unless the character is *already*
proficient (it skips when the current value is 0). Both sides recorded the same picks — level 1
`acr, arc`, level 6 `ani, ath` — so the difference was purely when they were applied. Animal Handling
is not on the Rogue's skill list at all; it comes from *Whispers of the Dead*, the level-3 feature the
Phantom grants, whose Trait choice is any skill.

`autoResolve` drained `traitSteps` in insertion order. Everything `prepare()` found goes in during
the main walk, but a decision a subclass or feat *synthesises* is appended after all of it — so the
level-3 feature's choice sat behind the level-6 Expertise, the upgrade ran while the skill was still
unproficient, and dnd5e silently declined to write it. Traits now drain in level order
(`screenLevel ?? level`, so a feat's own level-0 advancements sort at the level the feat was taken).

**Duplicate items were paired by position, not content.** Sorcerer Shadow Sorcery, and intermittent —
it passed one run and failed the next.

A character can hold two items sharing one compendium source with *different* data: a Shadow Sorcerer
carries two copies of Summon Beast, one enchantment-modified. `buildIdMap` numbers same-identity
duplicates `#1`, `#2` by array order, so whenever the two builds created them in opposite order the
diff paired `#1` against `#2` and reported every field of both as different — when the pair was in
fact identical, just crossed. `normalize.mjs` now breaks the tie on a content digest that ignores
ids, timestamps and flags, so a duplicate always takes the same number as its counterpart.

Only traits are ordered by level, because they are the type here with an intra-type dependency. Note
the interactive shell has the same latent hazard — it applies picks as the player clicks, so visiting
the level-6 screen before the level-3 one would reproduce it. The screens are presented in level
order, so it takes deliberate back-and-forth; a proper fix would re-evaluate expertise when an
underlying proficiency changes.

### Found by the sweep, not fixed — the native side is the one that is wrong

**Artificer Battle Smith: native never applies a level-3 spell grant, so the creator's character has
two spells the reference does not** (`Heroism`, `Shield`). 1/92, and the only remaining difference in
the whole sweep.

The subclass grants a *Battle Smith Spells* feature at level 3, and that feature carries five
ItemGrants, at levels 3, 5, 9, 13 and 17. On the native build the level-3 one has `value: {}` while
all four later ones are populated; the creator applies all five. It reproduces at `--level 3`, so it
is not an artefact of the long walk — the pattern is that an advancement at level N, on a feature
that *arrives* at level N, is missed by dnd5e's mid-walk step synthesis. The Cartographer's
equivalent grants sit directly on the subclass rather than on a granted feature, which is why they
apply.

Left alone deliberately: matching native here would mean dropping two spells the content says a
level-3 Battle Smith has. Same category as the `riders` flag and the `details.background` race — the
reference is the unreliable one. Reproduce with:

```bash
node run.mjs --compare-item "sweep:artificer/battle-smith/Battle Smith Spells"
```

### Not yet covered

Ember. The Ember world is provisioned but has no scenarios: Ember builds its own manager rather than
going through `forNewItem`, so it needs its own native build path, not just a scenario.
