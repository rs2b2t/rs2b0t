# Resilient World-Walking (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the one shared resilient-walk path (`Traversal.walkResilient`) into a tenacious escalation ladder — baked web-walk → bigger pathfinder budget → client-scene walk → unstick maneuver → backoff, looping forever — so bots effectively never wedge on navigation, with zero per-bot changes.

**Architecture:** A pure state machine in `src/bot/nav/walkLadder.ts` decides the next strategy each cycle from (distance-to-target progress, last outcome); `Traversal.walkResilient` becomes a thin driver that executes the chosen strategy against the existing `WalkExecutor` (baked), `DirectNavigator` (client-scene), and `Reachability` (unstick). The baked walker gains an honest arrival distinction (`closest`/`budget` vs `arrived`) and a plumbed `maxExpansions` budget.

**Tech Stack:** TypeScript (bun), bun:test, Playwright live smokes vs the local engine on :8890.

## Global Constraints

- Scope: create `src/bot/nav/walkLadder.ts`, `test/bot/nav/walkLadder.test.ts`, `tools/resilient-walk-test.ts`; modify `src/bot/api/Traversal.ts`, `src/bot/nav/WalkExecutor.ts`, `src/bot/nav/Navigator.ts`, `src/bot/nav/NavWorker.ts`, `src/bot/nav/PathFinder.ts`, `tools/nav/bench-path.ts`, `tools/run-all-smokes.ts`. Nothing else. Phase 2 (hand-added edges, coverage harness) is out of scope.
- **The walker retries forever** (user decision): `walkResilient` returns `false` ONLY on interruption (random event / Stop); it never returns a "gave up" failure. The runtime `Supervisor`→`StallGuard` (10/15-min) is the backstop for a truly impossible target — do not add a give-up.
- **`WalkExecutor.walkTo`'s boolean return is UNCHANGED** — direct callers must not regress. Only `lastOutcome` gains new values, and only `walkResilient` reads them.
- Explicit `attempts` on `walkResilient` still bounds behavior; the *default* (undefined) becomes retry-forever.
- Every code task must leave `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before its commit (suite currently 293 passing).
- Commit straight to `main`, conventional-commit subjects (`feat(nav): ...`), and end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Comments state constraints the code can't show (house style) — no "changed X" narration.
- No `Math.random`/`Date.now` in the PURE module (`walkLadder.ts`) — keep it deterministic/testable; the driver may use them.
- Live smokes need the local engine (`cd ~/code/rs2b2t-engine && npm run quickstart`, :8890) + `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`.

## File Structure

- `src/bot/nav/walkLadder.ts` — **pure** (imports only its own types): the `advance` state machine, `backoffTicks`, `classifyReason`, `pickUnstickStep`, and the shared types. Unit-tested.
- `src/bot/api/Traversal.ts` — `walkResilient` rewritten as the ladder driver; `WalkResilientOptions` extended.
- `src/bot/nav/WalkExecutor.ts` — `lastOutcome` union widened + set honestly; `WalkOptions.maxExpansions` forwarded.
- `src/bot/nav/{Navigator,NavWorker,PathFinder}.ts` — thread `maxExpansions` through the worker protocol.
- `test/bot/nav/walkLadder.test.ts` — pure unit tests.
- `tools/resilient-walk-test.ts` + `tools/run-all-smokes.ts` — live validation.

---

### Task 1: Pure ladder state machine — `walkLadder.ts` (TDD)

**Files:**
- Create: `src/bot/nav/walkLadder.ts`
- Test: `test/bot/nav/walkLadder.test.ts`

**Interfaces:**
- Consumes: nothing (standalone pure module).
- Produces (Task 4 consumes these exact signatures):
  - `type LastOutcome = 'arrived' | 'closest' | 'budget' | 'failed' | 'interrupted' | null`
  - `type LadderAction = { kind: 'baked'; bigBudget: boolean } | { kind: 'scene' } | { kind: 'unstick' } | { kind: 'backoff'; ticks: number } | { kind: 'arrived' } | { kind: 'interrupted' }`
  - `type StepPhase = 'baked' | 'scene' | 'unstick'`
  - `interface LadderState { bestDist: number; noProgressPasses: number; phase: StepPhase; triedBigBudget: boolean }`
  - `interface LadderObs { curDist: number; withinRadius: boolean; interrupted: boolean; lastOutcome: LastOutcome }`
  - `function initialLadderState(curDist: number): LadderState`
  - `function advance(state: LadderState, obs: LadderObs): { action: LadderAction; state: LadderState }`
  - `function backoffTicks(noProgressPasses: number): number`
  - `function classifyReason(reason: string): 'budget' | 'failed'`
  - `interface StepOffset { dx: number; dz: number }`
  - `function pickUnstickStep(canStep: (dx: number, dz: number) => boolean, startDir: number): StepOffset | null`

- [ ] **Step 1: Write the failing test**

Create `test/bot/nav/walkLadder.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { advance, backoffTicks, classifyReason, initialLadderState, pickUnstickStep, type LadderObs, type LadderState } from '#/bot/nav/walkLadder.js';

const obs = (o: Partial<LadderObs>): LadderObs => ({ curDist: 10, withinRadius: false, interrupted: false, lastOutcome: null, ...o });

describe('initialLadderState', () => {
    test('seeds bestDist from the starting distance, fresh pass', () => {
        expect(initialLadderState(12)).toEqual({ bestDist: 12, noProgressPasses: 0, phase: 'baked', triedBigBudget: false });
    });
});

describe('advance — terminal outcomes', () => {
    test('within radius → arrived', () => {
        const r = advance(initialLadderState(10), obs({ withinRadius: true }));
        expect(r.action).toEqual({ kind: 'arrived' });
    });
    test('interrupted flag → interrupted', () => {
        const r = advance(initialLadderState(10), obs({ interrupted: true }));
        expect(r.action).toEqual({ kind: 'interrupted' });
    });
    test('lastOutcome interrupted → interrupted', () => {
        const r = advance(initialLadderState(10), obs({ lastOutcome: 'interrupted' }));
        expect(r.action).toEqual({ kind: 'interrupted' });
    });
});

describe('advance — first action + start of pass', () => {
    test('null lastOutcome runs a normal baked walk', () => {
        const r = advance(initialLadderState(10), obs({ lastOutcome: null }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
        expect(r.state.phase).toBe('baked');
    });
});

describe('advance — escalation with no progress', () => {
    test('baked→budget-exceeded once → retry baked with big budget', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'budget' }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: true });
        expect(r.state.triedBigBudget).toBe(true);
    });
    test('baked→budget when big budget already tried → escalate to scene', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: true };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'budget' }));
        expect(r.action).toEqual({ kind: 'scene' });
        expect(r.state.phase).toBe('scene');
    });
    test('baked→closest (no progress) → escalate to scene', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'closest' }));
        expect(r.action).toEqual({ kind: 'scene' });
    });
    test('scene (no progress) → unstick', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'scene', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'failed' }));
        expect(r.action).toEqual({ kind: 'unstick' });
        expect(r.state.phase).toBe('unstick');
    });
    test('unstick (no progress) → backoff, bumps passes, resets phase to baked', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 0, phase: 'unstick', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: 'failed' }));
        expect(r.action.kind).toBe('backoff');
        expect(r.state.noProgressPasses).toBe(1);
        expect(r.state.phase).toBe('baked');
        expect(r.state.triedBigBudget).toBe(false);
    });
    test('after backoff (null lastOutcome) → baked again (new pass)', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 1, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 10, lastOutcome: null }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
    });
});

describe('advance — progress restarts the pass', () => {
    test('any progress resets to a fresh baked pass and clears noProgress', () => {
        const s: LadderState = { bestDist: 10, noProgressPasses: 3, phase: 'unstick', triedBigBudget: true };
        const r = advance(s, obs({ curDist: 7, lastOutcome: 'closest' }));
        expect(r.action).toEqual({ kind: 'baked', bigBudget: false });
        expect(r.state).toEqual({ bestDist: 7, noProgressPasses: 0, phase: 'baked', triedBigBudget: false });
    });
    test('bestDist only ever decreases', () => {
        const s: LadderState = { bestDist: 5, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
        const r = advance(s, obs({ curDist: 9, lastOutcome: 'closest' }));
        expect(r.state.bestDist).toBe(5);
    });
});

describe('backoffTicks', () => {
    test('monotonic non-decreasing and capped', () => {
        const seq = [1, 2, 3, 5, 8, 20].map(backoffTicks);
        for (let i = 1; i < seq.length; i++) { expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]); }
        expect(backoffTicks(1)).toBeGreaterThanOrEqual(2);
        expect(backoffTicks(1000)).toBeLessThanOrEqual(16);
    });
});

describe('classifyReason', () => {
    test('budget messages classify as budget, others as failed', () => {
        expect(classifyReason('expansion budget exceeded (300000)')).toBe('budget');
        expect(classifyReason('unreachable')).toBe('failed');
        expect(classifyReason('path request timed out')).toBe('failed');
    });
});

describe('pickUnstickStep', () => {
    const OPEN = () => true;
    test('returns a step when a neighbour is reachable', () => {
        expect(pickUnstickStep(OPEN, 0)).toEqual({ dx: 0, dz: 1 });
    });
    test('rotates by startDir', () => {
        expect(pickUnstickStep(OPEN, 2)).toEqual({ dx: 1, dz: 0 });
    });
    test('skips blocked neighbours to the first reachable one', () => {
        // only West (dx:-1,dz:0) is open
        const onlyWest = (dx: number, dz: number): boolean => dx === -1 && dz === 0;
        expect(pickUnstickStep(onlyWest, 0)).toEqual({ dx: -1, dz: 0 });
    });
    test('returns null when nothing is reachable', () => {
        expect(pickUnstickStep(() => false, 0)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/bot/nav/walkLadder.test.ts`
Expected: FAIL — cannot resolve `#/bot/nav/walkLadder.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/nav/walkLadder.ts`:

```ts
/**
 * Pure decision core for the resilient walk ladder (no client imports → runs
 * under plain `bun test`). `advance` is a state machine: given the player's
 * progress toward the target and how the last strategy ended, it picks the next
 * strategy. The impure driver (Traversal.walkResilient) executes the action and
 * feeds the outcome back. Escalation within one "pass": baked → (big-budget
 * baked on a budget failure) → client-scene → unstick → backoff, then repeat.
 * ANY progress (distance-to-target dropped) restarts the pass at baked.
 */

export type LastOutcome = 'arrived' | 'closest' | 'budget' | 'failed' | 'interrupted' | null;

export type LadderAction =
    | { kind: 'baked'; bigBudget: boolean }
    | { kind: 'scene' }
    | { kind: 'unstick' }
    | { kind: 'backoff'; ticks: number }
    | { kind: 'arrived' }
    | { kind: 'interrupted' };

export type StepPhase = 'baked' | 'scene' | 'unstick';

export interface LadderState {
    /** Best (smallest) Chebyshev distance to the target seen so far. */
    bestDist: number;
    /** Consecutive full passes (baked→scene→unstick) that made no progress. */
    noProgressPasses: number;
    /** The strategy the LAST executed action ran (what advance decides FROM). */
    phase: StepPhase;
    /** Whether the big-budget baked retry was already spent this pass. */
    triedBigBudget: boolean;
}

export interface LadderObs {
    /** Current Chebyshev distance to the target. */
    curDist: number;
    /** Genuinely within the requested arrival radius. */
    withinRadius: boolean;
    /** A random event / Stop is pending — yield now. */
    interrupted: boolean;
    /** How the action just executed ended (null = none yet / just backed off). */
    lastOutcome: LastOutcome;
}

const BACKOFF_MIN = 2;
const BACKOFF_MAX = 16;

export function initialLadderState(curDist: number): LadderState {
    return { bestDist: curDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false };
}

/** Growing, capped backoff (in game ticks) between no-progress passes. */
export function backoffTicks(noProgressPasses: number): number {
    return Math.min(BACKOFF_MAX, BACKOFF_MIN + 2 * Math.max(0, noProgressPasses - 1));
}

/** A path failure reason is a budget-exhaustion (retryable with more budget) or
 *  a genuine failure. */
export function classifyReason(reason: string): 'budget' | 'failed' {
    return /budget/i.test(reason) ? 'budget' : 'failed';
}

export function advance(state: LadderState, obs: LadderObs): { action: LadderAction; state: LadderState } {
    if (obs.interrupted || obs.lastOutcome === 'interrupted') {
        return { action: { kind: 'interrupted' }, state };
    }
    if (obs.withinRadius) {
        return { action: { kind: 'arrived' }, state };
    }

    const progressed = obs.curDist < state.bestDist;
    const bestDist = Math.min(state.bestDist, obs.curDist);

    // Progress anywhere → restart the pass fresh at baked.
    if (progressed) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
    }

    // Start of a pass (first call, or just finished a backoff wait).
    if (obs.lastOutcome === null) {
        return { action: { kind: 'baked', bigBudget: false }, state: { bestDist, noProgressPasses: state.noProgressPasses, phase: 'baked', triedBigBudget: false } };
    }

    // No progress — escalate within the pass by the phase of the action just run.
    if (state.phase === 'baked') {
        if (obs.lastOutcome === 'budget' && !state.triedBigBudget) {
            return { action: { kind: 'baked', bigBudget: true }, state: { ...state, bestDist, phase: 'baked', triedBigBudget: true } };
        }
        return { action: { kind: 'scene' }, state: { ...state, bestDist, phase: 'scene' } };
    }
    if (state.phase === 'scene') {
        return { action: { kind: 'unstick' }, state: { ...state, bestDist, phase: 'unstick' } };
    }
    // phase === 'unstick' → pass exhausted: back off, then a new pass starts at baked.
    const passes = state.noProgressPasses + 1;
    return { action: { kind: 'backoff', ticks: backoffTicks(passes) }, state: { bestDist, noProgressPasses: passes, phase: 'baked', triedBigBudget: false } };
}

// 8 neighbours, clockwise from North; the unstick maneuver steps to the first
// reachable one starting at a caller-rotated offset (so repeated unsticks vary).
const DIRS: readonly { dx: number; dz: number }[] = [
    { dx: 0, dz: 1 }, { dx: 1, dz: 1 }, { dx: 1, dz: 0 }, { dx: 1, dz: -1 },
    { dx: 0, dz: -1 }, { dx: -1, dz: -1 }, { dx: -1, dz: 0 }, { dx: -1, dz: 1 }
];

export interface StepOffset { dx: number; dz: number }

/** First reachable neighbour offset (rotating from `startDir`), or null. */
export function pickUnstickStep(canStep: (dx: number, dz: number) => boolean, startDir: number): StepOffset | null {
    for (let i = 0; i < DIRS.length; i++) {
        const d = DIRS[(startDir + i) % DIRS.length];
        if (canStep(d.dx, d.dz)) {
            return { dx: d.dx, dz: d.dz };
        }
    }
    return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/bot/nav/walkLadder.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Full check + commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/nav/walkLadder.ts test/bot/nav/walkLadder.test.ts && bun test`
Expected: clean; suite up from 293.

```bash
git add src/bot/nav/walkLadder.ts test/bot/nav/walkLadder.test.ts
git commit -m "feat(nav): pure walk-ladder state machine + tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Plumb `maxExpansions` through the worker protocol

**Files:**
- Modify: `src/bot/nav/PathFinder.ts` (the `NavRequest` type only)
- Modify: `src/bot/nav/NavWorker.ts` (pass the 4th arg)
- Modify: `src/bot/nav/Navigator.ts` (`findPath` opt + postMessage)
- Modify: `src/bot/nav/WalkExecutor.ts` (`WalkOptions.maxExpansions` + `requestPath` forward)
- Modify: `tools/nav/bench-path.ts` (real-pack budget assertion)

**Interfaces:**
- Consumes: `PathFinder.findPath(fromRaw, toRaw, avoidDoors?, maxExpansions = MAX_EXPANSIONS)` (already exists), `MAX_EXPANSIONS` export.
- Produces: `Navigator.findPath(from, to, { avoidDoors?, timeoutMs?, maxExpansions? })`; `WalkOptions.maxExpansions?: number` forwarded to the worker; `NavRequest` path variant carries `maxExpansions?`.

**Why no `bun test` unit test here:** the real collision pack lives at `out/collision.lcnav.gz` (a `build:bot` artifact, absent in a fresh checkout), so a `bun test` that loads it would be fragile. `PathFinder.findPath`'s 4th `maxExpansions` param already exists; the new work is threading it through the worker glue (covered by `tsc`). The param's real-pack behavior is asserted in `tools/nav/bench-path.ts` (Step 1) — the existing harness that already loads the pack — and the ladder's budget-bump is exercised by the live smoke (Task 5).

- [ ] **Step 1: Add a real-pack budget assertion to `tools/nav/bench-path.ts`**

At the end of the file (after the `for (const route of routes)` loop, ~`bench-path.ts:69`), append:

```ts
// Budget param check: a tiny budget makes a real long route fail 'budget
// exceeded'; the default solves it. Proves maxExpansions reaches findPath.
{
    const from = { x: 3222, z: 3218, level: 0 };
    const to = { x: 3213, z: 3428, level: 0 };
    const tight = finder.findPath(from, to, undefined, 50);
    const loose = finder.findPath(from, to);
    if (tight.ok || !/budget/i.test(tight.reason) || !loose.ok) {
        console.log(`FAIL  budget-param: tight.ok=${tight.ok} reason=${tight.ok ? '-' : tight.reason} loose.ok=${loose.ok}`);
        process.exitCode = 1;
    } else {
        console.log(`ok    budget-param: tight budget -> ${tight.reason}; default budget -> solved`);
    }
}
```

- [ ] **Step 2: Run it (needs the built pack)**

Run: `bun run build:bot >/dev/null 2>&1; bun tools/nav/bench-path.ts`
Expected: all 7 routes `ok` **and** `ok    budget-param: tight budget -> expansion budget exceeded (50); default budget -> solved`. (`build:bot` produces `out/collision.lcnav.gz`, which bench-path loads by default.)

- [ ] **Step 3: Thread `maxExpansions` in the worker protocol type — `PathFinder.ts:53`**

Replace the `NavRequest` path variant:

```ts
export type NavRequest = { type: 'init'; pack: ArrayBuffer } | { type: 'path'; id: number; from: NavPoint; to: NavPoint; avoid?: { x: number; z: number }[]; maxExpansions?: number };
```

- [ ] **Step 4: Pass it in the worker — `NavWorker.ts:51`**

Replace:

```ts
            const outcome = finder.findPath(message.from, message.to, avoid, message.maxExpansions);
```

- [ ] **Step 5: Forward it from the Navigator — `Navigator.ts:72` and `:90`**

Change the `findPath` opts type (`:72`) to add `maxExpansions`:

```ts
    async findPath(from: NavPoint, to: NavPoint, opts?: { avoidDoors?: { x: number; z: number }[]; timeoutMs?: number; maxExpansions?: number }): Promise<PathResult> {
```

And the postMessage (`:90`):

```ts
            this.worker!.postMessage({ type: 'path', id, from, to, avoid: opts?.avoidDoors, maxExpansions: opts?.maxExpansions });
```

- [ ] **Step 6: Forward it from WalkExecutor — `WalkExecutor.ts` `WalkOptions` (`:53-60`) + `requestPath` (`:179-187`)**

Add to `WalkOptions`:

```ts
    /** Override the pathfinder's node-expansion budget for this walk (default 300k). */
    maxExpansions?: number;
```

`walkTo` reads it once near the top (after `const log = ...`, ~`:115`):

```ts
        const maxExpansions = opts?.maxExpansions;
```

Change `requestPath` to accept + forward it (signature + the `findPath` call at `:181`):

```ts
    private async requestPath(from: WorldTile, to: WorldTile, maxExpansions?: number): Promise<PathResult> {
        let result: PathResult | null = null;
        Navigator.findPath(from, to, { avoidDoors: this.avoidDoors, maxExpansions }).then(
            r => (result = r),
            err => (result = { ok: false, reason: err instanceof Error ? err.message : String(err), expanded: 0 })
        );
        const settled = await Execution.delayUntil(() => result !== null, PATH_REQUEST_TIMEOUT_MS);
        return settled && result ? result : { ok: false, reason: 'path request timed out', expanded: 0 };
    }
```

And the call site in `walkTo` (`:132`):

```ts
                const path = await this.requestPath(me, dest, maxExpansions);
```

- [ ] **Step 7: Verify + commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/nav/PathFinder.ts src/bot/nav/NavWorker.ts src/bot/nav/Navigator.ts src/bot/nav/WalkExecutor.ts tools/nav/bench-path.ts && bun test`
Then: `bun run build:bot >/dev/null 2>&1; bun tools/nav/bench-path.ts` — all routes + `budget-param` line `ok`.
Expected: tsc/eslint/`bun test` clean; bench-path exits 0.

```bash
git add src/bot/nav/PathFinder.ts src/bot/nav/NavWorker.ts src/bot/nav/Navigator.ts src/bot/nav/WalkExecutor.ts tools/nav/bench-path.ts
git commit -m "feat(nav): plumb maxExpansions through the pathfinder worker protocol

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Honest arrival — widen `WalkExecutor.lastOutcome`

**Files:**
- Modify: `src/bot/nav/WalkExecutor.ts`

**Interfaces:**
- Consumes: `classifyReason` from `./walkLadder.js` (Task 1).
- Produces: `WalkExecutor.lastOutcome: 'arrived' | 'closest' | 'budget' | 'interrupted' | 'failed' | null`. `'closest'` = landed on the path's nearest-reachable terminal but outside `radius`; `'budget'` = the path request failed with a budget reason. The boolean return of `walkTo` is unchanged.

**Note on testing:** `WalkExecutor` is client-coupled (reads `reader.worldTile`, drives clicks), so its `lastOutcome` transitions are validated by the Task 5 live smoke, not a unit test. The pure `classifyReason` it now uses is already unit-tested (Task 1). This is the house split for impure nav glue (cf. `WalkExecutor` has no unit test today; `followMath`/`localReach` cover the pure parts).

- [ ] **Step 1: Import `classifyReason` — `WalkExecutor.ts:24` area**

Add to the imports (next to the `followMath` import):

```ts
import { classifyReason } from './walkLadder.js';
```

- [ ] **Step 2: Widen the `lastOutcome` field type — `WalkExecutor.ts:103`**

Replace:

```ts
    lastOutcome: 'arrived' | 'closest' | 'budget' | 'interrupted' | 'failed' | null = null;
```

- [ ] **Step 3: Classify a path-request failure as `budget` vs `failed` — `WalkExecutor.ts:133-137`**

Replace the `if (!path.ok) { ... }` block:

```ts
                if (!path.ok) {
                    log(`no path to (${dest.x},${dest.z},${dest.level}): ${path.reason}`);
                    this.lastOutcome = classifyReason(path.reason);
                    return false;
                }
```

(`classifyReason` returns `'budget'` or `'failed'`; both keep `walkTo` returning `false` here, so direct callers are unaffected — only `walkResilient` distinguishes them.)

- [ ] **Step 4: Mark the terminal snap as `closest`, not `arrived` — `WalkExecutor.ts:146-152`**

Replace the terminal block:

```ts
                const terminal = tiles[tiles.length - 1];
                if (terminal && me.level === terminal.level && me.x === terminal.x && me.z === terminal.z) {
                    if (chebyshev(me, dest) > radius) {
                        // standing on the nearest reachable tile but still short of dest —
                        // honestly 'closest', so walkResilient keeps escalating (client-scene
                        // walk) instead of believing it arrived. walkTo still returns true so
                        // direct callers get the "as close as the baked graph reaches" contract.
                        log(`dest (${dest.x},${dest.z}) unreachable beyond (${me.x},${me.z}) — nearest reachable tile`);
                        this.lastOutcome = 'closest';
                        return true;
                    }
                    this.lastOutcome = 'arrived';
                    return true;
                }
```

- [ ] **Step 5: Verify + commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/nav/WalkExecutor.ts && bun test`
Expected: clean (293 + Task 1/2 additions). The `followMath`/`localReach`/`specialCrossings` tests still pass (no behavior change to those paths).

```bash
git add src/bot/nav/WalkExecutor.ts
git commit -m "fix(nav): honest walk arrival — distinguish 'closest'/'budget' from 'arrived'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The ladder driver — rewrite `Traversal.walkResilient`

**Files:**
- Modify: `src/bot/api/Traversal.ts`

**Interfaces:**
- Consumes (Task 1): `advance`, `initialLadderState`, `pickUnstickStep`, and the `LadderState`/`LadderObs`/`LastOutcome` types from `../nav/walkLadder.js`. Consumes (Task 3): `WalkExecutor.lastOutcome` incl. `'closest'`/`'budget'`; `WalkExecutor.walkTo` accepting `maxExpansions`. Consumes existing: `DirectNavigator.walkTo`, `Reachability.canStep`, `EventSignal.pending`, `Execution.delayTicks`, `reader.worldTile`, `WalkExecutor.tryNearbyDoor`.
- Produces: `walkResilient(dest, opts)` that retries forever by default, returning `false` only on interruption. `WalkResilientOptions` gains `sceneRadius?`, `maxBudget?`; `attempts` default → unbounded.

**Prerequisite:** `WalkExecutor.tryNearbyDoor` is currently `private` (`WalkExecutor.ts:351`). Expose it: rename its declaration to a public method `async tryNearbyDoor(log?: (m: string) => void): Promise<boolean>` (keep the body) so the driver can call `WalkExecutor.tryNearbyDoor`. (It already takes a `log` param and returns whether a door opened.)

- [ ] **Step 1: Expose `tryNearbyDoor` — `WalkExecutor.ts:351`**

Change its declaration from `private async tryNearbyDoor(...)` to `async tryNearbyDoor(...)` (public). No body change. (Include this in Task 4's commit.)

- [ ] **Step 2: Rewrite `Traversal.ts`**

Replace the whole file body (keep the module shape) with:

```ts
import type { WorldTile } from '../adapter/ClientAdapter.js';
import { reader } from '../adapter/ClientAdapter.js';
import { Navigator } from '../nav/Navigator.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { WalkExecutor, type WalkOptions } from '../nav/WalkExecutor.js';
import { advance, initialLadderState, pickUnstickStep, type LadderState, type LastOutcome } from '../nav/walkLadder.js';
import { Reachability } from './Reachability.js';
import { EventSignal } from './EventSignal.js';
import { Execution } from './Execution.js';

export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Bound the escalation to this many baked-walk passes. Default: undefined =
     *  retry forever (the walker never gives up; only a random event / Stop ends
     *  it early). Set a number for a bounded caller. */
    attempts?: number;
    /** Per baked-walk budget (default 90s — several fit one recovery window). */
    timeoutMs?: number;
    /** Client-scene-walk arrival radius when bridging a baked gap (default = radius+1). */
    sceneRadius?: number;
    /** Big-budget baked retry's node budget (default 1.2M). */
    maxBudget?: number;
    /** Progress lines. */
    log?: (msg: string) => void;
}

const SCENE_TIMEOUT_MS = 6000; // short: return to the ladder promptly to re-check events/progress
const DEFAULT_MAX_BUDGET = 1_200_000;
const PROGRESS_LOG_MS = 15_000;

export const Traversal = {
    /** Walk to `dest` anywhere in the world (baked graph + doors + transports).
     *  True on arrival (within opts.radius, default 2), false on failure/timeout. */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean> {
        return WalkExecutor.walkTo(dest, opts);
    },

    /**
     * Tenacious world-walk: an escalation ladder (baked → bigger-budget baked →
     * client-scene walk → unstick maneuver → backoff) driven by the pure
     * `walkLadder` state machine, looping until it genuinely arrives within
     * `radius`. Retries FOREVER by default — returns false ONLY when a random
     * event / Stop interrupts (a yield, not a give-up; the runtime
     * Supervisor→StallGuard is the backstop for a truly impossible target). Pass
     * `attempts` to bound it. Sleeps via Execution.* so Stop unwinds it.
     */
    async walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean> {
        const log = opts.log ?? ((): void => {});
        const radius = opts.radius;
        const sceneRadius = opts.sceneRadius ?? radius + 1;
        const maxBudget = opts.maxBudget ?? DEFAULT_MAX_BUDGET;
        const bakedTimeout = opts.timeoutMs ?? 90000;
        const maxPasses = opts.attempts; // undefined = forever

        const dist = (): number => {
            const me = reader.worldTile();
            return me ? Math.max(Math.abs(me.x - dest.x), Math.abs(me.z - dest.z)) : Number.POSITIVE_INFINITY;
        };
        const withinRadius = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === dest.level && Math.max(Math.abs(me.x - dest.x), Math.abs(me.z - dest.z)) <= radius;
        };

        let state: LadderState = initialLadderState(dist());
        let lastOutcome: LastOutcome = null;
        let unstickDir = 0;
        let lastLoggedAt = performance.now();

        // Guard against the pathological empty-scene case where every observation
        // is Infinity (no player tile): a bounded safety cap on total iterations
        // that is astronomically above any real walk but prevents a hot spin if
        // reader.worldTile() is null forever.
        for (let iter = 0; iter < 100_000; iter++) {
            if (EventSignal.pending()) {
                log('walk interrupted by a random event — yielding to the runtime');
                return false;
            }

            const interrupted = lastOutcome === 'interrupted';
            const { action, state: next } = advance(state, { curDist: dist(), withinRadius: withinRadius(), interrupted, lastOutcome });
            state = next;

            if (action.kind === 'arrived') {
                return true;
            }
            if (action.kind === 'interrupted') {
                log('walk interrupted by a random event — yielding to the runtime');
                return false;
            }
            if (maxPasses !== undefined && state.noProgressPasses >= maxPasses) {
                log(`walkResilient: ${maxPasses} passes made no progress — stopping (bounded caller)`);
                return false;
            }

            if (performance.now() - lastLoggedAt > PROGRESS_LOG_MS) {
                lastLoggedAt = performance.now();
                log(`walkResilient: ${action.kind} toward (${dest.x},${dest.z}), best ${state.bestDist} tiles, pass ${state.noProgressPasses}`);
            }

            if (action.kind === 'baked') {
                await WalkExecutor.walkTo(dest, { radius, timeoutMs: bakedTimeout, log, ...(action.bigBudget ? { maxExpansions: maxBudget } : {}) });
                lastOutcome = WalkExecutor.lastOutcome;
            } else if (action.kind === 'scene') {
                await DirectNavigator.walkTo(dest, sceneRadius, SCENE_TIMEOUT_MS);
                lastOutcome = EventSignal.pending() ? 'interrupted' : 'failed'; // progress is read from the tile next iteration
            } else if (action.kind === 'unstick') {
                await WalkExecutor.tryNearbyDoor(log);
                const me = reader.worldTile();
                if (me) {
                    const step = pickUnstickStep((dx, dz) => Reachability.canStep(me, { x: me.x + dx, z: me.z + dz, level: me.level }), unstickDir);
                    unstickDir = (unstickDir + 3) % 8;
                    if (step) {
                        await DirectNavigator.walkTo({ x: me.x + step.dx, z: me.z + step.dz, level: me.level }, 0, 3000);
                    }
                }
                lastOutcome = 'failed';
            } else if (action.kind === 'backoff') {
                await Execution.delayTicks(action.ticks);
                lastOutcome = null; // a new pass starts at baked
            }
        }
        log('walkResilient: iteration cap hit (no player tile?) — yielding');
        return false;
    },

    /** Spawn the nav worker + load the collision pack ahead of first walkTo. */
    preload(): void {
        Navigator.start();
    },

    /** Remaining tile count of the walk in progress (0 when idle). */
    remaining(): number {
        return WalkExecutor.remaining;
    }
};

export type { WalkOptions };
```

- [ ] **Step 3: Verify clean**

Run: `bunx tsc --noEmit && bunx eslint src/bot/api/Traversal.ts src/bot/nav/WalkExecutor.ts && bun test`
Expected: all clean; full suite green (no unit test asserts the driver — it's covered by Task 5's live smoke, matching the house pattern for impure nav glue).

- [ ] **Step 4: Commit**

```bash
git add src/bot/api/Traversal.ts src/bot/nav/WalkExecutor.ts
git commit -m "feat(nav): resilient walkResilient — escalation ladder, retry-forever default

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Live validation + no-regression

**Files:**
- Create: `tools/resilient-walk-test.ts`
- Modify: `tools/run-all-smokes.ts` (add `'resilient-walk-test': 900` to `LONG`)

**Interfaces:**
- Consumes: the dev handle `globalThis.rs2b0t` (`client`, `reader.worldTile`, `registry`, `runner`, `actions`). Drives the real `Traversal.walkResilient` path via the registered **`WalkTo`** script (`WalkToBot`): it calls `Traversal.walkResilient(target, {radius: 3})` (`WalkToBot.ts:113`), and its `customTile` setting (non-zero) overrides the named destination (`WalkToBot.ts:12`, `:36`). Set it by URL param — tiles parse as `"x,z,level"` (`Settings.ts:108-113`): `bot.html?WalkTo.customTile=3253,3402,0`. Start it headlessly with `rs2b0t.runner.start(rs2b0t.registry.get('WalkTo'))` (the `.rs2b0t-select` picker is stale post-rebrand — do NOT use `selectOption`). Reachable floor sits 1-2 tiles from Aubury's counter tile, so radius 3 genuinely arrives once the ladder bridges the gap.

- [ ] **Step 1: Write the smoke**

Create `tools/resilient-walk-test.ts` — the decisive test is the **Varrock East bank → Aubury** leg that the baked walker calls "unreachable", now bridged by the ladder's client-scene fallback with NO hand-added edge. Model the harness on `tools/essminer-test.ts` (login off-tutorial, `::~maxme`), but drive the walker to Aubury and assert arrival within 3 tiles:

```ts
// Headless live smoke for the resilient walker: the Varrock East bank -> Aubury
// leg is a known baked-graph gap ("unreachable"). The hardened walkResilient must
// bridge it via the client-scene fallback and arrive within 3 tiles of Aubury
// (3253,3402) — WITHOUT any Phase-2 transport edge. Reload after the ::tele so the
// headless client scene is rebuilt (a ::tele alone leaves it un-rebuilt; see the
// 2026-07-13 essmine notes).
//
// Requires: engine on :8890 + local build deployed.
// Usage: bun tools/resilient-walk-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `rw${Date.now().toString(36).slice(-7)}`;
const AUBURY = { x: 3253, z: 3402 };

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        // the walker is reached via a tiny driver started with runner; see Step 1.
        runner: { start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean };
    };
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 20; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); } });
    const relog = async () => { await page.reload(); await boot(); let ok = false; for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(5000); ok = await login(); } return ok; };

    // customTile (3253,3402,0) = Aubury; WalkTo walks there via walkResilient radius 3.
    await page.goto(`${base}/bot.html?WalkTo.customTile=3253,3402,0`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    if (!(await relog())) { fail('relogin failed (off-island)'); }
    await type('::~maxme');
    await clearDialogs();
    for (let a = 0; a < 4; a++) { await type('::tele 0,50,53,53,26'); await page.waitForTimeout(1500); const t = await tile(); if (t && Math.abs(t.x - 3253) <= 6 && Math.abs(t.z - 3418) <= 6) break; await clearDialogs(); }
    if (!(await relog())) { fail('relogin failed (scene rebuild)'); }
    const start = await tile();
    if (!start || Math.abs(start.x - 3253) > 8 || Math.abs(start.z - 3418) > 8) { fail(`not at the Varrock East bank (at ${JSON.stringify(start)})`); }
    console.log(`at the bank: ${JSON.stringify(start)}`);

    // Drive the real Traversal.walkResilient via the WalkTo script → Aubury.
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('WalkTo')); });
    console.log('walking bank -> Aubury via the resilient walker...');

    let closest = 999;
    for (let i = 0; i < 150; i++) { // ~300s
        await page.waitForTimeout(2000);
        const t = await tile();
        if (t) { closest = Math.min(closest, Math.max(Math.abs(t.x - AUBURY.x), Math.abs(t.z - AUBURY.z))); }
        if (i % 15 === 0) { console.log(`  ...${i * 2}s at=${JSON.stringify(t)} closestToAubury=${closest}`); }
        if (closest <= 3) { break; }
    }
    console.log(`closestToAubury=${closest}`);
    if (closest > 3) { await page.screenshot({ path: 'out/resilient-walk-test.png' }); fail(`resilient walker did not reach Aubury (closest ${closest}) — the client-scene fallback did not bridge the baked gap`); }
    console.log('PASS');
} finally {
    await browser.close();
}
```

- [ ] **Step 2: Add the LONG entry**

In `tools/run-all-smokes.ts`, extend the `LONG` map: `..., 'resilient-walk-test': 900`.

- [ ] **Step 3: tsc/eslint + engine deploy**

Run: `bunx tsc --noEmit && bunx eslint tools/resilient-walk-test.ts tools/run-all-smokes.ts && bun test`
Then (engine on :8890): `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`

- [ ] **Step 4: Run the new smoke**

Run: `bun tools/resilient-walk-test.ts`
Expected: `PASS` with `closestToAubury <= 3`.

- [ ] **Step 5: No-regression on existing nav**

Run (engine up + deployed):
- `bun tools/essminer-test.ts` → still `PASS` (the loop that motivated this).
- `bun tools/tollgate-test.ts` → still `PASS` (both phases).
- `bun tools/nav-test.ts` → still `PASS` (Lumbridge→Varrock arrival).
- `bun tools/nav/bench-path.ts` → all 7 routes still `ok`.

- [ ] **Step 6: Commit**

```bash
git add tools/resilient-walk-test.ts tools/run-all-smokes.ts
git commit -m "test(nav): resilient-walk live smoke (bank->Aubury baked gap) + LONG entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
