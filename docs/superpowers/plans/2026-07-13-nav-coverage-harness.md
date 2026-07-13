# Nav-tile Coverage Harness + Bank-tile Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline harness that flags every tile a bot web-walks to that is a sealed nook/island in the baked collision graph (unreachable by walking), plus the fix repointing EssMiner's bank stand — the one genuine offender — to a connected tile.

**Architecture:** Pure classification logic (`coverageLogic.ts`) over an injected `ReachChecker` (unit-tested with a stub), a curated `navTargets.ts` registry of the tiles bots navigate to, and a `tools/nav/coverage.ts` tool that adapts the real `PathFinder` into a `ReachChecker`, classifies every target, prints each bad tile with a suggested nearest-connected replacement, and exits non-zero on any *unexpected* failure. Then EssMiner's `BANK_STAND` is repointed to the connected tile the harness suggests. Spec: `docs/superpowers/specs/2026-07-13-nav-coverage-harness-design.md`.

**Tech Stack:** TypeScript (bun), bun:test, the real `PathFinder` over `out/collision.lcnav.gz` (a `build:bot` artifact).

## Global Constraints

- Scope: create `src/bot/nav/coverageLogic.ts`, `test/bot/nav/coverageLogic.test.ts`, `src/bot/nav/data/navTargets.ts`, `tools/nav/coverage.ts`; modify `src/bot/scripts/EssMiner.ts` (one constant). Nothing else.
- Classification is exact-tile (no radius-5 snap): `walkable(tile)` is `PathFinder.walkable`; `connected(tile, anchor)` is `PathFinder.findPath(tile, anchor, undefined, BUDGET).ok` — `findPath`'s start snaps via `snapWalkable(from, 2)`, which returns the tile itself when walkable, so a walkable tile that can't reach the anchor is a genuine island.
- The gate fails only on **unexpected** bad tiles; registry entries may carry `expected: 'island'` for known-handled cases (the RuneMysteries wizard-tower basement `(3104,9576)`, a ladder-hop landing in a separate underground region the quest bot handles via trapped-landing recovery).
- Every code task must leave `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before its commit (suite currently 312 passing).
- Commit straight to `main`, conventional-commit subjects (`feat(nav): ...`), and end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Comments state constraints the code can't show — no "changed X" narration.
- The anchor for connectivity is Lumbridge `(3221,3218,0)` (deep in the main component); `BUDGET = 1_000_000` (generous — a genuinely connected short-range target resolves in ~20k expansions, so budget-exhaustion ⇒ island).
- `out/collision.lcnav.gz` is produced by `bun run build:bot` (build it before running `coverage.ts`).

## File Structure

- `src/bot/nav/coverageLogic.ts` — pure: `ReachChecker`, `TargetKind`, `classifyTarget`, `nearestConnected`. Client-free (imports only `NavPoint` type). Unit-tested.
- `test/bot/nav/coverageLogic.test.ts` — pure unit tests with a stub `ReachChecker`.
- `src/bot/nav/data/navTargets.ts` — the curated `NAV_TARGETS` registry.
- `tools/nav/coverage.ts` — the tool: `PathFinder` → `ReachChecker` adapter, runs the classification, prints, exits.
- `src/bot/scripts/EssMiner.ts` — repoint `BANK_STAND`.

---

### Task 1: Pure coverage logic — `coverageLogic.ts` (TDD)

**Files:**
- Create: `src/bot/nav/coverageLogic.ts`
- Test: `test/bot/nav/coverageLogic.test.ts`

**Interfaces:**
- Consumes: `NavPoint` type (`{ x: number; z: number; level: number }`) from `#/bot/nav/PathFinder.js`.
- Produces (Task 2 consumes these exact signatures):
  - `interface ReachChecker { walkable(x: number, z: number, level: number): boolean; connected(from: NavPoint, anchor: NavPoint): boolean }`
  - `type TargetKind = 'ok' | 'unwalkable' | 'island'`
  - `function classifyTarget(rc: ReachChecker, target: NavPoint, anchor: NavPoint): TargetKind`
  - `function nearestConnected(rc: ReachChecker, tile: NavPoint, anchor: NavPoint, maxRing: number): NavPoint | null`

- [ ] **Step 1: Write the failing test**

Create `test/bot/nav/coverageLogic.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { classifyTarget, nearestConnected, type ReachChecker } from '#/bot/nav/coverageLogic.js';

// Stub world: a set of walkable tiles + a set of tiles connected to the anchor.
// key = "x,z,level".
function stub(walkable: Set<string>, connected: Set<string>): ReachChecker {
    const k = (x: number, z: number, l: number): string => `${x},${z},${l}`;
    return {
        walkable: (x, z, l) => walkable.has(k(x, z, l)),
        connected: (from) => connected.has(k(from.x, from.z, from.level))
    };
}
const A: NavPoint = { x: 0, z: 0, level: 0 };

describe('classifyTarget', () => {
    test('unwalkable tile → unwalkable (connectivity not even consulted)', () => {
        const rc = stub(new Set(), new Set(['5,5,0']));
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('unwalkable');
    });
    test('walkable but not connected → island', () => {
        const rc = stub(new Set(['5,5,0']), new Set());
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('island');
    });
    test('walkable and connected → ok', () => {
        const rc = stub(new Set(['5,5,0']), new Set(['5,5,0']));
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('ok');
    });
});

describe('nearestConnected', () => {
    test('returns the nearest walkable+connected ring tile', () => {
        // (5,5) is the island; (6,5) walkable+connected at ring 1.
        const rc = stub(new Set(['5,5,0', '6,5,0']), new Set(['6,5,0']));
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 6, z: 5, level: 0 });
    });
    test('prefers a closer ring over a farther one', () => {
        // ring-1 (5,6) connected AND ring-2 (7,5) connected → ring-1 wins.
        const rc = stub(new Set(['5,6,0', '7,5,0']), new Set(['5,6,0', '7,5,0']));
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 5, z: 6, level: 0 });
    });
    test('a walkable-but-unconnected neighbour is skipped', () => {
        const rc = stub(new Set(['6,5,0', '5,6,0']), new Set(['5,6,0'])); // (6,5) walkable but not connected
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 5, z: 6, level: 0 });
    });
    test('boxed in (nothing connected within maxRing) → null', () => {
        const rc = stub(new Set(['5,5,0']), new Set());
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 3)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/bot/nav/coverageLogic.test.ts`
Expected: FAIL — cannot resolve `coverageLogic.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/nav/coverageLogic.ts`:

```ts
import type { NavPoint } from '#/bot/nav/PathFinder.js';

/**
 * Pure coverage classification for nav-target tiles (client-free → runs under
 * plain `bun test`). Injected `ReachChecker` so the logic is testable against a
 * synthetic world; the real tool wraps a `PathFinder` (walkable = exact-tile
 * walkability, connected = findPath(tile, anchor).ok, which uses the exact tile
 * as the start because PathFinder snaps a walkable start to itself).
 */
export interface ReachChecker {
    walkable(x: number, z: number, level: number): boolean;
    connected(from: NavPoint, anchor: NavPoint): boolean;
}

export type TargetKind = 'ok' | 'unwalkable' | 'island';

/** A nav-target is `unwalkable` (not a floor tile), an `island` (walkable but
 *  cannot reach the anchor — a sealed nook/pocket), or `ok`. */
export function classifyTarget(rc: ReachChecker, target: NavPoint, anchor: NavPoint): TargetKind {
    if (!rc.walkable(target.x, target.z, target.level)) {
        return 'unwalkable';
    }
    if (!rc.connected(target, anchor)) {
        return 'island';
    }
    return 'ok';
}

/** Nearest walkable tile (Chebyshev rings outward from `tile`, up to `maxRing`)
 *  that IS connected to the anchor — the suggested replacement for a flagged
 *  tile. Same level as `tile`. Null if none within `maxRing`. */
export function nearestConnected(rc: ReachChecker, tile: NavPoint, anchor: NavPoint, maxRing: number): NavPoint | null {
    for (let r = 1; r <= maxRing; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) {
                    continue;
                }
                const c: NavPoint = { x: tile.x + dx, z: tile.z + dz, level: tile.level };
                if (rc.walkable(c.x, c.z, c.level) && rc.connected(c, anchor)) {
                    return c;
                }
            }
        }
    }
    return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/bot/nav/coverageLogic.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full check + commit**

Run: `bunx tsc --noEmit && bunx eslint src/bot/nav/coverageLogic.ts test/bot/nav/coverageLogic.test.ts && bun test`
Expected: clean; suite up from 312 by 7.

```bash
git add src/bot/nav/coverageLogic.ts test/bot/nav/coverageLogic.test.ts
git commit -m "feat(nav): pure nav-target coverage classification + tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Registry + coverage tool

**Files:**
- Create: `src/bot/nav/data/navTargets.ts`
- Create: `tools/nav/coverage.ts`

**Interfaces:**
- Consumes (Task 1): `classifyTarget`, `nearestConnected`, `ReachChecker` from `../../src/bot/nav/coverageLogic.js`.
- Consumes (existing): `PathFinder` (`walkable(x,z,level)`, `findPath(from, to, avoid?, maxExpansions)`), `NavPoint`, `DoorEdgeData` from `#/bot/nav/PathFinder.js`; `doors.json`/`transports.json`; the `out/collision.lcnav.gz` pack (load like `tools/nav/bench-path.ts`).
- Produces: `NAV_TARGETS: NavTarget[]` and a runnable `tools/nav/coverage.ts` exiting non-zero on any unexpected non-`ok` target.

- [ ] **Step 1: Create the registry `src/bot/nav/data/navTargets.ts`**

```ts
import type { NavPoint } from '../PathFinder.js';

/**
 * Tiles bots web-walk to (bank stands, skill-station stands, quest stands).
 * The coverage harness (tools/nav/coverage.ts) checks each is walkable AND
 * connected to the main graph, so a sealed-nook config (a tile a bot can't
 * actually reach by walking) is caught. Hand-maintained: when a bot adds a
 * nav-target constant, add it here. `expected:'island'` marks a KNOWN,
 * runtime-handled island so the gate fails only on NEW offenders.
 */
export interface NavTarget {
    bot: string;
    label: string;
    tile: NavPoint;
    expected?: 'island';
}

export const NAV_TARGETS: NavTarget[] = [
    // NOTE: this entry starts at the KNOWN-BAD nook tile so the harness proves it
    // catches it (Task 2 run FAILs here); Task 3 repoints it to (3251,3420).
    { bot: 'EssMiner', label: 'Varrock East bank stand', tile: { x: 3253, z: 3418, level: 0 } },
    { bot: 'ArdyThiever/ArdyFighter', label: 'Ardougne south bank stand', tile: { x: 2655, z: 3286, level: 0 } },
    { bot: 'ArdyFighter', label: "Baker's stall stand", tile: { x: 2668, z: 3312, level: 0 } },
    { bot: 'CookBot', label: 'Catherby bank stand', tile: { x: 2809, z: 3441, level: 0 } },
    { bot: 'CookBot', label: 'Catherby range stand', tile: { x: 2817, z: 3443, level: 0 } },
    { bot: 'SmelterBot', label: 'Al Kharid furnace stand', tile: { x: 3275, z: 3185, level: 0 } },
    { bot: 'SmithingBot', label: 'Varrock West anvil stand', tile: { x: 3188, z: 3425, level: 0 } },
    { bot: 'BankFletcher', label: 'Varrock West bank stand', tile: { x: 3185, z: 3440, level: 0 } },
    { bot: 'FlaxSpinner', label: 'Seers bank stand', tile: { x: 2722, z: 3493, level: 0 } },
    { bot: 'FlaxPicker', label: 'Seers bank stand', tile: { x: 2725, z: 3493, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'Edgeville bank stand', tile: { x: 3094, z: 3491, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'trapdoor stand', tile: { x: 3096, z: 3468, level: 0 } },
    { bot: 'RockCrab', label: 'Rellekka area', tile: { x: 2586, z: 3420, level: 0 } },
    { bot: 'RuneMysteries', label: 'wizard-tower surface ladder stand', tile: { x: 3105, z: 3162, level: 0 } },
    // KNOWN island: the wizard-tower BASEMENT ladder landing is a separate
    // underground region reached via the ladder transport; RuneMysteries handles
    // the trapped-landing at runtime (climb-up re-roll). Expected, not a defect.
    { bot: 'RuneMysteries', label: 'wizard-tower basement ladder landing', tile: { x: 3104, z: 9576, level: 0 }, expected: 'island' }
];
```

- [ ] **Step 2: Create the tool `tools/nav/coverage.ts`**

```ts
// Offline nav-target coverage check (sibling of bench-path.ts). Verifies every
// tile a bot web-walks to (src/bot/nav/data/navTargets.ts) is walkable AND
// connected to the main graph in the baked collision pack, so a sealed-nook
// config is caught. Prints each bad tile + the nearest connected replacement.
// Exits non-zero on any UNEXPECTED non-ok target (expected:'island' entries are
// documented known cases and do not fail the gate).
//
// Prereq: bun run build:bot (produces out/collision.lcnav.gz).
// Usage: bun tools/nav/coverage.ts [--pack out/collision.lcnav.gz] [--anchor 3221,3218]

import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '../../src/bot/nav/data/doors.json';
import transportsJson from '../../src/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/nav/PathFinder.js';
import { NAV_TARGETS } from '../../src/bot/nav/data/navTargets.js';
import { classifyTarget, nearestConnected, type ReachChecker } from '../../src/bot/nav/coverageLogic.js';

const BUDGET = 1_000_000;
const MAX_RING = 8;

const args = process.argv.slice(2);
const optVal = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let packPath = optVal('--pack') ?? 'out/collision.lcnav.gz';
const anchorArg = optVal('--anchor');
const anchor: NavPoint = anchorArg
    ? { x: Number(anchorArg.split(',')[0]), z: Number(anchorArg.split(',')[1]), level: 0 }
    : { x: 3221, z: 3218, level: 0 };

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) { bytes = gunzipSync(bytes); }
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson);

const rc: ReachChecker = {
    walkable: (x, z, level) => finder.walkable(x, z, level),
    connected: (from, a) => finder.findPath(from, a, undefined, BUDGET).ok
};

console.log(`nav-target coverage: ${NAV_TARGETS.length} targets, anchor (${anchor.x},${anchor.z},${anchor.level}), pack ${packPath}`);
let failures = 0;
for (const t of NAV_TARGETS) {
    const kind = classifyTarget(rc, t.tile, anchor);
    if (kind === 'ok') {
        console.log(`ok        ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level})`);
        continue;
    }
    if (t.expected === kind) {
        console.log(`expected  ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level}): ${kind} (known/handled)`);
        continue;
    }
    const near = nearestConnected(rc, t.tile, anchor, MAX_RING);
    console.log(`FAIL      ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level}): ${kind}; nearest connected = ${near ? `(${near.x},${near.z},${near.level})` : 'none within ' + MAX_RING}`);
    failures++;
}
console.log(failures === 0 ? '\nall nav-targets reachable (or expected)' : `\n${failures} unreachable nav-target(s)`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Verify tsc/eslint, then run the harness — it must CATCH the nook**

Run: `bunx tsc --noEmit && bunx eslint src/bot/nav/data/navTargets.ts tools/nav/coverage.ts && bun test`
Expected: clean.

Then (build the pack first): `bun run build:bot >/dev/null 2>&1; bun tools/nav/coverage.ts; echo "exit $?"`
Expected: every target `ok`, the RuneMysteries basement `expected`, and **exactly one FAIL** proving the harness works:
`FAIL      EssMiner — Varrock East bank stand (3253,3418,0): island; nearest connected = (3251,3420,0)` and `exit 1`. (Task 3 repoints it; then the tool exits 0.) If any OTHER target FAILs, stop and report it — the registry data or a real new nook needs attention before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/bot/nav/data/navTargets.ts tools/nav/coverage.ts
git commit -m "feat(nav): nav-target registry + offline coverage tool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Repoint EssMiner's bank stand + verify (harness → green)

**Files:**
- Modify: `src/bot/scripts/EssMiner.ts` (the `BANK_STAND` constant)
- Modify: `src/bot/nav/data/navTargets.ts` (the EssMiner entry → the fixed tile)

**Interfaces:**
- Consumes: the harness's Task-2 finding — `(3253,3418)` is an island; nearest connected `(3251,3420)`.
- Produces: EssMiner banking that walks to a connected approach tile, then OPLOCs the booth (unchanged `openBooth` flow); the coverage tool exits 0.

- [ ] **Step 1: Repoint `BANK_STAND` — `src/bot/scripts/EssMiner.ts`**

Find the line:

```ts
const BANK_STAND = new Tile(3253, 3418, 0);
```

Replace with:

```ts
// (3253,3418) — directly south of the booths — is a sealed collision nook
// (booths wall it north, building walls south), unreachable by walking (nav
// coverage harness). (3251,3420) is the nearest connected tile; banking is
// OPLOC-first (openBooth), so the walk only needs a reachable approach and the
// server-walk finishes onto the booth.
const BANK_STAND = new Tile(3251, 3420, 0);
```

- [ ] **Step 2: Update the registry entry — `src/bot/nav/data/navTargets.ts`**

Replace the EssMiner entry (and drop the now-stale "starts at the known-bad nook" note) with the fixed tile:

```ts
    { bot: 'EssMiner', label: 'Varrock East bank stand', tile: { x: 3251, z: 3420, level: 0 } },
```

- [ ] **Step 3: Verify tsc/eslint/tests + the harness now passes clean**

Run: `bunx tsc --noEmit && bunx eslint src/bot/scripts/EssMiner.ts src/bot/nav/data/navTargets.ts && bun test`
Expected: clean; suite 319 (312 + Task 1's 7).

Then: `bun run build:bot >/dev/null 2>&1; bun tools/nav/coverage.ts; echo "exit $?"`
Expected: all targets `ok`, RuneMysteries basement `expected`, `exit 0` (the EssMiner FAIL is gone).

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/EssMiner.ts src/bot/nav/data/navTargets.ts
git commit -m "fix(essminer): bank stand to a connected tile (3251,3420) — 3253,3418 is a nook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Live no-regression — EssMiner loop from the new stand**

Ensure the engine is up (`curl -s -o /dev/null -w '%{http_code}' http://localhost:8890/bot.html` → `200`; else `cd ~/code/rs2b2t-engine && npm run quickstart`), then deploy + run:

```bash
cd ~/code/rs2b0t && ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
bun tools/essminer-test.ts
```

Expected: `PASS` — the double cycle still completes (mine → full → portal → bank at the new stand → re-teleport, pickaxe retained). The bank deposit now works from a walk-reachable approach tile plus the booth OPLOC.

- [ ] **Step 6: Confirm the coverage tool is documented for future runs**

The tool is offline and needs the built pack (like `bench-path.ts`), so it's run manually / in a build step, not in the browser-smoke `run-all-smokes` sweep. Confirm its header documents `bun run build:bot` + `bun tools/nav/coverage.ts`. No code change; this step is a doc/verification check that the usage comment at the top of `tools/nav/coverage.ts` is accurate.
