# ClueSolver (RockCrab easy treasure-trail solver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When RockCrab loots an easy clue scroll, bank non-essentials, withdraw food + a spade, solve the full 2–4 step easy trail (search / dig / talk, anywhere incl. upper floors), collect the reward, and resume crabbing — plus a foundational stair/ladder transport generator so the world walker reaches upstairs answers.

**Architecture:** A nav-layer generator bakes stair/ladder hops into the transport graph (the walker's cross-level *mechanic* already works — `handleTransport` waits for the level change; only the edge *data* is missing). Then a reusable `src/bot/clues/` module (generated answer DB + pure `identifyStep` + a thin `ClueExecutor`) is driven by one high-priority `SolveClue` task inside RockCrab. Spec: `docs/superpowers/specs/2026-07-13-clue-solver-design.md`.

**Tech Stack:** TypeScript (bun), bun:test, playwright-core smoke vs the local engine (:8890), content pack at `~/code/rs2b2t-content`, engine at `~/code/rs2b2t-engine`.

## Global Constraints

- Content facts (two surveys + live guide agree): 66 easy clues, each a **distinct obj id** all named "Clue scroll" — identify by **`InvItem.id`**, never by text (obj params are not client-readable). Types: 46 search-loc (obj `trail_coord` = loc tile), 6 dig (`trail_coord` + `trail_casket`, spade, stand ≤1 tile), 14 talk (NPC from handler scripts), 1 special `vague003`. Trails are **2–4 random steps** (`^trail_easy_maxsteps=4`) — solve reactively in a loop. Members-world only; one clue at a time globally.
- Nav facts: node id = `(level<<28)|(x<<14)|z`; grid steps never change level; cross-level only via transport edges with `toLevel` set. `TransportEdgeData = { from: NavPoint; to: NavPoint; locName: string; action: string; kind: string }` (`PathFinder.ts:43`). `addEdges` **drops edges whose endpoints aren't walkable** and sets `toLevel` automatically when `to.level !== from.level`; `locX/locZ = from.x/from.z` must be ≤3 tiles of the live loc, and `locName`/`action` must match the loc's display name + op. `handleTransport`'s `toLevel !== undefined` branch drives the climb with **no new walker code** (`TRANSPORT_WAIT_MS=8000`, waits `worldTile().level === toLevel`).
- Reward/objbox distinction (verified): intermediate "another clue"/"casket" popups are **chat** modals → dismiss with `ChatDialog.continue()` while `canContinue()`; the final `trail_reward` is a **main** modal (`if_openmain`) → dismiss with `reader.closeModal()` while `reader.modals().main !== -1`. Reward loot is already in the pack before the interface shows.
- Spade is a held op (`iop1=Dig`) — `Inventory.first('Spade').interact('Dig')`, no wielding.
- Repo: 4-space indent, single quotes, `#/*`→`./src/*` ESM imports ending `.js`, bun:test; every code task leaves `bunx tsc --noEmit`, `bunx eslint <touched files>`, and `bun test` clean before commit (baseline: **371 tests**). Conventional commits to `main`, trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Comments state constraints code can't show — no narration. Never hand-edit generated files (`stairEdges.json`, `cluedb.ts`) — regenerate.
- Generated-data content roots: `process.env.CONTENT_DIR ?? ~/code/rs2b2t-content`, `process.env.ENGINE_DIR ?? ~/code/rs2b2t-engine`.
- Local engine runs members by default — the smoke cheats a clue with `::~item <obj> 1` (no members setup, no relog needed).

## File Structure

- `tools/nav/derive-stairs.ts` — NEW generator: parse `stairs.rs2` `switch_coord→p_telejump` + scan `.jm2` locs for generic ladders → `stairEdges.json`. Pure parse helpers exported for tests.
- `tools/nav/stairsParse.ts` — NEW pure helpers (coord decode, `switch_coord`/`p_telejump`/`movecoord` parsing) — unit-tested.
- `src/bot/nav/data/stairEdges.json` — GENERATED, committed (`TransportEdgeData[]`, one per line).
- `src/bot/nav/PathFinder.ts` — `addEdges` gains a defaulted `stairs` param.
- `src/bot/nav/NavWorker.ts`, `tools/nav/{coverage,bench-path,route-probe}.ts` — thread `stairEdges` into `addEdges`.
- `src/bot/nav/data/navTargets.ts` — +16 upstairs clue-answer targets.
- `tools/clues/gen-cluedb.ts` + `tools/clues/cluesParse.ts` — NEW cluedb generator + pure parsers.
- `src/bot/clues/data/cluedb.ts` — GENERATED, committed.
- `src/bot/clues/types.ts`, `src/bot/clues/ClueLogic.ts` — pure types + `identifyStep`, unit-tested.
- `src/bot/clues/ClueExecutor.ts` — thin step executor (client-bound).
- `src/bot/scripts/RockCrab.ts` — `SolveClue` task + `solveClues`/`spade` settings.
- `tools/cluesolve-test.ts` — live smoke.
- Tests under `test/tools/`, `test/bot/nav/`, `test/clues/`.

## Pinned data (from surveys — verbatim tiles)

**16 upstairs clue answers + their stair/ladder edges** (up-hop `from→to`; down is the reverse; `x,z,L`). These are the sanity-assert set for Task 1 and the NAV_TARGETS for Task 2:

| clue | answer | source | up-hop from → to |
|---|---|---|---|
| simple001 | 3209,3218,1 | stairs.rs2 | 3205,3209,0 → 3205,3209,1 (Lumbridge S spiral; already in transports.json) |
| simple002 | 3228,3216,1 | ladder | 3229,3213,0 → 3229,3213,1 |
| simple004 | 3301,3169,1 | ladder | 3284,3165,0 → 3284,3165,1 |
| simple011 | 3250,3420,1 | stairs.rs2 | 3255,3421,0 → 3255,3420,1 |
| simple015 | 2971,3386,1 | stairs.rs2 | 2973,3384,0 → 2972,3385,1 |
| vague001 | 3206,3419,1 | ladder | 3202,3416,0 → 3202,3416,1 |
| vague010 | 2970,3214,1 | stairs.rs2 | 2965,3215,0 → 2968,3215,1 |
| vague011 | 3016,3205,1 | ladder | 3013,3203,0 → 3013,3203,1 |
| vague013 | 3041,3364,1 | stairs.rs2 | 3034,3363,0 → 3036,3363,1 |
| vague014 | 3035,3347,1 | ladder | 3035,3344,0 → 3035,3344,1 |
| vague021 | 2657,3322,1 | ladder | 2655,3322,0 → 2655,3322,1 |
| vague023 | 2809,3451,1 | ladder | 2807,3454,0 → 2807,3454,1 |
| vague024 | 2716,3472,1 | ladder | 2715,3470,0 → 2715,3470,1 |
| vague003 | ~2574,3325,1 | stairs.rs2 | 2572,3325,0 → 2574,3325,1 |
| simple027 | 2748,3495,2 | ladder ×2 | 2747,3493,0→1, then 2749,3491,1→2 |
| vague018 | 3106,3369,2 | stairs.rs2 ×2 | 3108,3363,0→3108,3367,1, then 3104,3362,1→3105,3364,2 |

**Generic-ladder loc ids** (emit ±1-in-place, keyed by Climb-up/Climb-down op): 1746 `laddertop`, 1747 `ladder`, 1748 `laddermiddle`, 1749 `laddertop_directional`, 1750 `ladder_directional`.

**Talk clue → NPC** (baked from handler scripts): simple005→Hans, simple007→Zeke, simple008→Tanner, simple010→Bartender (Blue Moon), simple017→Squire, simple020→Bartender (Rusty Anchor), simple021→Ned, simple022→Doric, simple023→Gaius, simple025→Arhein, simple026→Sir Kay, vague012→Captain Tobias, vague028→Louisa, vague029→Spectator. (The generator greps these from `~/code/rs2b2t-content/scripts` for `~progress_clue_easy(trail_clue_easy_<id>` inside `[opnpc*,<npc>]` blocks; the table above is the expected output for the drift assert.)

---

### Task 1: Stair/ladder transport generator (pure parsers TDD + generator)

**Files:** Create `tools/nav/stairsParse.ts`, `tools/nav/derive-stairs.ts`, `src/bot/nav/data/stairEdges.json`; Test `test/bot/nav/stairsParse.test.ts`.

**Interfaces:**
- Consumes: `TransportEdgeData`, `NavPoint` from `#/bot/nav/PathFinder.js`; `loadLocTypes`, `loadMapsquares`, `parseLands`, `forEachLoc`, `Reader`, `bridgedLevel` from `./lib.js` (the deriver machinery — see `derive-doors.ts`).
- Produces: `stairsParse.ts` exports `decodeCoord(s: string): NavPoint` (`level_mx_mz_lx_lz` → world), `parseSwitchStairs(text: string): { from: NavPoint; to: NavPoint; debugname: string; op: number }[]` (parse each `[oplocN,<debugname>]` block's `case <coord> : p_telejump(<dest|movecoord(...)>)`), `applyMovecoord(base: NavPoint, args: number[]): NavPoint` (movecoord arg order `(dx, dLevel, dz)`); `derive-stairs.ts` writes `src/bot/nav/data/stairEdges.json`.

- [ ] **Step 1: Write failing parser tests** — `test/bot/nav/stairsParse.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { applyMovecoord, decodeCoord, parseSwitchStairs } from '../../../tools/nav/stairsParse.js';

describe('decodeCoord', () => {
    test('level_mx_mz_lx_lz → world x=mx*64+lx, z=mz*64+lz', () => {
        expect(decodeCoord('1_50_50_5_9')).toEqual({ x: 3205, z: 3209, level: 1 });
        expect(decodeCoord('0_50_50_4_7')).toEqual({ x: 3204, z: 3207, level: 0 });
    });
});

describe('applyMovecoord', () => {
    test('args are (dx, dLevel, dz) — middle is the level delta', () => {
        // Draynor: from 3108,3363,0 telejump movecoord(coord, 0, 1, 4) → +1 level, +4 z
        expect(applyMovecoord({ x: 3108, z: 3363, level: 0 }, [0, 1, 4])).toEqual({ x: 3108, z: 3367, level: 1 });
        expect(applyMovecoord({ x: 3108, z: 3364, level: 1 }, [0, -1, -4])).toEqual({ x: 3108, z: 3360, level: 0 });
    });
});

describe('parseSwitchStairs', () => {
    const FIXTURE = `
[oploc1,spiralstairs]
p_arrivedelay;
switch_coord (loc_coord) {
    case 0_50_50_4_7 : p_telejump(1_50_50_5_9); // Lumbridge Castle South - level 0
    case 0_50_53_55_29 : p_telejump(1_50_53_55_28); // Varrock East Bank - level 0
    case 0_48_52_36_35 : p_telejump(movecoord(coord, 0, 1, 4)); // Draynor manor - level 0
    case default : @unhandled_stairs(loc_coord);
}
`;
    test('parses literal + movecoord p_telejump cases, skips default', () => {
        const rows = parseSwitchStairs(FIXTURE);
        expect(rows).toEqual([
            { from: { x: 3204, z: 3207, level: 0 }, to: { x: 3205, z: 3209, level: 1 }, debugname: 'spiralstairs', op: 1 },
            { from: { x: 3255, z: 3421, level: 0 }, to: { x: 3255, z: 3420, level: 1 }, debugname: 'spiralstairs', op: 1 },
            { from: { x: 3108, z: 3363, level: 0 }, to: { x: 3108, z: 3367, level: 1 }, debugname: 'spiralstairs', op: 1 }
        ]);
    });
});
```

- [ ] **Step 2: RED** — `bun test test/bot/nav/stairsParse.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement `tools/nav/stairsParse.ts`** (pure, no IO):

```ts
/**
 * Pure parsers for the content pack's ladders+stairs/scripts/stairs.rs2 —
 * a set of `[oplocN,<debugname>]` blocks each holding
 * `switch_coord (loc_coord) { case <coord> : p_telejump(<dest>); ... }`.
 * Coord literal = level_mapsqX_mapsqZ_localX_localZ (world x=mx*64+lx).
 * dest is either a literal coord or movecoord(coord, dx, dLevel, dz).
 */
import type { NavPoint } from '#/bot/nav/PathFinder.js';

export function decodeCoord(s: string): NavPoint {
    const [level, mx, mz, lx, lz] = s.split('_').map(Number);
    return { x: mx * 64 + lx, z: mz * 64 + lz, level };
}

export function applyMovecoord(base: NavPoint, args: number[]): NavPoint {
    const [dx, dLevel, dz] = args;
    return { x: base.x + dx, z: base.z + dz, level: base.level + dLevel };
}

export interface StairCase { from: NavPoint; to: NavPoint; debugname: string; op: number }

export function parseSwitchStairs(text: string): StairCase[] {
    const out: StairCase[] = [];
    const blockRe = /^\[oploc(\d+),([a-z0-9_]+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
        const op = Number(m[1]);
        const debugname = m[2];
        const end = text.indexOf('\n[oploc', m.index + 1);
        const body = text.slice(m.index, end === -1 ? undefined : end);
        const caseRe = /case\s+([0-9_]+)\s*:\s*p_telejump\(\s*([^)]+(?:\([^)]*\))?)\s*\)/g;
        let c: RegExpExecArray | null;
        while ((c = caseRe.exec(body)) !== null) {
            const from = decodeCoord(c[1]);
            const dest = c[2].trim();
            const mv = /^movecoord\(\s*coord\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(dest);
            const to = mv ? applyMovecoord(from, [Number(mv[1]), Number(mv[2]), Number(mv[3])]) : decodeCoord(dest);
            out.push({ from, to, debugname, op });
        }
    }
    return out;
}
```

- [ ] **Step 4: GREEN** — `bun test test/bot/nav/stairsParse.test.ts` → 3 pass.

- [ ] **Step 5: Implement `tools/nav/derive-stairs.ts`** (mirror `derive-doors.ts` structure — read it first for the `loadLocTypes`/`loadMapsquares`/`forEachLoc`/`Reader`/one-JSON-per-line emit/end-of-run PASS-FAIL assert pattern):

```ts
/**
 * Generates src/bot/nav/data/stairEdges.json — cross-level transport edges
 * from two sources: (1) explicit switch_coord→p_telejump cases in
 * stairs.rs2; (2) generic ladders (loc ids 1746-1750) that climb ±1 level
 * in place. Edges whose endpoints aren't walkable are dropped by
 * PathFinder.addEdges at load; the coverage gate (tools/nav/coverage.ts)
 * over the 16 upstairs clue tiles is the real acceptance test.
 *   bun tools/nav/derive-stairs.ts [--engine <dir>] [--content <dir>] [--out <file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { NavPoint, TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { Reader, forEachLoc, loadLocTypes, loadMapsquares } from './lib.js';
import { parseSwitchStairs } from './stairsParse.js';

const engine = argVal('--engine') ?? process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');
const content = argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content');
const out = argVal('--out') ?? 'src/bot/nav/data/stairEdges.json';

// generic ladders: climb ±1 in place, keyed by the loc's op labels
const LADDER_LOC_IDS = new Set([1746, 1747, 1748, 1749, 1750]);

function argVal(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function edge(from: NavPoint, to: NavPoint, locName: string, action: string): TransportEdgeData {
    return { from, to, locName, action, kind: 'stair' };
}

function main(): void {
    const { configs } = loadLocTypes(engine);
    const edges: TransportEdgeData[] = [];

    // (1) stairs.rs2 explicit cases → resolve debugname → locName + op label
    const byDebug = new Map(configs.map(c => [c.debugname, c]));
    const stairsText = fs.readFileSync(path.join(content, 'scripts/ladders+stairs/scripts/stairs.rs2'), 'utf8');
    for (const s of parseSwitchStairs(stairsText)) {
        const def = byDebug.get(s.debugname);
        const action = def?.op[s.op - 1];
        if (!def || !action) { continue; }
        edges.push(edge(s.from, s.to, def.name ?? s.debugname, action));
    }

    // (2) generic ladders from the map loc data → ±1-in-place edges
    for (const sq of loadMapsquares(engine)) {
        forEachLoc(new Reader(sq.locs), (loc) => {
            if (!LADDER_LOC_IDS.has(loc.locId)) { return; }
            const def = configs[loc.locId];
            if (!def) { return; }
            for (let i = 0; i < def.op.length; i++) {
                const op = def.op[i];
                if (!op) { continue; }
                const here = { x: loc.x, z: loc.z, level: loc.level };
                if (/climb-up/i.test(op)) { edges.push(edge(here, { ...here, level: loc.level + 1 }, def.name ?? 'Ladder', op)); }
                else if (/climb-down/i.test(op) && loc.level > 0) { edges.push(edge(here, { ...here, level: loc.level - 1 }, def.name ?? 'Ladder', op)); }
            }
        });
    }

    edges.sort((a, b) => a.from.level - b.from.level || a.from.x - b.from.x || a.from.z - b.from.z || a.to.level - b.to.level);
    const json = '[\n' + edges.map(e => '    ' + JSON.stringify(e)).join(',\n') + '\n]\n';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log(`wrote ${out}: ${edges.length} edges`);

    // sanity gate (mirror derive-doors' expect list): known up-hops must exist
    const expect: [number, number, number, number, number, number][] = [
        [3205, 3209, 0, 3205, 3209, 1], // Lumbridge S
        [3255, 3421, 0, 3255, 3420, 1], // Varrock East bank
        [3229, 3213, 0, 3229, 3213, 1], // Lumbridge tower ladder
        [2807, 3454, 0, 2807, 3454, 1]  // Catherby ladder
    ];
    let failures = 0;
    for (const [fx, fz, fl, tx, tz, tl] of expect) {
        const hit = edges.some(e => e.from.x === fx && e.from.z === fz && e.from.level === fl && e.to.x === tx && e.to.z === tz && e.to.level === tl);
        console.log(`${hit ? 'PASS' : 'FAIL'} ${fx},${fz},${fl} -> ${tx},${tz},${tl}`);
        if (!hit) { failures++; }
    }
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (current !== json) { console.error(`STALE: ${out} — run bun tools/nav/derive-stairs.ts`); process.exitCode = 1; }
    }
    if (failures > 0) { process.exitCode = 1; }
}

main();
```

Note: verify `LocDef` field names (`.name`, `.debugname`, `.op[]`) and `loadMapsquares` return shape (`sq.locs`) against `tools/nav/lib.ts` — adjust to the real names if they differ (derive-doors.ts is the reference consumer).

- [ ] **Step 6: Generate + eyeball** — `bun tools/nav/derive-stairs.ts`. Expect `wrote … : <N> edges` (N in the low hundreds — ~270 stairs.rs2 cases + generic ladders), all 4 sanity lines `PASS`. `grep -c '"level":1' src/bot/nav/data/stairEdges.json` > 0.

- [ ] **Step 7: Gate + commit** — `bunx tsc --noEmit && bunx eslint tools/nav/stairsParse.ts tools/nav/derive-stairs.ts test/bot/nav/stairsParse.test.ts && bun test`.
```bash
git add tools/nav/stairsParse.ts tools/nav/derive-stairs.ts src/bot/nav/data/stairEdges.json test/bot/nav/stairsParse.test.ts
git commit -m "feat(nav): stair/ladder transport generator — bakes cross-level edges from stairs.rs2 + generic ladders

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire stairEdges into the pathfinder + upstairs coverage gate

**Files:** Modify `src/bot/nav/PathFinder.ts` (addEdges signature), `src/bot/nav/NavWorker.ts`, `tools/nav/coverage.ts`, `tools/nav/bench-path.ts`, `tools/nav/route-probe.ts`, `src/bot/nav/data/navTargets.ts`.

**Interfaces:**
- Consumes: `stairEdges.json` (Task 1), `addEdges` (existing).
- Produces: `addEdges(doors, transports, stairs?)` accepting a third `TransportEdgeData[]` (default `[]`); 16 new `NAV_TARGETS`.

- [ ] **Step 1: Add the defaulted param to `addEdges`** (`PathFinder.ts` ~:230). Change the signature to `addEdges(doors: DoorEdgeData[], transports: TransportEdgeData[], stairs: TransportEdgeData[] = []): void` and process stairs with the SAME loop as transports — simplest: iterate `[...transports, ...stairs]` in the existing transport loop (stairs are `TransportEdgeData` already). Keep `this.transportEdges++` counting both.

- [ ] **Step 2: Thread stairEdges at all four call sites.** Each currently calls `addEdges(doors, transports)`:
  - `src/bot/nav/NavWorker.ts:12-14` — add `import stairs from './data/stairEdges.json';` and change the call to `finder.addEdges(doors as DoorEdgeData[], transports, stairs);`
  - `tools/nav/coverage.ts:14,33` — `import stairsJson from '../../src/bot/nav/data/stairEdges.json';` + `finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);`
  - `tools/nav/bench-path.ts` + `tools/nav/route-probe.ts` — same import (via their existing `#/bot/nav/data/...` alias style) + third arg.

- [ ] **Step 3: Add the 16 upstairs answer tiles to `NAV_TARGETS`** (`src/bot/nav/data/navTargets.ts`), each `{ bot: 'ClueSolver', label: '<clue> (<building>)', tile: { x, z, level } }` using the answers column from the pinned table (e.g. `{ bot: 'ClueSolver', label: 'simple001 Lumbridge Duke bedroom', tile: { x: 3209, z: 3218, level: 1 } }` … through `vague018` at `{ x: 3106, z: 3369, level: 2 }`). No `expected: 'island'` — they must be genuinely reachable via the new edges.

- [ ] **Step 4: Build the pack + run coverage** — `bun run build:bot && bun tools/nav/coverage.ts`. Every `ClueSolver` line must print `ok`. For any `FAIL <label> … nearest connected = (x,z,L)`: the stair edge for that building is missing/has a non-walkable endpoint — cross-check the pinned up-hop tiles against `stairEdges.json`; if the generator's endpoint isn't walkable, the fix is in Task 1's endpoint selection (prefer the landing tile projected to the source level, per the addEdges walkable rule). Re-generate, rebuild, re-run until all 16 are `ok`. (The coverage gate before Task 1's edges existed would FAIL all 16 — this proves the fix.)

- [ ] **Step 5: Gate + commit** — `bunx tsc --noEmit && bunx eslint <touched files> && bun test`.
```bash
git add src/bot/nav/PathFinder.ts src/bot/nav/NavWorker.ts tools/nav/coverage.ts tools/nav/bench-path.ts tools/nav/route-probe.ts src/bot/nav/data/navTargets.ts
git commit -m "feat(nav): route through baked stair edges + coverage-gate the 16 upstairs clue tiles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Clue answer DB generator (pure parsers TDD + generator)

**Files:** Create `tools/clues/cluesParse.ts`, `tools/clues/gen-cluedb.ts`, `src/bot/clues/data/cluedb.ts`; Test `test/tools/cluesParse.test.ts`.

**Interfaces:**
- Produces: `cluesParse.ts` exports `parseEnum(text)`, `parseClueObjs(text)`, `parseTalkMappings(scriptText)`, `buildClueDb(...)`; `CLUE_DB: Record<number, ClueRow>` from `#/bot/clues/data/cluedb.js` where `ClueRow = { obj: string; id: number; type: 'search'|'dig'|'talk'; coord?: NavPoint; casketObj?: string; npc?: string }`.

- [ ] **Step 1: Failing parser tests** — `test/tools/cluesParse.test.ts` with fixtures cut from `trail_easy.obj` (a search block with `trail_coord`+`trail_loc=^true`; a dig block with `trail_coord`+`trail_casket`; a talk block with only `trail_desc`) and a handler-script fixture (`[opnpc1,ned] … ~progress_clue_easy(trail_clue_easy_simple021, …)`). Assert: search row → `{type:'search', coord}`; dig row → `{type:'dig', coord, casketObj}`; talk obj (no coord) + handler grep → `{type:'talk', npc:'Ned'}` (npc display resolved from the loc/npc config by debugname); the `vague003` special coord `1_40_51_14_62` hard-cased. (Model the block parser on `tools/shops/parse.ts`'s `blocks()` helper.)

- [ ] **Step 2: RED**, then **Step 3: implement `cluesParse.ts`** — block parser over `trail_easy.obj` reading `param=trail_coord,<coord>`, `param=trail_loc,^true`, `param=trail_casket,<obj>`; type = dig if `trail_casket` present, else search if `trail_loc=^true`, else talk. `parseTalkMappings` regex-scans script text for `~progress_clue_easy(trail_clue_easy_<id>` within `[opnpc\d+,<npc>]` blocks → `{ obj, npc }` (npc debugname → display via the npc config, resolved in the generator). `decodeCoord` reused from `stairsParse.ts` (import it) for the `level_mx_mz_lx_lz` params.

- [ ] **Step 4: GREEN**, then **Step 5: implement `tools/clues/gen-cluedb.ts`** — reads `~/code/rs2b2t-content/scripts/minigames/game_trail/configs/trail_easy.{enum,obj}` + globs `scripts/**/*.rs2` for talk mappings + resolves obj ids from the engine pack (`obj.pack` / `loadLocTypes`-style, or a name→id map) + npc display names; emits committed `src/bot/clues/data/cluedb.ts` (`/* eslint-disable */` header like shopdb) with `--check` drift gate. Hard-case `vague003`. Log `clues=<n>` (expect 66; 51 coord + 14 talk + 1 special).

- [ ] **Step 6: Generate + verify** — `bun tools/clues/gen-cluedb.ts`; `--check` both ways (clean → exit 0; tamper → exit 1). Spot-check: `grep -c "type: 'talk'" src/bot/clues/data/cluedb.ts` → 14; a known row e.g. simple021 → Ned.

- [ ] **Step 7: Gate + commit** (`feat(clues): easy-clue answer DB generator + committed cluedb with --check`).

---

### Task 4: Pure clue logic — `identifyStep` (TDD)

**Files:** Create `src/bot/clues/types.ts`, `src/bot/clues/ClueLogic.ts`; Test `test/clues/cluelogic.test.ts`.

**Interfaces:**
- Produces: `ClueStep = ClueRow | { type: 'open-casket'; casketObj: string; casketId: number }`; `identifyStep(heldIds: number[], db: Record<number, ClueRow>, casketIds: Record<number, string>): ClueStep | null`.

- [ ] **Step 1: Failing tests** — casket held (id in `casketIds`) → `open-casket` step (casket **beats** a clue if both held); a clue id in db → its row; unknown ids → null; empty → null.
- [ ] **Step 2: RED → Step 3: implement** (pure, client-free, no `Date.now()`): scan `heldIds` for a casket first, then a clue.
- [ ] **Step 4: GREEN → Step 5: gate + commit** (`feat(clues): pure identifyStep step-picker + tests`).

---

### Task 5: ClueExecutor — step execution

**Files:** Create `src/bot/clues/ClueExecutor.ts`; (no unit tests — behavior proven by the Task 7 smoke; logic lives in the tested `identifyStep`).

**Interfaces:**
- Consumes: `identifyStep`, `CLUE_DB`; `Traversal.walkResilient`, `Locs`, `Inventory`, `gotoNpc`/`talkThrough` (`#/bot/quests/exec/primitives.js`), `ChatDialog`, `reader.closeModal`, `Execution`, `Game`.
- Produces: `async solveHeldClue(log): Promise<'done' | 'abandon'>` — runs the full reactive loop until no clue/casket held (returns `done`) or a step fails its bounded attempts (`abandon`).

- [ ] **Step 1: Implement `ClueExecutor.ts`** — the reactive loop:
  ```
  loop (bounded, ~20 iterations max):
    ids = Inventory.items().map(i => i.id)
    step = identifyStep(ids, CLUE_DB, CASKET_IDS)
    if (!step) { dismiss reward main-modal via reader.closeModal() if open; return 'done' }
    switch step.type:
      search: walkResilient(coord, {radius:1}); Locs.query().where(tile≈coord).nearest()?.interact(<its search op>); verify held clue id changed
      dig:    if no Spade in inv → return 'abandon'; walkResilient(coord, {radius:1}); Inventory.first('Spade').interact('Dig'); verify a casket appears
      talk:   gotoNpc({npc, anchor:coord?, ...}) + talkThrough(npc, [])   // coord absent for talk — gotoNpc uses the npc's known area; reuse quest-primitive NpcStop shape
      open-casket: Inventory.first(casketName).interact('Open'); verify casket id gone
    after each: drain objbox popups via `while (ChatDialog.canContinue()) await ChatDialog.continue()`
    if a step made no progress after N attempts → return 'abandon'
  ```
  Key details from surveys: intermediate popups are **chat** modals (`ChatDialog.continue`); the final `trail_reward` is a **main** modal (`reader.closeModal()`). Verify each step by watching the held clue/casket id set change (idempotent — re-identify next iteration). Yield on `EventSignal.pending()` like the quest primitives.
- [ ] **Step 2: Gate + commit** (`feat(clues): ClueExecutor — reactive search/dig/talk/casket solve loop`).

---

### Task 6: RockCrab SolveClue task + settings

**Files:** Modify `src/bot/scripts/RockCrab.ts`.

- [ ] **Step 1: Add settings** to `SETTINGS` (RockCrab.ts:46) — `solveClues: { type: 'boolean', default: true, label: 'Solve easy clues' }`, `spade: { type: 'string', default: 'Spade', label: 'Spade item (for dig clues)' }` — and read them in `onStart` (`SOLVE_CLUES = this.settings.bool('solveClues', true)`, `SPADE_NAME = this.settings.str('spade', 'Spade')`) with new module `let`s.
- [ ] **Step 2: Add the `SolveClue` task class** — `validate()`: `SOLVE_CLUES && Game.members?() && (holds a clue or casket by id via CLUE_DB/CASKET_IDS) && hp healthy && !EventSignal.pending()`. `execute()`: (a) bank-first — `walkResilient(BANK_TILE)`, `Bank.openNearest(BANK_NAME, BANK_OP)`, `Bank.depositAllMatching(name => !isKeep(name))` where `isKeep` protects clue/casket/food/spade, `Bank.withdraw(FOOD_NAME, …)` + `Bank.withdraw(SPADE_NAME, 'Withdraw-1')` if not held; (b) `const outcome = await ClueExecutor.solveHeldClue(m => this.log(\`[clue] ${m}\`))`; (c) `walkResilient(FIELD)` (or let `GoToField` handle return). Overlay status `clue: solving`/`banking`/`returning`.
- [ ] **Step 3: Insert `new SolveClue(this)`** into the `this.add(...)` block (RockCrab.ts:122) **between `new Eat(this)` and `new BankRun(this)`** (survival outranks it; it preempts Fight/Aggro/loot). Add a `clue: <status>` line to `onPaint`.
- [ ] **Step 4: Gate + commit** — `bunx tsc --noEmit && bunx eslint src/bot/scripts/RockCrab.ts && bun test` (`feat(clues): RockCrab SolveClue task — bank-first, solve trail, resume crabbing`).

---

### Task 7: Live smoke — `tools/cluesolve-test.ts`

**Files:** Create `tools/cluesolve-test.ts`; Modify `tools/run-all-smokes.ts` (`LONG` += `'cluesolve-test': 900`).

- [ ] **Step 1: Write the smoke** (mirror `tools/shoprun-test.ts` boot; base default `http://localhost:8890`; `mainlandAccount` + `cheat`). Two cases:
  - **Ground talk (deterministic):** `cheat(page, '~item trail_clue_easy_simple021 1')` (Ned/Draynor), start RockCrab with `solveClues` on; assert a `[clue] solving` log for simple021 → the held clue id changes or the trail advances/completes (`[clue] trail complete` or a new clue id) within ~180s.
  - **Upstairs search (exercises a stair climb):** `cheat(page, '~item trail_clue_easy_simple011 1')` (Varrock East bank drawers, L1); assert the bot reaches level 1 (`reader.worldTile().level === 1` at some poll) and the step solves. Seed a spade (`~item spade 1`) and coins/food as needed; the local engine is members by default.
  - Since trails are RNG length, assert the **first step solves + the loop advances** (a new clue/casket appears or the reward fires), not a fixed trail length. Screenshot on failure; read `runner.ctx.log`.
- [ ] **Step 2: Run it** — `bun tools/run-all-smokes.ts --only cluesolve` (deploys first). Iterate to PASS (each failure names the awaited condition; check `out/smoke-logs/cluesolve-test.log`). If a talk/search step reveals a real solver bug, fix in the owning module and note it.
- [ ] **Step 3: Gate + commit** (`test(clues): ClueSolver live smoke — ground talk + upstairs search`).

---

### Task 8: Green sweep

- [ ] **Step 1: Full gates** — `bunx tsc --noEmit`; `bun test`; `bun tools/clues/gen-cluedb.ts --check`; `bun tools/nav/derive-stairs.ts --check`; `bun run build:bot && bun tools/nav/coverage.ts` (all 16 ClueSolver tiles `ok`).
- [ ] **Step 2: Smoke suite** — `bun tools/run-all-smokes.ts --only "cluesolve,rockcrab,door-cross"` (rockcrab = no-regression on the host bot; door-cross = nav no-regression after the addEdges change). All PASS.
- [ ] **Step 3: Report** — tests added vs the 371 baseline, edge count generated, coverage result, smoke timings, and what a first live members run should watch (a real 1/128 drop → full trail; the RNG trail length; any straggler that abandons).

## Self-review notes (applied)

- Spec coverage: stair generator + coverage gate (Tasks 1-2) = the upstairs nav fix; cluedb generator + drift (Task 3); pure identifyStep (Task 4); executor with chat-vs-main-modal dismissal + dig/search/talk (Task 5); RockCrab bank-first + immediate-interrupt + abandon (Task 6); members-only smoke incl. an upstairs climb (Task 7). Reward = auto-collected to inventory (Task 5 dismiss). Spade withdrawn on bank-first (Task 6). All 16 upstairs clues reachable (survey — none abandon).
- Type consistency: `TransportEdgeData`/`NavPoint` (Tasks 1-2) match PathFinder; `ClueRow`/`ClueStep`/`identifyStep` (Tasks 3-5) consistent; RockCrab settings keys match onStart reads (Task 6) and the smoke (Task 7).
- Known risks folded in: generator endpoint-walkability (Task 2 Step 4 loop is the corrective gate); talk clues have no coord so `gotoNpc` uses the npc's area (Task 5); RNG trail length (smoke asserts advance, not length); generic-ladder scan can only enable cross-level routing, never harm same-level (low-risk, per survey).
