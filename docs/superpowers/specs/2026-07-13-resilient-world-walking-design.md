# Resilient World-Walking — Phase 1: the walker core — Design

**Goal:** Make the one shared resilient-walk path so tenacious that bots effectively never wedge on navigation. It keeps trying, escalating through strategies, until it genuinely arrives or the script is stopped/interrupted — with zero per-bot changes, so every bot benefits at once.

**Scope:** Phase 1 = the walker core only (this spec). Phase 2 (hand-added transport edges for spots the core still can't bridge, + a route-coverage harness to find them) gets its own spec after this lands. Phase 1's own validation uses the real Varrock East bank↔Aubury stuck case, so it needs no Phase-2 data to prove itself.

**User decisions (2026-07-13):** core first; the walker **retries forever** (never returns a "gave up" failure); build the coverage harness in Phase 2.

## Problem (grounded in the current code)

- **The client-scene walker is never wired into the resilient path.** `actions.walkTo`/`DirectNavigator` fire the client's own `tryMove` BFS over the *live loaded-scene collision* (`ClientAdapter.ts:935-941`, `DirectNavigator.ts:14-65`) — it paths into a walled shop / around a building where the baked graph has no edge. Only RockCrab/FlaxPicker call it by hand (`FlaxPicker.ts:307-312`); `Traversal.walkResilient` (`Traversal.ts:39-62`) only ever re-runs the baked `WalkExecutor.walkTo`.
- **Silent false-positive "arrived."** When the baked pathfinder snaps an unwalkable `dest` to its nearest reachable terminal, *standing on that terminal counts as arrival even if still outside `radius`* (`WalkExecutor.ts:144-152` and `:215-219`, `lastOutcome='arrived'`). `walkResilient` returns `true`; the caller believes it arrived and the *next* task fails (this is exactly why EssMiner "reached" the bank area yet couldn't bank).
- **Hard-wired pathfinder budget, not plumbed.** `MAX_EXPANSIONS = 300_000` (`PathFinder.ts:64`, enforced `:351-353`) is overridable per call but `NavWorker.ts:51` passes no budget and the worker protocol carries none — dense routes fail `"expansion budget exceeded"` with no recourse.
- **No fast, unified stuck recovery.** Zero-progress escalation only exists at the 10-min `Supervisor` wedge (`Supervisor.ts:10`) → 15-min `StallGuard` restart (`StallGuard.ts:5`). `walkResilient` gives up after `attempts` (default 3) and returns `false`, which most callers ignore.

## Architecture — an escalation ladder inside `walkResilient`

Replace the current fixed-attempt loop with a strategy ladder that runs each cycle and escalates on **no progress**. Progress = the player's Chebyshev distance to `dest` strictly decreased since the last checkpoint (`bestDist`). The ladder, per cycle:

1. **Baked web-walk** — `WalkExecutor.walkTo(dest, {radius, timeoutMs})` (unchanged), the fast primary.
2. **Budget bump** — if that returned with `WalkExecutor.lastOutcome === 'budget'` (new; see Honest Arrival), retry the baked walk once with a larger `maxExpansions` (e.g. ×4) before escalating — cheaply clears dense-area failures.
3. **Client-scene walk** — on stall / `closest` / `failed`, drive `DirectNavigator.walkTo(dest, sceneRadius, sceneTimeoutMs)` toward the target. This is the key lever: it bridges the short in-scene hop the baked graph can't. If `dest` is outside the loaded scene (`reader.toLocal` null), DirectNavigator already clamps the click to the scene edge, so it still makes progress toward `dest` and the next cycle's baked walk re-engages closer in.
4. **Unstick maneuver** — if a whole pass still made zero progress: open any shut door within 3 (reuse `WalkExecutor.tryNearbyDoor`), then step to a random *reachable* adjacent tile (`Reachability.canStep`) to break a corner-wedge / re-click loop, and continue.
5. **Backoff + loop forever** — after a no-progress pass, wait a short growing backoff (`Execution.delayTicks`, ~2→~10 ticks, capped) and repeat from step 1. Emit a throttled progress line (`bestDist`, strategy) at most every ~15 s — observable, never spam.

Every cycle first checks `EventSignal.pending()` and yields (returns, semantics below), so random events and script Stop always interrupt cleanly and promptly.

**Termination:**
- **Arrived** (genuinely within `radius`) → return `true`.
- **Interrupted** (`EventSignal.pending()` / `WalkExecutor.lastOutcome === 'interrupted'`) → return `false` immediately (a yield, not a give-up — every caller already treats `false` as "retry next loop"). This is the ONLY `false`.
- Otherwise it never returns on its own — it keeps escalating. The runtime backstop below handles a truly impossible target.

## Honest arrival (bug fix in WalkExecutor)

Split the conflated outcome. Extend `WalkExecutor.lastOutcome` to `'arrived' | 'closest' | 'budget' | 'interrupted' | 'failed'`:
- `'arrived'` — genuinely within `radius`.
- `'closest'` — landed on the path's nearest-reachable terminal but still outside `radius` (the case at `:144-152`/`:215-219`).
- `'budget'` — the path request came back `reason` matching `/budget/`.

`WalkExecutor.walkTo`'s **boolean return is unchanged** (still `true` when it reaches the terminal — direct `walkTo` callers, e.g. bots that want "get as close as you can," are unaffected). The resilient ladder reads `lastOutcome`, treating only `'arrived'` as done and `'closest'`/`'budget'`/`'failed'` as "escalate." This keeps blast radius to `walkResilient` alone.

## Retry-forever semantics & compatibility

- **Default becomes tenacious.** `WalkResilientOptions.attempts` default changes from `3` to unbounded (retry forever). Callers that pass an explicit `attempts` (RockCrab `attempts:4/6`, quest `primitives.ts`) keep bounded behavior unchanged — so no bot regresses; the common default path gains the resilience.
- **Backstop against a truly impossible target.** IMPORTANT (corrected after the final review): the `Supervisor` (10-min) → `StallGuard` (15-min) timers do NOT reliably fire during an *actively looping* forever-walk — every ladder rung sleeps via `Execution.*`, which refreshes `ctx.lastProgressAt` each frame (so StallGuard's hard-stall never ages) and keeps `loopInFlight` true (so `Supervisor.intercept` never re-runs). The real liveness for an active walk is the walker's own top-of-loop `EventSignal.pending()` poll (random events still interrupt on a live server). The load-bearing backstop is therefore that **the Supervisor watchdog — itself a `walkResilient` caller — must stay BOUNDED** (`attempts: 3`) so it can give up and call `StallGuard.requestRestart`; the retry-forever default would silently defeat it (this was found and fixed in review — `Supervisor.ts` passes explicit `attempts`). Other callers with genuine `false`-driven recovery branches (the quest primitives' hop/climb-back) are likewise bounded. Plain gather/travel loops correctly become more tenacious.
- **CPU/log safety.** Every cycle sleeps via `Execution.*` (never a tight loop); progress logging is throttled to ~15 s.

## File structure

- **Create** `src/bot/nav/walkLadder.ts` — pure, client-free strategy logic (the ArdyThieverLogic/localReach pattern): `nextStrategy(state)`, `backoffTicks(noProgressPasses)`, `classifyOutcome(...)`, `pickUnstickStep(here, blocked, candidates)` (choose a reachable adjacent tile), `madeProgress(bestDist, curDist)`. Unit-tested under plain `bun test`.
- **Modify** `src/bot/api/Traversal.ts` — rewrite `walkResilient` to orchestrate the ladder using `walkLadder.ts` + `WalkExecutor` + `DirectNavigator` + `Reachability`/`EventSignal`. Keep `walkTo`/`preload`/`remaining` as-is. Extend `WalkResilientOptions` (attempts default → unbounded; optional `sceneRadius`, `maxBudget`).
- **Modify** `src/bot/nav/WalkExecutor.ts` — widen `lastOutcome` union to include `'closest'`/`'budget'`; set `'closest'` at the two terminal-arrival sites, `'budget'` when the path result reason matches `/budget/`; accept an optional `maxExpansions` in `WalkOptions`/`requestPath` and forward it.
- **Modify** `src/bot/nav/Navigator.ts`, `NavWorker.ts`, `PathFinder.ts` (`NavRequest`) — thread an optional `maxExpansions` through the worker `path` message to `findPath`'s 4th arg (default stays 300k).
- **Reuse unchanged** `DirectNavigator.ts`, `Reachability.ts`, `EventSignal.ts`, `WalkExecutor.tryNearbyDoor`.

## Testing

- **Unit** (`test/bot/nav/walkLadder.test.ts`): progress detection (`madeProgress`), backoff schedule (monotonic, capped), outcome classification (`arrived`/`closest`/`budget`/`failed`/`interrupted`), unstick step selection (picks a reachable candidate; returns null when none), strategy sequencing (baked → budget-bump on `'budget'` → scene → unstick → backoff).
- **Live validation on the real stuck case** (`tools/resilient-walk-test.ts`): a maxme'd account, quest set, **start at the Varrock East bank and walk to Aubury (3253,3402)** — assert the hardened `walkResilient` gets within interact range (the exact leg the baked walker calls "unreachable"), driven by the client-scene fallback, **with no Phase-2 edge added.** Then re-run the **EssMiner** smoke from a cold `::tele` bank start (the scenario that failed) — it should now complete the double cycle. This proves the core fixes real stalls.
- **No regressions:** `tools/tollgate-test.ts` (both phases), `tools/nav-test.ts` (Lumbridge→Varrock arrival), and `tools/nav/bench-path.ts` (7 fixed routes still `ok`) all still pass. Add `resilient-walk-test` to `run-all-smokes` `LONG` (900 s).

## Risks / non-goals

- **DirectNavigator is scene-bound** (±48 tiles). For a far `dest` it walks to the scene edge and the next baked cycle re-engages — correct but means the scene fallback only *finishes* a leg the baked walk got close on. Acceptable: the failures we're fixing are short in-scene hops the baked walk already reaches the vicinity of.
- **Retry-forever + task-level stops.** A bot task that itself stops after N failures (e.g. EssMiner's `MAX_BANK_FAILS`) will now rarely hit that cap because the walker keeps trying — the two must be reconciled per bot, but that's out of Phase-1 scope (the walker change is strictly more tenacious; existing caps just fire less).
- **Non-goals (Phase 2+):** hand-added transport edges, the route-coverage harness, a rewrite of the pathfinder's A* internals (bidirectional search, etc.), and any change to the door/crossing machinery beyond the `lastOutcome` widening.
