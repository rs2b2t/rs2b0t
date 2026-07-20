# CakeThiever + Shared Cake-Stall Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone CakeThiever bot (steal cakes at the East Ardougne Baker's stall, bank them, Fight/Flee guards per setting) whose steal loop is a shared driver that then replaces the broken `RestockCakes` in ArdyThiever and ArdyFighter.

**Architecture:** Three layers per the spec (`docs/superpowers/specs/2026-07-20-cakethiever-design.md`): pure decision logic in `CakeStallLogic.ts` (bun-tested, no client imports), a client-coupled shared driver `stealCakes()` in `CakeStall.ts` (outcome-classified steal loop: golden stand → click → classify success/caught/lockout/refused → streak reset), and the `CakeThiever` TaskBot wired from proven ArdyThiever task shapes. Backports swap each bot's `RestockCakes.execute` onto the driver and delete the LOS-prediction machinery (`ownerWatching`/`lineClear`/`StallOwner.ts`).

**Tech Stack:** TypeScript (bun), `bun:test` with `mock.module`, Playwright smoke harness (`tools/*-test.ts` pattern), local engine at `~/code/rs2b2t-engine`.

## Global Constraints

- Test runner: `bun test` (full suite must stay green, 666+ tests). Typecheck: `bunx tsc --noEmit -p tsconfig.json` (zero output = pass).
- `bun:test` `mock.module` LEAKS across test files in one run. Never mock a shared module with a slimmed stub of itself (this broke `gotoNpc.test.ts` when `primitives.js` was stubbed — see `src/bot/clues/ClueExecutor.test.ts` header). Mock only leaf client singletons, with their full used surface.
- The user commits concurrently on this checkout: `git add` exact paths only, NEVER `git add -A`. Check `git log --oneline -1` before each commit.
- Commit messages: conventional (`feat(scripts): ...`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Engine facts (do not re-derive): guard catch = combat starts, Baker catch = silent refusal (`npc_say` is overhead-only, NOT a chat message), every attempt prints the chat line "You attempt to steal ...", 10-tick post-combat lockout prints "You can't steal from the market stall during combat!".
- Golden stand tile: `(2668,3312)`. Never loop on exact-tile arrival — one bounded claim walk, then steal from wherever we are.
- Live smokes deploy over the local web build — if a live wall/fleet is running from this checkout, do not deploy without the user's OK.

---

### Task 1: CakeStallLogic — pure outcome/reset/lockout logic

**Files:**
- Create: `src/bot/scripts/CakeStallLogic.ts`
- Test: `src/bot/scripts/CakeStallLogic.test.ts` (co-located, `ArdyFighterLogic` pattern)

**Interfaces:**
- Consumes: `Tile` from `../api/Tile.js` (pure class).
- Produces (later tasks import all of these from `./CakeStallLogic.js`):
  - `type StealOutcome = 'success' | 'caught' | 'lockout' | 'refused' | 'timeout'`
  - `interface StealSignals { gained: boolean; combat: boolean; lockoutSeen: boolean; attemptSeen: boolean }`
  - `classifySteal(s: StealSignals): StealOutcome`
  - `shouldReset(consecutiveRefusals: number): boolean`, `RESET_AFTER_REFUSALS = 3`
  - `LOCKOUT_TICKS = 10`
  - Constants: `STAND: Tile(2668,3312)`, `RESET_TILE: Tile(2668,3320)`, `STALL_TILE: Tile(2667,3310)`, `STALL_NAME = 'Baker\'s stall'`, `STALL_OP = 'Steal from'`, `CAKE_ITEMS = ['cake', 'bread', 'chocolate slice']`

- [ ] **Step 1: Write the failing test**

`src/bot/scripts/CakeStallLogic.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';

import { classifySteal, shouldReset, RESET_AFTER_REFUSALS, STAND, RESET_TILE, CAKE_ITEMS } from './CakeStallLogic.js';

describe('classifySteal (one steal click resolved)', () => {
    test('a gained cake is success even if ambient combat coincides', () => {
        expect(classifySteal({ gained: true, combat: false, lockoutSeen: false, attemptSeen: true })).toBe('success');
        expect(classifySteal({ gained: true, combat: true, lockoutSeen: false, attemptSeen: true })).toBe('success');
    });

    test('combat without a cake = a guard caught the theft', () => {
        expect(classifySteal({ gained: false, combat: true, lockoutSeen: false, attemptSeen: true })).toBe('caught');
    });

    test('the engine lockout message wins over a bare refusal', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: true, attemptSeen: true })).toBe('lockout');
    });

    test('attempt seen but nothing landed = Baker refusal (his npc_say is overhead-only)', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: false, attemptSeen: true })).toBe('refused');
    });

    test('no signals at all = the click never registered', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: false, attemptSeen: false })).toBe('timeout');
    });
});

describe('shouldReset (refusal streak -> walk off and let the Baker drift)', () => {
    test('resets at the threshold, not before', () => {
        expect(shouldReset(RESET_AFTER_REFUSALS - 1)).toBe(false);
        expect(shouldReset(RESET_AFTER_REFUSALS)).toBe(true);
        expect(shouldReset(RESET_AFTER_REFUSALS + 1)).toBe(true);
    });
});

describe('constants', () => {
    test('reset tile is outside the 5-tile catch radius of the stand', () => {
        expect(Math.max(Math.abs(RESET_TILE.x - STAND.x), Math.abs(RESET_TILE.z - STAND.z))).toBeGreaterThan(5);
    });
    test('cake items cover the multi-bite stages by contains-match', () => {
        expect(CAKE_ITEMS).toContain('cake'); // 'Cake', '2/3 cake', 'Slice of cake' all contain it
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/scripts/CakeStallLogic.test.ts`
Expected: FAIL — `Cannot find module './CakeStallLogic.js'`

- [ ] **Step 3: Write the implementation**

`src/bot/scripts/CakeStallLogic.ts`:

```ts
import Tile from '../api/Tile.js';

/**
 * Pure cake-stall knowledge — no client imports so it runs under plain
 * `bun test` (ArdyFighterLogic pattern). Encodes the East Ardougne Baker's
 * stall layout and the engine's steal outcomes (content
 * skill_thieving/stalls/stealing.rs2, verified 2026-07-20):
 *
 *  - Every attempt prints the CHAT line "You attempt to steal ..." BEFORE the
 *    guard/owner checks run.
 *  - A guard (Guard/Knight/Paladin/Hero) within 5 tiles WITH line of sight
 *    catches the theft and retaliates -> combat, nothing stolen.
 *  - The Baker within 5 tiles with LOS refuses the theft silently client-side
 *    (his "Hey! Get your hands off there!" is npc_say OVERHEAD text, not a
 *    chat message) -> no loot, no combat.
 *  - For 10 ticks after any combat every steal prints "You can't steal from
 *    the market stall during combat!".
 *
 * Strategy (2026-07-20 design): no line-of-sight prediction — classify what
 * actually happened and react. Outcomes over predictions.
 */

/** The stall loc itself (behind its counter, not standable). */
export const STALL_TILE = new Tile(2667, 3310, 0);
/** THE stand — highest live steal-success rate (user-verified). Market-side
 *  and behind-the-stall stands alert the guards/Baker far more often. */
export const STAND = new Tile(2668, 3312, 0);
/** Where a refusal streak resets to: ~8 tiles north, outside the Baker's
 *  5-tile catch radius and off the market side, until he drifts. */
export const RESET_TILE = new Tile(2668, 3320, 0);
export const STALL_NAME = 'Baker\'s stall';
export const STALL_OP = 'Steal from';
/** What the stall yields (content stealing.dbrow) — contains-matched, so the
 *  cake bite-stages ('2/3 cake', 'Slice of cake') count too. */
export const CAKE_ITEMS = ['cake', 'bread', 'chocolate slice'];

/** Engine: steals are refused until %lastcombat + 10 <= map_clock. */
export const LOCKOUT_TICKS = 10;
/** Consecutive refused/no-op steals before walking off to reset. */
export const RESET_AFTER_REFUSALS = 3;

export type StealOutcome = 'success' | 'caught' | 'lockout' | 'refused' | 'timeout';

/** Signals gathered while resolving one steal click. */
export interface StealSignals {
    /** Carried stall-food count rose. */
    gained: boolean;
    /** Game.inCombat() is up — a guard caught us (when nothing was gained). */
    combat: boolean;
    /** The 10-tick post-combat lockout chat line was seen. */
    lockoutSeen: boolean;
    /** The "You attempt to steal" chat line was seen (the click registered). */
    attemptSeen: boolean;
}

/** What one steal click actually did, in signal-priority order. */
export function classifySteal(s: StealSignals): StealOutcome {
    if (s.gained) {
        return 'success';
    }
    if (s.combat) {
        return 'caught';
    }
    if (s.lockoutSeen) {
        return 'lockout';
    }
    if (s.attemptSeen) {
        return 'refused';
    }
    return 'timeout';
}

/** Walk off and let the Baker drift once refusals stack this high. */
export function shouldReset(consecutiveRefusals: number): boolean {
    return consecutiveRefusals >= RESET_AFTER_REFUSALS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/scripts/CakeStallLogic.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `bun test 2>&1 | tail -3` (expect 0 fail) and `bunx tsc --noEmit -p tsconfig.json` (expect no output).

```bash
git add src/bot/scripts/CakeStallLogic.ts src/bot/scripts/CakeStallLogic.test.ts
git commit -m "feat(scripts): pure cake-stall steal-outcome logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CakeStall — the shared `stealCakes()` driver

**Files:**
- Create: `src/bot/scripts/CakeStall.ts`
- Test: `src/bot/scripts/CakeStall.test.ts`

**Interfaces:**
- Consumes: Task 1's exports; `countMatching` from `./ArdyFighterLogic.js`; client singletons (`Execution`, `Game`, `Inventory`, `Traversal`, `Locs`, `Npcs`, `bus`).
- Produces (Tasks 3, 5, 6 import from `./CakeStall.js`):
  - `type StealCakesResult = 'stocked' | 'combat' | 'aborted' | 'no-progress'`
  - `interface StealCakesOptions { fillTo: number; abort: () => boolean; shouldEat?: () => boolean; lockedOutUntil?: () => number; setStatus: (s: string) => void; log: (m: string) => void; onSteal?: () => void; onReset?: () => void }`
  - `stealCakes(opts: StealCakesOptions): Promise<StealCakesResult>`
  - `carriedCakes(): number` (so callers count the same items the driver does)

- [ ] **Step 1: Write the failing test**

`src/bot/scripts/CakeStall.test.ts`. Mocks use the driver's own relative specifiers; every mocked module carries its full surface used anywhere in the suite-after-this-file (leak rule from Global Constraints — these leaf singletons are already globally mocked by `quests/exec` tests, which run BEFORE `scripts/` alphabetically and re-mock for themselves):

```ts
import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '../api/Tile.js';

// Driver regression tests over mocked I/O singletons. The scripted "world"
// advances a fake game tick inside Execution.delayUntil/delayTicks so lockout
// waits and stall respawns resolve without wall-clock time. primitives-style
// shared modules are NOT mocked (bun module mocks leak across test files).

let tick: number;
let cakeCount: number;
let inCombat: boolean;
let stallStocked: boolean;
let bakerNear: boolean;
let playerTile: Tile;
let walks: string[];            // every walkTo dest
let clicks: number;             // stall interacts issued
let chatHandler: ((e: { text: string }) => void) | null;
// per-click script: what the world does when the stall is clicked
let onClick: () => void;
// called on every stall Locs poll — lets a test script the respawn
let pollHook: () => void;

mock.module('../api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean, _ms?: number): Promise<boolean> => {
            for (let i = 0; i < 60; i++) {
                if (fn()) { return true; }
                tick++;
            }
            return fn();
        },
        delayTicks: async (n: number = 1): Promise<void> => { tick += n; }
    }
}));
mock.module('../api/Game.js', () => ({
    Game: {
        tick: () => tick,
        inCombat: () => inCombat,
        tile: () => playerTile,
        ingame: () => true
    }
}));
mock.module('../api/hud/Inventory.js', () => ({
    Inventory: {
        items: () => Array.from({ length: cakeCount }, (_, i) => ({ id: 1891, name: 'Cake', count: 1, slot: i })),
        isFull: () => cakeCount >= 28,
        count: (name: string) => (name.toLowerCase().includes('cake') ? cakeCount : 0),
        used: () => cakeCount,
        first: () => null
    }
}));
mock.module('../api/Traversal.js', () => ({
    Traversal: {
        walkTo: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        },
        walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        }
    }
}));
mock.module('../api/queries/Locs.js', () => ({
    Locs: {
        query: () => {
            const chain = {
                name: () => chain,
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => {
                    pollHook();
                    return stallStocked
                        ? {
                            tile: () => new Tile(2667, 3310, 0),
                            interact: async (): Promise<boolean> => { clicks++; onClick(); return true; }
                        }
                        : null;
                }
            };
            return chain;
        }
    }
}));
mock.module('../api/queries/Npcs.js', () => ({
    Npcs: {
        query: () => {
            const chain = {
                name: () => chain,
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => (bakerNear ? { tile: () => new Tile(2668, 3311, 0) } : null)
            };
            return chain;
        },
        all: () => []
    }
}));
mock.module('../events/EventBus.js', () => ({
    bus: {
        on: (_event: string, cb: (e: { text: string }) => void): (() => void) => {
            chatHandler = cb;
            return () => { chatHandler = null; };
        },
        emit: () => {}
    }
}));

const { stealCakes } = await import('./CakeStall.js');

const say = (text: string): void => { chatHandler?.({ text }); };

function opts(over: Record<string, unknown> = {}) {
    return {
        fillTo: 5,
        abort: () => false,
        setStatus: () => {},
        log: () => {},
        ...over
    };
}

describe('stealCakes driver', () => {
    beforeEach(() => {
        tick = 100;
        cakeCount = 0;
        inCombat = false;
        stallStocked = true;
        bakerNear = false;
        playerTile = new Tile(2668, 3312, 0); // already on the stand
        walks = [];
        clicks = 0;
        chatHandler = null;
        pollHook = () => {};
        onClick = () => { say('You attempt to steal a cake from the baker\'s stall.'); cakeCount++; };
    });

    test('steals to the fill target and reports stocked, no reset walks', async () => {
        expect(await stealCakes(opts())).toBe('stocked');
        expect(cakeCount).toBe(5);
        expect(clicks).toBe(5);
        expect(walks).toEqual([]); // on the stand the whole time
    });

    test('claims the stand once when off it, and still steals if the claim walk fails', async () => {
        playerTile = new Tile(2660, 3308, 0);
        expect(await stealCakes(opts())).toBe('stocked');
        expect(walks[0]).toBe('2668,3312'); // one claim walk, then stealing
    });

    test('a guard catch (combat, no cake) returns combat immediately', async () => {
        onClick = () => { say('You attempt to steal a cake from the baker\'s stall.'); inCombat = true; };
        expect(await stealCakes(opts())).toBe('combat');
        expect(clicks).toBe(1); // no clicking into a fight
    });

    test('three silent refusals walk to the reset tile, then stealing resumes', async () => {
        let refused = 0;
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (refused < 3) { refused++; bakerNear = true; return; } // Baker watching: nothing gained
            bakerNear = false;
            cakeCount++;
        };
        // the reset wait ends when the Baker drifts — script that via the wait loop
        const resets: number[] = [];
        expect(await stealCakes(opts({ onReset: () => { resets.push(clicks); bakerNear = false; } }))).toBe('stocked');
        expect(resets).toEqual([3]); // exactly one reset, after the 3rd refusal
        expect(walks).toContain('2668,3320'); // walked off to the reset tile
        expect(walks[walks.length - 1]).toBe('2668,3312'); // and re-claimed the stand after
    });

    test('the lockout message parks clicks until the 10-tick window passes', async () => {
        // Locked until tick 110: the first click at tick 100 gets the engine
        // lockout line; the driver must then WAIT (selfLockout = 100 + 10),
        // and the next click at tick >= 110 succeeds.
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (tick < 110) { say('You can\'t steal from the market stall during combat!'); return; }
            cakeCount++;
        };
        expect(await stealCakes(opts())).toBe('stocked');
        // 1 locked click + 5 successes — a 10-tick wait, not click spam
        expect(clicks).toBe(6);
    });

    test('abort wins between actions', async () => {
        let calls = 0;
        expect(await stealCakes(opts({ abort: () => ++calls > 1 }))).toBe('aborted');
    });

    test('an emptied stall waits for the respawn instead of clicking nothing', async () => {
        // Respawn model: after each success the stall empties; the stocked
        // variant returns after 5 Locs polls (the tick-advancing delayUntil
        // in the Execution mock drives those polls).
        let emptyPolls = 0;
        const baseNearest = (): void => {
            if (!stallStocked && ++emptyPolls >= 5) { stallStocked = true; emptyPolls = 0; }
        };
        pollHook = baseNearest; // see Locs mock: called on every nearest()
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            cakeCount++;
            stallStocked = false; // our steal emptied it
        };
        expect(await stealCakes(opts({ fillTo: 3 }))).toBe('stocked');
        expect(cakeCount).toBe(3); // waited out two respawns to get there
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/scripts/CakeStall.test.ts`
Expected: FAIL — `Cannot find module './CakeStall.js'`

- [ ] **Step 3: Write the implementation**

`src/bot/scripts/CakeStall.ts`:

```ts
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Traversal } from '../api/Traversal.js';
import { Locs } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { bus } from '../events/EventBus.js';
import { countMatching } from './ArdyFighterLogic.js';
import {
    CAKE_ITEMS, LOCKOUT_TICKS, RESET_TILE, STALL_NAME, STALL_OP, STALL_TILE, STAND,
    classifySteal, shouldReset
} from './CakeStallLogic.js';

/**
 * The shared Baker's-stall steal driver (2026-07-20 design) — the base
 * implementation CakeThiever proves live and ArdyThiever/ArdyFighter reuse.
 *
 * Shape: do our best to stand on THE stand (one bounded claim walk — never
 * loop on exact-tile arrival, that was the old wedge), click Steal-from, and
 * classify what actually happened (CakeStallLogic.classifySteal) instead of
 * predicting the Baker's line of sight:
 *  - success  -> keep going
 *  - caught   -> return 'combat'; the caller's Flee/Fight task owns it
 *  - lockout  -> wait out the engine's 10-tick post-combat window
 *  - refused  -> free (no damage); after RESET_AFTER_REFUSALS in a row, walk
 *               to RESET_TILE until the Baker drifts off the stand, come back
 *
 * Callers may feed `lockedOutUntil` (last combat end + LOCKOUT_TICKS) to skip
 * the first refused click after a fight; without it the driver self-heals off
 * the lockout chat line.
 */

const DEADLINE_MS = 90_000; // one execute()'s worth of stealing; caller re-enters
const CLAIM_TIMEOUT_MS = 5_000;
const RESOLVE_MS = 2_400; // attempt-mes -> p_arrivedelay -> p_delay(0) -> loot, ~4 ticks
const RESTOCK_WAIT_MS = 8_000; // stall respawn is 8 ticks base, playercount-scaled
const RESET_WAIT_MS = 10_000; // Baker wander-out bound while parked on RESET_TILE
const OWNER = 'Baker';
const OWNER_RANGE = 5; // the engine's catch radius

const ATTEMPT_RE = /you attempt to steal/i;
const LOCKOUT_RE = /can't steal from the market stall during combat/i;

export type StealCakesResult = 'stocked' | 'combat' | 'aborted' | 'no-progress';

export interface StealCakesOptions {
    /** Stop once carried stall food reaches this (or the pack fills). */
    fillTo: number;
    /** Bail signal (death, random event, open dialog...) — checked between actions. */
    abort: () => boolean;
    /** Caller's eat gate: true -> return 'aborted' so its eat task runs. */
    shouldEat?: () => boolean;
    /** Game tick before which steals are engine-refused (last combat end + 10). */
    lockedOutUntil?: () => number;
    setStatus: (s: string) => void;
    log: (m: string) => void;
    onSteal?: () => void;
    onReset?: () => void;
}

/** Carried stall food, bite-stages included — the count `fillTo` is against. */
export function carriedCakes(): number {
    return countMatching(Inventory.items(), CAKE_ITEMS);
}

/** The stocked stall (the emptied respawn variant drops the Steal-from op). */
function stockedStall() {
    return Locs.query()
        .name(STALL_NAME)
        .action(STALL_OP)
        .where(l => l.tile().distanceTo(STALL_TILE) <= 3)
        .nearest();
}

/** Baker inside the engine's catch radius of the stand (position only — no
 *  LOS modelling; the reset wait just outlasts him). */
function bakerNearStand(): boolean {
    return Npcs.query().name(OWNER).where(n => n.tile().distanceTo(STAND) <= OWNER_RANGE).nearest() !== null;
}

export async function stealCakes(opts: StealCakesOptions): Promise<StealCakesResult> {
    let refusals = 0;
    let selfLockout = 0; // learned from the lockout chat line when the caller has no tracking
    let attemptSeen = false;
    let lockoutSeen = false;
    const unsub = bus.on('chat.message', e => {
        if (ATTEMPT_RE.test(e.text)) {
            attemptSeen = true;
        }
        if (LOCKOUT_RE.test(e.text)) {
            lockoutSeen = true;
        }
    });
    try {
        const deadline = performance.now() + DEADLINE_MS;
        while (performance.now() < deadline) {
            if (opts.abort() || opts.shouldEat?.()) {
                return 'aborted';
            }
            if (Game.inCombat()) {
                return 'combat';
            }
            if (Inventory.isFull() || carriedCakes() >= opts.fillTo) {
                opts.log(`stocked ${carriedCakes()} stall food`);
                return 'stocked';
            }

            // Engine lockout: don't spam clicks the server will refuse.
            const until = Math.max(opts.lockedOutUntil?.() ?? 0, selfLockout);
            if (Game.tick() < until) {
                opts.setStatus('waiting out the post-combat steal lockout');
                await Execution.delayUntil(() => Game.tick() >= until || opts.abort(), 12_000);
                continue;
            }

            // Best-effort claim of THE stand: one bounded walk per pass. On a
            // walk hiccup we still steal from here — the click's server-walk
            // covers the last step — and re-try the claim next pass.
            const here = Game.tile();
            if (here && STAND.distanceTo(here) > 0) {
                await Traversal.walkTo(STAND, { radius: 0, timeoutMs: CLAIM_TIMEOUT_MS, log: m => opts.log(`  ${m}`) });
            }

            const stall = stockedStall();
            if (!stall) {
                // Emptied by our own steal — condition-wait for the respawn.
                await Execution.delayUntil(() => stockedStall() !== null || opts.abort(), RESTOCK_WAIT_MS);
                continue;
            }

            attemptSeen = false;
            lockoutSeen = false;
            const before = carriedCakes();
            opts.setStatus(`stealing cake (${before}/${opts.fillTo})`);
            if (!(await stall.interact(STALL_OP))) {
                refusals++;
                await Execution.delayTicks(1);
            } else {
                await Execution.delayUntil(() => carriedCakes() > before || Game.inCombat() || lockoutSeen, RESOLVE_MS);
                const outcome = classifySteal({ gained: carriedCakes() > before, combat: Game.inCombat(), lockoutSeen, attemptSeen });
                if (outcome === 'success') {
                    refusals = 0;
                    opts.onSteal?.();
                    continue;
                }
                if (outcome === 'caught') {
                    return 'combat';
                }
                if (outcome === 'lockout') {
                    selfLockout = Game.tick() + LOCKOUT_TICKS;
                    continue;
                }
                refusals++; // 'refused' | 'timeout' — both free, both count toward the reset
            }

            if (shouldReset(refusals)) {
                opts.setStatus('watched — resetting off the stall');
                opts.log(`${refusals} refused steals — resetting at ${RESET_TILE.x},${RESET_TILE.z} until the Baker drifts`);
                opts.onReset?.();
                await Traversal.walkTo(RESET_TILE, { radius: 1, timeoutMs: 15_000, log: m => opts.log(`  ${m}`) });
                await Execution.delayUntil(() => !bakerNearStand() || opts.abort(), RESET_WAIT_MS);
                refusals = 0;
            }
        }
        return 'no-progress';
    } finally {
        unsub();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/scripts/CakeStall.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `bun test 2>&1 | tail -3` (0 fail — watch specifically that `src/bot/quests/exec` and `test/` files stayed green given the module mocks) and `bunx tsc --noEmit -p tsconfig.json`.

```bash
git add src/bot/scripts/CakeStall.ts src/bot/scripts/CakeStall.test.ts
git commit -m "feat(scripts): shared outcome-classified cake-stall steal driver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: CakeThiever bot + registration

**Files:**
- Create: `src/bot/scripts/CakeThiever.ts`
- Modify: `src/bot/scripts/index.ts` (imports at top; registration after the ArdyThiever block, ~line 157)

**Interfaces:**
- Consumes: `stealCakes`/`carriedCakes` (Task 2), `CAKE_ITEMS`/`LOCKOUT_TICKS`/`STAND` (Task 1), `HOSTILE_NAMES`/`isHostileAttacker` from `./ArdyThieverLogic.js`, `matchesAny`/`shouldEat` from `./ArdyFighterLogic.js`, plus the same api/tasks/hud modules ArdyThiever uses.
- Produces: `default class CakeThiever extends TaskBot`, `export const SETTINGS: SettingsSchema`; registry name `'CakeThiever'`.

- [ ] **Step 1: Write the bot**

`src/bot/scripts/CakeThiever.ts`:

```ts
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { DeathRecovery } from '../api/tasks/DeathRecovery.js';
import { depositMatcher } from '../api/Banking.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Bank } from '../api/hud/Bank.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Traversal } from '../api/Traversal.js';
import { walkOpening } from '../api/walkOpening.js';
import { EventSignal } from '../api/EventSignal.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { matchesAny, shouldEat } from './ArdyFighterLogic.js';
import { HOSTILE_NAMES, isHostileAttacker } from './ArdyThieverLogic.js';
import { CAKE_ITEMS, LOCKOUT_TICKS, STAND } from './CakeStallLogic.js';
import { carriedCakes, stealCakes } from './CakeStall.js';

// East Ardougne layout — baked in (see the 2026-07-20 cakethiever design).
// The bot lives on the golden stand; everything else is a short fixed walk.
const BANK_STAND = new Tile(2655, 3286, 0);
const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
// Kite tile SW of the market — far enough to drag a guard off the stall and
// break its melee (proven by ArdyThiever's Flee).
const FLEE_TILE = new Tile(2655, 3298, 0);
// Market-local boundary: covers the stand AND the south bank (cheb 26 apart),
// so bank trips never fight ReturnToAnchor for control.
const MARKET_RADIUS = 40;
const OBSTACLE = ['door', 'gate'];
const ENGAGE_RADIUS = 5;

/** minutes -> h:mm:ss for the paint's runtime line. */
function fmtDuration(mins: number): string {
    const t = Math.max(0, Math.floor(mins * 60));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const SETTINGS: SettingsSchema = {
    guardResponse: { type: 'string', default: 'Flee', options: ['Flee', 'Fight'], label: 'Guard response', help: 'caught at the stall: Flee kites the guard off the market; Fight kills it (bring combat stats)' },
    eatAtHp: { type: 'number', default: 40, min: 0, max: 100, label: 'Eat below HP%', help: 'eats the stolen cakes — they are free' },
    eatToHp: { type: 'number', default: 90, min: 1, max: 100, label: 'Eat up to HP%' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Bank common junk too' }
};

// Active run config (ADR-0006 single-script module state).
let RESPONSE = 'Flee';
let EAT_AT = 0.4;
let EAT_TO = 0.9;
let BANK_COMMON = true;

function nearMarket(): boolean {
    const here = Game.tile();
    return here !== null && STAND.distanceTo(here) <= MARKET_RADIUS;
}

/**
 * Baker's-stall cake thiever. Stands on THE stand (2668,3312), steals cakes
 * via the shared outcome-classified driver (no Baker line-of-sight
 * prediction — refusals are free; a streak resets nearby until he drifts),
 * banks full packs at the south bank, and answers a guard catch with Flee
 * (kite) or Fight per the guardResponse setting. Thieving 5 required.
 */
export default class CakeThiever extends TaskBot {
    override loopDelay = 600;

    private steals = 0;
    private resets = 0;
    private eats = 0;
    private banked = 0;
    private trips = 0;
    private flees = 0;
    private kills = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private combatEndTick = 0;
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        RESPONSE = this.settings.str('guardResponse', 'Flee');
        EAT_AT = this.settings.num('eatAtHp', 40) / 100;
        EAT_TO = this.settings.num('eatToHp', 90) / 100;
        BANK_COMMON = this.settings.bool('bankCommonJunk', true);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');

        if (Skills.level('thieving') < 5) {
            this.log(`CakeThiever needs Thieving 5 for the Baker's stall (have ${Skills.level('thieving')}) — stopping.`);
            throw new Error('CakeThiever: Thieving 5 required');
        }

        this.log(`CakeThiever starting — stand ${STAND}, bank ${BANK_STAND}, ${RESPONSE.toLowerCase()} mode`);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: STAND,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            ...(RESPONSE === 'Fight' ? [new FightBack(this)] : [new Flee(this)]),
            new EatCake(this),
            new BankRun(this),
            new StealCakes(this),
            new ReturnToStall(this)
        );
    }

    override grindTargets(): string[] {
        // In Fight mode the retaliating market hostiles are legitimate targets,
        // not random events; harmless in Flee mode (we never attack them).
        return HOSTILE_NAMES.map(n => n.toLowerCase());
    }
    override recoveryAnchor(): Tile | null {
        return STAND;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#f2a6c9' });
        p.title(`CakeThiever — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('thieving') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        const sph = mins > 0.5 ? `${Math.round((this.steals / mins) * 60)}` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Steals: ${this.steals}`, `Steals/hr: ${sph}`);
        p.row(`XP/hr: ${xph}`, `Carried: ${carriedCakes()}`, `Banked: ${this.banked}`);
        p.row(`Resets: ${this.resets}`, RESPONSE === 'Fight' ? `Fought: ${this.kills}` : `Fled: ${this.flees}`, `Trips: ${this.trips}`);
        p.bar('HP', Skills.hpFraction());
        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    /** Called by Flee/FightBack the moment combat clears — feeds the driver's
     *  10-tick engine lockout so the first post-fight click isn't wasted. */
    markCombatEnd(): void { this.combatEndTick = Game.tick(); }
    lockedOutUntil(): number { return this.combatEndTick + LOCKOUT_TICKS; }
    countSteal(): void { this.steals++; }
    countReset(): void { this.resets++; }
    countEat(): void { this.eats++; }
    countBanked(n: number): void { this.banked += n; }
    countTrip(): void { this.trips++; }
    countFlee(): void { this.flees++; }
    countKill(): void { this.kills++; }
}

/** Flee mode: on any combat, kite the guard to the fixed SW tile (drags it off
 *  the stall + breaks melee), wait out combat, record the end tick for the
 *  driver's lockout. ArdyThiever's proven shape, minus its pickpocket-stun
 *  ambiguity — CakeThiever never pickpockets, so combat is always real. */
class Flee implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return Game.inCombat(); }
    async execute(): Promise<void> {
        this.bot.setStatus(`kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.log(`combat — kiting the guard to ${FLEE_TILE.x},${FLEE_TILE.z}`);
        this.bot.countFlee();
        await walkOpening(FLEE_TILE, 0, OBSTACLE, m => this.bot.log(`  ${m}`));
        await Execution.delayUntil(() => !Game.inCombat(), 15000);
        if (!Game.inCombat()) {
            this.bot.markCombatEnd();
        }
    }
}

/** Fight mode: kill the market hostile that caught us (auto-retaliate-proof —
 *  attacks explicitly). ArdyThiever's FightBack shape with cake-eating gates. */
class FightBack implements Task {
    constructor(private bot: CakeThiever) {}
    private findAttacker(): Npc | null {
        return Npcs.query()
            .where(n => isHostileAttacker({ name: n.name, inCombat: n.inCombat, distance: n.distance(), actions: n.actions() }, ENGAGE_RADIUS))
            .nearest();
    }
    private track(engaged: Npc): Npc | null {
        return Npcs.all().find(n => n.index === engaged.index && n.name === engaged.name) ?? null;
    }
    validate(): boolean { return Game.inCombat(); }
    async execute(): Promise<void> {
        const attacker = this.findAttacker();
        if (!attacker) {
            await Execution.delayTicks(2);
            if (!Game.inCombat()) {
                this.bot.markCombatEnd();
            }
            return;
        }
        this.bot.setStatus(`fighting back: ${attacker.name} at ${attacker.tile()}`);
        this.bot.log(`combat — fighting back against ${attacker.name}`);
        if (!(await attacker.interact('Attack'))) { await Execution.delayTicks(2); return; }
        const deadline = performance.now() + 90_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || ChatDialog.canContinue() || this.bot.died) { return; }
            if (shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes())) {
                return; // EatCake outranks us next loop; combat resumes after
            }
            const target = this.track(attacker);
            if (!target || (target.health === 0 && target.snap.totalHealth > 0)) {
                if (target) {
                    await Execution.delayUntil(() => this.track(attacker) === null, 10_000);
                }
                this.bot.countKill();
                this.bot.log(`killed the ${attacker.name}`);
                this.bot.markCombatEnd();
                return;
            }
            if (!Game.inCombat() && !target.inCombat) {
                this.bot.markCombatEnd();
                return;
            }
            await Execution.delayTicks(2);
        }
    }
}

/** Eat stolen cakes below the gate up to the eat-to target — they're free. */
class EatCake implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes()); }
    async execute(): Promise<void> {
        for (let bite = 0; bite < 28; bite++) {
            if (this.bot.died || ChatDialog.canContinue() || EventSignal.pending()) { return; }
            if (Skills.hpFraction() >= EAT_TO || carriedCakes() === 0) { return; }
            const food = Inventory.items().find(i => matchesAny(i.name, CAKE_ITEMS));
            if (!food) { return; }
            this.bot.setStatus(`eating ${food.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
            const before = Skills.effective('hitpoints');
            if (!(await food.interact('Eat'))) { return; }
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before || carriedCakes() === 0, 3000);
            if (Skills.effective('hitpoints') > before) { this.bot.countEat(); }
        }
    }
}

/** Full pack -> south bank: deposit the cakes (+ common junk), walk back. */
class BankRun implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean { return nearMarket() && !Game.inCombat() && Inventory.isFull(); }
    async execute(): Promise<void> {
        this.bot.setStatus('banking the cakes');
        await Traversal.walkTo(BANK_STAND, { radius: 2, timeoutMs: 90000, log: m => this.bot.log(`  ${m}`) });
        if (!(await Bank.openBooth(BANK_STAND, BOOTH.name, BOOTH.op, m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank — will retry');
            return;
        }
        const before = carriedCakes();
        await Bank.depositAllMatching(depositMatcher(name => matchesAny(name, CAKE_ITEMS), BANK_COMMON), m => this.bot.log(`  ${m}`));
        await Execution.delayTicks(1);
        const shed = before - carriedCakes();
        this.bot.countBanked(Math.max(0, shed));
        this.bot.log(`banked ${shed} cakes${shed <= 0 ? ' (nothing deposited!)' : ''}`);
        this.bot.countTrip();
        this.bot.setStatus('heading back to the stall');
        await Traversal.walkResilient(STAND, { radius: 1, attempts: 4, timeoutMs: 120_000, log: m => this.bot.log(`  ${m}`) });
    }
}

/** The main loop: run the shared steal driver until the pack fills. */
class StealCakes implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean {
        return nearMarket() && !Game.inCombat() && !Inventory.isFull() && !this.bot.died;
    }
    async execute(): Promise<void> {
        const result = await stealCakes({
            fillTo: 28, // Inventory.isFull() is the real stop; 28 = never early
            abort: () => this.bot.died || EventSignal.pending() || ChatDialog.canContinue(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, carriedCakes()),
            lockedOutUntil: () => this.bot.lockedOutUntil(),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal(),
            onReset: () => this.bot.countReset()
        });
        if (result === 'combat') {
            this.bot.log('guard caught the steal — handling per guardResponse');
        } else if (result === 'no-progress') {
            this.bot.log('steal pass made no progress — re-entering');
        }
    }
}

/** Start-anywhere travel + displacement recovery (ArdyThiever shape). */
class ReturnToStall implements Task {
    constructor(private bot: CakeThiever) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && STAND.distanceTo(here) > MARKET_RADIUS;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('heading to the Baker\'s stall');
        const here = Game.tile();
        if (here && STAND.distanceTo(here) > 30) {
            await Traversal.walkResilient(STAND, { radius: 3, attempts: 6, timeoutMs: 240_000, log: m => this.bot.log(`  ${m}`) });
        }
        await walkOpening(STAND, 2, OBSTACLE, m => this.bot.log(m));
    }
}
```

- [ ] **Step 2: Register it**

In `src/bot/scripts/index.ts`, add with the other imports:

```ts
import CakeThiever, { SETTINGS as CAKETHIEVER_SETTINGS } from './CakeThiever.js';
```

and immediately after the ArdyThiever registration block (after its `});`, ~line 157):

```ts
ScriptRegistry.register({
    name: 'CakeThiever',
    description: 'Baker\'s-stall cake thiever — steals on the golden stand, resets nearby when watched, banks full packs, flees (kites) or fights a catching guard per guardResponse',
    category: 'Thieving',
    tags: ['ardougne', 'thieving', 'banking', 'afk'],
    settingsSchema: CAKETHIEVER_SETTINGS,
    create: () => new CakeThiever()
});
```

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit -p tsconfig.json` (no output) and `bun test 2>&1 | tail -3` (0 fail).

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/CakeThiever.ts src/bot/scripts/index.ts
git commit -m "feat(scripts): CakeThiever — golden-stand cake stealer with fight/flee guards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Live smoke — prove the base before any backport

**Files:**
- Create: `tools/cakethiever-test.ts` (pattern: `tools/ardythiever-test.ts`)

**Interfaces:**
- Consumes: the deployed local web build (`tools/deploy-local.sh`), engine at `http://localhost:8890`, registry name `'CakeThiever'` (Task 3), URL-settings override `?CakeThiever.guardResponse=Fight`.
- Produces: PASS/FAIL smoke evidence for both modes; nothing imported by later tasks.

- [ ] **Step 1: Write the harness**

`tools/cakethiever-test.ts` — copy `tools/ardythiever-test.ts` VERBATIM as the base, then apply exactly these deltas (the boot/login/tele/maxme plumbing is proven, do not rewrite it):

- Header comment: CakeThiever smoke; usage `bun tools/cakethiever-test.ts [base-url] [username] [Fight|Flee]`.
- `const mode = (process.argv[4] || 'Flee');` and goto `${base}/bot.html${mode === 'Fight' ? '?CakeThiever.guardResponse=Fight' : ''}`.
- Start `r.registry.get('CakeThiever')` instead of ArdyThiever.
- Watch loop (~240s of 2s polls) over `logLines()` sets flags:

```ts
const seen = { stocked: false, banked: false, reset: false, combat: false };
for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(2000);
    const lines = (await logLines()).slice(before);
    for (const l of lines) {
        if (/stocked \d+ stall food/.test(l)) { seen.stocked = true; }
        if (/banked \d+ cakes/.test(l) && !/nothing deposited/.test(l)) { seen.banked = true; }
        if (/resetting at 2668,3320/.test(l)) { seen.reset = true; }
        if (/kiting the guard|fighting back against/.test(l)) { seen.combat = true; }
    }
    if (seen.banked) { break; }
}
console.log(`seen: ${JSON.stringify(seen)}`);
if (!seen.stocked && !seen.banked) { fail('never stocked or banked — steal loop is not landing cakes'); }
if (!seen.banked) { fail('no successful bank trip within the watch window'); }
console.log(`PASS: CakeThiever ${mode} — full pack stolen and banked${seen.reset ? ' (incl. a refusal reset)' : ''}${seen.combat ? ' (incl. a guard response)' : ''}`);
```

(`seen.reset`/`seen.combat` are stochastic — the Baker/guards decide; report but don't fail on them. A pack fills in ~28 steals ≈ 2–3 min.)

- [ ] **Step 2: Deploy + run the Flee smoke**

```bash
curl -sf http://localhost:8890 >/dev/null || echo "ENGINE DOWN — start it: cd ~/code/rs2b2t-engine && npm run quickstart"
ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
bun tools/cakethiever-test.ts
```

Expected: `PASS: CakeThiever Flee — full pack stolen and banked ...`. If it fails: read the tail of the printed log lines, fix the bot (not the harness) and re-run; the golden stand and reset tiles are the live-tunable suspects (`STAND`, `RESET_TILE` in `CakeStallLogic.ts`).

- [ ] **Step 3: Run the Fight smoke**

Run: `bun tools/cakethiever-test.ts http://localhost:8890 '' Fight` (empty username arg → harness generates one; pass `Fight` as argv[4]).
Expected: PASS again; if a guard catch occurred, the log shows `fighting back against` + `killed the`.

- [ ] **Step 4: Commit**

```bash
git add tools/cakethiever-test.ts
git commit -m "test(scripts): CakeThiever live smoke — steal, reset, bank, both guard modes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Backport — ArdyThiever's RestockCakes onto the driver

**Files:**
- Modify: `src/bot/scripts/ArdyThiever.ts` (constants ~lines 32–47, imports, `RestockCakes` ~lines 495–572)
- Modify: `src/bot/scripts/ArdyThieverLogic.ts` (delete `ownerWatching`, `lineClear`, `Point`)
- Modify: `test/scripts/ardythiever-logic.test.ts` (delete the two describe blocks + imports for the deleted functions)

**Interfaces:**
- Consumes: `stealCakes`/`carriedCakes` (Task 2), `CAKE_ITEMS` (Task 1).
- Produces: unchanged ArdyThiever public surface; `ArdyThieverLogic.js` no longer exports `ownerWatching`/`lineClear`/`Point` (grep first — after this task nothing may import them).

- [ ] **Step 1: Swap RestockCakes onto the driver**

In `src/bot/scripts/ArdyThiever.ts`:

1. Imports: remove `Locs` and `Reachability`? NO — `Reachability` stays (LootDrops + Pickpocket use it); remove the `Locs` import (only RestockCakes used it) and change the logic import line to drop `ownerWatching`:

```ts
import { chooseTarget, isHostileAttacker, requiredThieving, targetSpot } from './ArdyThieverLogic.js';
```

Add:

```ts
import { CAKE_ITEMS } from './CakeStallLogic.js';
import { stealCakes } from './CakeStall.js';
```

2. Constants: delete `STALL_TILE`, `STALL_STAND`, `STALL_STAND_ALT`, `STALL_STAND_2`, `STALL_NAME`, `STALL_OP` (the driver owns the stall layout). The `onStart` log line references `STALL_TILE` — change it to:

```ts
this.log(`ArdyThiever starting — target '${TARGET}' at ${ANCHOR} r${LEASH} (Thieving ${need}+), ${RESPONSE.toLowerCase()} mode, stall via shared driver, bank ${BANK_STAND}`);
```

Replace the `FOOD` list with the shared one:

```ts
// What the Baker's stall gives — the shared driver's list, also what
// PanicRetreat withdraws if the bank holds any.
const FOOD = CAKE_ITEMS;
```

3. Replace the ENTIRE `RestockCakes` class (delete `stockedStall`, `pickStand`, and the old execute loop) with:

```ts
/** Fill cake to FOOD_TARGET once food drops to/below RESTOCK_AT (low-water
 *  trigger, high-water fill). The shared CakeStall driver does the stealing:
 *  golden stand, outcome classification, refusal-streak reset — no Baker
 *  line-of-sight prediction (see the 2026-07-20 cakethiever design). A guard
 *  catch returns 'combat' and the Flee/FightBack task owns it next loop. */
class RestockCakes implements Task {
    constructor(private bot: ArdyThiever) {}
    validate(): boolean {
        return nearMarket() && !this.bot.inRealCombat() && !Inventory.isFull() && foodCount() <= RESTOCK_AT;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        this.bot.log(`restocking cake (have ${foodCount()})`);
        await stealCakes({
            fillTo: FOOD_TARGET,
            abort: () => EventSignal.pending() || this.bot.died || ChatDialog.canContinue() || this.bot.inRealCombat(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, foodCount()),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal()
        });
    }
}
```

(No `lockedOutUntil` plumbing here — the driver self-heals off the lockout chat line; ArdyThiever's stun/combat machinery stays untouched.)

- [ ] **Step 2: Prune the dead logic + its tests**

In `src/bot/scripts/ArdyThieverLogic.ts`: delete the `Point` interface, `lineClear`, and `ownerWatching` (everything from `export interface Point {` to the end of `ownerWatching`), and drop the now-unused `import { chebyshev } from '../nav/followMath.js';`.

In `test/scripts/ardythiever-logic.test.ts`: remove `lineClear, ownerWatching` from the import line and delete the entire `describe('ownerWatching (Baker stall-owner catch)', ...)` block (which also contains the `lineClear` tests).

Then verify nothing else references them: `rg -n "ownerWatching|lineClear" src test tools` → expect zero hits.

- [ ] **Step 3: Typecheck + full suite**

Run: `bunx tsc --noEmit -p tsconfig.json` and `bun test 2>&1 | tail -3` (0 fail).

- [ ] **Step 4: Live smoke ArdyThiever**

Run: `bun tools/ardythiever-test.ts`
Expected: PASS — its watch already covers the restock → pickpocket cycle; the restock lines now come from the shared driver (`stocked N stall food`). If the harness greps an old log string that no longer appears (check its `seen` patterns against the driver's messages), update the harness patterns in the same commit.

- [ ] **Step 5: Commit**

```bash
git add src/bot/scripts/ArdyThiever.ts src/bot/scripts/ArdyThieverLogic.ts test/scripts/ardythiever-logic.test.ts tools/ardythiever-test.ts
git commit -m "refactor(scripts): ArdyThiever restock rides the shared cake-stall driver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Only add `tools/ardythiever-test.ts` if Step 4 actually changed it.)

---

### Task 6: Backport — ArdyFighter's RestockCakes onto the driver, delete StallOwner

**Files:**
- Modify: `src/bot/scripts/ArdyFighter.ts` (settings ~lines 61–82, module state ~lines 86–105, onStart reads ~lines 148–167, `RestockCakes` ~lines 358–424)
- Delete: `src/bot/scripts/StallOwner.ts` (its only consumer was ArdyFighter)

**Interfaces:**
- Consumes: `stealCakes` (Task 2), `CAKE_ITEMS` (Task 1).
- Produces: ArdyFighter public surface minus the six stall settings (`stallTile`, `stallStand`, `stallName`, `stallOwner`, `ownerDodgeTile`, `ownerRange`); `StallOwner.ts` gone.

- [ ] **Step 1: Swap RestockCakes + drop the stall configuration**

In `src/bot/scripts/ArdyFighter.ts`:

1. Imports: remove `import { dodgeStallOwner, ownerNearStall } from './StallOwner.js';` and the `Locs` import (only RestockCakes used it). Add:

```ts
import { stealCakes } from './CakeStall.js';
```

2. SETTINGS: delete the six entries `stallTile`, `stallStand`, `stallName`, `stallOwner`, `ownerDodgeTile`, `ownerRange` (the stall layout was never really configurable — the shared driver bakes it).

3. Constants/module state: delete `DEFAULT_STALL`, `DEFAULT_STALL_STAND`, `DEFAULT_OWNER_DODGE`, `STALL_OP`, and the module vars `STALL_TILE`, `STALL_STAND`, `STALL_NAME`, `STALL_OWNER`, `OWNER_DODGE`, `OWNER_RANGE`, plus their six `this.settings.*` reads in `onStart` and the `stall ${STALL_TILE}` fragment in the start log line (use `stall via shared driver`).

4. Replace the ENTIRE `RestockCakes` class with:

```ts
/**
 * Steal food from the Baker's stall until stocked, via the shared CakeStall
 * driver (golden stand, outcome classification, refusal-streak reset — see
 * the 2026-07-20 cakethiever design). A guard with line of sight catches the
 * theft and attacks — that pull is WELCOME here: the driver returns 'combat',
 * this task ends, and server-side auto-retaliate + the Fight task finish the
 * guard (Fight.validate requires !Game.inCombat(), so it never initiates
 * against an already-attacking guard). The engine's 10-tick post-combat
 * lockout is handled inside the driver.
 */
class RestockCakes implements Task {
    constructor(private bot: ArdyFighter) {}
    validate(): boolean {
        return !Game.inCombat() && !Inventory.isFull() && shouldRestock(foodCount(), FOOD_TARGET);
    }
    async execute(): Promise<void> {
        this.bot.setStatus('restocking at the Baker\'s stall');
        await stealCakes({
            fillTo: FOOD_TARGET,
            abort: () => EventSignal.pending() || this.bot.died || ChatDialog.canContinue(),
            shouldEat: () => shouldEat(Skills.hpFraction(), EAT_AT, foodCount()),
            setStatus: s => this.bot.setStatus(s),
            log: m => this.bot.log(m),
            onSteal: () => this.bot.countSteal()
        });
    }
}
```

Note: `abort` deliberately omits `Game.inCombat()` — the driver's own combat check turns it into the `'combat'` return (the guard-pull mechanism), identical either way but the return reason is honest.

5. Delete `src/bot/scripts/StallOwner.ts`, then verify: `rg -n "StallOwner|dodgeStallOwner|ownerNearStall" src test tools` → zero hits.

6. Check the smoke harnesses for the removed settings: `rg -n "stallTile|stallStand|stallName|stallOwner|ownerDodge|ownerRange" tools/` — if any `tools/ardyfighter-*.ts` sets them (URL params or `rs2b0t:set:` keys), delete those lines in the same commit.

- [ ] **Step 2: Typecheck + full suite**

Run: `bunx tsc --noEmit -p tsconfig.json` and `bun test 2>&1 | tail -3` (0 fail).

- [ ] **Step 3: Live smoke ArdyFighter**

Run: `bun tools/ardyfighter-test.ts`
Expected: PASS — kills + restock cycle. Same caveat as Task 5 Step 4: if the harness greps old restock log strings, update its patterns.

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/ArdyFighter.ts tools/ardyfighter-test.ts
git rm src/bot/scripts/StallOwner.ts
git commit -m "refactor(scripts): ArdyFighter restock rides the shared cake-stall driver, drop StallOwner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Only add `tools/ardyfighter-test.ts` if Step 3 actually changed it.)

---

## Final verification (after Task 6)

- [ ] `bun test 2>&1 | tail -3` — 0 fail.
- [ ] `bunx tsc --noEmit -p tsconfig.json` — no output.
- [ ] `rg -n "ownerWatching|lineClear|dodgeStallOwner|StallOwner|STALL_STAND" src tools test` — zero hits (the prediction machinery is gone).
- [ ] All three smokes passed live this session: `cakethiever-test.ts` (both modes), `ardythiever-test.ts`, `ardyfighter-test.ts`.
- [ ] Report the per-bot live evidence (log excerpts: `stocked`, `banked`, any `resetting at`, any guard response) back to the user before pushing; push only on their say-so or per standing instruction.
