# Ladder-Behind-Wall Reach Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop bots from standing outside a building and clicking a ladder/staircase that sits just inside the wall ("I can't reach that!" loop) — fix the wall-blind gates in the shared walker and turn the server's can't-reach message into a first-class fast-fail signal.

**Architecture:** Three independent layers, all following the repo's established "replace raw Chebyshev with a live-collision reachability probe" pattern (the same pattern as the door-arrival fix in `arrival.ts` and the wall-nibble `cardinalGoals` fix in `PathFinder.ts`):

1. **Crossing-trigger gate (root cause).** `WalkExecutor.followPath` fires `handleTransport` on horizontal Chebyshev ≤ 4 to a crossing's tiles — wall-blind. A baked stair edge whose operate tile is just inside a house wall triggers while the bot is still outside, the ladder click fails server-side, two 8s waits burn, `failedDoor` blacklists the ladder, and `walkResilient` restarts the loop forever. Gate the trigger on live reachability of the approach tile (`adjacentOk` so a swung-open door leaf on the approach tile — the shape-9 diagonal-door mechanic — still fires).
2. **Game-message watermark (the user's "dead giveaway").** The server's `I can't reach that!` arrives as a MESSAGE_GAME packet; `BotHost.handlePacket` already sees every packet opcode and `chatText[0]` holds the just-added line. Record type-0 game messages into a monotonic-seq ring (`GameMessages`), and make `handleTransport`/`crossMultiTileDoor` waits complete instantly on a fresh can't-reach instead of burning the 8–20s timeout. Failure semantics unchanged (existing `failedDoor` + repath).
3. **Wall-aware arrival for unwalkable dests (hardening).** `isArrived`'s `!walkable(dest)` fallback is pure Chebyshev, so `walkTo(ladderTile)` declares "arrived" the moment the bot passes within radius *outside* the wall. For in-scene unwalkable dests, require reaching a wall-open cardinally-adjacent tile (`canReach` with `adjacentOk`); keep old Chebyshev semantics when the dest can't be probed (out of scene) so nothing hangs.

**Tech Stack:** TypeScript, `bun test` (pure modules with injected probes — no client imports in tests), existing `Reachability`/`localReach` BFS.

## Global Constraints

- Never touch `src/client/**` (the adapter reads client internals; the client stays unpatched). `src/client/GameShell.ts` has the user's uncommitted in-progress work — do not stage or modify it.
- Commit with explicit file lists only (`git add <files>`), never `git add -A` — the user commits concurrently on this checkout. Check `git log` before each commit.
- All new decision logic must be pure/testable (injected probe callbacks), matching `arrival.ts` / `followMath.ts` / `walkLadder.ts` idioms. No client imports in `.test.ts` files.
- Comments state constraints the code can't show, in the repo's existing voice; match density of the file you're editing.
- Run `bun test src/bot` before each commit (PathFinder.test.ts is pack-gated and skips itself when the collision pack is absent — from the main checkout it runs).
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `GameMessages` ring + BotHost wiring

**Files:**
- Create: `src/bot/events/gameMessages.ts`
- Create: `src/bot/events/gameMessages.test.ts`
- Modify: `src/bot/BotHost.ts` (handlePacket, ~line 73)

**Interfaces:**
- Consumes: `reader.chat(1)` → `ChatLine { type: number; username: string | null; text: string }` (ClientAdapter.ts:33), `ServerProt.MESSAGE_GAME = 161`.
- Produces (used by Task 4):
  - `GameMessages.mark(): number` — current watermark (0 before any message).
  - `GameMessages.record(text: string): void` — BotHost-only feed.
  - `GameMessages.sawSince(mark: number, pattern: RegExp): boolean`
  - `GameMessages.since(mark: number): { seq: number; text: string }[]`
  - `CANT_REACH: RegExp` — matches the server's `I can't reach that!`.

- [ ] **Step 1: Write the failing test**

`src/bot/events/gameMessages.test.ts`:

```ts
import { describe, expect, test, beforeEach } from 'bun:test';
import { GameMessages, CANT_REACH } from './gameMessages.js';

describe('GameMessages', () => {
    beforeEach(() => GameMessages.reset());

    test('mark starts at 0 and advances per record', () => {
        expect(GameMessages.mark()).toBe(0);
        GameMessages.record('Welcome to RuneScape');
        expect(GameMessages.mark()).toBe(1);
    });

    test('sawSince only sees messages recorded after the mark', () => {
        GameMessages.record("I can't reach that!");
        const mark = GameMessages.mark();
        expect(GameMessages.sawSince(mark, CANT_REACH)).toBe(false);
        GameMessages.record("I can't reach that!");
        expect(GameMessages.sawSince(mark, CANT_REACH)).toBe(true);
    });

    test('identical repeated texts are distinct messages', () => {
        GameMessages.record('x');
        const mark = GameMessages.mark();
        GameMessages.record('x');
        GameMessages.record('x');
        expect(GameMessages.since(mark).length).toBe(2);
    });

    test('ring caps at 64 but seq keeps climbing', () => {
        for (let i = 0; i < 70; i++) {
            GameMessages.record(`m${i}`);
        }
        expect(GameMessages.mark()).toBe(70);
        expect(GameMessages.since(0).length).toBe(64);
        expect(GameMessages.since(0)[0].text).toBe('m6');
    });

    test('CANT_REACH matches the live server line', () => {
        expect(CANT_REACH.test("I can't reach that!")).toBe(true);
        expect(CANT_REACH.test('You can reach that')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/events/gameMessages.test.ts`
Expected: FAIL — `Cannot find module './gameMessages.js'`

- [ ] **Step 3: Write minimal implementation**

`src/bot/events/gameMessages.ts`:

```ts
// Monotonic feed of type-0 server game messages ("I can't reach that!",
// "Nothing interesting happens", ...). BotHost records one entry per
// MESSAGE_GAME packet; consumers snapshot mark() before an interaction and
// poll sawSince(mark, pattern) to react to a message CAUSED by that
// interaction. A plain ring diff can't do this — the chat ring holds bare
// strings, and the interesting lines repeat verbatim — hence the seq.
// Pure module (no client imports) so it runs under plain `bun test`.

export interface GameMessage {
    seq: number;
    text: string;
}

/** The server's reach-failure line for an unreachable interaction target. */
export const CANT_REACH = /^i can't reach that/i;

const CAP = 64;

class GameMessagesImpl {
    private ring: GameMessage[] = [];
    private lastSeq = 0;

    /** BotHost-only: append one just-arrived game message. */
    record(text: string): void {
        this.ring.push({ seq: ++this.lastSeq, text });
        if (this.ring.length > CAP) {
            this.ring.shift();
        }
    }

    /** Watermark: seq of the newest message so far (0 = none yet). */
    mark(): number {
        return this.lastSeq;
    }

    /** Messages recorded strictly after `mark`, oldest first. */
    since(mark: number): GameMessage[] {
        return this.ring.filter(m => m.seq > mark);
    }

    /** Any message after `mark` matching `pattern`? */
    sawSince(mark: number, pattern: RegExp): boolean {
        return this.ring.some(m => m.seq > mark && pattern.test(m.text));
    }

    /** Test-only: drop all state. */
    reset(): void {
        this.ring = [];
        this.lastSeq = 0;
    }
}

export const GameMessages = new GameMessagesImpl();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/events/gameMessages.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire BotHost**

In `src/bot/BotHost.ts`, add imports:

```ts
import { attach as adapterAttach, reader, setPacketListener } from './adapter/ClientAdapter.js';
import { GameMessages } from './events/gameMessages.js';
```

(`reader` is added to the existing ClientAdapter import.) Replace `handlePacket`:

```ts
    private handlePacket(ptype: number): void {
        if (ptype === ServerProt.MESSAGE_GAME) {
            // addChat ran synchronously during this packet, so the new line is
            // ring slot 0. Type-0 only: tradereq/duelreq suffixed messages add
            // type-4 lines (or, when the sender is ignored, none at all — the
            // one case where slot 0 is a stale type-0 line; a rare duplicate
            // record there is benign, consumers just fail an attempt fast and
            // repath).
            const line = reader.chat(1)[0];
            if (line && line.type === 0) {
                GameMessages.record(line.text);
            }
            return;
        }

        if (ptype !== ServerProt.PLAYER_INFO) {
            return;
        }

        this.tickCount++;

        const now = performance.now();
        if (this.lastTickAt > 0) {
            this.tickIntervals.push(now - this.lastTickAt);
            if (this.tickIntervals.length > 10) {
                this.tickIntervals.shift();
            }
        }
        this.lastTickAt = now;
    }
```

- [ ] **Step 6: Full suite + commit**

Run: `bun test src/bot`
Expected: PASS (all existing + 5 new)

```bash
git add src/bot/events/gameMessages.ts src/bot/events/gameMessages.test.ts src/bot/BotHost.ts
git commit -m "feat(nav): monotonic GameMessages feed off the MESSAGE_GAME packet hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wall-aware arrival for unwalkable dests

**Files:**
- Modify: `src/bot/nav/arrival.ts`
- Create: `src/bot/nav/arrival.test.ts`
- Modify: `src/bot/api/Reachability.ts` (arrivalProbe, ~line 70)

**Interfaces:**
- Consumes: `canReachLocal(..., { adjacentOk: true })` semantics (localReach.ts:118 — succeeds on reaching a tile CARDINALLY adjacent to the target with no wall between).
- Produces: `ArrivalProbe` gains two members every probe supplier must implement:
  - `canReachAdjacent(t: NavPoint): boolean` — BFS reaches a wall-open cardinal neighbour of `t`.
  - `probeable(t: NavPoint): boolean` — `t` is same-level, in scene, flags readable.

  All four `isArrived` gates get the new members for free via `Reachability.arrivalProbe()`.

- [ ] **Step 1: Write the failing test**

`src/bot/nav/arrival.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isArrived, type ArrivalProbe } from './arrival.js';

const at = (x: number, z: number, level = 0): { x: number; z: number; level: number } => ({ x, z, level });

function probe(p: Partial<ArrivalProbe>): ArrivalProbe {
    return {
        canReach: () => false,
        walkable: () => false,
        canReachAdjacent: () => false,
        probeable: () => true,
        ...p
    };
}

describe('isArrived', () => {
    test('standing on the dest tile is always arrival', () => {
        expect(isArrived(at(5, 5), at(5, 5), 0, probe({}))).toBe(true);
    });

    test('walkable dest within radius: arrival needs canReach', () => {
        const walkable = probe({ walkable: () => true });
        expect(isArrived(at(5, 5), at(6, 5), 2, walkable)).toBe(false);
        expect(isArrived(at(5, 5), at(6, 5), 2, probe({ walkable: () => true, canReach: () => true }))).toBe(true);
    });

    test('unwalkable dest beside me with no wall between: arrived (bank booth)', () => {
        const booth = probe({ canReachAdjacent: () => true });
        expect(isArrived(at(5, 5), at(6, 5), 2, booth)).toBe(true);
    });

    test('unwalkable dest through a wall: NOT arrived (the ladder-in-a-house case)', () => {
        const ladderBehindWall = probe({ canReachAdjacent: () => false, probeable: () => true });
        expect(isArrived(at(5, 5), at(6, 5), 2, ladderBehindWall)).toBe(false);
    });

    test('unwalkable dest the scene cannot probe keeps Chebyshev semantics', () => {
        const outOfScene = probe({ probeable: () => false });
        expect(isArrived(at(5, 5), at(6, 5), 2, outOfScene)).toBe(true);
    });

    test('outside radius / cross-level never arrives', () => {
        const anything = probe({ canReach: () => true, canReachAdjacent: () => true });
        expect(isArrived(at(0, 0), at(9, 0), 2, anything)).toBe(false);
        expect(isArrived(at(5, 5, 1), at(6, 5, 0), 2, anything)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/nav/arrival.test.ts`
Expected: FAIL — TypeScript/shape errors (`canReachAdjacent`/`probeable` not in `ArrivalProbe`) and/or the through-a-wall case asserting `false` but getting `true`.

- [ ] **Step 3: Implement**

`src/bot/nav/arrival.ts` — extend the probe and the predicate (full new file body below the unchanged header comment; update that header's last paragraph too):

```ts
// Reachability-aware arrival — the ONE predicate every walk gate shares
// (WalkExecutor.walkTo early-return + followPath arrived check, Traversal
// .walkResilient's withinRadius, DirectNavigator.walkTo). Pure module: callers
// inject an ArrivalProbe over whatever surface they have (the live scene in
// production, a stub in tests), so no client import leaks in and it runs under
// plain `bun test`.
//
// Why it exists: arrival used to be pure Chebyshev — a bot standing `radius`
// tiles from dest across a CLOSED door returned `true` in 0.0s with zero
// movement (live-confirmed H1), then wedged running interaction loops it could
// never satisfy. Arrival now additionally demands the dest be REACHABLE through
// the current collision map. An unwalkable dest (booth/counter/rock/ladder)
// can never be stood on, so for those "reachable" means a wall-open tile
// CARDINALLY beside it — plain Chebyshev there let a bot outside a house
// "arrive" at a ladder just inside the wall and click it through the wall
// forever ("I can't reach that!"). Only a dest the scene can't probe at all
// (out of scene) falls back to the old Chebyshev gate, so a legitimately
// unprobeable target never becomes a never-arrives hang.

import type { NavPoint } from './PathFinder.js';
import { chebyshev } from './followMath.js';

/** Live "can I stand where I'm aiming?" surface, injected so `isArrived` stays
 *  pure/testable. In production all four wrap the current scene CollisionMap
 *  (`Reachability.arrivalProbe()`). */
export interface ArrivalProbe {
    /** BFS over the current collision map reaches `t` from the player. */
    canReach(t: NavPoint): boolean;
    /** `t` is a stand-able floor tile (not a whole-tile blocker). */
    walkable(t: NavPoint): boolean;
    /** BFS reaches a tile CARDINALLY beside `t` with no wall between — the
     *  stand an interaction with an unwalkable `t` could be issued from. */
    canReachAdjacent(t: NavPoint): boolean;
    /** The scene can read collision at `t` (same level, in scene). False means
     *  the other probe answers are vacuous, not "blocked". */
    probeable(t: NavPoint): boolean;
}

/**
 * Arrived ⟺ same level ∧ Chebyshev(me,dest) ≤ radius ∧ dest genuinely
 * reachable: canReach for a walkable dest, canReachAdjacent for an unwalkable
 * one (interact stands only), Chebyshev-only when the scene can't probe dest.
 * Standing exactly on dest (cheb 0) is always arrival and short-circuits
 * before the probe — `canReachLocal(from==to)` is degenerate and being on the
 * tile IS arrival regardless.
 */
export function isArrived(me: NavPoint, dest: NavPoint, radius: number, probe: ArrivalProbe): boolean {
    if (me.level !== dest.level) {
        return false;
    }
    const dist = chebyshev(me, dest);
    if (dist > radius) {
        return false;
    }
    if (dist === 0) {
        return true; // standing on the tile IS arrival, always
    }
    if (probe.canReach(dest)) {
        return true;
    }
    if (probe.walkable(dest)) {
        return false; // stand-able but unreachable (closed door between) — keep walking
    }
    // Unwalkable target: arrived only from a stand an interact could use — a
    // wall-open cardinal neighbour. Unprobeable (out of scene) keeps the old
    // Chebyshev semantics so it can't hang a walk.
    return !probe.probeable(dest) || probe.canReachAdjacent(dest);
}
```

`src/bot/api/Reachability.ts` — extend `arrivalProbe()` and add the two live implementations inside the `Reachability` object (after `walkable`):

```ts
    /** The scene can read collision at `dest` — same level and inside the
     *  loaded area. Distinguishes "blocked" from "can't even look": walkable()
     *  is false for both, and arrival treats them differently. */
    probeable(dest: WorldTile): boolean {
        const me = reader.worldTile();
        if (!me || me.level !== dest.level) {
            return false;
        }
        const to = reader.toLocal(dest.x, dest.z);
        return to !== null && reader.collisionFlags(to.lx, to.lz) !== null;
    },

    /** The live ArrivalProbe (canReach bounded to ARRIVAL_MAX_STEPS + walkable
     *  + adjacency for unwalkable targets) the four walk gates feed to the
     *  shared `isArrived` predicate. */
    arrivalProbe(): ArrivalProbe {
        return {
            canReach: t => Reachability.canReach(t, { maxSteps: ARRIVAL_MAX_STEPS }),
            walkable: t => Reachability.walkable(t),
            canReachAdjacent: t => Reachability.canReach(t, { maxSteps: ARRIVAL_MAX_STEPS, adjacentOk: true }),
            probeable: t => Reachability.probeable(t)
        };
    }
```

(The old two-member `arrivalProbe()` body is replaced by this four-member one.)

- [ ] **Step 4: Run tests**

Run: `bun test src/bot/nav/arrival.test.ts && bun test src/bot`
Expected: PASS — new suite green; no other suite regresses (the only ArrivalProbe suppliers are `Reachability.arrivalProbe()` and the new test's stub).

- [ ] **Step 5: Commit**

```bash
git add src/bot/nav/arrival.ts src/bot/nav/arrival.test.ts src/bot/api/Reachability.ts
git commit -m "fix(nav): arrival at an unwalkable dest requires a wall-open adjacent stand

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Reach-gate the crossing trigger

**Files:**
- Modify: `src/bot/nav/followMath.ts` (new pure predicate)
- Modify: `src/bot/nav/followMath.test.ts` (new cases)
- Modify: `src/bot/nav/WalkExecutor.ts` (crossing scan ~line 339-346, new const ~line 70)

**Interfaces:**
- Consumes: `PathTileLike { x; z; level }`, `chebyshev` (followMath.ts), `Reachability.canReach(t, { maxSteps, adjacentOk })`.
- Produces: `crossingEligible(me: PathTileLike, approach: PathTileLike, far: PathTileLike, trigger: number, reachable: (t: PathTileLike) => boolean): boolean` — the full trigger decision (level + proximity + reachability), reachability callback called last (short-circuit: BFS only runs when proximate).

- [ ] **Step 1: Write the failing test**

Append to `src/bot/nav/followMath.test.ts` (match the file's existing import/describe style):

```ts
describe('crossingEligible', () => {
    const t = (x: number, z: number, level = 0): PathTileLike => ({ x, z, level });
    const approach = t(10, 10);
    const far = t(10, 11, 1); // stair hop: far endpoint on the level above

    test('fires when proximate to the approach tile and it is reachable', () => {
        expect(crossingEligible(t(8, 8), approach, far, 4, () => true)).toBe(true);
    });

    test('fires on proximity to the far tile too (horizontal), approach reachable', () => {
        expect(crossingEligible(t(10, 14), approach, far, 4, () => true)).toBe(true);
    });

    test('does NOT fire when the approach tile is unreachable (ladder behind a wall)', () => {
        expect(crossingEligible(t(9, 10), approach, far, 4, () => false)).toBe(false);
    });

    test('does NOT fire from a different level than the approach', () => {
        expect(crossingEligible(t(10, 9, 1), approach, far, 4, () => true)).toBe(false);
    });

    test('does NOT run the reach probe when out of trigger range', () => {
        let probed = false;
        expect(
            crossingEligible(t(30, 30), approach, far, 4, () => {
                probed = true;
                return true;
            })
        ).toBe(false);
        expect(probed).toBe(false);
    });
});
```

Add `crossingEligible` to the existing `./followMath.js` import in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/nav/followMath.test.ts`
Expected: FAIL — `crossingEligible` is not exported.

- [ ] **Step 3: Implement the predicate**

Append to `src/bot/nav/followMath.ts`:

```ts
/**
 * Should followPath hand this crossing to handleTransport yet? Proximity alone
 * (the old rule) is wall-blind: a baked stair edge whose operate tile sits just
 * INSIDE a house wall came within trigger range of a bot walking past OUTSIDE,
 * and the resulting through-the-wall ladder click could never resolve ("I
 * can't reach that!" → 2x8s waits → the ladder blacklisted → repath → forever).
 * `reachable` (live-collision canReach with adjacentOk, injected) must accept
 * the approach tile too — adjacentOk so a swung-open door leaf FLAGGING the
 * approach tile (shape-9 diagonal doors) still fires. Checked last so the BFS
 * only runs when proximate.
 */
export function crossingEligible(me: PathTileLike, approach: PathTileLike, far: PathTileLike, trigger: number, reachable: (t: PathTileLike) => boolean): boolean {
    if (me.level !== approach.level) {
        return false;
    }
    if (chebyshev(me, approach) > trigger && chebyshev(me, far) > trigger) {
        return false;
    }
    return reachable(approach);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/nav/followMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into followPath**

`src/bot/nav/WalkExecutor.ts`:

Add to the consts block (after `STALL_REACH_STEPS`, ~line 40):

```ts
// canReach BFS budget for the crossing-trigger gate: is the crossing's
// approach tile actually attainable from here, or merely Chebyshev-close
// through a wall? Bounded like STALL_REACH_STEPS; runs at most once per loop
// iteration and only when a crossing is proximate.
const TRIGGER_REACH_STEPS = 256;
```

Extend the followMath import (line 26):

```ts
import { chebyshev, crossingEligible, isOnFarSide, locateOnPath, selectClickTarget } from './followMath.js';
```

Replace the crossing-proximity scan body (lines 339-346; the long comment above it stays, with one sentence appended):

```ts
            // ... (existing comment block) ...
            // Reach-gated: Chebyshev proximity alone is wall-blind, so a stair
            // operate tile just inside a house wall used to fire from OUTSIDE
            // (see crossingEligible).
            let crossingIdx = -1;
            const approachable = (t: WorldTile): boolean => Reachability.canReach(t, { maxSteps: TRIGGER_REACH_STEPS, adjacentOk: true });
            const scanHi = Math.min(tiles.length, pathIdx + PROGRESS_WINDOW);
            for (let i = Math.max(1, pathIdx - 5); i < scanHi; i++) {
                if (tiles[i].transport && crossingEligible(me, tiles[i - 1], tiles[i], TRANSPORT_TRIGGER, approachable)) {
                    crossingIdx = i;
                    break;
                }
            }
```

(The old inline `me.level === tiles[i - 1].level && (chebyshev(...) <= TRANSPORT_TRIGGER || chebyshev(...) <= TRANSPORT_TRIGGER)` condition is subsumed by `crossingEligible`. An ineligible crossing is simply skipped this iteration — the walker keeps clicking along the path toward the door/route that eventually makes the approach reachable, at which point the trigger fires. A crossing gated forever is eventually handled by the existing stall → repath machinery.)

- [ ] **Step 6: Full suite + commit**

Run: `bun test src/bot`
Expected: PASS.

```bash
git add src/bot/nav/followMath.ts src/bot/nav/followMath.test.ts src/bot/nav/WalkExecutor.ts
git commit -m "fix(nav): crossing trigger requires a reachable approach tile, not bare proximity

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fast-fail crossings on a fresh "I can't reach that!"

**Files:**
- Modify: `src/bot/nav/WalkExecutor.ts` (`handleTransport` ~line 501-549, `crossMultiTileDoor` ~line 580-590)

**Interfaces:**
- Consumes: `GameMessages.mark()`, `GameMessages.sawSince(mark, CANT_REACH)`, `CANT_REACH` from `src/bot/events/gameMessages.js` (Task 1).
- Produces: no new exports — behavioral change only: a can't-reach reply makes the current crossing attempt fail in ~1 tick instead of `TRANSPORT_WAIT_MS`, and skips the second attempt (the server just proved this stand can't reach the loc; re-clicking from the same tile gives the same answer). Failure then flows through the existing `failedDoor` + repath path.

- [ ] **Step 1: Modify `handleTransport`'s attempt loop**

Add the import at the top of WalkExecutor.ts:

```ts
import { CANT_REACH, GameMessages } from '../events/gameMessages.js';
```

In `handleTransport`, wrap each interact with a watermark and extend each wait; replace the body of the `for (let attempt = 0; attempt < 2; attempt++)` loop from the `if (!loc.interact(...))` check down to the retry log line with:

```ts
            const mark = GameMessages.mark();
            if (!loc.interact(transport.action)) {
                log(`'${transport.action}' not offered by ${transport.locName} (ops: ${loc.actions().join(', ')})`);
                return false;
            }

            const cantReach = (): boolean => GameMessages.sawSince(mark, CANT_REACH);
            let crossed: boolean;
            if (transport.toLevel !== undefined) {
                const toLevel = transport.toLevel;
                crossed = (await Execution.delayUntil(() => reader.worldTile()?.level === toLevel || cantReach(), TRANSPORT_WAIT_MS)) && reader.worldTile()?.level === toLevel;
            } else if (transport.toTile !== undefined) {
                // teleport crossing (dungeon trapdoor/ladder z±6400): the script
                // telejumps the player's own tile, so we land NEAR the edge's to
                // tile, not on it — arrival is proximity on the same level
                const toTile = transport.toTile;
                const landed = (): boolean => {
                    const me = reader.worldTile();
                    return me !== null && me.level === step.level && chebyshev(me, toTile) <= 3;
                };
                crossed = (await Execution.delayUntil(() => landed() || cantReach(), TRANSPORT_WAIT_MS)) && landed();
            } else {
                const open = (): boolean => this.findTransportLoc(transport) === null || Reachability.canStep(approach, step);
                crossed = (await Execution.delayUntil(() => open() || cantReach(), TRANSPORT_WAIT_MS)) && open();
            }
            if (crossed) {
                log(`${transport.action} ${transport.locName} at (${transport.locX},${transport.locZ}) ok`);
                return true;
            }
            if (cantReach()) {
                // The server just told us the loc is unreachable from this stand
                // — a second click from the same tile gives the same answer.
                // Fail now; failedDoor + repath find another way in.
                log(`server says can't reach ${transport.locName} at (${transport.locX},${transport.locZ}) — repathing`);
                return false;
            }
            log(`${transport.action} ${transport.locName} did not resolve, retrying`);
```

- [ ] **Step 2: Modify `crossMultiTileDoor`'s open-wait**

In the `if (shut)` branch, snapshot before the interact and cut the wait short on the message (a can't-reach here means the door leaf itself was unreachable — bail to the caller's repath instead of spinning the full budget):

```ts
            const shut = this.findTransportLoc(transport);
            if (shut) {
                // closed (first arrival) or reverted mid-cross — open it and let
                // the open register before trying to step through
                const mark = GameMessages.mark();
                if (!shut.interact(transport.action)) {
                    log(`'${transport.action}' not offered by ${transport.locName} (ops: ${shut.actions().join(', ')})`);
                    return false;
                }
                await Execution.delayUntil(() => this.findTransportLoc(transport) === null || GameMessages.sawSince(mark, CANT_REACH), TRANSPORT_WAIT_MS);
                if (GameMessages.sawSince(mark, CANT_REACH)) {
                    log(`server says can't reach ${transport.locName} — repathing`);
                    return false;
                }
                continue;
            }
```

- [ ] **Step 3: Full suite**

Run: `bun test src/bot`
Expected: PASS (no unit coverage reaches these driver-coupled paths; the live smoke in Task 5 exercises them).

- [ ] **Step 4: Commit**

```bash
git add src/bot/nav/WalkExecutor.ts
git commit -m "feat(nav): crossings fail fast on the server's 'I can't reach that!' reply

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Verification — repro-site audit + live walk

**Files:**
- Create (scratchpad, not committed): `wall-adjacent-stairs.ts` audit script
- No source changes.

- [ ] **Step 1: Enumerate real repro sites**

Write a scratchpad script that loads the baked pack the same way `PathFinder.test.ts` does (copy its pack-loading preamble), then for each `stairEdges.json` entry checks whether the operate (`from`) tile has a wall on any edge nibble (`wallMask(from) !== 0`) or a wall-adjacent neighbour — printing edges whose operate tile hugs a wall. Pick 2-3 near Lumbridge/Varrock as live-verify targets and note the nearest upstairs tile above each.

- [ ] **Step 2: Check for a live wall before launching anything**

Run: `ps aux | rg -i "playwright|chromium|b0t" | rg -v rg`
If the user's multibox wall / cluebot session is running from this checkout, DO NOT rebuild or deploy — report the prepared verify commands and stop (smoke deploys clobber the live build; see memory).

- [ ] **Step 3: Live verify (only if clear)**

Start `bun run b0t`, position the account outside one audited house (start-anywhere or reload after `::tele` — headless tele leaves the scene un-rebuilt), and `walkTo` the upstairs tile above the wall-adjacent ladder. Confirm in the live log:
- The crossing does NOT fire while outside (no ladder click through the wall, no "I can't reach that!" in chat).
- The walker routes through the door, the crossing fires inside, the level changes, walk arrives.
- As a regression check, re-run one known shape-9 diagonal-door route (Juliet's mansion entrance or the wizard-tower door) to confirm swung-leaf crossings still fire.

- [ ] **Step 4: Update memory + report**

Record the outcome (verified sites, any residue) in the session summary; update the door-nav memory file if the fix ships live-verified.

---

## Self-Review

- **Spec coverage:** root cause (wall-blind trigger) → Task 3; the user's chat-giveaway ask → Tasks 1+4; the arrival-fallback hole that lets script-level walks "arrive" outside the wall → Task 2; end-to-end proof on real geometry → Task 5. ✓
- **Placeholders:** none — every step carries the actual code/commands. ✓
- **Type consistency:** `GameMessages.mark/sawSince/since/record/reset` used identically in Tasks 1 and 4; `ArrivalProbe.canReachAdjacent/probeable` defined in Task 2 and only consumed there; `crossingEligible` signature matches between followMath.ts and its test. `reader.chat` returns `ChatLine[]` with `type/username/text` — matched. ✓
- **Ordering note:** Tasks 1-3 are independent; Task 4 depends on Task 1. Task 2 (arrival) and Task 3 (trigger) both attack the reported symptom — Task 3 is the root cause for baked-path walks, Task 2 for walk-at-loc scripts.
