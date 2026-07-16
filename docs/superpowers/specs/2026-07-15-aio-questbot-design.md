# AIO Questbot — Design

Date: 2026-07-15
Status: approved (brainstorm complete)

## Goal

One registered bot ("AIOQuester") that completes a user-picked queue of quests
end-to-end, replacing per-quest scripts. V1 ships six quests: Rune Mysteries
(ported from the proven standalone), The Restless Ghost, Romeo & Juliet,
Doric's Quest, Sheep Shearer, and Cook's Assistant (completed properly — the
"stuck newbie" loiter bot is retired). This is the "extract the quest engine at
quest #2" milestone from the roadmap.

## Decisions (user-approved)

- **Item strategy:** bank-first, gather fallback. Withdraw quest items the bank
  holds; otherwise run the quest's gather steps. `mustHave` items that cannot
  be provisioned mark the quest BLOCKED rather than half-starting.
- **Queue model:** pick list + auto-order. Settings multi-select the quests
  (default all); the engine orders by eligibility and re-scores after each
  completion so QP-gated quests unlock mid-run.
- **Architecture:** the RuneMysteries idiom, codified — pure `decide()` per
  quest + declarative steps a shared engine executes; at most one `custom`
  handler per quest for its single bespoke mechanic.
- **Old bots:** standalone RuneMysteries and CooksAssistant registry entries
  are deleted after the full-queue live run passes.
- **Sources:** quest facts (dialogue strings, item names, QP) come from the
  engine's `.rs2` content sources, as the existing `quests/data/*.ts` records
  already do. The LostHQ 2004 quest guides
  (https://2004.losthq.rs/?p=questguides) are the human-readable cross-check
  for route/order — *mostly* accurate; never override the sources with them.

## Architecture

### Quest module contract

Each quest lives in `src/bot/quests/defs/<quest>.ts` exporting one
`QuestModule`:

- `record` — its existing `QuestRecord` from `quests/data/f2p.ts` (name, QP,
  requirements, items). One source of truth shared with eligibility.
- `stops` / `hops` — `NpcStop`s and `LadderHop`s, as RuneMysteries has today.
- `gather` — per acquirable item, the step that obtains it (used by the
  provisioning phase when the bank lacks it).
- `decide(snap: QuestSnapshot): QuestStep` — **pure**. The generalization of
  RuneMysteries' `nextStep(journal, held)`. `QuestSnapshot` is plain data
  (journal status, inventory name→count, equipped names) so every quest brain
  gets a `bun:test` suite with no client dependency.

`QuestStep` is a discriminated union the engine executes:

```
{ kind: 'talk', stop }                            // gotoNpc + talkThrough (exists)
{ kind: 'grabGround', item, anchor }              // walk + Take
{ kind: 'pickLoc', loc, op, item, anchor }        // wheat / cadava bush
{ kind: 'interactLoc', loc, op, anchor, expect? } // coffin, hopper, flour bin
{ kind: 'useOn', item, target, anchor }           // bucket-on-cow, wool-on-wheel
{ kind: 'equip', item }                           // Ghostspeak amulet
{ kind: 'withdraw', items }                       // bank leg
{ kind: 'mineRock', rock, item, anchor }          // Doric gather fallback
{ kind: 'custom', name, run }                     // ONE bespoke mechanic per quest, max
{ kind: 'wait' } | { kind: 'done' }
```

### Engine

`src/bot/quests/engine/QuestEngine.ts`, driven by a thin `AIOQuester` TaskBot
in `scripts/`. Each loop: snapshot state → active quest's `decide()` → execute
the step via primitives in `quests/exec/` (which grow the new step executors).

- **Progress watchdog:** RuneMysteries' signature idiom — a
  `journal|inventory-hash` unchanged after a completed step bumps a no-progress
  counter. Warn at 3; at 8 **park** the quest at the back of the queue and
  move on (never wedge the queue). Both are named constants, tunable. (Park
  was provisionally 6; raised to 8 during planning because stage-invisible
  quests probe up to 4 NPCs per rotation — see the plan's Task 12 trace.)
- **Provisioning phase:** before running a quest, diff `record.items` against
  inventory; withdraw what the bank holds (`Bank.withdrawX`); return gather
  steps for the rest; BLOCK on unprovisionable `mustHave`.
- **Safety:** `ContinueDialog` + `EventSignal` yielding carry over unchanged.
  All progress is re-derived from journal + inventory every loop (ADR-0007
  discipline — varps are never transmitted), so restart, relog, and
  random-event interruptions are safe by construction.

### Queue manager

Scores the pick list with the existing `EligibilityEvaluator`: DONE skip,
READY runnable, BLOCKED skip with reason (shown in paint). Runs the first
READY quest in def-list order (cheapest/most-certain first), re-scores after
each completion. Parked quests retry after everything else has had its turn.
Nothing runnable → stop with a per-quest reason summary.

### Paint

Interactive chatbox paint: title with total QP + queue position; **Queue tab**
(row per picked quest: DONE ✓ / RUNNING / READY / PARKED / BLOCKED+reason);
**Current tab** (quest, step, status, no-progress counter); buttons
Pause/Resume, Stop, **Skip quest** (manual park).

## Per-quest work

| Quest | New mechanics beyond talk chain | Nav-data work |
|---|---|---|
| Rune Mysteries (port) | none — `nextStep` becomes `decide` | none |
| The Restless Ghost | `equip` amulet; coffin `interactLoc`; skull grab in wizard basement (skeleton spawns — flee, don't fight) = the custom step | none — reuses RuneMysteries `HOPS` + basement geometry |
| Romeo & Juliet | cadava `pickLoc` | verify/add Juliet's mansion staircase to baked transports |
| Doric's Quest | provisioning showcase (bank-first; `mineRock` fallback near Doric) | none |
| Sheep Shearer | shears `grabGround`; shear-to-20-wool loop; `useOn` wheel (castle stairs baked) | none |
| Cook's Assistant | pot `grabGround`; grain→hopper→operate→flour-bin sequence | add the two windmill ladders to `transports.json` |

## Planning amendments (2026-07-15, content research)

Discovered while writing the implementation plan (see
`docs/superpowers/plans/2026-07-15-aio-questbot.md`); they supersede the
per-quest table above where they conflict:

- **No nav-data work needed.** `nav/data/stairEdges.json` (the derive-stairs
  pack) already contains the windmill ladders (3165,3307 levels 0↔1↔2) and
  Juliet's staircase (3155,3435). Both spec rows drop to smoke verification.
- **Romeo & Juliet: cadava berries are an IMP DROP on this server** (~3%/kill,
  `imp.rs2:67`) — there is no cadava bush in the content. The gather step is a
  kill-imps-and-loot custom, R&J moves to LAST in the run order, and the
  module gains `grind: ['Imp']` so the event guard tolerates the fight.
- **Stage-invisible quests** (R&J, Restless Ghost mid-stages) are handled by
  threading the watchdog count into `QuestSnapshot.noProgress` so pure
  `decide()` rotates NPC probes statelessly — the RuneMysteries RECOVER idiom,
  generalized. This is also why park moved 6 → 8.
- **Provisioning runs once per quest** (a per-quest `provisioned` flag):
  quests CONSUME their items, so re-diffing after hand-in would re-gather
  forever.

1. Unit: per-quest `decide()` suites (journal×inventory → expected step, like
   `RuneMysteries.test.ts`); queue ordering/parking tests; new-primitive tests.
2. Live, in order: (a) Rune Mysteries via AIO (port parity), (b) one live run
   per new quest, (c) full 6-quest queue on a fresh account — the acceptance
   test.
3. Only after (c): delete standalone `RuneMysteries` + `CooksAssistant`
   registrations.

## Error handling

Walk failures self-heal (walkResilient + re-decide next loop). Dialogue drift
logs the WARN-fallback (last option = safe decline). Un-progressable quests
park instead of wedging. Restart/relog re-derives everything from journal +
inventory.

## Out of scope (v1)

Combat quests (Demon/Vampire Slayer), RNG grinds (Imp Catcher), fiddly
mechanics (Witch's Potion burnt meat), members quests, multi-account quests
(Shield of Arrav), shop-buy provisioning ("fully from scratch" item strategy).
The engine's step vocabulary is expected to grow one or two kinds per quest
wave; that is fine — `custom` is the pressure valve until a third quest needs
the same mechanic.
