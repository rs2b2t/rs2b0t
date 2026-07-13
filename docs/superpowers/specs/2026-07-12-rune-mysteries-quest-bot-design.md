# RuneMysteries — first quest bot (executor-shaped), design

2026-07-12. Completes the Rune Mysteries quest autonomously from any mainland
position and any quest state. A bespoke `TaskBot` script in the
FlaxSpinner/TutorialBot idiom, deliberately built on two reusable primitives
(`gotoNpc`, `talkThrough`) that become the future quest executor's core; the
second quest extracts the engine, this one proves it.

Ground truth comes from the LostCity content sources
(`~/code/LostCityRS/Content/scripts/quests/quest_runemysteries/` + the three
NPC scripts under `areas/`): exact dialogue strings, quest-item names, state
transitions, and NPC spawns. The script itself uses NO cheats, so it runs on
live rs2b2t as-is; only the smoke uses setup cheats.

## The quest (from the .rs2 sources)

A pure delivery chain — no combat, no requirements, ~3 long walks:

1. **Duke Horacio** (`duke_of_lumbridge`, spawn 3212,3220,**level 1** of
   Lumbridge castle): "Have you any quests for me?" → "Sure, no problem." →
   receive **Air talisman**.
2. **Sedridor** (`head_wizard`, spawn 3103,9571,0 — the wizard-tower
   BASEMENT, an underground mapsquare): "I'm looking for the head wizard." →
   "Ok, here you are." → talisman taken → "Yes, certainly." → receive
   **Research package**.
3. **Aubury** (spawn 3253,3402,0 — Varrock rune shop): "I have been sent here
   with a package for you." → package taken → *talk to him AGAIN*
   (no choices) → receive **Notes**.
4. **Sedridor** again: no choices, long continue-chain → notes taken → quest
   complete widget + journal flips green.

Every lost-item sub-state has a recovery dialogue in the content (each NPC
re-gives its item when `obj_gettotal` = 0), which is what makes a stateless
observable-state machine self-healing.

## State: journal colour + held item (no varps)

`runemysteries` is `scope=perm` with no `transmit=yes` — the client NEVER
sees the quest varp (same as the tutorial; ADR-0007). Observable state is
enough:

- **journal** = `Quests.status('Rune Mysteries Quest')` — the questlist
  side-tab colour reader built for the eligibility dashboard
  (notStarted / inProgress / complete).
- **held** = which quest item is in the pack: `Air talisman`,
  `Research package`, `Notes` (exact, case-insensitive FULL-name matches —
  `Notes` is too generic for substring matching), or none. If several are
  somehow present, the most-advanced wins (Notes > Research package > Air
  talisman) — server-side this can't happen, but the function is
  deterministic anyway.

One pure decision function `nextStep(journal, held)` (unit-tested table):

| journal | held | step |
|---|---|---|
| complete | — | DONE — log + `ScriptRunner.stop()` |
| unknown | — | WAIT — journal not read yet; delay + re-poll |
| notStarted | — | DUKE |
| inProgress | Air talisman | SEDRIDOR |
| inProgress | Research package | AUBURY |
| inProgress | Notes | SEDRIDOR (final handover) |
| inProgress | none | RECOVER — probe Aubury → Sedridor → Duke, fixed order |

RECOVER covers every hidden sub-state: just-handed-package (Aubury's second
talk advances), lost notes (Aubury re-gives), lost package (Sedridor
re-gives), lost talisman (Duke re-gives; Sedridor's probe is a clean no-op
first). Each probe is harmless in every state — the content scripts guarantee
it. On a clean run RECOVER only ever fires as the natural "talk to Aubury
again" step.

## The two executor primitives (`src/bot/quests/exec/primitives.ts`)

- **`gotoNpc(spec)`** — `Traversal.walkResilient` to `spec.anchor`; when here
  and the anchor straddle the surface/underground boundary (Sedridor: the
  basement ladder is NOT a nav edge and the 2D A* heuristic can't span the
  z+6400 underground offset), take a `hopLadder(hop)` region-crossing first
  (FlaxSpinner's climb helper, promoted/mirrored), then local-walk the
  basement — the basement mapsquare IS in the collision pack (verified:
  walkable(3103,9571,0) = true). Task-6 live-run true-up: the final approach
  lands RIGHT ON the anchor (radius 1), not merely "within leash", and the
  leash-wide "already near, skip the walk" short-circuit was removed — a loose
  radius-3 arrival stranded the bot across the cramped basement wall from a
  wandering Sedridor (Talk-to couldn't path; "never opened a dialogue", retried
  forever), so re-centring on the anchor every call self-heals a failed talk.
  It also recovers a trapped ladder-landing: the tower ladder occasionally
  drops you on a dead-end tile the baked pack thinks reaches Sedridor while the
  live scene walls it off (0 clicks, freeze) — detected (still underground, not
  at the nearby anchor after a bounded walk) and escaped by climbing back up so
  the caller re-descends onto a reachable tile.
  Post-ship root-cause (2026-07-12, live probe): the "trapped landing" was the
  basement's HORSESHOE shape — the client's ground-click fallback walks to the
  reachable tile nearest the target, and on the landing → east → corridor →
  west-through-the-door route every intermediate tile is farther from Sedridor
  than the start, so clicks were no-ops. Fixed properly with
  `NpcStop.approach` staged waypoints (Sedridor: corridor mouth (3108,9572)).
  Second post-ship true-up (2026-07-12 21:49 live freeze): the pocket landing
  is REAL and distinct from the horseshoe artifact — its signature is 0 clicks
  (live `Reachability.canReach` rejects every tile of the baked path; the
  horseshoe variant clicked plenty and just didn't move), seen at (3107,9575)
  against a pack-open cost-4 route to the corridor mouth. So the recovery is
  load-bearing, not belt-and-braces, and it must catch a failed APPROACH leg
  too: the staged-waypoint loop originally early-returned on failure, which
  bypassed the recovery entirely and re-walked from the pocket forever. A
  failed approach leg now falls through to the trapped-landing check (climb
  up, re-descend to re-roll), and a failed leg outside the trapped signature
  still returns false rather than `npcNear()` — the leash can see the NPC
  across the very wall that blocked the walk. Control-flow regression tests:
  `src/bot/quests/exec/gotoNpc.test.ts` (mocked I/O singletons).
- **`talkThrough(npcName, prefer[])`** — Talk-to the nearest matching NPC,
  then drive the dialogue: continue through pages; at a choice pick the first
  `prefer` entry that case-insensitive substring-matches (the tutorial
  `AdvanceDialog` idiom); fallback = last option + WARN log (quest prefer
  lists enumerate every real choice point, so fallback firing means drift).
  Returns when the dialog closes, for any reason.

Walk-target discipline (the FlaxSpinner lesson): every anchor must be an
exactly-walkable tile on the correct side of any seal — an unwalkable dest
opens PathFinder's radius-5 goal box, which can "arrive" across a wall. The
Duke's floor-1 anchor and Aubury's shop tile verify walkable in the pack
already; the tower surface-ladder anchor and basement stand tile are dumped
and probe-verified during implementation (offline `PathFinder` probe + live
`reader.locs()`, the established recipe).

## Step data (const table in the script; future quest-pack shape)

- DUKE: npc `Duke Horacio`, anchor (3212,3220,1) — castle staircases are
  baked nav transports, walkTo handles the level change; prefer
  `["Have you any quests for me?", "Sure, no problem."]`.
- SEDRIDOR: npc `Sedridor`, surface anchor at the tower ladder (live-verified
  tile), via `Ladder`/`Climb-down` → basement anchor ~(3103,9571,0); prefer
  `["I'm looking for the head wizard.", "Ok, here you are.", "Yes, certainly."]`
  — the same route data serves the final no-choice handover.
- AUBURY: npc `Aubury`, anchor (3253,3402,0); prefer
  `["I have been sent here with a package for you."]`.

## Tasks (mutually exclusive, observable-state-gated)

| Task | Runs when | Behaviour |
|---|---|---|
| ContinueDialog | a continue page/widget is up | dismiss (top priority; also eats the quest-complete widget) |
| QuestStep | otherwise, every loop | compute `nextStep(journal, held)`; DONE → log + stop; else `gotoNpc(step.spec)` → `talkThrough(step.npc, step.prefer)` |

A single QuestStep task (rather than one task per leg) keeps the mutual
exclusivity trivially true and the decision auditable in one pure function.

## Error handling

- Walk failure / random event: `walkResilient` false → task returns; the
  runtime handles the event; next loop re-validates from scratch. No step
  counters, no "where was I" — restart- and relog-safe by construction.
- Talk completed but state unchanged (wrong match, full pack when an NPC
  hands an item, NPC absent): the loop re-runs the step; after 3 consecutive
  no-progress talks on the same step, log a loud warning with the last dialog
  transcript, keep retrying (recovery dialogues make retries safe).
- Items only move on server-completed handovers, so an interrupted dialogue
  never wedges state.
- Nav-layer hardenings this quest's first live walks forced (Task 6):
  `WalkExecutor` now (a) gates its crossing-proximity scan on the player being
  on the crossing's approach-tile level — `chebyshev()` is horizontal-only, so
  a ground-floor doorway directly under an upstairs player was falsely
  "handled" as already-open and skipped the real staircase-down (the post-Duke
  castle-descent stall); and (b) accepts an already-open door via live-scene
  `Reachability.canReach`, not just `canStep`, because the hand-added
  wizard-tower diagonal-door edge bridges tiles 2 apart across a baked-in wall
  where `canStep` (single adjacent step only) is permanently false (the
  wizard-tower stall).

## Testing

- **Unit (bun:test)**: `nextStep()` full decision table incl. RECOVER order;
  prefer-list matching against the exact `.rs2` option strings.
- **Live smoke** `tools/rune-mysteries-test.ts` (+ `run-all-smokes`): fresh
  account → mainland-ready (quests-tab-test harness helpers) → start script →
  poll → assert in order: talisman appears, package appears, notes appear,
  journal `complete`, script stops itself. Full real walking, no mid-quest
  cheats; `::tele` only for initial off-island setup. Budget ~15 min.

## Settings & registration

`SETTINGS` schema (FlaxSpinner style): the quest journal name, the three NPC
anchor tiles, and the leash radius — defaults from the verified data, all
overridable. The NPC names and the ladder name/op shipped as in-script
constants, not settings (they're fixed by the quest content). Registered in
`scripts/index.ts` as `RuneMysteries`. Paint overlay: current step, journal
status, held item, walk progress.

## Out of scope

Generic quest engine / data packs (extracted when the second quest lands),
banking or gearing (quest needs nothing), members quests, multibox.
