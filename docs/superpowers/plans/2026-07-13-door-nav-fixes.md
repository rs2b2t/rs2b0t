# Door-Navigation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bots wedging within 1 tile of doors: complete 1-tile door crossings instead of declaring victory on "opened" (Fix A), make arrival reachability-aware instead of wall-blind Chebyshev (Fix B), and harden the stall-recovery opener + stall detection (Fix C).

**Architecture:** All changes live in the walker core (`src/bot/nav/WalkExecutor.ts`, `src/bot/api/Traversal.ts`, `src/bot/nav/DirectNavigator.ts`) shared by every bot. Root causes were live-confirmed (evidence: `.superpowers/sdd/door-probe-evidence.md`): H1 wall-blind arrival (radius-2 success, 0 movement, across a blocker), H2 six-of-six 30–92s wedges at `Door@(3248,3411)` because the swung-open leaf lands on the step tile and `handleTransport` returns success on OPEN (not crossed) then `followPath` clears the annotation. `crossMultiTileDoor` already implements the correct drive-to-completion pattern — Fix A extends it to 1-tile doors.

**Tech Stack:** TypeScript (bun), bun:test with stubbed collision (localReach.test.ts pattern), playwright-core live smokes vs the local engine (:8890, running).

## Global Constraints

- Evidence file is the spec: `/Users/elliottriplett/code/rs2b0t/.superpowers/sdd/door-probe-evidence.md`. Key mechanics (probe-verified): opening a straight door swings the leaf onto the step tile (`WALK_SCENERY`), so the landing for a completed crossing is one tile PAST the step (`step + dir`), exactly as `crossMultiTileDoor` (WalkExecutor.ts:483-530) already does for multi-tile edges.
- Arrival predicate must be ONE shared implementation used by all four gates — `WalkExecutor.walkTo` (~:131), `WalkExecutor.followPath` (~:227), `Traversal.walkResilient`'s `withinRadius` (~Traversal.ts:60), `DirectNavigator.walkTo` (~:50). Divergence between them makes walkResilient loop (outer says arrived, inner refuses).
- Fix B semantics (exact): `arrived ⟺ sameLevel ∧ chebyshev(me, dest) ≤ radius ∧ (canReach(dest) ∨ dest tile not scene-walkable)`. The unwalkable-dest fallback preserves current behavior for legitimate unwalkable targets (booth-tile style dests) — worst case is the old semantics, never a never-arrives regression. `canReach` = existing `Reachability.canReach(dest, { maxSteps: 512 })` (verify exact option shape against its use at WalkExecutor.ts:215); determine the scene-walkable check from `localReach`/`Reachability`'s surface during implementation and quote it in the report.
- Fix A semantics (exact): 1-tile no-level transports use the same drive-to-completion as multi-tile — open (retry on revert), then walk to `landing = step + dir`, success ONLY when the player is strictly past the door plane; `followPath` clears the crossing annotation only on that success. Simplest shape: relax `crossMultiTileDoor`'s gate so all `toLevel === undefined` transports route through it (delete `handleTransport`'s open-equals-success 1-tile branch, WalkExecutor.ts:457-464); keep `failedDoor`/`avoidDoors` repath semantics for `false`.
- Fix C semantics (exact): `tryNearbyDoor` filters locs by name `/(door|gate)/i` AND op `/^open/i` (prefix — catches `Open-quietly`; no more wardrobes), still `.within(3).nearest()`. Stall counter: accumulate when `!moved` even within `ARRIVE_RADIUS` of the committed click target IF that target is currently unreachable (`!Reachability.canReach(tiles[clickIdx], …)`) — the probe-confirmed blind spot at WalkExecutor.ts:254-255.
- Every code task leaves `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before its commit (baseline 357 green). Conventional commits to main, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Live smokes: engine already running at :8890; `bun tools/run-all-smokes.ts --only <substr>` deploys and runs. The new door smoke must NOT regress `essminer-test`/`shoprun-test` (both cross Varrock East).
- No scope creep: shape-9/diagonal door graph coverage and non-`Open`-op door EDGES (derive-doors gaps) are tracked follow-ups, NOT this plan.

## File Structure

- `src/bot/nav/WalkExecutor.ts` — Fix A (crossing completion), Fix B (shared arrival predicate), Fix C (opener filter + stall accumulation).
- `src/bot/nav/arrival.ts` — NEW, pure: `isArrived(me, dest, radius, probe: { canReach(t): boolean; walkable(t): boolean }): boolean` — the single predicate, injectable for tests.
- `src/bot/api/Traversal.ts`, `src/bot/nav/DirectNavigator.ts` — wire the shared predicate.
- `test/bot/nav/arrival.test.ts` — NEW, pure unit tests (stub probe).
- `tools/door-cross-test.ts` — NEW live smoke: repeated wedge-free crossings of `Door@(3248,3411)`.
- `tools/run-all-smokes.ts` — LONG entry `'door-cross-test': 600`.

---

### Task 1: Fix A — complete 1-tile door crossings (+ the failing door smoke)

**Files:** Modify `src/bot/nav/WalkExecutor.ts`; Create `tools/door-cross-test.ts`; Modify `tools/run-all-smokes.ts`.

- [ ] **Step 1: Write the smoke (the failing test).** `tools/door-cross-test.ts`, modeled on `tools/shoprun-test.ts` boot (harness `mainlandAccount`/`cheat`, base default `http://localhost:8890`). Contract: fresh account; 4 crossings of the Varrock East door at `(3248,3411)` alternating direction (tele to a tile ~8 tiles on one side, page-ABI `Traversal.walkResilient` to a tile ~8 tiles on the other side, radius 0, timeoutMs 60000 — reuse the probe's approach from the evidence file, which lists the exact tiles used); assert each leg completes with the bot GENUINELY on the far side within **25s** (probe baseline: wedged legs took 30–92s; clean legs ≤16s) and that the walk return is true. On any failure print the walker log tail. Exit 0 only if 4/4 legs pass.
- [ ] **Step 2: RED.** Run `bun tools/run-all-smokes.ts --only door-cross` (add the `LONG: 600` entry first). Expected: FAIL — legs wedge ≥30s (this is today's bug; capture the failing output in the report).
- [ ] **Step 3: Implement Fix A.** In `WalkExecutor.ts`: route ALL `toLevel === undefined` transports through the drive-to-completion path — relax `crossMultiTileDoor`'s `chebyshev(approach, step) > 1` gate (call site ~:427) to `>= 1` (or restructure so the 1-tile branch of `handleTransport` (~:457-464) is deleted and its callers use `crossMultiTileDoor`); landing stays `step + dir`. Preserve: the already-open short-circuit (`Reachability.canStep(approach, step)` → still must WALK THROUGH before returning true, not just detect open), the re-open-on-revert retry, `failedDoor` on false. Keep log lines' shapes; add one: `crossed '<name>' at (x,z)` on completion.
- [ ] **Step 4: GREEN.** Re-run the door smoke: 4/4 legs, each ≤25s. Then `bun tools/run-all-smokes.ts --only "essminer"` — must still PASS (EssMiner crosses this area constantly; this is the no-regression gate for the hot path).
- [ ] **Step 5: Gate + commit.** `bunx tsc --noEmit && bunx eslint src/bot/nav/WalkExecutor.ts tools/door-cross-test.ts tools/run-all-smokes.ts && bun test` clean. Commit: `fix(nav): drive 1-tile door crossings to completion — swung leaf blocks the step tile (live-confirmed 6/6 wedge)`.

### Task 2: Fix B — reachability-aware arrival (shared predicate, TDD)

**Files:** Create `src/bot/nav/arrival.ts`, `test/bot/nav/arrival.test.ts`; Modify `src/bot/nav/WalkExecutor.ts`, `src/bot/api/Traversal.ts`, `src/bot/nav/DirectNavigator.ts`.

**Interfaces:** `export interface ArrivalProbe { canReach(t: NavPoint): boolean; walkable(t: NavPoint): boolean }`; `export function isArrived(me: NavPoint, dest: NavPoint, radius: number, probe: ArrivalProbe): boolean` implementing the Global-Constraints semantics exactly.

- [ ] **Step 1: Failing unit tests** (`test/bot/nav/arrival.test.ts`, stub probe like `coverageLogic.test.ts`): within radius + reachable → true; within radius + UNreachable + dest walkable → **false** (the H1 case); within radius + unreachable + dest NOT walkable → true (fallback); outside radius → false regardless; level mismatch → false; radius 0 exact-tile + reachable → true.
- [ ] **Step 2: RED.** `bun test test/bot/nav/arrival.test.ts` — module not found.
- [ ] **Step 3: Implement** `arrival.ts` (pure, ~15 lines) and wire ALL FOUR gates to it, each building the probe from the real `Reachability`/scene surface (verify exact APIs; keep `maxSteps` bounded ~512 — arrival checks run per tick). `'closest'`/honest-arrival outcomes keep their current meaning (they fire when NOT arrived on the terminal tile). walkResilient's `withinRadius` uses the same predicate so outer/inner never disagree.
- [ ] **Step 4: GREEN + no-regression.** Unit tests pass; full `bun test`; re-run door smoke + `--only "essminer"` + `--only shoprun` (three smokes cover long walks, bank stands, shop stands — the arrival semantics change must not strand any of them).
- [ ] **Step 5: Gate + commit.** `fix(nav): arrival requires reachability within radius — no more wall-blind 'arrived' at closed doors`.

### Task 3: Fix C — opener filter + stall blind spot

**Files:** Modify `src/bot/nav/WalkExecutor.ts`; extract the loc filter as a pure exported helper `isOpenableBarrier(name: string | null, ops: readonly (string | null)[]): boolean` (new tests appended to `test/bot/nav/arrival.test.ts` or a small `test/bot/nav/openableBarrier.test.ts`).

- [ ] **Step 1: Failing tests:** `isOpenableBarrier('Door', ['Open'])` true; `('Gate', ['Open-quietly'])` true (prefix); `('Wardrobe', ['Open'])` **false** (name filter — the probe's wardrobe incident); `('Door', ['Close'])` false; null name false.
- [ ] **Step 2: RED, then implement:** `tryNearbyDoor` uses the helper (`.where(l => isOpenableBarrier(l.name, l.actions()))` + `.within(3).nearest()`, click via the matched `/^open/i` op — mirror `walkOpening.ts`'s `openOp`). Stall accumulation: at ~:254-255, when `!moved` and the committed click target within `ARRIVE_RADIUS` is `!Reachability.canReach(tiles[clickIdx], { maxSteps: 256 })`, accumulate `stallTicks` instead of resetting (comment the probe-confirmed blind spot). Do not change `STALL_TICKS`/retry ordering.
- [ ] **Step 3: GREEN + smokes:** unit tests; full suite; door smoke + essminer re-run.
- [ ] **Step 4: Gate + commit.** `fix(nav): stall opener targets real doors/gates (any Open-op) + stall counter counts unreachable click targets`.

### Task 4: Green sweep + evidence closure

- [ ] **Step 1:** `bunx tsc --noEmit`; full `bun test`; `bun tools/shops/gen-shopdb.ts --check`; `bun run build:bot && bun tools/nav/coverage.ts` (all previously green — confirm unchanged).
- [ ] **Step 2:** `bun tools/run-all-smokes.ts --only "door-cross,essminer,shoprun,shop-test"` — all PASS.
- [ ] **Step 3:** Append a closure section to `.superpowers/sdd/door-probe-evidence.md`: which fix closed which confirmed hypothesis, with the post-fix door-smoke timings vs the 30–92s baseline. Report: tests added, smoke timings, any behavior notes for the next live run.

## Self-review notes

- Fix ordering is deliberate: A first (it's the EssMiner-site mechanism and the door smoke's subject), B second (its no-regression net includes the now-green door smoke), C last (hardening on top).
- Fix B's unwalkable-dest fallback is the explicit regression guard; if implementation finds a caller whose dest is walkable-but-legitimately-unreachable (none known — navTargets coverage gates stands), that surfaces as a smoke failure in Task 2 Step 4, not silent behavior change.
- The follow-ups NOT in scope (derive-doors shape/op coverage, diagonal doors) are recorded in the evidence file and the ledger.
