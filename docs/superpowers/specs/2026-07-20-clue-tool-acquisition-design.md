# Clue tool acquisition — design

**Date:** 2026-07-20
**Status:** approved (brainstorm w/ user)

## Problem

The medium clue solver ABANDONS two step types instead of solving them:

1. A **dig** step when no Spade is held (`ClueExecutor.blockReason` → "no Spade held").
2. A **coordinate/sextant dig** when the Sextant + Watch + Chart aren't all held
   (`blockReason` → "coordinate clue needs Sextant+Watch+Chart").

Both are acquirable in-game. This feature acquires them instead of abandoning,
falling back to today's graceful-abandon only when acquisition genuinely can't
complete (unreachable NPC, no spade at either spawn, wrong dialogue state).

## Engine truths (verified in rs2b2t-content, 2026-07-20 — these OVERRIDE the wiki)

- **The dig hard-requires the trio.** `general_use/spade.rs2` opheld1: for a
  clue with `trail_sextant=yes`, if `trail_watch|trail_chart|trail_sextant`
  count is 0 it prints the default "nothing interesting" and returns — no
  casket. So all three must be HELD at dig time. (Dig tolerance is `distance<=1`,
  matching the solver's ARRIVE_RADIUS. No sextant minigame math — the dig tile
  is already stored in cluedb as `trail_coord`.)
- **The chart comes from the PROFESSOR, not the assistant.** The wiki's
  "assistant for the chart" step does not exist in this engine — the assistant
  only hands out quest wine. The chain is 4 talks: professor → Murphy → Kojo →
  professor.
- **The Observatory Quest is NOT a prerequisite here.** The professor's
  treasure-trails dialogue is reachable from `professor_initial`
  (itgronigen not-started, choice 5) and `professor_returns` (quest complete),
  gated only on `has_sextant_clue`. It is unavailable only while the quest is
  mid-progress — a rare account state, handled by graceful-abandon.
- **All four NPCs gate on `has_sextant_clue`** = holding a clue whose
  `oc_param(obj, trail_sextant) = true`. Only the **20** coordinate clues (of 75
  medium clues) carry that param. **Consequence: the trio can only be acquired
  while a coordinate clue is in the pack.** You cannot pre-provision during a
  non-coord solve.
- **Server tracks `chart_progress` in `%trail_status` bits 5-8 — client-unreadable.**
  So the bot drives entirely off WHICH of the three obj ids it holds; the server
  picks the correct dialogue branch (first-time vs. lost-item) off its own state.

### Chain state (server-side, for reference only — bot never reads it)

| chart_progress | professor | Murphy | Kojo |
|---|---|---|---|
| not_started(0) | learn → prof(1) | — | — |
| spoken_prof(1) | reminder | **sextant** → murphy(2) | — |
| spoken_murphy(2) | reminder | replace if lost | **watch** → kojo(3) |
| spoken_kojo(3) | **chart** → complete(4) | — | replace if lost |
| complete(4) | replace-chart multi if none held | replace if lost | replace if lost |

### Locations (NPC spawn tiles; anchors probe-verified in planning)

- Observatory professor (npc 488): **(2438, 3186, 0)**
- Murphy, Port Khazard (npc 463): **(2668, 3162, 0)**
- Brother Kojo, Clock Tower (npc 223): **(2569, 3249, 0)**
- Spade ground spawns (obj 952): West Ardougne **(2574, 3331, 0)**, Falador **(2981, 3369, 0)**

## Design

### Files

- `src/bot/clues/data/toolAcquire.ts` (pure data + a pure helper): the three
  `SEXTANT_NPCS` (name, spawn tile, dialogue prefer-list), the two
  `SPADE_SPAWNS`, obj names (`Sextant`/`Watch`/`Chart`/`Spade`), and
  `nextCoordTool(held) -> 'sextant'|'watch'|'chart'|null`.
- `src/bot/clues/AcquireTools.ts` (client-coupled): `ensureSpade()` and
  `ensureCoordTools()`, imported by both `SolveClue` (proactive) and
  `ClueExecutor` (safety net). Depends on the same `gotoNpc`/`talkThrough`
  primitives + `Traversal` + queries the executor already uses.
- Tests: `toolAcquire.test.ts` (pure `nextCoordTool` + data sanity);
  `AcquireTools.test.ts` (mocked-world chain/branch selection).

### `ensureSpade(log): Promise<boolean>`

Held Spade → true. Else walk to the **nearer** of the two spade spawns (nav
short-path distance from the current tile; chebyshev tiebreak), grab the spade
(ground-item Take, or loc interact if it's a scenery spade), verify it's in the
pack. Bounded walk + attempts; false if neither spawn yields one.

### `ensureCoordTools(log): Promise<boolean>`

All three held → true. Otherwise an **item-keyed** walk of the chain
(`nextCoordTool` decides the next hop from held items):

- missing sextant → `gotoNpc`+`talkThrough` professor (prefer "Treasure
  Trails"), then Murphy → verify Sextant held.
- have sextant, missing watch → Kojo → verify Watch held.
- have sextant+watch, missing chart → professor (prefer "Treasure Trails" /
  "lost" / "navigation") → verify Chart held.

Idempotent and re-entrant: each hop verifies its item landed before advancing;
a random-event yield or interrupt just re-enters at the same held-item state.
**Precondition (caller-guaranteed): a coordinate clue is in the pack** — without
it every NPC no-ops and the function returns false. First-time and lost-item
dialogues need no special handling; `talkThrough`'s option preferences drive
whichever branch the server presents.

### Wiring — "pre-provision at bank-first", honestly implemented

Because acquisition requires a coordinate clue held, "pre-provision" means: run
it at the bank step **when the currently-held scroll is a coordinate clue**, and
catch a mid-trail coordinate leg with the same idempotent function at the dig
step. One function, two call sites:

1. **`SolveClue.bankFirst`** (primary): after the deposit, if the held scroll is
   a `needsSextant` coordinate clue:
   - **Auto-withdraw** any of Sextant/Watch/Chart present in the bank (they
     persist once acquired — this makes every solve after the first cheap; the
     three are already in the keep-set so they're never re-deposited).
   - If still incomplete, call `ensureCoordTools()` right there (we hold the
     coord clue, so `has_sextant_clue` is true) to run the NPC chain for the
     missing pieces.
   The existing spade withdraw stays; `ensureSpade()` is the fallback when the
   bank had none (see below).
2. **`ClueExecutor` dig dispatch** (safety net): the `dig` case currently
   abandons via `blockReason` on "no Spade" / missing trio. Instead it calls
   `ensureSpade()` / `ensureCoordTools()` first and only abandons if they return
   false. This covers a coordinate clue appearing at trail leg N>1 (bank-first
   already ran) and a spade/tool lost mid-trail. Since both functions are
   idempotent and the tools persist, the usual case is a fast no-op.

`blockReason` keeps returning its string for the audit/allowlist, but the dig
path now attempts acquisition before honoring it — so the graceful-abandon
behavior remains the guaranteed floor, never the first resort.

### Lifecycle (why this is cheap after the first time)

The trio and the spade persist in inventory/bank. The 4-NPC chain runs **once
ever** (the first coordinate clue encountered); every later coordinate solve is
a bank withdraw of already-owned tools. The spade spawn-fetch runs only when the
bank is empty of spades.

## Testing & verification

1. `toolAcquire.test.ts`: `nextCoordTool` truth table (all 8 held combinations),
   data sanity (2 spawns, 3 NPCs, obj names non-empty).
2. `AcquireTools.test.ts`: mocked world — chain advances professor→Murphy→Kojo→
   professor as items appear; nearer-spade selection; abort/yield re-entry;
   returns false when no coord clue is held (the gate).
3. Full suite + `tsc --noEmit` green; **clue audit** re-run (the 2
   genuinely-unreachable allowlist entries were sextant digs — this may clear
   them; the audit gate is updated to match reality).
4. Offline nav probe of all four tiles from a spread of bank/clue locations
   (like the clue audit) before committing; anything unreachable stays on the
   abandon path.
5. Live smoke on a fresh members account holding a coordinate clue with no spade
   and no trio: fetches the nearer spade, walks professor→Murphy→Kojo→professor,
   digs the casket.

## Out of scope

- Operating the sextant minigame / computing coordinates (unneeded — dig tile is
  stored).
- Doing the Observatory Quest (not a prerequisite in this engine).
- Hard clue coordinate tools (this targets the medium solver; the chain is the
  same NPCs if hard is added later).
