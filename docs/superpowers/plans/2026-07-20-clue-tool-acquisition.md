# Clue Tool Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the medium clue solver would abandon a dig for lack of a Spade or a coordinate dig for lack of the Sextant/Watch/Chart, acquire the missing tools in-game (nearer of the Ardougne/Falador spade spawns; the professor→Murphy→Kojo→professor chain) and only abandon if acquisition genuinely can't complete.

**Architecture:** A pure data+logic module (`data/toolAcquire.ts`) holds the spawn tiles, the three NPC stops, and the `nextCoordTool` decision function. A client-coupled module (`AcquireTools.ts`) exposes `ensureSpade()` and `ensureCoordTools()`, built on the same `gotoNpc`/`talkThrough` primitives the talk-clue step already uses. `ClueExecutor` calls them as a pre-abandon safety net in its `blockReason` gate; `SolveClue.bankFirst` calls them proactively when the held scroll is a coordinate clue.

**Tech Stack:** TypeScript (bun), `bun:test` with `mock.module`, Playwright smoke harness, local engine at `~/code/rs2b2t-engine`.

## Global Constraints

- Test runner: `bun test` (full suite must stay green — 676 tests as of this branch). Typecheck: `bunx tsc --noEmit -p tsconfig.json` (no output = pass).
- `bun:test` `mock.module` LEAKS across files in one run. Mock only leaf client singletons, with their full used surface. Do NOT stub shared modules (`primitives.js`, `ClueLogic.js`) — real code runs; observe effects through mocked leaves (see `src/bot/clues/ClueExecutor.test.ts` header for the precedent).
- The user commits concurrently on this checkout: `git add` exact paths only, NEVER `git add -A`. Check `git log --oneline -1` before each commit.
- Commit messages: conventional, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Engine facts (verified, do NOT re-derive): the dig needs all three trio items HELD (`spade.rs2`); the chart comes from the **professor**, not the assistant; all four NPCs gate on holding a coordinate clue (`has_sextant_clue`); `trail_status` is server-only (drive off held obj ids). Obj display names: `Spade`, `Sextant`, `Watch`, `Chart`.
- Locations (NPC spawn tiles; the anchor is a probe-verified adjacent WALKABLE tile — Task 1 gives starting values, Task 6 verifies): professor (2438,3186,0), Murphy (2668,3162,0), Kojo (2569,3249,0). Spade spawns: W.Ardougne (2574,3331,0), Falador (2981,3369,0).
- `Tile.distanceTo` is **chebyshev** (`Math.max(|dx|,|dz|)`). Nearer-spade selection uses it (cheap; the two spawns are ~410 tiles apart so straight-line always picks the right region).
- Live smokes deploy over the local web build (`tools/deploy-local.sh`, `ENGINE_DIR=~/code/rs2b2t-engine`). If a live wall/fleet runs from this checkout, don't deploy without the user's OK.

---

### Task 1: toolAcquire data + `nextCoordTool` logic

**Files:**
- Create: `src/bot/clues/data/toolAcquire.ts`
- Test: `src/bot/clues/data/toolAcquire.test.ts`

**Interfaces:**
- Consumes: `Tile` from `#/bot/api/Tile.js`; `NpcStop` from `#/bot/quests/exec/primitives.js`.
- Produces (Tasks 2, 3 import from `#/bot/clues/data/toolAcquire.js`):
  - `SPADE_NAME='Spade'`, `TRIO=['Sextant','Watch','Chart'] as const`
  - `SPADE_SPAWNS: Tile[]` (two tiles)
  - `type CoordTool = 'sextant'|'watch'|'chart'`
  - `interface HeldTrio { sextant: boolean; watch: boolean; chart: boolean }`
  - `nextCoordTool(held: HeldTrio): CoordTool | null`
  - `PROFESSOR: NpcStop`, `MURPHY: NpcStop`, `KOJO: NpcStop` (npc, anchor, leash, prefer)

- [ ] **Step 1: Write the failing test**

`src/bot/clues/data/toolAcquire.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';

import { nextCoordTool, SPADE_SPAWNS, SPADE_NAME, TRIO, PROFESSOR, MURPHY, KOJO } from './toolAcquire.js';

describe('nextCoordTool (item-keyed chain order)', () => {
    test('nothing held -> sextant first', () => {
        expect(nextCoordTool({ sextant: false, watch: false, chart: false })).toBe('sextant');
    });
    test('sextant held, no watch -> watch', () => {
        expect(nextCoordTool({ sextant: true, watch: false, chart: false })).toBe('watch');
    });
    test('sextant+watch held, no chart -> chart', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: false })).toBe('chart');
    });
    test('all three held -> null (done)', () => {
        expect(nextCoordTool({ sextant: true, watch: true, chart: true })).toBe(null);
    });
    test('strict order: a held watch without a sextant still asks for the sextant first', () => {
        // the server chain is strictly ordered — you cannot get a watch before a sextant
        expect(nextCoordTool({ sextant: false, watch: true, chart: false })).toBe('sextant');
    });
});

describe('data sanity', () => {
    test('two spade spawns, Ardougne and Falador, far apart', () => {
        expect(SPADE_SPAWNS.length).toBe(2);
        expect(SPADE_SPAWNS[0].distanceTo(SPADE_SPAWNS[1])).toBeGreaterThan(300);
    });
    test('trio + spade names', () => {
        expect(TRIO).toEqual(['Sextant', 'Watch', 'Chart']);
        expect(SPADE_NAME).toBe('Spade');
    });
    test('three NPC stops with distinct anchors and a Treasure-Trails preference', () => {
        const anchors = [PROFESSOR, MURPHY, KOJO].map(s => `${s.anchor.x},${s.anchor.z}`);
        expect(new Set(anchors).size).toBe(3);
        expect(PROFESSOR.prefer.join(' ').toLowerCase()).toContain('treasure');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/clues/data/toolAcquire.test.ts`
Expected: FAIL — `Cannot find module './toolAcquire.js'`

- [ ] **Step 3: Write the implementation**

`src/bot/clues/data/toolAcquire.ts`:

```ts
import Tile from '#/bot/api/Tile.js';
import type { NpcStop } from '#/bot/quests/exec/primitives.js';

/**
 * Data + pure logic for acquiring the clue tools the medium solver otherwise
 * abandons on (2026-07-20 design). No client imports — runs under plain
 * `bun test`. The client-coupled walking/talking lives in AcquireTools.ts.
 *
 * Engine truths (rs2b2t-content, verified): the coordinate dig hard-requires
 * Sextant+Watch+Chart HELD (general_use/spade.rs2); the chain is a strict
 * server order professor -> Murphy(sextant) -> Kojo(watch) -> professor(chart),
 * all gated on holding a coordinate clue (`has_sextant_clue`). The bot drives
 * off held obj ids only (`trail_status` is server-only).
 */

export const SPADE_NAME = 'Spade';
export const TRIO = ['Sextant', 'Watch', 'Chart'] as const;

/** Ground spawns of obj 952 (Spade). Nearer one is chosen at runtime. */
export const SPADE_SPAWNS: Tile[] = [
    new Tile(2574, 3331, 0), // West Ardougne house
    new Tile(2981, 3369, 0) // Falador
];

export type CoordTool = 'sextant' | 'watch' | 'chart';

export interface HeldTrio {
    sextant: boolean;
    watch: boolean;
    chart: boolean;
}

/**
 * Next tool to acquire given what's held, in the engine's strict chain order:
 * sextant, then watch, then chart. Null when all three are held. A held
 * later-item without its predecessor still returns the predecessor — the
 * server won't hand out a watch before the sextant step is done.
 */
export function nextCoordTool(held: HeldTrio): CoordTool | null {
    if (!held.sextant) {
        return 'sextant';
    }
    if (!held.watch) {
        return 'watch';
    }
    if (!held.chart) {
        return 'chart';
    }
    return null;
}

// NPC stops for gotoNpc/talkThrough. Anchors are the NPC spawn tiles (gotoNpc
// arrives within 1 and talkThrough re-finds within leash). Probe-verified in
// the plan's Task 6; adjust here if a spawn tile isn't a walkable stand.
// prefer lists drive talkThrough through whichever branch the server shows
// (first-time learn vs. lost-item), so both cases need no code branching.
export const PROFESSOR: NpcStop = {
    npc: 'Observatory professor',
    anchor: new Tile(2438, 3186, 0),
    leash: 10,
    prefer: ['Treasure Trails', 'lost', 'navigation', 'sextant', 'watch']
};
export const MURPHY: NpcStop = {
    npc: 'Murphy',
    anchor: new Tile(2668, 3162, 0),
    leash: 10,
    prefer: ['sextant', 'lost']
};
export const KOJO: NpcStop = {
    npc: 'Brother Kojo',
    anchor: new Tile(2569, 3249, 0),
    leash: 10,
    prefer: ['watch', 'lost']
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/clues/data/toolAcquire.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `bun test 2>&1 | tail -3` (0 fail) and `bunx tsc --noEmit -p tsconfig.json` (no output).

```bash
git add src/bot/clues/data/toolAcquire.ts src/bot/clues/data/toolAcquire.test.ts
git commit -m "feat(clues): tool-acquisition data + nextCoordTool chain logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `ensureSpade` + `ensureCoordTools` driver

**Files:**
- Create: `src/bot/clues/AcquireTools.ts`
- Test: `src/bot/clues/AcquireTools.test.ts`

**Interfaces:**
- Consumes: Task 1's exports; `gotoNpc`/`talkThrough` from `#/bot/quests/exec/primitives.js`; client singletons (`Game`, `Execution`, `EventSignal`, `Inventory`, `Traversal`, `GroundItems`).
- Produces (Tasks 3, 4 import from `#/bot/clues/AcquireTools.js`):
  - `heldTrio(): HeldTrio`
  - `hasAllTrio(): boolean`
  - `hasCoordClueHeld(): boolean` (a held clue with `needsSextant`)
  - `ensureSpade(log: (m: string) => void): Promise<boolean>`
  - `ensureCoordTools(log: (m: string) => void): Promise<boolean>`

**Reference — GroundItem API** (from `entities/index.ts`): `.id`, `.name`, `.tile()`, `.distance()`, `.interact('Take')`. EntityQuery: `.where(pred).nearest()`.

- [ ] **Step 1: Write the failing test**

`src/bot/clues/AcquireTools.test.ts`:

```ts
import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '#/bot/api/Tile.js';

// Mocked-world tests. gotoNpc/talkThrough are the REAL primitives; we mock the
// leaf singletons they and the driver reach. talkThrough success is scripted by
// giving the tool item the moment the right NPC's dialogue is driven.

let held: string[]; // inventory item names
let clueNeedsSextant: boolean; // a coord clue is in the pack
let playerTile: Tile;
let walks: string[]; // walkResilient/walkTo dests "x,z"
let talkedTo: string[]; // npc names talkThrough drove
let groundSpades: Tile[]; // spade ground items in scene
let takes: number;
let npcByName: Record<string, { x: number; z: number }>; // spawns for gotoNpc's re-find

mock.module('#/bot/api/Game.js', () => ({ Game: { tile: () => playerTile, ingame: () => true, inCombat: () => false } }));
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
        delayTicks: async (): Promise<void> => {}
    }
}));
mock.module('#/bot/api/EventSignal.js', () => ({ EventSignal: { pending: () => false } }));
mock.module('#/bot/api/hud/Inventory.js', () => ({
    Inventory: {
        items: () => held.map((name, i) => ({ id: i + 1, name, count: 1, slot: i })),
        first: (name: string) => held.includes(name) ? { name } : null,
        count: (name: string) => held.filter(n => n === name).length
    }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        },
        walkTo: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        }
    }
}));
mock.module('#/bot/api/queries/GroundItems.js', () => ({
    GroundItems: {
        query: () => {
            let list = groundSpades.map(t => ({
                id: 952, name: 'Spade', tile: () => t, distance: () => t.distanceTo(playerTile),
                interact: async (): Promise<boolean> => { takes++; groundSpades = groundSpades.filter(g => g !== t); held.push('Spade'); return true; }
            }));
            const chain = {
                where: (p: (g: typeof list[number]) => boolean) => { list = list.filter(p); return chain; },
                nearest: () => list.sort((a, b) => a.distance() - b.distance())[0] ?? null
            };
            return chain;
        }
    }
}));
// gotoNpc + talkThrough are real; they reach Npcs + ChatDialog. Stub those so a
// talk "drives" by recording the npc and, if the server would give a tool here,
// dropping it into `held`. gotoNpc uses Game.tile()/Traversal (mocked) and
// Npcs (stub returns the spawn so npcNear() passes).
mock.module('#/bot/api/queries/Npcs.js', () => ({
    Npcs: {
        query: () => {
            let name = '';
            const chain = {
                name: (n: string) => { name = n; return chain; },
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => {
                    const s = npcByName[name];
                    return s ? { name, tile: () => new Tile(s.x, s.z, 0), distance: () => new Tile(s.x, s.z, 0).distanceTo(playerTile), interact: async () => true } : null;
                }
            };
            return chain;
        }
    }
}));

const { ensureSpade, ensureCoordTools } = await import('./AcquireTools.js');

beforeEach(() => {
    held = [];
    clueNeedsSextant = true;
    playerTile = new Tile(2660, 3300, 0); // Ardougne market-ish
    walks = [];
    talkedTo = [];
    groundSpades = [];
    takes = 0;
    npcByName = {
        'Observatory professor': { x: 2438, z: 3186 },
        'Murphy': { x: 2668, z: 3162 },
        'Brother Kojo': { x: 2569, z: 3249 }
    };
    void clueNeedsSextant; void talkedTo;
});

describe('ensureSpade', () => {
    test('already held -> true, no walk', async () => {
        held = ['Spade'];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks).toEqual([]);
    });
    test('walks to the NEARER spawn and takes the spade', async () => {
        playerTile = new Tile(2600, 3320, 0); // closer to Ardougne (2574,3331) than Falador (2981,3369)
        groundSpades = [new Tile(2574, 3331, 0)];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks[0]).toBe('2574,3331'); // Ardougne, not Falador
        expect(takes).toBe(1);
        expect(held).toContain('Spade');
    });
    test('picks Falador when closer', async () => {
        playerTile = new Tile(2950, 3360, 0);
        groundSpades = [new Tile(2981, 3369, 0)];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks[0]).toBe('2981,3369');
    });
    test('no spade at the spawn -> false', async () => {
        playerTile = new Tile(2600, 3320, 0);
        groundSpades = []; // none in scene at either
        expect(await ensureSpade(() => {})).toBe(false);
    });
});

describe('ensureCoordTools', () => {
    test('all three held -> true immediately', async () => {
        held = ['Sextant', 'Watch', 'Chart'];
        expect(await ensureCoordTools(() => {})).toBe(true);
        expect(walks).toEqual([]);
    });
    test('none held -> professor then Murphy yields the sextant, and so on to the chart', async () => {
        // Scripted server: the tool appears when its giver is reached in order.
        // We simulate by having ensureCoordTools drive talkThrough; the stubbed
        // Npcs.interact returns true and we inject the tool per-hop via a walk hook.
        // Simplest: patch talk to grant on arrival — done here by spawn proximity.
        // Grant sextant once we've walked to Murphy, watch at Kojo, chart at professor(2nd).
        // (Implementation grants happen inside talkThrough's real drive over the
        //  mocked ChatDialog; see AcquireTools — this test asserts the WALK order.)
        expect(await ensureCoordTools(() => {})).toBe(false); // no ChatDialog mock -> talks can't complete
        // But it must have tried the professor FIRST (learn), then Murphy.
        expect(walks[0]).toBe('2438,3186'); // professor
        expect(walks).toContain('2668,3162'); // Murphy
    });
    test('sextant+watch held -> goes straight to the professor for the chart', async () => {
        held = ['Sextant', 'Watch'];
        await ensureCoordTools(() => {});
        expect(walks[0]).toBe('2438,3186'); // professor only
        expect(walks).not.toContain('2668,3162'); // no Murphy
        expect(walks).not.toContain('2569,3249'); // no Kojo
    });
});
```

Note: the "none held" chain test asserts **walk order** (deterministic from `nextCoordTool`), not tool delivery — delivery needs a ChatDialog mock, which the live smoke (Task 6) covers end-to-end. Keep the unit test at the walk-order level.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/clues/AcquireTools.test.ts`
Expected: FAIL — `Cannot find module './AcquireTools.js'`

- [ ] **Step 3: Write the implementation**

`src/bot/clues/AcquireTools.ts`:

```ts
import { Execution } from '#/bot/api/Execution.js';
import { EventSignal } from '#/bot/api/EventSignal.js';
import { Game } from '#/bot/api/Game.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
import { gotoNpc, talkThrough } from '#/bot/quests/exec/primitives.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import {
    KOJO, MURPHY, PROFESSOR, SPADE_NAME, SPADE_SPAWNS, TRIO,
    nextCoordTool, type HeldTrio
} from '#/bot/clues/data/toolAcquire.js';

/**
 * Acquire the clue tools the medium solver otherwise abandons on (2026-07-20
 * design): a Spade for any dig, and the Sextant/Watch/Chart for a coordinate
 * dig. Best-effort — return false and the caller falls back to graceful
 * abandon. Both functions are idempotent (verify the item is HELD before
 * returning true) and re-entrant on a random-event yield (the primitives bail
 * on EventSignal.pending()).
 */

const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 120_000;
const TAKE_WAIT_MS = 3000;
const TOOL_WAIT_MS = 3000; // for a talk-given tool to land in the pack

/** Which of the trio are held right now. */
export function heldTrio(): HeldTrio {
    return {
        sextant: Inventory.first('Sextant') !== null,
        watch: Inventory.first('Watch') !== null,
        chart: Inventory.first('Chart') !== null
    };
}

export function hasAllTrio(): boolean {
    return TRIO.every(n => Inventory.first(n) !== null);
}

/** A held clue that needs the sextant trio (gates the NPC chain server-side). */
export function hasCoordClueHeld(): boolean {
    return Inventory.items().some(i => CLUE_DB[i.id]?.needsSextant === true);
}

/** Get a Spade into the pack via the nearer of the two ground spawns. */
export async function ensureSpade(log: (m: string) => void): Promise<boolean> {
    if (Inventory.first(SPADE_NAME) !== null) {
        return true;
    }
    const here = Game.tile();
    // Nearest spawn first, then the other as a fallback (chebyshev; the two are
    // ~410 tiles apart so straight-line reliably picks the right region).
    const spawns = here
        ? [...SPADE_SPAWNS].sort((a, b) => a.distanceTo(here) - b.distanceTo(here))
        : SPADE_SPAWNS;
    for (const spawn of spawns) {
        if (EventSignal.pending()) {
            return false;
        }
        log(`acquiring a spade — walking to (${spawn.x},${spawn.z})`);
        await Traversal.walkResilient(spawn, { radius: 1, attempts: WALK_ATTEMPTS, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
        const spade = GroundItems.query().where(g => g.id === 952 || (g.name ?? '').toLowerCase() === 'spade').nearest();
        if (spade) {
            if (spade.distance() > 1) {
                await Traversal.walkResilient(spade.tile(), { radius: 1, attempts: 2, timeoutMs: WALK_TIMEOUT_MS, log: m => log(`  ${m}`) });
            }
            await spade.interact('Take');
            if (await Execution.delayUntil(() => Inventory.first(SPADE_NAME) !== null, TAKE_WAIT_MS)) {
                log('got a spade');
                return true;
            }
        }
        log(`no spade at (${spawn.x},${spawn.z}) — trying the next spawn`);
    }
    return false;
}

/** Walk the professor->Murphy->Kojo->professor chain for the missing tools.
 *  Precondition: a coordinate clue is in the pack (else every NPC no-ops). */
export async function ensureCoordTools(log: (m: string) => void): Promise<boolean> {
    if (hasAllTrio()) {
        return true;
    }
    if (!hasCoordClueHeld()) {
        log('coord-tool chain needs a coordinate clue held — skipping');
        return false;
    }
    // Bounded: the chain is 3 acquisitions; cap re-tries so a stuck hop abandons.
    for (let guard = 0; guard < 8 && !hasAllTrio(); guard++) {
        if (EventSignal.pending()) {
            return false; // yield; caller re-enters at the same held-item state
        }
        const need = nextCoordTool(heldTrio());
        if (need === null) {
            break;
        }
        // sextant needs the professor 'learn' first, then Murphy hands it over;
        // watch = Kojo; chart = professor (2nd visit). One hop per loop; verify
        // the expected item landed before advancing.
        if (need === 'sextant') {
            log('coord-tools: learning from the professor, then Murphy for the sextant');
            if (await gotoNpc(PROFESSOR, [], log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            if (EventSignal.pending()) {
                return false;
            }
            if (await gotoNpc(MURPHY, [], log)) {
                await talkThrough(MURPHY.npc, MURPHY.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Sextant') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Sextant') === null) {
                log('coord-tools: Murphy did not yield a sextant — abandoning the chain');
                return false;
            }
        } else if (need === 'watch') {
            log('coord-tools: Brother Kojo for the watch');
            if (await gotoNpc(KOJO, [], log)) {
                await talkThrough(KOJO.npc, KOJO.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Watch') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Watch') === null) {
                log('coord-tools: Kojo did not yield a watch — abandoning the chain');
                return false;
            }
        } else {
            log('coord-tools: back to the professor for the chart');
            if (await gotoNpc(PROFESSOR, [], log)) {
                await talkThrough(PROFESSOR.npc, PROFESSOR.prefer, log);
            }
            await Execution.delayUntil(() => Inventory.first('Chart') !== null, TOOL_WAIT_MS);
            if (Inventory.first('Chart') === null) {
                log('coord-tools: the professor did not yield a chart — abandoning the chain');
                return false;
            }
        }
    }
    return hasAllTrio();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/clues/AcquireTools.test.ts`
Expected: PASS. If the "none held" chain test's `walks[0]` isn't `2438,3186`, the loop is not visiting the professor first — fix the ordering, not the test.

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `bun test 2>&1 | tail -3` and `bunx tsc --noEmit -p tsconfig.json`.

```bash
git add src/bot/clues/AcquireTools.ts src/bot/clues/AcquireTools.test.ts
git commit -m "feat(clues): ensureSpade + ensureCoordTools acquisition driver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire acquisition into ClueExecutor's abandon gate

**Files:**
- Modify: `src/bot/clues/ClueExecutor.ts` (imports; the `blockReason` gate at ~line 502-506)
- Test: `src/bot/clues/ClueExecutor.test.ts` (add a case; file already exists)

**Interfaces:**
- Consumes: `ensureSpade`, `ensureCoordTools` from `#/bot/clues/AcquireTools.js`.
- Produces: no new exports; behavior change — a blocked dig attempts acquisition before abandoning.

- [ ] **Step 1: Add the import**

In `src/bot/clues/ClueExecutor.ts`, after the existing `import ... from '#/bot/clues/data/killAnchors.js';` line:

```ts
import { ensureSpade, ensureCoordTools } from '#/bot/clues/AcquireTools.js';
```

- [ ] **Step 2: Add the acquisition attempt in the blockReason gate**

Replace this block (~line 502):

```ts
            const blocked = blockReason(step);
            if (blocked) {
                tlog(`abandoning ${describeStep(step)}: ${blocked}`);
                return end('abandon', blocked);
            }
```

with (uses the module-scoped `acquireTries` added in Step 3):

```ts
            const blocked = blockReason(step);
            if (blocked) {
                // Try to acquire the missing tool instead of abandoning. Keyed
                // on the step (not the reason string). ensure* verify the item
                // is HELD before returning true, so a success clears blockReason
                // on the re-identify; a failure falls through to abandon. Bounded
                // by acquireTries so a spawn/NPC that never yields can't spin.
                if (acquireTries < 2 && (await tryAcquire(step, tlog))) {
                    acquireTries++;
                    continue; // re-identify; the block should be cleared now
                }
                tlog(`abandoning ${describeStep(step)}: ${blocked}`);
                return end('abandon', blocked);
            }
```

- [ ] **Step 3: Add the `acquireTries` counter + `tryAcquire` helper**

The executor's loop lives inside `solveHeldClue` on the `ClueExecutor` object literal; use a module-scoped counter reset alongside `sessionActive`/`sessionLegs`. Near those declarations (~line 129) add:

```ts
let acquireTries = 0; // bounded tool-acquisition attempts this solve
```

Reset it in the `end()` helper (right where `sessionLegs = 0` is set) and when a NEW solve begins (the `if (!sessionActive)` block where `sessionLegs = 0` is set). Add `acquireTries = 0;` at both spots so a fresh solve starts with a full budget and an abandon clears it.

Add the helper near `blockReason` (after its definition, ~line 373):

```ts
/** Attempt to acquire the tool a dig step is blocked on. Spade for any dig;
 *  the sextant trio for a coordinate dig. Returns true only when the tool is
 *  now held (ensure* verify), so the caller's re-identify clears blockReason. */
async function tryAcquire(step: ClueStep, log: (m: string) => void): Promise<boolean> {
    if (step.type !== 'dig') {
        return false;
    }
    if (!Inventory.first(SPADE)) {
        return ensureSpade(log);
    }
    if ((step as ClueRow).needsSextant && COORD_ITEMS.some(n => !Inventory.first(n))) {
        return ensureCoordTools(log);
    }
    return false;
}
```

- [ ] **Step 4: Add a regression test case (no new mock — exercise the real path)**

Do NOT mock `AcquireTools.js` — bun module mocks leak across files. The existing `ClueExecutor.test.ts` already mocks `Traversal` (recording into a `walks` array), `Game.tile()` (non-null), and `GroundItems` (a `queryStub` whose `nearest()` returns null). That is exactly the world in which the REAL `ensureSpade` runs to completion and returns false (walks to a spade spawn, finds no ground spade, tries the other, gives up) — so the integration is verified end-to-end without a stub.

The file's harness (confirmed): module-level `let inv: number[]` and `let walks: string[]`; `Inventory.items()` maps off `inv`; the `Traversal` mock records **`walk ${dest.x},${dest.z}`** into `walks` (note the `walk ` prefix) and only mocks `walkResilient` — which is exactly what `ensureSpade` calls; `Game.tile()` returns `new Tile(2394, 3488, 0)` (nearer Ardougne than Falador); `GroundItems` is a `queryStub` whose `.where().nearest()` is null. So the REAL `ensureSpade` runs, walks to the Ardougne spawn, finds no ground spade, and returns false — no stub needed.

Add this import near the top with the others:

```ts
import { CLUE_DB } from './data/cluedb.js';
```

Then add the test inside the file's `describe`:

```ts
test('a spade-less dig walks to a spade spawn before abandoning', async () => {
    // hold only a plain dig clue (no Spade, no needsSextant) from the real DB
    const digId = Number(Object.keys(CLUE_DB).find(k => {
        const r = CLUE_DB[Number(k)];
        return r.type === 'dig' && r.needsSextant !== true;
    }));
    inv = [digId];
    walks.length = 0;
    const result = await ClueExecutor.solveHeldClue(() => {});
    // ensureSpade walked to the nearer spade spawn (Ardougne, from Game.tile 2394,3488)
    expect(walks).toContain('walk 2574,3331');
    // no ground spade in the mocked scene -> acquisition failed -> abandon
    expect(result).toBe('abandon');
});
```

If `Object.keys(CLUE_DB).find(...)` returns undefined (no plain dig clue in the DB — unlikely, easy clues have 6), the test throws on `Number(undefined)` → NaN; guard with `expect(Number.isNaN(digId)).toBe(false)` before the run so the failure is legible.

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test src/bot/clues/ClueExecutor.test.ts` (PASS), `bun test 2>&1 | tail -3` (0 fail), `bunx tsc --noEmit -p tsconfig.json` (clean).

- [ ] **Step 6: Commit**

```bash
git add src/bot/clues/ClueExecutor.ts src/bot/clues/ClueExecutor.test.ts
git commit -m "feat(clues): attempt tool acquisition before abandoning a blocked dig

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Pre-provision the trio at bank-first

**Files:**
- Modify: `src/bot/clues/SolveClue.ts` (imports; `bankFirst` ~line 175-198)
- Test: covered by the existing suite + the live smoke (bankFirst is I/O-heavy; no new unit test — the withdraw/keep logic is exercised by Task 6).

**Interfaces:**
- Consumes: `ensureCoordTools`, `hasCoordClueHeld`, `hasAllTrio` from `#/bot/clues/AcquireTools.js`; `TRIO` from `#/bot/clues/data/toolAcquire.js`; `heldClueScrollId` (already in file); `CLUE_DB` (already imported).
- Produces: no new exports.

- [ ] **Step 1: Add imports**

In `src/bot/clues/SolveClue.ts`, after `import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';`:

```ts
import { ensureCoordTools, hasAllTrio, hasCoordClueHeld } from '#/bot/clues/AcquireTools.js';
import { TRIO } from '#/bot/clues/data/toolAcquire.js';
```

- [ ] **Step 2: Auto-withdraw the trio + pre-provision when the held scroll is a coord clue**

In `bankFirst`, the block that currently withdraws the spade and coins ends before the food top-up (~line 199, after the coins block). Insert, right after the coins withdraw block and before the food top-up:

```ts
        // Coordinate clues: the dig hard-requires Sextant+Watch+Chart held
        // (spade.rs2). They persist once acquired, so withdraw any owned copies
        // now (they're already in the keep-set, never re-deposited). If the held
        // scroll is a coordinate clue and any are still missing, run the NPC
        // chain here (we hold the coord clue, so has_sextant_clue is true) —
        // best-effort: a failure just defers to the dig-step safety net, so it
        // must NOT fail bankFirst.
        const scrollId = heldClueScrollId();
        const scrollIsCoord = scrollId !== null && CLUE_DB[scrollId]?.needsSextant === true;
        if (scrollIsCoord) {
            for (const tool of TRIO) {
                if (!Inventory.first(tool)) {
                    await Bank.withdraw(tool, 'Withdraw-1');
                    await Execution.delayUntil(() => Inventory.first(tool) !== null, 2000);
                }
            }
        }
```

- [ ] **Step 3: Run the chain after the bank closes (needs the coord clue, not the bank)**

The chain walks NPCs, so it must run AFTER banking is done, not with the bank open. At the END of `bankFirst`, just before `return true;`, add:

```ts
        // Pre-provision the coord trio (user's bank-first choice). Runs once
        // ever — the tools persist — and only when a coordinate clue is held.
        // Best-effort; the dig-step safety net covers any mid-trail coord leg.
        if (scrollIsCoord && !hasAllTrio() && hasCoordClueHeld()) {
            this.host.setStatus('clue — acquiring coordinate tools');
            await ensureCoordTools(m => this.host.log(`[clue] ${m}`));
        }
```

(`scrollIsCoord` is in scope from Step 2 — both are inside `bankFirst`.)

- [ ] **Step 4: Typecheck + full suite**

Run: `bunx tsc --noEmit -p tsconfig.json` (clean), `bun test 2>&1 | tail -3` (0 fail).

- [ ] **Step 5: Commit**

```bash
git add src/bot/clues/SolveClue.ts
git commit -m "feat(clues): pre-provision coord tools at bank-first for coord clues

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Offline reachability probe of the four tiles

**Files:**
- Create: `tools/nav/clue-tool-tiles-probe.ts` (pattern: the earlier `tools/nav/cake-tiles-probe.ts` / `route-probe.ts`)

**Interfaces:**
- Consumes: the baked pack `out/collision.lcnav.gz`, `PathFinder` + edge JSON (as in `tools/nav/route-probe.ts`), Task 1's `PROFESSOR`/`MURPHY`/`KOJO`/`SPADE_SPAWNS`.
- Produces: PASS/FAIL evidence that each tile is pathable from representative starts; nothing imported by later tasks.

- [ ] **Step 1: Write the probe**

`tools/nav/clue-tool-tiles-probe.ts` (mirror `tools/nav/route-probe.ts`'s pack-load + `addEdges`):

```ts
// Offline reachability probe for the clue tool-acquisition tiles: the four NPC
// anchors + two spade spawns, each from a spread of bank/clue starts. Runs the
// exact PathFinder NavWorker ships. Usage: bun tools/nav/clue-tool-tiles-probe.ts
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';
import { KOJO, MURPHY, PROFESSOR, SPADE_SPAWNS } from '#/bot/clues/data/toolAcquire.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);

const STARTS = [
    { name: 'Ardougne market', x: 2662, z: 3305, level: 0 },
    { name: 'Falador east bank', x: 3013, z: 3356, level: 0 },
    { name: 'Catherby bank', x: 2809, z: 3440, level: 0 }
];
const tp = (name: string, t: { x: number; z: number; level: number }) => ({ name, x: t.x, z: t.z, level: t.level });
const TARGETS = [
    tp('professor', PROFESSOR.anchor),
    tp('Murphy', MURPHY.anchor),
    tp('Kojo', KOJO.anchor),
    tp('spade Ardougne', SPADE_SPAWNS[0]),
    tp('spade Falador', SPADE_SPAWNS[1])
];

let bad = 0;
for (const s of STARTS) {
    for (const t of TARGETS) {
        const o = finder.findPath({ x: s.x, z: s.z, level: s.level }, { x: t.x, z: t.z, level: t.level });
        const line = o.ok ? `ok cost ${o.cost}` : `NO PATH (${o.reason}, expanded ${o.expanded})`;
        if (!o.ok) { bad++; }
        console.log(`${s.name} -> ${t.name}: ${line}`);
    }
}
console.log(bad === 0 ? 'ALL REACHABLE' : `${bad} unreachable pair(s)`);
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: Ensure a pack exists, then run**

The pack is gitignored and regenerated per checkout. If `out/collision.lcnav.gz` is missing:

Run: `test -f out/collision.lcnav.gz || bun tools/nav/build-collision.ts --engine ~/code/lostcity-dev/engine`
Then: `bun tools/nav/clue-tool-tiles-probe.ts`

Expected: ideally `ALL REACHABLE`. If some pairs are `NO PATH`, that's a real finding — the anchor tile may need adjusting (nudge to an adjacent walkable tile in `toolAcquire.ts` and re-run) or a transport edge is genuinely missing (note it; that NPC stays on the abandon path, and the live smoke will confirm). Record the final probe output in the commit message.

- [ ] **Step 3: Commit**

```bash
git add tools/nav/clue-tool-tiles-probe.ts
git commit -m "test(clues): offline reachability probe for tool-acquisition tiles

Probe output: <paste the ALL REACHABLE / per-pair result here>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live smoke — acquire spade + trio, dig a coordinate casket

**Files:**
- Create: `tools/clue-tool-acquire-test.ts` (pattern: `tools/cluesolve-test.ts` / `tools/mediumsolve-test.ts`)

**Interfaces:**
- Consumes: deployed local build, engine at `http://localhost:8890`, `::` cheats to spawn a coordinate clue and clear the pack; the registry `ClueSolver` bot.
- Produces: PASS/FAIL live evidence; nothing imported later.

- [ ] **Step 1: Find a coordinate clue obj name + its dig tile**

Run: `rg -n "needsSextant" src/bot/clues/data/cluedb.ts | head -3` and note one coord clue's obj name (e.g. `trail_clue_medium_sextant001`) and `coord`. The cheat to spawn it is `::~item <objname> 1` (per the clue memory).

- [ ] **Step 2: Write the smoke**

`tools/clue-tool-acquire-test.ts` — copy `tools/mediumsolve-test.ts` as the base (its boot/login/tele/maxme plumbing is proven), then:

- After login + `::~maxme`, ensure a members world (the trail NPCs are members-only) — mirror whatever `mediumsolve-test.ts` already does for members; if it doesn't, add `::setvar member 1` or the project's members cheat (grep `rg -n "member" tools/*.ts` for the established one).
- Clear the pack of tools to force acquisition: no Spade, no Sextant/Watch/Chart. (Fresh maxme account starts clean; assert `Inventory` has none via the reader if the harness exposes it, else trust the fresh state.)
- Spawn the coordinate clue: `::~item trail_clue_medium_sextant001 1`.
- Teleport near the clue's dig region OR just start the bot and let it walk (the bot banks-first, acquires, then trails). Given acquisition is a long multi-NPC walk, tele to Ardougne first (`::tele` to ~2660,3305) to bound the run.
- Start `ClueSolver` (or the bot that hosts `SolveClue`): `r.runner.start(r.registry.get('ClueSolver'))`.
- Watch (~15 min window — acquisition is several long members' walks) for log lines:

```ts
const seen = { spade: false, sextant: false, watch: false, chart: false, dug: false };
for (let i = 0; i < 450; i++) {
    await page.waitForTimeout(2000);
    const lines = (await logLines()).slice(before);
    for (const l of lines) {
        if (/got a spade/.test(l)) { seen.spade = true; }
        if (/Murphy|sextant/i.test(l) && /got|given|Sextant/.test(l)) { seen.sextant = true; }
        if (/watch/i.test(l) && /got|given|Watch/.test(l)) { seen.watch = true; }
        if (/chart/i.test(l) && /got|given|Chart/.test(l)) { seen.chart = true; }
        if (/trail complete|found a casket|casket/i.test(l)) { seen.dug = true; }
    }
    if (seen.dug) { break; }
    if (i % 30 === 0) { console.log(`  t+${i*2}s ${JSON.stringify(seen)}`); }
}
console.log(`seen: ${JSON.stringify(seen)}`);
if (!(seen.sextant && seen.watch && seen.chart)) { fail('coord trio not fully acquired'); }
console.log('PASS: acquired the coordinate trio' + (seen.dug ? ' and dug the casket' : ' (dig not observed in window)'));
```

(The exact "given"/"got" strings depend on the bot's own log lines — after running once, tighten the regexes to what actually appears; the load-bearing assertion is the trio landing, best confirmed by reading the bot's `[clue]` log tail the harness prints.)

- [ ] **Step 3: Deploy + run**

```bash
curl -sf http://localhost:8890 >/dev/null || echo "ENGINE DOWN — start it first"
ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
bun tools/clue-tool-acquire-test.ts
```

Expected: `PASS: acquired the coordinate trio ...`. If a hop stalls, read the printed `[clue]` log tail: the likely fixes are anchor tiles in `toolAcquire.ts` (an NPC the walk can't reach the exact spawn of) or a `prefer` string that doesn't match the live dialogue option — adjust and re-run. Fix the code, not the assertion.

- [ ] **Step 4: Commit**

```bash
git add tools/clue-tool-acquire-test.ts
git commit -m "test(clues): live smoke — acquire spade + coord trio and dig the casket

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Re-run the clue audit, clear the sextant-dig allowlist if reachable

**Files:**
- Modify: `tools/clues/audit-clues.ts` and/or its pack-gated test (only if the audit now needs the trio/spade acquisition reflected; likely the graceful-abandon allowlist for the 2 sextant digs).

**Interfaces:**
- Consumes: the acquisition modules; the existing audit harness.
- Produces: an audit that reflects "acquire-then-solve", with any newly-solvable clues off the abandon allowlist.

- [ ] **Step 1: Run the audit as-is**

Run: `bun tools/clues/audit-clues.ts 2>&1 | tail -20`
Note which clues are flagged abandon/fail and whether the 2 sextant-dig allowlist entries (Baxtorian/Crandor, per the clue memory) are still needed now that tools are acquirable.

- [ ] **Step 2: Update the allowlist/audit to match reality**

If the sextant digs are now reachable+solvable (trio acquirable, dig tile pathable per Task 5), remove them from the graceful-abandon allowlist so the audit asserts they solve. If they remain genuinely unreachable (dig tile unpathable), leave them but update the comment to say "dig tile unreachable" rather than "no tools". Make the minimal change that makes `bun test` (the pack-gated audit test) green and honest.

- [ ] **Step 3: Run the audit test**

Run: `bun test 2>&1 | rg -i "audit|clue" | tail` and `bun test 2>&1 | tail -3` (0 fail).

- [ ] **Step 4: Commit**

```bash
git add tools/clues/audit-clues.ts test/bot/clues/*.test.ts
git commit -m "test(clues): audit reflects tool acquisition — update sextant-dig allowlist

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Only add the files actually changed; run `git status --short` first.)

---

## Final verification (after Task 7)

- [ ] `bun test 2>&1 | tail -3` — 0 fail.
- [ ] `bunx tsc --noEmit -p tsconfig.json` — no output.
- [ ] `bun tools/nav/clue-tool-tiles-probe.ts` — final reachability state recorded (all reachable, or the exceptions documented on the abandon path).
- [ ] Live smoke (Task 6) passed this session: spade acquired from the nearer spawn, the professor→Murphy→Kojo→professor chain yielded all three tools, and a coordinate dig produced the casket. Paste the `[clue]` log tail into the report.
- [ ] Report per-item live evidence to the user before pushing; push only on their say-so.
