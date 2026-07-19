# Navigation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make world navigation stop getting stuck: honest `unreachable` termination, deterministic door-crossing, wall-aware fallback goals, and one shared last-mile primitive (`Reach`) replacing the per-quest hacks.

**Architecture:** Targeted hardening of the existing stack — pure decision modules (`walkLadder`, `followMath`, `PathFinder`) get new tested logic; the impure drivers (`WalkExecutor`, `Traversal`) get thin wiring; quest defs then refactor onto a new `src/bot/api/Reach.ts` primitive. Spec: `docs/superpowers/specs/2026-07-19-nav-reliability-design.md`.

**Tech Stack:** TypeScript (Bun), `bun test` for pure-module unit tests, `bunx tsc --noEmit` typecheck, Playwright-driven live smokes against the local engine.

## Global Constraints

- **NEVER touch or commit `src/client/GameShell.ts`** (user's uncommitted WIP, stashed).
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Typecheck gate for every task: `bunx tsc --noEmit` must produce **no new errors** (pre-existing unrelated errors are tolerated; grep your touched files: `bunx tsc --noEmit 2>&1 | grep -E "walkLadder|WalkExecutor|Traversal|PathFinder|followMath|Reach|primitives|demonslayer|witchshouse|merlinscrystal"` must be empty).
- Unit test gate: `bun test` must pass fully.
- Live smokes need the local engine on `http://localhost:8890` (check: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8890/bot.html` → `200`). If it is down, STOP and report — do not try to start it.
- **Before every live smoke**: kill stale smokes (`pkill -f "aio-quest-test"; pkill -f "door-cross-test"` — ignore exit code), deploy (`bash tools/deploy-local.sh`), wait 2s, then verify freshness: `BUILT=$(shasum out/botclient.js | cut -d' ' -f1); SERVED=$(curl -s http://localhost:8890/bot/botclient.js | shasum | cut -d' ' -f1); [ "$BUILT" = "$SERVED" ] && echo FRESH || echo STALE` — must print `FRESH`. Smokes silently run stale bundles otherwise.
- Live smokes are **sequential only** — the engine and deployed bundle are shared single instances.
- macOS: there is no `timeout` command; long smokes run via `nohup ... > log 2>&1 &` and are polled.
- The user commits concurrently on this checkout — before any `git add`, run `git status --short` and add **only the files this task touched** (never `-A`).

---

### Task 1: walkLadder `verify`/`unreachable` terminal (pure)

**Files:**
- Modify: `src/bot/nav/walkLadder.ts`
- Create: `src/bot/nav/walkLadder.test.ts`

**Interfaces:**
- Consumes: existing `LadderState`, `LadderObs`, `advance`, `backoffTicks` (unchanged shapes).
- Produces (Task 2 relies on these exact names): action kinds `{ kind: 'verify' }` and `{ kind: 'unreachable' }`; `StepPhase` gains `'verify'`; `LastOutcome` gains `'probe-fresh' | 'probe-dead'`; `export const UNREACHABLE_PASSES = 3`; `export interface ProbeResult { ok: boolean; terminal: { x: number; z: number; level: number } | null }`; `export function judgeProbe(prev: { x: number; z: number; level: number } | null, probe: ProbeResult): 'probe-fresh' | 'probe-dead'`.

- [ ] **Step 1: Write the failing tests**

Create `src/bot/nav/walkLadder.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { advance, initialLadderState, judgeProbe, UNREACHABLE_PASSES, type LadderState } from './walkLadder.js';

// Drive one full exhausted pass (baked fail → scene fail → unstick fail) and
// return the state advance leaves behind at the end of the pass.
function exhaustOnePass(state: LadderState, dist: number): { state: LadderState; endAction: string } {
    const obs = (last: 'failed' | null) => ({ curDist: dist, withinRadius: false, interrupted: false, lastOutcome: last });
    let r = advance(state, obs(null)); // start of pass → baked
    expect(r.action.kind).toBe('baked');
    r = advance(r.state, obs('failed')); // baked failed → scene
    expect(r.action.kind).toBe('scene');
    r = advance(r.state, obs('failed')); // scene failed → unstick
    expect(r.action.kind).toBe('unstick');
    r = advance(r.state, obs('failed')); // unstick failed → pass exhausted
    return { state: r.state, endAction: r.action.kind };
}

describe('walkLadder unreachable terminal', () => {
    test(`emits verify after ${UNREACHABLE_PASSES} exhausted passes`, () => {
        let state = initialLadderState(50);
        let endAction = '';
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            const r = exhaustOnePass(state, 50);
            state = r.state;
            endAction = r.endAction;
            if (pass < UNREACHABLE_PASSES) {
                expect(endAction).toBe('backoff');
                // backoff ends with lastOutcome=null → next advance starts a new pass
            }
        }
        expect(endAction).toBe('verify');
        expect(state.phase).toBe('verify');
    });

    test('verify + probe-dead → unreachable', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 50, withinRadius: false, interrupted: false, lastOutcome: 'probe-dead' });
        expect(r.action.kind).toBe('unreachable');
    });

    test('verify + probe-fresh → backoff with the exhaustion counter reset', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 50, withinRadius: false, interrupted: false, lastOutcome: 'probe-fresh' });
        expect(r.action.kind).toBe('backoff');
        expect(r.state.noProgressPasses).toBe(0);
        expect(r.state.phase).toBe('baked');
    });

    test('progress during the verify phase resets to baked (progressed branch wins)', () => {
        let state = initialLadderState(50);
        for (let pass = 1; pass <= UNREACHABLE_PASSES; pass++) {
            state = exhaustOnePass(state, 50).state;
        }
        const r = advance(state, { curDist: 10, withinRadius: false, interrupted: false, lastOutcome: 'probe-fresh' });
        expect(r.action.kind).toBe('baked');
        expect(r.state.noProgressPasses).toBe(0);
    });
});

describe('judgeProbe', () => {
    const t = (x: number, z: number) => ({ x, z, level: 0 });
    test('no path → dead', () => {
        expect(judgeProbe(null, { ok: false, terminal: null })).toBe('probe-dead');
    });
    test('first fresh terminal → fresh', () => {
        expect(judgeProbe(null, { ok: true, terminal: t(10, 10) })).toBe('probe-fresh');
    });
    test('same terminal as the previous probe → dead (that plan already failed)', () => {
        expect(judgeProbe(t(10, 10), { ok: true, terminal: t(10, 10) })).toBe('probe-dead');
    });
    test('a NEW terminal → fresh', () => {
        expect(judgeProbe(t(10, 10), { ok: true, terminal: t(12, 10) })).toBe('probe-fresh');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/bot/nav/walkLadder.test.ts`
Expected: FAIL — `judgeProbe`/`UNREACHABLE_PASSES` not exported; `verify` action never produced.

- [ ] **Step 3: Implement the terminal in `walkLadder.ts`**

Apply these exact changes:

1. Replace the `LastOutcome` type line with:

```ts
export type ProbeOutcome = 'probe-fresh' | 'probe-dead';
export type LastOutcome = 'arrived' | 'closest' | 'budget' | 'failed' | 'interrupted' | ProbeOutcome | null;
```

2. Replace the `LadderAction` union with:

```ts
type LadderAction =
    | { kind: 'baked'; bigBudget: boolean }
    | { kind: 'scene' }
    | { kind: 'unstick' }
    | { kind: 'backoff'; ticks: number }
    | { kind: 'verify' }
    | { kind: 'unreachable' }
    | { kind: 'arrived' }
    | { kind: 'interrupted' };
```

3. Replace `type StepPhase = 'baked' | 'scene' | 'unstick';` with:

```ts
type StepPhase = 'baked' | 'scene' | 'unstick' | 'verify';
```

4. Below `BACKOFF_MAX`, add:

```ts
/** Consecutive fully-exhausted no-progress passes before the driver is asked to
 *  run a verification probe (a big-budget path request). A dead/stale probe then
 *  terminates the walk with an honest `unreachable` instead of retrying forever. */
export const UNREACHABLE_PASSES = 3;
```

5. Replace the whole `advance` function with:

```ts
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

    // A verification probe just ran (the driver fed its judgement back).
    if (state.phase === 'verify') {
        if (obs.lastOutcome === 'probe-dead') {
            // No path, or the same plan that already failed to be followed —
            // re-walking it provably gains nothing. Honest terminal.
            return { action: { kind: 'unreachable' }, state };
        }
        // probe-fresh: the probe found a NEW plan — reset the exhaustion
        // counter and go again from baked after a short backoff.
        return { action: { kind: 'backoff', ticks: backoffTicks(1) }, state: { bestDist, noProgressPasses: 0, phase: 'baked', triedBigBudget: false } };
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
    // phase === 'unstick' → pass exhausted. After UNREACHABLE_PASSES of these,
    // ask the driver to VERIFY before another blind retry; otherwise back off
    // and start a new pass at baked.
    const passes = state.noProgressPasses + 1;
    if (passes >= UNREACHABLE_PASSES) {
        return { action: { kind: 'verify' }, state: { ...state, bestDist, noProgressPasses: passes, phase: 'verify' } };
    }
    return { action: { kind: 'backoff', ticks: backoffTicks(passes) }, state: { bestDist, noProgressPasses: passes, phase: 'baked', triedBigBudget: false } };
}
```

6. At the end of the file (after `pickUnstickStep`), add:

```ts
export interface ProbeResult {
    ok: boolean;
    terminal: { x: number; z: number; level: number } | null;
}

/** Judge a verification probe: dead when no path exists, or when the fresh
 *  plan's terminal repeats the previous probe's terminal — that plan was
 *  already tried and could not be followed, so re-walking it gains nothing. */
export function judgeProbe(prev: { x: number; z: number; level: number } | null, probe: ProbeResult): ProbeOutcome {
    if (!probe.ok || probe.terminal === null) {
        return 'probe-dead';
    }
    if (prev && prev.x === probe.terminal.x && prev.z === probe.terminal.z && prev.level === probe.terminal.level) {
        return 'probe-dead';
    }
    return 'probe-fresh';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/bot/nav/walkLadder.test.ts`
Expected: PASS (8 tests). Then run the full suite: `bun test` — all pass (the changed `advance` must not break `gotoNpc.test.ts`/`primitives.test.ts`, which don't exercise ≥3 exhausted passes).

- [ ] **Step 5: Typecheck + commit**

Run: `bunx tsc --noEmit 2>&1 | grep -E "walkLadder" ` — expect empty.

```bash
git add src/bot/nav/walkLadder.ts src/bot/nav/walkLadder.test.ts
git commit -m "feat(nav): walkLadder verify/unreachable terminal (W1 pure core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: verification probe plumbing (`probeDest` + walkResilient wiring)

**Files:**
- Modify: `src/bot/nav/WalkExecutor.ts` (lastOutcome union ~line 137; avoid-reset extraction ~lines 153-166; new `probeDest` method after `requestPath` ~line 259)
- Modify: `src/bot/api/Traversal.ts` (imports line 6; new action branches in `walkResilient` after the `backoff` branch ~line 142)

**Interfaces:**
- Consumes: Task 1's `judgeProbe`, `ProbeResult`, action kinds `verify`/`unreachable`.
- Produces: `WalkExecutor.probeDest(dest: WorldTile, maxExpansions: number): Promise<{ ok: boolean; terminal: WorldTile | null }>`; `WalkExecutor.lastOutcome` may now be `'unreachable'`; `Traversal.walkResilient` returns `false` with `WalkExecutor.lastOutcome === 'unreachable'` on a proven-unreachable target (Tasks 8-11 rely on this).

- [ ] **Step 1: Extend `WalkExecutor.lastOutcome` union**

In `src/bot/nav/WalkExecutor.ts`, change the field declaration to:

```ts
    /** How the last walkTo/walkResilient ended — 'interrupted' means a random
     *  event took over; 'unreachable' means walkResilient PROVED the target
     *  can't be reached from here (verification probe dead) and gave up. */
    lastOutcome: 'arrived' | 'closest' | 'blocked' | 'budget' | 'interrupted' | 'failed' | 'unreachable' | null = null;
```

- [ ] **Step 2: Extract the avoid-reset and add `probeDest`**

In `WalkExecutor.ts`, replace the avoid-reset block at the top of `walkTo` (the `this.avoidDoors = [];` line plus the `for (const sc of SPECIAL_CROSSINGS) {...}` loop) with a single call `this.resetAvoids();`, and add these two methods right after `requestPath`:

```ts
    /** Fresh avoid set: empty except special crossings whose precondition we
     *  can't currently meet (e.g. the Al Kharid toll while broke). Shared by
     *  walkTo and probeDest so a probe sees what a fresh walk would plan. */
    private resetAvoids(): void {
        this.avoidDoors = [];
        for (const sc of SPECIAL_CROSSINGS) {
            if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
                this.avoidDoors.push({ x: sc.x, z: sc.z });
            }
        }
    }

    /** One-shot verification probe for walkResilient's unreachable terminal: a
     *  big-budget path request from the current position with a FRESH avoid
     *  set. Returns the plan's terminal tile (the pathfinder's snapped goal),
     *  or ok:false when no path exists at all. */
    async probeDest(dest: WorldTile, maxExpansions: number): Promise<{ ok: boolean; terminal: WorldTile | null }> {
        const me = reader.worldTile();
        if (!me) {
            return { ok: false, terminal: null };
        }
        this.resetAvoids();
        const path = await this.requestPath(me, dest, maxExpansions);
        if (!path.ok || path.waypoints.length === 0) {
            return { ok: false, terminal: null };
        }
        const last = path.waypoints[path.waypoints.length - 1];
        return { ok: true, terminal: { x: last.x, z: last.z, level: last.level } };
    }
```

- [ ] **Step 3: Wire the actions in `Traversal.walkResilient`**

In `src/bot/api/Traversal.ts`:

1. Extend the walkLadder import (line 6) to:

```ts
import { advance, initialLadderState, judgeProbe, pickUnstickStep, type LadderState, type LastOutcome } from '../nav/walkLadder.js';
```

2. Next to `let unstickDir = 0;` add:

```ts
        let lastProbeTerminal: WorldTile | null = null;
```

3. Extend the action chain — after the `} else if (action.kind === 'backoff') { ... }` branch, add:

```ts
            } else if (action.kind === 'verify') {
                const probe = await WalkExecutor.probeDest(dest, maxBudget);
                const outcome = judgeProbe(lastProbeTerminal, probe);
                if (probe.ok && probe.terminal) {
                    lastProbeTerminal = probe.terminal;
                }
                log(`walkResilient: verify probe ${outcome === 'probe-dead' ? 'dead' : `fresh (terminal ${probe.terminal!.x},${probe.terminal!.z})`}`);
                lastOutcome = outcome;
            } else if (action.kind === 'unreachable') {
                log(`walkResilient: (${dest.x},${dest.z},${dest.level}) unreachable from here — stopping (best ${state.bestDist} tiles)`);
                WalkExecutor.lastOutcome = 'unreachable';
                return false;
            }
```

Note: the bounded-caller exit (`maxPasses !== undefined && state.noProgressPasses >= maxPasses`) stays where it is, BEFORE action execution — bounded callers with `attempts <= 3` keep today's exact behavior; only unbounded (or `attempts > 3`) callers ever execute `verify`.

- [ ] **Step 4: Audit `lastOutcome` consumers**

Run: `grep -rn "lastOutcome" src/bot --include="*.ts" | grep -v "nav/walkLadder" | grep -v test`
For each hit outside `WalkExecutor.ts`/`Traversal.ts`: confirm the comparison is against a specific literal (`=== 'blocked'`, `=== 'interrupted'`) so the new `'unreachable'` value falls through to the same handling as `'failed'`. If any site `switch`es exhaustively over the union, add an `'unreachable'` case behaving like `'failed'`. List the audited sites in the commit message body.

- [ ] **Step 5: Typecheck + tests + commit**

Run: `bunx tsc --noEmit 2>&1 | grep -E "WalkExecutor|Traversal"` → empty. Run: `bun test` → all pass.

```bash
git add src/bot/nav/WalkExecutor.ts src/bot/api/Traversal.ts
git commit -m "feat(nav): verification probe + honest unreachable return in walkResilient (W1)

<one line per audited lastOutcome consumer>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: deterministic door-crossing (`chooseCrossClick` + crossMultiTileDoor rework)

**Files:**
- Modify: `src/bot/nav/followMath.ts` (add `chooseCrossClick`)
- Modify: `src/bot/nav/followMath.test.ts` (add tests)
- Modify: `src/bot/nav/WalkExecutor.ts` (constants ~lines 62-73; `crossMultiTileDoor` ~lines 630-687)

**Interfaces:**
- Consumes: existing `isOnFarSide`, `Reachability.canStep/canReach`, `DirectNavigator.walk`.
- Produces: `export function chooseCrossClick(canStepEdge: boolean, canReachLanding: boolean): 'step' | 'landing-click' | 'landing-scene'` in followMath (Task 4's starvation escape and this task's loop both assume the reworked `crossMultiTileDoor` behavior).

- [ ] **Step 1: Write the failing test**

Append to `src/bot/nav/followMath.test.ts`:

```ts
import { chooseCrossClick } from './followMath.js';

describe('chooseCrossClick', () => {
    test('open edge → walk onto the step tile itself', () => {
        expect(chooseCrossClick(true, true)).toBe('step');
        expect(chooseCrossClick(true, false)).toBe('step');
    });
    test('edge blocked by the swung leaf but landing routable → gated click', () => {
        expect(chooseCrossClick(false, true)).toBe('landing-click');
    });
    test('edge blocked and no route to landing → raw scene-step', () => {
        expect(chooseCrossClick(false, false)).toBe('landing-scene');
    });
});
```

(Match the file's existing import style — it already imports from `'./followMath.js'`; merge the named imports into the existing import line if the linter prefers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/nav/followMath.test.ts`
Expected: FAIL — `chooseCrossClick` is not exported.

- [ ] **Step 3: Implement `chooseCrossClick` in followMath.ts**

Append:

```ts
/**
 * Which through-move a door crossing should make once the leaf reads open.
 * `canStepEdge` is the RAW one-edge collision check approach→step (precise,
 * cheap — the exact same rule the client's tryMove uses); when it is open, walk
 * ONTO the far tile itself. The old flow aimed only at `landing` (one tile PAST
 * the door), which in tight interiors can be furniture/wall — the witch-house
 * inner door — so the cross timed out with the edge genuinely open. The two
 * landing modes are the preserved shape-9 swung-leaf handling: a gated click
 * when a bypass route exists, a raw scene-step when the leaf seals the gap.
 */
export function chooseCrossClick(canStepEdge: boolean, canReachLanding: boolean): 'step' | 'landing-click' | 'landing-scene' {
    if (canStepEdge) {
        return 'step';
    }
    return canReachLanding ? 'landing-click' : 'landing-scene';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/nav/followMath.test.ts` → PASS.

- [ ] **Step 5: Rework `crossMultiTileDoor`**

In `src/bot/nav/WalkExecutor.ts`:

1. Change the budget constant (~line 68) and add a per-open cap next to it:

```ts
// Budget to open AND walk THROUGH a door (1-tile or multi-tile). Raised from
// 20s: each open-revert cycle costs open-wait + through-step, and the RS door
// auto-reverts — 36s fits ≥3 full cycles so a flaky-timing door still crosses
// within ONE attempt instead of burning the attempt and poisoning avoidDoors.
const MULTI_DOOR_CROSS_MS = 36_000;
// Per-open wait: the leaf state/edge usually flips within ~1s of the op landing;
// capping the wait short keeps revert cycles cheap inside MULTI_DOOR_CROSS_MS.
const OPEN_WAIT_MS = 4000;
```

2. Extend the followMath import (line 27) with `chooseCrossClick`:

```ts
import { chebyshev, chooseCrossClick, crossingEligible, isOnFarSide, locateOnPath, selectClickTarget } from './followMath.js';
```

3. Replace the whole `crossMultiTileDoor` method body with:

```ts
    private async crossMultiTileDoor(approach: PathStep, step: PathStep, transport: TransportInfo, log: (msg: string) => void): Promise<boolean> {
        const dir = { x: Math.sign(step.x - approach.x), z: Math.sign(step.z - approach.z) };
        const landing = { x: step.x + dir.x, z: step.z + dir.z, level: step.level };
        const deadline = performance.now() + MULTI_DOOR_CROSS_MS;
        while (performance.now() < deadline) {
            if (isOnFarSide(reader.worldTile(), approach, step)) {
                log(`crossed '${transport.locName}' at (${transport.locX},${transport.locZ})`);
                return true;
            }
            const shut = this.findTransportLoc(transport);
            if (shut) {
                // Closed (first arrival) or reverted mid-cross — open it. The wait
                // is on the RAW crossing edge (canStep approach→step) OR the closed
                // leaf vanishing, whichever reads first; capped at OPEN_WAIT_MS so a
                // revert cycle costs seconds, not the whole budget.
                const mark = GameMessages.mark();
                if (!shut.interact(transport.action)) {
                    log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
                    return false;
                }
                await Execution.delayUntil(
                    () => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step) || GameMessages.sawSince(mark, CANT_REACH),
                    OPEN_WAIT_MS
                );
                if (GameMessages.sawSince(mark, CANT_REACH)) {
                    // the door leaf itself is unreachable from this side — spinning
                    // the rest of the budget can't fix that; bail to the repath
                    log(`server says can't reach ${transport.locName} — repathing`);
                    return false;
                }
                continue;
            }
            // Door reads open — pick the through-move by what the LIVE collision
            // permits (see chooseCrossClick).
            const canStepEdge = Reachability.canStep(approach, step);
            const landingLocal = reader.toLocal(landing.x, landing.z);
            const canReachLanding = landingLocal !== null && Reachability.canReach(landing, { maxSteps: 128 });
            const choice = chooseCrossClick(canStepEdge, canReachLanding);
            if (choice === 'step') {
                // 1-tile door with the edge genuinely open: walk ONTO the far tile
                // itself (landing may be furniture/wall in tight interiors). Being
                // on `step` satisfies isOnFarSide (cheb 0 < cheb 1).
                DirectNavigator.walk(step);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), 3000);
            } else if (choice === 'landing-click') {
                // A walkable route around the swung-open leaf exists (multi-tile
                // doors) — click it; loop back to re-open if the door reverts.
                ActionRouter.driver.walk(landingLocal!.lx, landingLocal!.lz);
                await Execution.delayTicks(2);
            } else {
                // No canReach route: the swung leaf seals the sole gap. Raw scene
                // click (NOT canReach-gated) and return the instant we're past the
                // door plane.
                log(`leaf blocks landing — scene-stepping through '${transport.locName}'`);
                DirectNavigator.walk(landing);
                await Execution.delayUntil(() => isOnFarSide(reader.worldTile(), approach, step), SCENE_STEP_MS);
            }
        }
        log(`${transport.locName} at (${transport.locX},${transport.locZ}) did not cross in time, repathing`);
        return false;
    }
```

- [ ] **Step 6: Typecheck + tests + commit**

Run: `bunx tsc --noEmit 2>&1 | grep -E "WalkExecutor|followMath"` → empty. `bun test` → all pass.

```bash
git add src/bot/nav/followMath.ts src/bot/nav/followMath.test.ts src/bot/nav/WalkExecutor.ts
git commit -m "feat(nav): deterministic door-crossing — raw-edge wait, step-first through-move (W2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: crossing-starvation escape + two-strike avoidDoors

**Files:**
- Modify: `src/bot/nav/WalkExecutor.ts` (`followPath` click-starvation branch ~line 448; `failedDoor` ~line 499; `resetAvoids` from Task 2)

**Interfaces:**
- Consumes: Task 3's reworked `handleTransport`/`crossMultiTileDoor`.
- Produces: behavior only — a door now gets TWO full crossing attempts per walkTo before `avoidDoors` poisons it, and click-starvation beside a crossing fires the crossing instead of stalling.

- [ ] **Step 1: Add the strike map and rework `failedDoor`**

In `WalkExecutorImpl`, next to the `avoidDoors` field, add:

```ts
    /** Per-walkTo crossing failure counts (key `locX|locZ`) — a crossing is only
     *  poisoned into avoidDoors on its SECOND failed full attempt, so one
     *  timing flake no longer diverts the route around the world (the
     *  witch-house exterior detour). */
    private doorStrikes = new Map<string, number>();
```

In `resetAvoids()` (Task 2), add as the first line:

```ts
        this.doorStrikes.clear();
```

Replace `failedDoor` with:

```ts
    private failedDoor(step: PathStep): void {
        const t = step.transport;
        if (!t) {
            return;
        }
        const key = `${t.locX}|${t.locZ}`;
        const strikes = (this.doorStrikes.get(key) ?? 0) + 1;
        this.doorStrikes.set(key, strikes);
        if (strikes >= 2) {
            // Two full crossing budgets failed this walk — poison it so the
            // repath routes around (doors, stairs, ladders, teleports alike).
            this.avoidDoors.push({ x: t.locX, z: t.locZ });
        }
        // strike 1: repath WITHOUT avoiding — the fresh path retries the same
        // crossing with a full budget.
    }
```

- [ ] **Step 2: Add the starvation escape in `followPath`**

Replace the `} else if (target === -1) {` branch (currently just `stallTicks += 2;`) with:

```ts
                } else if (target === -1) {
                    // Nothing clickable ahead. If the reason is a crossing we're
                    // already beside (its approach canReach-refused through the
                    // closed leaf), fire the crossing NOW — click-starvation next
                    // to a crossing IS the door case, and waiting only burns the
                    // stall counter into a repath (live: Camelot throne doors,
                    // witch-house inner door — the "0 clicks" loops).
                    if (nextCrossingIdx !== -1) {
                        const appr = tiles[nextCrossingIdx - 1];
                        if (me.level === appr.level && chebyshev(me, appr) <= TRANSPORT_TRIGGER + 2) {
                            const handled = await this.handleTransport(appr, tiles[nextCrossingIdx], log);
                            if (handled) {
                                tiles[nextCrossingIdx].transport = undefined;
                                pathIdx = Math.max(pathIdx, nextCrossingIdx - 1);
                                stallTicks = 0;
                                stallRetries = 0;
                                clickIdx = -1;
                                lastTile = null;
                                continue;
                            }
                            this.failedDoor(tiles[nextCrossingIdx]);
                            return 'repath';
                        }
                    }
                    // scene edge / genuinely blocked — a stall
                    stallTicks += 2;
                }
```

(Note this branch is inside the `if (needClick)` block; `continue` restarts the main `while` loop exactly like the crossing-handled path above it.)

- [ ] **Step 3: Typecheck + tests + commit**

Run: `bunx tsc --noEmit 2>&1 | grep -E "WalkExecutor"` → empty. `bun test` → all pass.

```bash
git add src/bot/nav/WalkExecutor.ts
git commit -m "feat(nav): crossing-starvation escape + two-strike avoidDoors (W2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: W2 live gate — door-cross smoke

**Files:** none modified (gate only).

- [ ] **Step 1: Deploy + freshness** (Global Constraints preamble: pkill, deploy, FRESH check).

- [ ] **Step 2: Run the door-cross smoke**

Run: `bun tools/door-cross-test.ts` (takes ~6-10 min; the bot web-walks from spawn to the door first).
Expected final line: `PASS: 4/4 one-tile door crossings genuinely on the far side within 25s`.
If a leg FAILS: read the printed walker-log tail — the new `crossMultiTileDoor` lines (`crossed '...'`, `leaf blocks landing`, `did not cross in time`) localize the failure. Fix in Task 3/4 code, redeploy, rerun. Do not proceed until PASS.

- [ ] **Step 3: Record the result**

No commit (no file changes). Note pass timing in the task report.

---

### Task 6: wall-aware `goalCandidates` (connected flood)

**Files:**
- Modify: `src/bot/nav/PathFinder.ts` (`goalCandidates` ~line 322)
- Modify: `src/bot/nav/PathFinder.test.ts` (add v2 wall-pack fixture + tests)
- Modify: `tools/nav/witchhouse-probe.ts` (add the ladder-tile goal-selection trace, Step 5)

**Interfaces:**
- Consumes: existing private `exitMask`, `cardinalGoals`, `walkable`, module consts `DX`/`DZ`, `nodeId`/`nodeX`/`nodeZ`/`nodeLevel`.
- Produces: behavior only — `findPath` to an unwalkable target never terminates on a tile wall-separated from it (unless the target's component is sealed, where the old ring fallback is preserved).

- [ ] **Step 1: Write the failing tests**

Append to `src/bot/nav/PathFinder.test.ts`:

```ts
// v2 LCNV pack (wall nibbles present): one mapsquare, level 0 only, all tiles
// walkable and all exits open, with helpers to carve blocked tiles. Blocking a
// tile = clearing its walk bit AND clearing every neighbour's exit bit INTO it
// (search steps are gated by the SOURCE tile's exit byte).
const DX8 = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ8 = [1, 0, -1, 0, 1, -1, -1, 1];

function v2Pack(): { bytes: Uint8Array; blockTile(x: number, z: number): void } {
    const perLevel = 4096 + 512 + 2048;
    const bytes = new Uint8Array(10 + 3 + perLevel);
    bytes[0] = 0x4c; bytes[1] = 0x43; bytes[2] = 0x4e; bytes[3] = 0x56;
    bytes[4] = 2; // version 2 (wall nibbles)
    bytes[5] = 0;
    bytes[8] = 1; // mapsquare count
    bytes[10] = 0; // mx
    bytes[11] = 0; // mz
    bytes[12] = 0b0001; // level 0 only
    const exitBase = 13;
    const walkBase = exitBase + 4096;
    bytes.fill(0xff, exitBase, exitBase + 4096); // all exits open
    bytes.fill(0xff, walkBase, walkBase + 512); // all walkable
    // wall nibbles stay zeroed (no walls — separation is via blocked tiles)
    const idx = (x: number, z: number) => (x & 63) * 64 + (z & 63);
    const blockTile = (x: number, z: number): void => {
        const i = idx(x, z);
        bytes[walkBase + (i >> 3)] &= ~(1 << (i & 7)); // unwalkable
        for (let d = 0; d < 8; d++) {
            const nx = x - DX8[d];
            const nz = z - DZ8[d];
            if (nx < 0 || nz < 0 || nx > 63 || nz > 63) continue;
            bytes[exitBase + idx(nx, nz)] &= ~(1 << d); // neighbour can't step INTO it
        }
    };
    return { bytes, blockTile };
}

describe('wall-aware goal candidates (W4)', () => {
    // A sealed 5x5 "room" (walls = a ring of blocked tiles at x/z 7..13) with an
    // unwalkable "ladder" target at its centre (10,10) and NO door. Interior
    // floor tiles 8..12 stay walkable.
    function roomPack(): Uint8Array {
        const { bytes, blockTile } = v2Pack();
        for (let x = 7; x <= 13; x++) {
            for (let z = 7; z <= 13; z++) {
                const onRing = x === 7 || x === 13 || z === 7 || z === 13;
                if (onRing) blockTile(x, z);
            }
        }
        blockTile(10, 10); // the unwalkable target itself
        return bytes;
    }

    test('outside → interior target: NO wall-blind ring goal (honest unreachable)', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        // Old behavior: the within-5 ring includes tiles OUTSIDE the sealed room
        // (e.g. (5,10)), so the path "succeeded" onto the wrong side of the wall.
        const out = finder.findPath({ x: 2, z: 10, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(false);
    });

    test('inside → interior target: terminates cardinally beside it', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 9, z: 9, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(true);
        if (out.ok) {
            const t = out.waypoints[out.waypoints.length - 1];
            const cardinal = Math.abs(t.x - 10) + Math.abs(t.z - 10) === 1;
            expect(cardinal).toBe(true);
        }
    });

    test('sealed enclave target in the open: ring fallback keeps it harmless', () => {
        const { bytes, blockTile } = v2Pack();
        // target (30,30) unwalkable and all four cardinals blocked — no
        // connected stand exists (the Varrock-fountain shape)
        blockTile(30, 30);
        blockTile(29, 30);
        blockTile(31, 30);
        blockTile(30, 29);
        blockTile(30, 31);
        const finder = new PathFinder(bytes);
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 2, z: 30, level: 0 }, { x: 30, z: 30, level: 0 });
        expect(out.ok).toBe(true); // reaches a nearby ring tile, as today
    });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `bun test src/bot/nav/PathFinder.test.ts`
Expected: `outside → interior target` FAILS (`out.ok` is `true` today — the wall-blind ring); the other two pass already. If `inside → interior` fails too, the fixture is wrong — fix the fixture before touching PathFinder.

- [ ] **Step 3: Implement the connected flood**

Replace `goalCandidates` in `PathFinder.ts` with:

```ts
    /**
     * Goal candidates for an unwalkable target — WALL-AWARE. Prefer tiles
     * CONNECTED to the target: a bounded flood seeded from its wall-open
     * cardinal adjacents (cardinalGoals' exact rule), expanded over the same
     * exit-mask steps A* uses, confined to the Chebyshev `radius` box. A tile
     * the flood can't touch is wall-separated from the target (the witch-house
     * exterior (2908,3478) vs its interior stand (2906,3476) — one cost-unit
     * cheaper and useless) and must NOT be a goal. When the flood finds
     * NOTHING (the target's component is sealed — the Varrock-fountain
     * enclave), fall back to the plain ring so those stay harmless.
     */
    private goalCandidates(p: NavPoint, radius: number): Set<number> {
        const goals = new Set<number>();
        if (this.walkable(p.x, p.z, p.level)) {
            goals.add(nodeId(p.x, p.z, p.level));
            return goals;
        }
        const queue: NavPoint[] = [];
        const seen = new Set<number>();
        for (const id of this.cardinalGoals(p)) {
            queue.push({ x: nodeX(id), z: nodeZ(id), level: nodeLevel(id) });
            seen.add(id);
        }
        while (queue.length > 0) {
            const cur = queue.shift()!;
            goals.add(nodeId(cur.x, cur.z, cur.level));
            const mask = this.exitMask(cur.x, cur.z, cur.level);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) {
                    continue;
                }
                const nx = cur.x + DX[dir];
                const nz = cur.z + DZ[dir];
                if (Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) > radius) {
                    continue;
                }
                const id = nodeId(nx, nz, cur.level);
                if (seen.has(id) || !this.walkable(nx, nz, cur.level)) {
                    continue;
                }
                seen.add(id);
                queue.push({ x: nx, z: nz, level: cur.level });
            }
        }
        if (goals.size > 0) {
            return goals;
        }
        // Sealed target — the old wall-blind ring keeps enclaves harmless.
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (this.walkable(p.x + dx, p.z + dz, p.level)) {
                    goals.add(nodeId(p.x + dx, p.z + dz, p.level));
                }
            }
        }
        return goals;
    }
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/bot/nav/PathFinder.test.ts` → PASS (5 tests incl. the 2 pre-existing). Then `bun test` → full suite passes.

- [ ] **Step 5: Offline probe check + commit**

First add the goal-selection trace to `tools/nav/witchhouse-probe.ts` — append after the existing `trace(...)` calls:

```ts
trace({ x: 2900, z: 3474, level: 0 }, { x: 2907, z: 3476, level: 0 }, 'outside -> LADDER TILE itself (goal selection)');
```

Then run: `bun tools/nav/witchhouse-probe.ts`. Expected for the new trace: `OK`, waypoints route THROUGH both doors (`[Open 2901,3473]` and `[Open 2902,3474]` appear), and the terminal is an interior operable stand — `(2906,3476)` or `(2907,3475)` — NEVER the exterior `(2908,3478)`. The pre-existing traces are unchanged (`outside front door -> live wedge tile (2908,3478)` still routes exterior — it targets a walkable tile explicitly, which is not goal snapping).

```bash
git add src/bot/nav/PathFinder.ts src/bot/nav/PathFinder.test.ts tools/nav/witchhouse-probe.ts
git commit -m "feat(nav): wall-aware goal candidates — connected flood with ring fallback (W4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: operable stair-stand snap + stairEdges regeneration

**Files:**
- Modify: `tools/nav/derive-stairs.ts` (`snapAndReverse` cross-level snap ~lines 124-142)
- Regenerate: `src/bot/nav/data/stairEdges.json`

**Interfaces:**
- Consumes: public `PathFinder.walkable` + `PathFinder.wallMask`.
- Produces: corrected `stairEdges.json` (the Wizards' Tower edge `(3102,3159,0)→(3105,3160,1)` must be replaced by an interior-stand edge).

- [ ] **Step 1: Baseline audits (BEFORE any change)**

Run and save outputs for comparison:
- `bun tools/clues/audit-clues.ts` → record the score (expected clean: 66/66).
- `bun tools/nav/tower-probe.ts` → record the `approach -> Traiborn` waypoint trace (today it routes via the bogus exterior edge `(3102,3159,0) -> (3105,3160,1)[Climb-up]`).

- [ ] **Step 2: Add `snapOperable` and use it for cross-level FROM tiles**

In `tools/nav/derive-stairs.ts`, add below `snapWalkable`:

```ts
// Wall-aware snap for an OPERATE stand: the tile you fire the op from must be
// wall-connected to the stair loc (same rule as PathFinder.cardinalGoals — the
// candidate's wall nibble on the edge FACING the stair must be clear). Blind
// cardinal-first snapping shipped stands on the WRONG SIDE of building walls:
// the Wizards' Tower staircase (3103,3159) snapped to (3102,3159) OUTSIDE the
// west wall — the server rejects Climb-up from there, and A* preferred that
// cheap bogus edge over the real door route (live 2026-07-19).
function snapOperable(finder: PathFinder, x: number, z: number, level: number): NavPoint | null {
    // candidate offset from the stair → wall bit on the candidate's edge facing
    // it (nibble bits 0=N,1=E,2=S,3=W)
    const sides: [number, number, number][] = [
        [0, 1, 1 << 2], // candidate north of stair, its S edge
        [1, 0, 1 << 3], // east, its W edge
        [0, -1, 1 << 0], // south, its N edge
        [-1, 0, 1 << 1] // west, its E edge
    ];
    for (const [dx, dz, facingBit] of sides) {
        if (finder.walkable(x + dx, z + dz, level) && (finder.wallMask(x + dx, z + dz, level) & facingBit) === 0) {
            return { x: x + dx, z: z + dz, level };
        }
    }
    // no wall-open cardinal — the old radius-2 snap as a last resort
    return snapWalkable(finder, x, z, level);
}
```

In `snapAndReverse`, change the non-pivot branch so the FROM (operate) tile uses the operable snap while the TO (landing) keeps the plain snap:

```ts
        } else {
            f = snapOperable(finder, e.from.x, e.from.z, e.from.level);
            t = snapWalkable(finder, e.to.x, e.to.z, e.to.level);
        }
```

- [ ] **Step 3: Regenerate and diff**

Run: `bun tools/nav/derive-stairs.ts` (defaults: engine `~/code/rs2b2t-engine`, content `~/code/rs2b2t-content`, out `src/bot/nav/data/stairEdges.json`).
Then: `git diff --stat src/bot/nav/data/stairEdges.json` and review the full diff. Verify specifically:

```bash
python3 -c "
import json
d = json.load(open('src/bot/nav/data/stairEdges.json'))
bad = [e for e in d if e['from'] == {'x': 3102, 'z': 3159, 'level': 0}]
print('bogus tower edges remaining:', len(bad))
tower = [e for e in d if abs(e['from']['x'] - 3104) <= 3 and abs(e['from']['z'] - 3159) <= 3]
print('tower-area edges now:', *tower, sep='\n  ')
"
```
Expected: `bogus tower edges remaining: 0`, and the up-edge's from-tile is an interior stand (e.g. `(3104,3159,0)`). Eyeball the rest of the diff: changed from-tiles should number in the tens, each moving a stand to the loc's wall-connected side. If hundreds changed, STOP and investigate before committing.

- [ ] **Step 4: Regression gates**

- `bun test` → all pass.
- `bun tools/clues/audit-clues.ts` → score identical to the Step 1 baseline (66/66).
- `bun tools/nav/tower-probe.ts` → `approach -> Traiborn (L1, full climb)` now routes THROUGH the south door with the climb firing from the interior stand (waypoints include `[Open]` on a Door and a `[Climb-up]` whose tile is inside), not from `(3102,3159)`.
- `bun tools/nav/witchhouse-probe.ts` → unchanged from Task 6 (no stair involved).

- [ ] **Step 5: Commit**

```bash
git add tools/nav/derive-stairs.ts src/bot/nav/data/stairEdges.json
git commit -m "feat(nav): operable stair-stand snap + stairEdges regen — kills wrong-side stands (W4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `Reach` last-mile primitive + talkThrough hardening

**Files:**
- Create: `src/bot/api/Reach.ts`
- Create: `src/bot/api/Reach.test.ts`
- Modify: `src/bot/quests/exec/primitives.ts` (`talkThrough` drive loop, ~lines 262-283)

**Interfaces:**
- Consumes: `Traversal.walkResilient` (+ Task 2's `'unreachable'` outcome), `WalkExecutor.tryNearbyDoor`, `Reachability.canReach`, `Locs`/`Npcs` queries, `ChatDialog`, `Execution.delayUntil`.
- Produces (Tasks 9-11 rely on these exact names):

```ts
export type ReachStatus = 'done' | 'retry' | 'unreachable';
export interface ReachLocOpts {
    name: string;            // loc display name
    op: string;              // op label, e.g. 'Climb-up' | 'Open' | 'Check'
    near: WorldTile;         // walk hint when the loc isn't in op range yet
    within?: number;         // loc query radius (default 10)
    expect: () => boolean;   // success predicate after the op
    expectMs?: number;       // wait budget for expect (default 12_000)
    log?: (m: string) => void;
}
export interface ReachNpcOpts {
    name: string;            // npc display name
    near: WorldTile;         // walk hint when the npc isn't in scene yet
    openMs?: number;         // dialogue-open wait (default 15_000)
    log?: (m: string) => void;
}
export const Reach: {
    locOp(opts: ReachLocOpts): Promise<ReachStatus>;
    npcDialog(opts: ReachNpcOpts): Promise<ReachStatus>;
};
```

`Reach.npcDialog` gets the dialogue OPEN; driving it (prefer lists) stays the caller's job via `talkThrough` — `Reach` lives in the api layer and must not import quest code.

- [ ] **Step 1: Write the failing control-flow tests**

Create `src/bot/api/Reach.test.ts`, following the `mock.module` pattern of `src/bot/quests/exec/gotoNpc.test.ts` (read that file first and mirror its structure exactly — mocks must be registered before the module under test is imported):

```ts
import { describe, expect, mock, test, beforeEach } from 'bun:test';

// --- capture state the mocks read/write ---
let sceneLoc: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let sceneNpc: { name: string; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let walkCalls: { x: number; z: number; level: number }[];
let walkResult: boolean;
let walkLastOutcome: string;
let canReachResult: boolean;
let doorOpened: boolean;
let dialogOpen: boolean;
let expectFlips: boolean; // locOp's expect() reads this

mock.module('../adapter/ClientAdapter.js', () => ({
    reader: { worldTile: () => ({ x: 0, z: 0, level: 0 }) }
}));
mock.module('./Execution.js', () => ({
    Execution: {
        delayUntil: async (cond: () => boolean) => cond(),
        delayTicks: async () => {}
    }
}));
mock.module('./queries/Locs.js', () => ({
    Locs: {
        query: () => ({
            name: () => ({ action: () => ({ within: () => ({ nearest: () => (sceneLoc ? { name: sceneLoc.name, tile: () => sceneLoc!.tile, actions: () => sceneLoc!.ops, interact: async () => sceneLoc!.interactResult } : null) }) }) })
        })
    }
}));
mock.module('./queries/Npcs.js', () => ({
    Npcs: {
        query: () => ({
            name: () => ({ action: () => ({ nearest: () => (sceneNpc ? { name: sceneNpc.name, tile: () => sceneNpc!.tile, interact: async () => sceneNpc!.interactResult } : null) }) })
        })
    }
}));
mock.module('./hud/ChatDialog.js', () => ({
    ChatDialog: { isOpen: () => dialogOpen, canContinue: () => false }
}));
mock.module('./Reachability.js', () => ({
    Reachability: { canReach: () => canReachResult }
}));
mock.module('./Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number; level: number }) => {
            walkCalls.push(dest);
            return walkResult;
        }
    }
}));
mock.module('../nav/WalkExecutor.js', () => ({
    WalkExecutor: {
        get lastOutcome() { return walkLastOutcome; },
        tryNearbyDoor: async () => { doorOpened = true; return true; }
    }
}));

const { Reach } = await import('./Reach.js');

beforeEach(() => {
    sceneLoc = null;
    sceneNpc = null;
    walkCalls = [];
    walkResult = true;
    walkLastOutcome = 'failed';
    canReachResult = true;
    doorOpened = false;
    dialogOpen = false;
    expectFlips = true;
});

describe('Reach.locOp', () => {
    test('loc not in scene → walks the hint, returns retry', async () => {
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
    });
    test('hint walk proven unreachable → unreachable', async () => {
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
    });
    test('loc present + expect satisfied → done (no walking)', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(walkCalls.length).toBe(0);
    });
    test('loc present but canReach false → opens a door first, still fires the op', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(doorOpened).toBe(true);
        expect(r).toBe('done');
    });
    test('op fired but expect never satisfied → retry', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
    });
});

describe('Reach.npcDialog', () => {
    test('dialog already open → done immediately', async () => {
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('done');
    });
    test('npc absent → walks the hint, retry', async () => {
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
    });
    test('npc present, blocked way → door opened, talk fired, done when dialog opens', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        // delayUntil evaluates its condition once — make the dialog "open" as a
        // side effect of interact for this scenario:
        sceneNpc.interactResult = true;
        dialogOpen = false;
        const promise = Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        dialogOpen = true; // opens before the wait's condition is polled
        const r = await promise;
        expect(doorOpened).toBe(true);
        expect(r).toBe('done');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/bot/api/Reach.test.ts`
Expected: FAIL — `./Reach.js` does not exist.

- [ ] **Step 3: Implement `src/bot/api/Reach.ts`**

```ts
// The shared LAST-MILE primitive: get to a loc/NPC and act on it, using each
// channel the way the real game does — client web-walk to get NEAR, the op's
// own SERVER-walk for the final tiles (it crosses furniture-tight interiors
// the client BFS refuses and tracks patrolling NPCs), with a door-open
// pre-step because the server op-walk HALTS at closed doors (live-verified:
// Traiborn). Replaces the per-quest interior-stand/OPLOC/open-the-leaf hacks.
// Honest tri-state: 'done' | 'retry' (re-enter me) | 'unreachable' (the walk
// PROVED the hint can't be reached — re-plan, don't loop).

import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Execution } from './Execution.js';
import { ChatDialog } from './hud/ChatDialog.js';
import { Locs } from './queries/Locs.js';
import { Npcs } from './queries/Npcs.js';
import { Reachability } from './Reachability.js';
import { Traversal } from './Traversal.js';
import { WalkExecutor } from '../nav/WalkExecutor.js';

export type ReachStatus = 'done' | 'retry' | 'unreachable';

export interface ReachLocOpts {
    name: string;
    op: string;
    near: WorldTile;
    within?: number;
    expect: () => boolean;
    expectMs?: number;
    log?: (m: string) => void;
}

export interface ReachNpcOpts {
    name: string;
    near: WorldTile;
    openMs?: number;
    log?: (m: string) => void;
}

const REACH_BFS_STEPS = 400;

/** Walk toward a hint tile; map a PROVEN-unreachable walk to the honest
 *  tri-state so callers re-plan instead of re-entering forever. */
async function closeIn(near: WorldTile, radius: number, log: (m: string) => void): Promise<ReachStatus> {
    const ok = await Traversal.walkResilient(near, { radius, attempts: 3, timeoutMs: 90_000, log });
    if (!ok && WalkExecutor.lastOutcome === 'unreachable') {
        log(`reach: hint (${near.x},${near.z},${near.level}) is unreachable`);
        return 'unreachable';
    }
    return 'retry';
}

export const Reach = {
    /** Reach a loc and fire `op` on it, awaiting `expect`. Re-entrant. */
    async locOp(opts: ReachLocOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        const loc = Locs.query().name(opts.name).action(opts.op).within(opts.within ?? 10).nearest();
        if (!loc) {
            return closeIn(opts.near, 2, log);
        }
        if (!Reachability.canReach(loc.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true })) {
            // a closed door likely separates us — the server op-walk halts at
            // closed doors, so open the nearest leaf first
            await WalkExecutor.tryNearbyDoor(log);
        }
        if (!(await loc.interact(opts.op))) {
            return 'retry';
        }
        if (await Execution.delayUntil(opts.expect, opts.expectMs ?? 12_000)) {
            return 'done';
        }
        log(`reach: '${opts.op}' on '${opts.name}' did not produce the expected outcome — retrying`);
        return 'retry';
    },

    /** Reach an NPC and get a Talk-to dialogue OPEN (driving it is the
     *  caller's job — talkThrough). Tracks patrols via the live query +
     *  server-walk. Re-entrant. */
    async npcDialog(opts: ReachNpcOpts): Promise<ReachStatus> {
        const log = opts.log ?? ((): void => {});
        if (ChatDialog.isOpen()) {
            return 'done';
        }
        const npc = Npcs.query().name(opts.name).action('Talk-to').nearest();
        if (!npc) {
            return closeIn(opts.near, 3, log);
        }
        if (!Reachability.canReach(npc.tile(), { maxSteps: REACH_BFS_STEPS, adjacentOk: true })) {
            await WalkExecutor.tryNearbyDoor(log);
        }
        if (!(await npc.interact('Talk-to'))) {
            return 'retry';
        }
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), opts.openMs ?? 15_000)) {
            return 'done';
        }
        log(`reach: '${opts.name}' never opened a dialogue — retrying`);
        return 'retry';
    }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/bot/api/Reach.test.ts` → PASS (8 tests). Adjust mock shapes if the query-chain stubs don't match the real call chain (`Locs.query().name(x).action(y).within(z).nearest()` and `Npcs.query().name(x).action('Talk-to').nearest()` — keep the production code as written and fix the MOCKS).

- [ ] **Step 5: Harden `talkThrough` (transient-close tolerance)**

In `src/bot/quests/exec/primitives.ts`, replace the drive loop inside `talkThrough` (the `for (let i = 0; i < 120 && ChatDialog.isOpen(); i++) { ... }` block) with:

```ts
    // Drive the dialogue, TOLERATING page-transition gaps: a server-scripted
    // branch closes the box for a beat BETWEEN pages, and a plain isOpen() loop
    // exits there — BEFORE mid-branch varp-sets (sir_lancelot.rs2:34 is line 4
    // of a 6-line branch), so a correct option pick silently failed to advance
    // the stage (live 2026-07-19). A transient close now waits ~1.5s for the
    // next page before concluding the dialogue is genuinely over.
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false; // let the runtime clear the random event
        }
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 1500))) {
                break; // genuinely closed
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`WARN: no preferred option in [${opts.join(' | ')}] — taking the last`);
            }
            await ChatDialog.chooseOption(pick ?? opts[opts.length - 1]);
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
```

- [ ] **Step 6: Full tests + typecheck + commit**

Run: `bun test` → all pass. If `primitives.test.ts` breaks on the new grace-wait, update ITS `Execution.delayUntil` mock to evaluate the condition once and return the boolean (the same convention the Reach test uses) — do not weaken the production code.
Run: `bunx tsc --noEmit 2>&1 | grep -E "Reach|primitives"` → empty.

```bash
git add src/bot/api/Reach.ts src/bot/api/Reach.test.ts src/bot/quests/exec/primitives.ts
git commit -m "feat(api): Reach last-mile primitive + transient-close-tolerant talkThrough (W3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Demon Slayer onto `Reach` + live PASS gate

**Files:**
- Modify: `src/bot/quests/defs/demonslayer.ts` (the Wizards' Tower climb block and the Traiborn talk block inside the `keyHunt` custom's `!hasTraiborn` branch)

**Interfaces:**
- Consumes: `Reach.locOp`, `Reach.npcDialog`, hardened `talkThrough`; Task 7's corrected tower stair edge.

- [ ] **Step 1: Replace the tower-climb + Traiborn blocks**

In `demonslayer.ts`, add the import:

```ts
import { Reach } from '../../api/Reach.js';
```

Find the `!hasTraiborn` branch. Replace everything from `const t0 = Game.tile();` down to (and including) the `if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 15_000))) { return false; }` closing of the manual OPNPC block, with:

```ts
        // Climb to the tower's first floor. Post nav-fix this is ONE primitive:
        // walkResilient routes the whole baked path (the regenerated stair edge
        // now stands INSIDE the tower and the door-crossings are driven), and
        // the Climb-up OPLOC server-walks the last tiles.
        const t0 = Game.tile();
        if (t0 && t0.level !== 1) {
            const climbed = await Reach.locOp({
                name: 'Staircase',
                op: 'Climb-up',
                near: WIZ_INSIDE_STAND,
                expect: () => (Game.tile()?.level ?? 0) >= 1,
                log
            });
            if (climbed === 'unreachable') {
                log('demon: tower staircase unreachable — re-entering to re-plan');
            }
            return false; // re-enter: next pass talks Traiborn from L1
        }
        // On L1 — get Traiborn's dialogue open (tracks his patrol; opens the
        // interior door leaf when the way is shut), then drive it.
        if ((await Reach.npcDialog({ name: 'Traiborn', near: TRAIBORN.anchor, log })) !== 'done') {
            return false;
        }
```

Keep everything AFTER that point unchanged (the `talkThrough('Traiborn', ...)` call, the `delayTicks(2)`, the bones-count check with the incantation-continue loop, and the `return false;`). Keep `WIZ_INSIDE_STAND` (it is now the `near` hint). Delete any now-unused imports (run tsc to find them).

- [ ] **Step 2: Typecheck + unit tests**

`bunx tsc --noEmit 2>&1 | grep demonslayer` → empty. `bun test` → pass.

- [ ] **Step 3: Deploy + live PASS gate**

Deploy + freshness per Global Constraints, then:

```bash
LOG=/tmp/nav-demon.log; : > "$LOG"
nohup bun tools/aio-quest-test.ts http://localhost:8890 "nd$(date +%s | tail -c 6)" demon 30 "coins:50000,bones:25" "attack:60,strength:60,defence:60,hitpoints:60" > "$LOG" 2>&1 &
```

Poll `grep -E "demon=|PASS|FAIL" /tmp/nav-demon.log | tail -3` every ~3 min. Expected within ~20 min: `demon=complete qp=3` and a final `PASS` line. This is the live proof of the regenerated tower edge + door-crossing + `Reach` together. On FAIL: read the last 20 non-`pos=` `[info]` lines, diagnose (the fix belongs in Tasks 3/4/7/8 code, not in new def hacks), redeploy, rerun.

- [ ] **Step 4: Commit**

```bash
git add src/bot/quests/defs/demonslayer.ts
git commit -m "refactor(quest): Demon Slayer tower + Traiborn onto Reach — live PASS re-verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Witch's House cellar onto `Reach` + live descent gate

**Files:**
- Modify: `src/bot/quests/defs/witchshouse.ts` (`magnetLeg`'s surface descent block; delete `LADDER_DOWN_STAND` + the DirectNavigator block)

**Interfaces:**
- Consumes: `Reach.locOp`; Tasks 3/4/6 (door crossings + wall-aware goals make the interior route the walked one).

- [ ] **Step 1: Replace the descent block**

In `witchshouse.ts`: add `import { Reach } from '../../api/Reach.js';`, delete the `import { DirectNavigator } ...` line, delete the `LADDER_DOWN_STAND` constant, and replace the whole `if (!isUnderground(t)) { ... }` descent block inside `magnetLeg` with:

```ts
    if (!isUnderground(t)) {
        // Descend the cellar Ladder. The nav fix carries this whole leg: the
        // wall-aware goals route INTERIOR (front door → inner door → the ladder
        // stand — never the wall-blind exterior (2908,3478)), the door
        // crossings are driven to completion, and the Climb-down OPLOC
        // server-walks the furniture-tight last tiles.
        const r = await Reach.locOp({
            name: 'Ladder',
            op: 'Climb-down',
            near: LADDER_TILE,
            expect: () => {
                const g = Game.tile();
                return g !== null && isUnderground(g);
            },
            log
        });
        if (r === 'unreachable') {
            log('magnetLeg: cellar ladder unreachable — re-entering to re-plan');
        }
        return false; // re-enter: the underground branch takes over once down
    }
```

(`LADDER_TILE = new Tile(2907, 3476, 0)` already exists — it stays.) Update the `LADDER_TILE` comment block to drop the DirectNav wording. Delete now-unused imports per tsc.

- [ ] **Step 2: Typecheck + unit tests**

`bunx tsc --noEmit 2>&1 | grep witchshouse` → empty. `bun test` → pass.

- [ ] **Step 3: Deploy + live cellar-descent gate**

Deploy + freshness, then:

```bash
LOG=/tmp/nav-ball.log; : > "$LOG"
nohup bun tools/aio-quest-test.ts http://localhost:8890 "nb$(date +%s | tail -c 6)" ball 26 "coins:50000,cheese:1,leather_gloves:1" "attack:60,strength:60,defence:60,hitpoints:60" > "$LOG" 2>&1 &
```

Poll `grep -oE "pos=[0-9]+,9[0-9]{3},[0-9]" /tmp/nav-ball.log | tail -2` every ~2 min. **Gate: any `pos=29xx,98xx` line (cellar z-band ≈ 9856-9880) within ~12 min of start** — the bot descended via the interior. The full quest PASS is a bonus, not the gate (the gate/cupboard/experiment/witch legs past the cellar are quest scope, per the spec). Once the cellar line appears (or the run completes), `pkill -f "aio-quest-test"`. On no-descent: diagnose from the walker log; the fix belongs in nav code, not def hacks.

- [ ] **Step 4: Commit**

```bash
git add src/bot/quests/defs/witchshouse.ts
git commit -m "refactor(quest): Witch's House cellar descent onto Reach — interior route live-verified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Merlin's knights onto `Reach` + live keep gate ×2

**Files:**
- Modify: `src/bot/quests/defs/merlinscrystal.ts` (delete the local `talkKnight`; `talkKnights` uses the shared primitives)

**Interfaces:**
- Consumes: `Reach.npcDialog` + hardened `talkThrough` (which now carries the transient-close fix the local `talkKnight` had).

- [ ] **Step 1: Replace `talkKnight`/`talkKnights`**

In `merlinscrystal.ts`: add `import { Reach } from '../../api/Reach.js';`. Delete the whole local `talkKnight` function. Replace `talkKnights` with:

```ts
/** Talk Gawain then Lancelot to advance stage 1→3. Reach opens each dialogue
 *  (tracking the patrol via the live NPC query; opening the throne-room leaf
 *  when the way is shut), and the shared talkThrough — transient-close
 *  tolerant — drives it through the mid-branch varp-sets. */
async function talkKnights(log: (m: string) => void): Promise<void> {
    if ((await Reach.npcDialog({ name: GAWAIN.npc, near: GAWAIN.anchor, log })) === 'done') {
        await talkThrough(GAWAIN.npc, GAWAIN.prefer, log);
    }
    if ((await Reach.npcDialog({ name: LANCELOT.npc, near: LANCELOT.anchor, log })) === 'done') {
        await talkThrough(LANCELOT.npc, LANCELOT.prefer, log);
    }
}
```

Ensure `talkThrough` is in the primitives import; remove imports the deletion orphaned (per tsc).

- [ ] **Step 2: Typecheck + unit tests**

`bunx tsc --noEmit 2>&1 | grep merlinscrystal` → empty. `bun test` → pass.

- [ ] **Step 3: Deploy + live keep-entry gate, TWICE**

Deploy + freshness, then run **two consecutive** smokes (sequentially — kill each before the next):

```bash
LOG=/tmp/nav-arthur1.log; : > "$LOG"
nohup bun tools/aio-quest-test.ts http://localhost:8890 "na$(date +%s | tail -c 6)" arthur 40 "coins:50000,bread:1,insect_repellent:1,bucket_empty:1,tinderbox:1" "attack:70,strength:70,defence:70,hitpoints:70" > "$LOG" 2>&1 &
```

Gate per run: `grep -cE "pos=27[0-9]{2},(339[5-9]|340[0-9]),"` ≥ 1 (the keep footprint x≈2768-2779, z≈3395-3409) within ~15 min — the knights advanced the stage AND the crate teleported. The spec's acceptance is **2/2 consecutive keep entries** (this was the flaky bottleneck). A full quest run beyond the keep is a bonus; kill each smoke after its gate. If run 1 or 2 misses the keep: diagnose the knight/crate leg from the log; fix in nav/Reach code; restart the ×2 count.

- [ ] **Step 4: Commit**

```bash
git add src/bot/quests/defs/merlinscrystal.ts
git commit -m "refactor(quest): Merlin's knights onto Reach + shared talkThrough — keep entry 2/2 live

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: integration sweep, cleanup, docs

**Files:**
- Modify: whatever the sweep finds (dead constants/imports in the three defs)
- Modify: `docs/superpowers/specs/2026-07-19-nav-reliability-design.md` (status line)

- [ ] **Step 1: Full battery**

Run in order (live ones sequential):
1. `bun test` → all pass.
2. `bunx tsc --noEmit` → no errors in any touched file.
3. `bun tools/clues/audit-clues.ts` → matches the Task 7 baseline (66/66).
4. `bun tools/nav/tower-probe.ts` + `bun tools/nav/witchhouse-probe.ts` → interior routings as per Tasks 6/7.
5. Deploy + freshness, then `bun tools/door-cross-test.ts` → `PASS: 4/4 ...`.
6. One fleet canary: `bun tools/mossgiant-style-test.ts melee` (safespot combat bot exercises plain walking + banking) → its PASS line. If this tool's name/args differ, pick the cheapest existing smoke under `tools/` that walks+banks and note which.

- [ ] **Step 2: Dead-workaround sweep**

`grep -nE "WIZ_INSIDE_STAND|LADDER_TILE|DirectNavigator" src/bot/quests/defs/*.ts` — each hit must be either the `near` hint usage added in Tasks 9/10 or deleted. `grep -n "talkKnight" src/bot/quests/defs/merlinscrystal.ts` → only `talkKnights` remains. Remove leftovers, retest (`bun test`, tsc).

- [ ] **Step 3: Mark the spec shipped**

Edit the spec's Status line to `**Status:** implemented — see docs/superpowers/plans/2026-07-19-nav-reliability.md (all 12 tasks landed <date>)`.

- [ ] **Step 4: Final commit**

```bash
git add -u docs/superpowers/specs/2026-07-19-nav-reliability-design.md src/bot/quests/defs
git commit -m "chore(nav): integration sweep — full battery green, dead workarounds removed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Report the final state: battery results, the two keep entries' timings, cellar-descent timing, Demon Slayer PASS timing, and any deviation from this plan.
