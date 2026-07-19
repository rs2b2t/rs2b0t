# Navigation Reliability — design

**Date:** 2026-07-19 · **Status:** approved direction, spec for review
**Goal (user's words):** "reliable, realistic navigation that doesn't get stuck." Scope clarified to **reliability only** — mechanism and human-likeness are non-goals; incremental hardening preferred over a rewrite.
**Builds on:** `2026-07-13-resilient-world-walking-design.md` (walkResilient ladder), which this hardens rather than replaces.

## 1. Problem

The nav stack (baked A* → WalkExecutor click-following → walkResilient escalation) works for open-world walks and banks, but **interior navigation stalls** — doors, tight rooms, multi-floor buildings, patrolling NPCs. During the quest-bot push (2026-07-17→19) the same stall classes cost ~30 live smoke runs across Demon Slayer, Witch's House, and Merlin's Crystal, and were only beaten by per-quest hacks (interior-stand+OPLOC, open-the-leaf+OPNPC, walk-to-live-tile, transient-close dialogue loops) — each re-solving the same problem locally.

### 1.1 The canonical failure trace (Witch's House cellar ladder)

One live trace exhibits every root cause at once:

1. Def targets the cellar Ladder (2907,3476,0). `findPath`'s interact-first cardinal goals correctly pick the interior stand (2906,3476) — route crosses the front Door (2901,3473) and inner Door (2902,3474). *(Planning is right.)*
2. The inner-door crossing flakes ("`Door at (2902,3474) did not cross in time`") → `failedDoor` adds it to `avoidDoors` → repath. **(RC-2: door-crossing unreliability.)**
3. With the interior edge avoided, the wall-blind fallbacks take over — `goalCandidates` ring (within-5, any walkable tile) / "`dest unreachable beyond … — nearest reachable tile`" (WalkExecutor.ts:205) — and route **around the exterior** to (2908,3478), which is *outside the north wall*, one cost-unit cheaper than the interior stand. **(RC-3: wall-blind fallback goals.)**
4. Arrival correctly refuses (`arrival.ts` demands an interact-legal stand) — but the ladder ▸ escalation just loops baked→scene→unstick→backoff forever; no verdict ever reaches the caller. **(RC-1: no termination.)**
5. Under loop pressure, the def author (me) hard-coded the exterior tile as the "reachable approach," converting a transient failure into a permanent wrong answer, and later mis-diagnosed the wall as "impossible collision data." Offline probe (`tools/nav/witchhouse-probe.ts`) later proved the interior route exists and the data is fine.

The same classes recurred elsewhere: Wizards' Tower (bogus **derived stair-edge stand** on the wrong side of the west wall — derive-stairs' cardinal-first snap is wall-blind; plus flaky interior doors), Camelot (patrolling knights behind throne-room doors; server OPNPC halts at closed doors — live-verified with Traiborn), Merlin's keep exit (strict walk-to-stand vs. an OPLOC that server-walks the last tiles).

### 1.2 Root causes

| # | Root cause | Where |
|---|---|---|
| RC-1 | The walkResilient escalation ladder has **no terminal state** — unbounded callers retry forever; no `unreachable` verdict exists | `nav/walkLadder.ts` (`advance` never terminates), `api/Traversal.ts` |
| RC-2 | **Door-crossing is unreliable**: crossing waits gate on conservative `canReach`/`canStep` BFS budgets rather than the raw shared-edge collision flag; click selection canReach-starves on door-blocked segments ("0 clicks"); failures poison `avoidDoors` | `nav/WalkExecutor.ts` (crossing handler ~530-687, stall/`walkOpening` ~480-497, click gate :272) |
| RC-3 | **Fallback goal selection is wall-blind**: `goalCandidates` ring and the "nearest reachable tile" fallback accept tiles on the wrong side of walls; `derive-stairs` snaps stair stands wall-blind (the tower's bogus edge shipped in `stairEdges.json`) | `nav/PathFinder.ts` (`goalCandidates`/`snapWalkable`), `nav/WalkExecutor.ts:205`, `tools/nav/derive-stairs.ts` |
| RC-4 | **No shared last-mile primitive**: reaching-and-operating a loc/NPC (climb, open, talk) is re-implemented per quest; server op-walks cross furniture-tight interiors but halt at closed doors, patrolling NPCs defeat anchor-leash checks, dialogue drivers exit on transient page-transition closes and miss mid-branch varp-sets | quest defs (6+ local hacks), `quests/exec/primitives.ts` (`gotoNpc` npcNear gate, `talkThrough` `while(isOpen())` loop) |

**Engine facts constraining the design** (verified in content/live): doors are `[oploc1]`-scripted — walking into one does **not** open it; the Open op does. Plain walk-clicks are client-pathed (mirrored by `localReach.ts`); only op-clicks (OPLOC/OPNPC) are server-walked — and the server walk does **not** open closed doors en route. So the "realistic" reliable pattern is exactly what a player does: open the door (op), walk through; click the ladder/NPC (op) and let the server do the last tiles.

## 2. Design — four workstreams

Incremental hardening of the existing stack. No behavioral change to the happy path; each workstream lands independently with its own tests.

### W1 — Honest termination (`unreachable` verdict)

`walkLadder.advance` gains a terminal: after **K consecutive no-progress passes** (K=3, each pass = the full baked→scene→unstick escalation), the driver runs a one-shot **verification probe** — a big-budget `findPath` from the current position to the target's goals. If the probe **fails**, or its path terminal is a tile the bot has already reached this walk (i.e. re-walking it provably gains nothing), emit `{kind:'unreachable'}`; otherwise reset the pass counter and keep going (the probe found something new to try). `Traversal.walkResilient` maps the terminal to a `false` return with `WalkExecutor.lastOutcome = 'unreachable'` and a log line naming the best-reached tile. The terminal applies to unbounded (`attempts: undefined`) callers too — that is the point. Transient blockers (a door that will open, a passing crowd) don't fire it: their passes make progress or their probe finds a fresh terminal; a genuinely wall-separated target terminates in ~3 passes (~1-2 min) instead of never. (Once W4 lands, the probe targets *operable* goals, tightening the proof further.)

Callers then re-plan honestly (defs try a different stand/op or park with a reason) instead of looping. **This is deliberately a behavior change for retry-forever callers** — bounded to provably-unreachable targets, where retrying forever was never going to succeed.

*Tests:* unit tests on `advance` + the probe decision (terminal fires after K exhausted passes with a failed/stale probe; a probe that finds a new terminal resets the counter; any progress resets). Grep-audit of `walkResilient` call sites for callers that must handle the new `false`.

### W2 — Deterministic door-crossing

Rework the crossing handler around the raw collision surface instead of BFS budgets:

- **Proactive open:** when the path's next transport edge is a door and the bot is within trigger range of its approach tile, send the loc's Open-op immediately (already partially done via `walkOpening`) — and *re-send* on revert, up to a bounded count.
- **Raw-flag wait:** wait for the crossing to become passable by polling `canStepLocal` **on the exact shared edge** (approach→step) — one flag read, precise — instead of `canReach`/`canStep` budgeted BFS which mis-reads tight interiors.
- **Un-gated through-step:** once the edge reads open, step through with the un-gated scene walk (`DirectNavigator.walk`) to the landing, then resume normal following. Click selection along a door-blocked segment targets the door-approach tile rather than starving on canReach.
- **Bounded honesty:** a door that never opens (locked, quest-gated) times out to `'repath'` + `failedDoor` exactly as today — but only after the op-driven attempts, so `avoidDoors` no longer gets poisoned by timing flakes.

*Tests:* synthetic-grid unit tests (localReach fixtures) for the edge-wait predicate; live: the tower interior doors, Camelot Large doors, and Witch's House front+inner doors cross reliably (≥3 consecutive smoke traversals without a `did not cross` line).

### W3 — Shared last-mile primitive: `reachAndAct`

One API replacing the per-quest hacks: given a target (loc by name/tile, or NPC by name) plus an op and an expected-outcome predicate (level changed / dialogue open / inventory delta):

1. If the target isn't in scene/op range → walkResilient to a **W4-chosen operable stand** (not the raw target tile).
2. If a closed door sits between the stand and the target → open it first (W2 flow) — because the server op-walk halts at closed doors.
3. Fire the op; let the **server** walk the last tiles and interact (crosses furniture-tight interiors the client BFS refuses; tracks patrolling NPCs wherever they've wandered).
4. Await the outcome predicate with a generous bounded wait; return an honest tri-state (`done | retry | unreachable`).

`quests/exec/primitives.ts` refactors onto it: `gotoNpc`'s brittle npcNear-leash gate stops being the arbiter for talk (the talk attempt is); `talkThrough` is hardened with the **transient-close-tolerant dialogue loop** (waits ~1.5s across page-transition gaps — the Lancelot mid-branch varp-set fix, currently stranded in merlinscrystal.ts, hoisted to the shared driver).

*Tests:* mostly live — Demon Slayer's def slims (tower + Traiborn hacks deleted, replaced by `reachAndAct`) and still PASSES end-to-end; Merlin's knights advance the stage on ≥2 consecutive runs.

### W4 — Wall-aware fallback goals + stair-stand re-derivation

The interact-first cardinal-goal search in `findPath` is already right — harden the **fallbacks** to match it:

- `goalCandidates` ring and the WalkExecutor "nearest reachable tile" fallback rank candidates by **connectivity to the requested target** (wall-open adjacency using the pack's wall masks, as `cardinalGoals` already does), never by distance alone. A tile wall-separated from the target is not a goal — the exterior (2908,3478) can no longer beat the interior (2906,3476).
- `derive-stairs`' cardinal-first snap becomes operable-stand-aware (the stand must be wall-connected to the stair loc's interactive side); regenerate `stairEdges.json` and diff old→new edges as the audit (the tower's bogus (3102,3159) edge must disappear; expect a small set of corrected edges, each eyeballed). Run the existing clue-audit harness (66-route pack-gated suite) as the regression gate.

*Tests:* unit tests on the goal-ranking with synthetic walls; offline probes (`tower-probe`, `witchhouse-probe`) route interior with **no def-level workaround constants**; the stairEdges diff review.

## 3. Sequencing & integration acceptance

`W1 → W2 → W4 → W3` (W1 first: small, safe, makes every later debug loop terminate; W2/W4 independent; W3 depends on both). Each lands as its own commit(s) with unit tests green; live smokes gate promotion.

**Integration acceptance:**
1. **Merlin's Crystal smoke** reaches the keep (knights → crate) on ≥2 consecutive runs — the current flaky bottleneck — and ideally runs to `complete qp=6`.
2. **Witch's House smoke** descends the cellar ladder via the interior (the canonical trace fixed end-to-end); full PASS is the target, but quest-logic bugs past the cellar (gate/cupboard/experiment/witch-curse) are quest work, not nav scope.
3. **No fleet regression:** all existing nav unit tests pass; one representative existing-bot smoke (RockCrab or a bank loop) runs clean; Demon Slayer still PASSES after its hacks are replaced by `reachAndAct`.
4. Def-level nav workarounds deleted where the primitives now cover them (demonslayer tower block, witchshouse DirectNav block, merlinscrystal talkKnight local driver).

## 4. Out of scope

- Human-like movement/timing (stealth axis — explicitly deferred by the user).
- Collision-pack regeneration beyond `stairEdges.json` re-derivation (doors.json and the pack proved correct where probed).
- The Witch's House witch-curse stealth model; multibox nav; live climb-probes.

## 5. Risks & mitigations

- **Shared-code regression** (every bot walks through this): pure-module unit tests first, phased landing, representative fleet smoke per phase, and the quest smokes as end-to-end canaries.
- **stairEdges regen blast radius** (912 edges): mandatory old→new diff review + clue-audit harness before commit.
- **W1 changes retry-forever semantics:** terminal gated on *proven* unreachability (big-budget pathfail + zero progress), so transient blockers can't fire it; call-site audit for callers relying on never-returning.
- **Server-op reliance (W3)** assumes op-walks behave as observed (halt at closed doors, cross tight interiors) — both live-verified this session; the primitive's tri-state keeps a client-walk fallback.
