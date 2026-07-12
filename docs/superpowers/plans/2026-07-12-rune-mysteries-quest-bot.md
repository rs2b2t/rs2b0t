# RuneMysteries Quest Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `RuneMysteries` script that completes the Rune Mysteries quest from any mainland position/quest state, plus the two nav-data edges it needs, built on reusable `gotoNpc`/`talkThrough` primitives.

**Architecture:** TaskBot state machine keyed on observable state only (quest-journal colour + held quest item — the varp is never transmitted, ADR-0007). One pure `nextStep()` decision function; two I/O primitives in `src/bot/quests/exec/`; a hand-added pair of `transports.json` edges for the wizard-tower diagonal door that `derive-doors` can't see. Spec: `docs/superpowers/specs/2026-07-12-rune-mysteries-quest-bot-design.md`.

**Tech Stack:** Bun + TypeScript (ESM, `.js` import suffixes), bun:test colocated unit tests, playwright-core live smoke against the local engine on :8890.

## Global Constraints

- Imports end in `.js` (ESM); path style matches neighbours (`../api/...`).
- All waits inside bot/api code go through `Execution.delayTicks/delayUntil` — never raw timers.
- The script uses NO cheats (must run on live rs2b2t); cheats appear only in the smoke's setup (`mainlandAccount`).
- Every commit: `bun test` green, `bunx tsc --noEmit` clean, `bunx eslint <changed files>` clean.
- Commit messages: conventional (`feat(runemysteries): ...`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Walk destinations must be pack-walkable tiles (the goal-ring leak: an unwalkable dest lets walkTo "arrive" across a seal). Every constant below is already probe-verified against `out/collision.lcnav.gz`.

**Verified geometry (offline probe, 2026-07-12):**

| Thing | Value |
|---|---|
| Duke Horacio anchor | (3212, 3220, level 1) — castle stairs are baked transports |
| Wizard-tower laddertop | loc `Ladder` (id 2147) at (3104,3162,0), op `Climb-down`, scripted arrival (3104,9576,0) |
| Basement ladder | loc `Ladder` (id 2148) at (3103,9576,0), op `Climb-up`, scripted arrival (3105,3162,0) |
| Surface ladder stand | (3105,3162,0) walkable; basement stand (3104,9576,0) walkable |
| Sedridor anchor | (3103, 9572, 0) — basement, spawn (3103,9571); local path crosses annotated Door@(3108,9570) |
| Aubury anchor | (3253, 3402, 0) — Varrock rune shop |
| Diagonal door sealing the ladder room | loc `Door` (id 1536) at (3107,3162,0), shape 9 — NOT in doors.json (derive-doors handles straight walls only); neighbours (3106,3162) and (3108,3162) both walkable |
| Quest journal name | `Rune Mysteries Quest` (`Quests.status`, case-insensitive exact) |
| Quest items (exact names) | `Air talisman`, `Research package`, `Notes` |

---

### Task 1: Nav data — wizard-tower diagonal-door transport edges

The ladder room is sealed in the nav graph; without these edges the planner cannot reach the tower ladder from anywhere (probe: "NO PATH/unreachable"). Two directed transport entries bridge the walkable neighbours through the diagonal door; `WalkExecutor.handleTransport` opens it like any annotated door (success = the `Open`-offering loc vanishes).

**Files:**
- Modify: `src/bot/nav/data/transports.json` (append to the existing 8-entry array)

**Interfaces:**
- Produces: nav paths to/from (3105,3162,0). Task 5's step data and Task 6's smoke rely on these routes existing.

- [ ] **Step 1: Append the two entries**

Add to the end of the JSON array in `src/bot/nav/data/transports.json` (transports are single-direction edges — doors.json entries get both directions automatically, transport entries do not, hence the pair):

```json
    {
        "from": { "x": 3106, "z": 3162, "level": 0 },
        "to": { "x": 3108, "z": 3162, "level": 0 },
        "locName": "Door",
        "action": "Open",
        "kind": "door"
    },
    {
        "from": { "x": 3108, "z": 3162, "level": 0 },
        "to": { "x": 3106, "z": 3162, "level": 0 },
        "locName": "Door",
        "action": "Open",
        "kind": "door"
    }
```

Match the existing entries' field order/format exactly (open the file and imitate). The diagonal `Door` loc (id 1536) at (3107,3162) sits within 3 tiles of both `from` tiles, which is how `findTransportLoc` locates it.

- [ ] **Step 2: Verify with the offline probe**

Run from the repo root:

```bash
bun -e "
import fs from 'node:fs'; import { gunzipSync } from 'fflate';
import { PathFinder } from './src/bot/nav/PathFinder.js';
import doors from './src/bot/nav/data/doors.json';
import transports from './src/bot/nav/data/transports.json';
let b = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (b[0]===0x1f) b = gunzipSync(b);
const f = new PathFinder(b); f.addEdges(doors, transports);
for (const [label, from, to] of [
  ['A courtyard->Duke', {x:3222,z:3218,level:0}, {x:3212,z:3220,level:1}],
  ['B Duke->tower stand', {x:3212,z:3220,level:1}, {x:3105,z:3162,level:0}],
  ['C basement->Sedridor', {x:3104,z:9576,level:0}, {x:3103,z:9572,level:0}],
  ['D tower->Aubury', {x:3105,z:3162,level:0}, {x:3253,z:3402,level:0}],
  ['E Aubury->tower', {x:3253,z:3402,level:0}, {x:3105,z:3162,level:0}],
]) { const r = f.findPath(from, to); console.log(label, r.ok ? 'ok cost ' + r.cost : 'FAIL ' + r.reason); }
"
```

Expected: all five legs `ok` (previously B/D/E failed). Reference costs: A 53, B ~251, C 17, D/E ~366.

- [ ] **Step 3: Full check + commit**

```bash
bun test && bunx tsc --noEmit
git add src/bot/nav/data/transports.json
git commit -m "feat(nav): hand-add wizard-tower diagonal-door transport edges

The ladder room behind the shape-9 diagonal Door (1536) at (3107,3162) is
sealed in the graph — derive-doors only annotates straight walls. Two
directed transport entries bridge the walkable neighbours (3106/3108,3162);
verified offline: Duke->tower / tower->Varrock legs now path.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Quest-exec pure helpers (`pickPreferred`, `isUnderground`, `needsHop`)

**Files:**
- Create: `src/bot/quests/exec/primitives.ts` (pure part only — Task 3 adds the I/O)
- Create: `src/bot/quests/exec/primitives.test.ts`

**Interfaces:**
- Produces:
  - `pickPreferred(options: string[], prefer: string[]): string | null` — first `prefer` entry that case-insensitively substring-matches an option; returns the full option text.
  - `isUnderground(t: { z: number }): boolean` — underground mapsquares sit at z + 6400 (z ≥ 5000 is the discriminator; surface maxes ~4100).
  - `needsHop(here: { z: number }, anchor: { z: number }): boolean` — regions disagree.

- [ ] **Step 1: Write the failing tests**

`src/bot/quests/exec/primitives.test.ts`:

```typescript
import { expect, test, describe } from 'bun:test';
import { pickPreferred, isUnderground, needsHop } from './primitives.js';

describe('pickPreferred', () => {
    // exact option strings from the quest .rs2 sources
    const sedridor = ["Nothing thanks, I'm just looking around.", 'What are you doing down here?', "I'm looking for the head wizard."];

    test('returns the full option text for the first preferred match', () => {
        expect(pickPreferred(sedridor, ["I'm looking for the head wizard."])).toBe("I'm looking for the head wizard.");
    });

    test('prefer order wins over option order', () => {
        expect(pickPreferred(['No, I am busy.', 'Yes, certainly.'], ['Yes, certainly.', 'No, I am busy.'])).toBe('Yes, certainly.');
    });

    test('matches case-insensitively by substring', () => {
        expect(pickPreferred(['Have you any quests for me?'], ['have you any quests'])).toBe('Have you any quests for me?');
    });

    test('null when nothing matches (caller falls back + warns)', () => {
        expect(pickPreferred(['Yes please!', "Oh, it's a rune shop. No thank you, then."], ['I have been sent here with a package'])).toBeNull();
    });
});

describe('isUnderground / needsHop', () => {
    test('classifies the wizard basement as underground, the tower as surface', () => {
        expect(isUnderground({ z: 9571 })).toBe(true);
        expect(isUnderground({ z: 3162 })).toBe(false);
    });

    test('needsHop only when regions disagree', () => {
        expect(needsHop({ z: 3218 }, { z: 9572 })).toBe(true);
        expect(needsHop({ z: 9576 }, { z: 3402 })).toBe(true);
        expect(needsHop({ z: 3218 }, { z: 3402 })).toBe(false);
        expect(needsHop({ z: 9571 }, { z: 9576 })).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bot/quests/exec/primitives.test.ts`
Expected: FAIL — `Export named 'pickPreferred' not found` (module doesn't exist yet).

- [ ] **Step 3: Minimal implementation**

`src/bot/quests/exec/primitives.ts`:

```typescript
// Quest-executor primitives (first consumer: RuneMysteries). Pure helpers
// here; the I/O walkers/talkers are added alongside them (gotoNpc,
// talkThrough, hopLadder) and stay thin so all decision logic is testable.

/**
 * First `prefer` entry that case-insensitively substring-matches one of
 * `options`, returned as the FULL option text (ChatDialog.chooseOption wants
 * the visible label). Null when nothing matches — the caller decides the
 * fallback and warns, because a fallback firing means the dialogue drifted
 * from the .rs2 sources the prefer list was written against. Pure.
 */
export function pickPreferred(options: string[], prefer: string[]): string | null {
    for (const p of prefer) {
        const hit = options.find(o => o.toLowerCase().includes(p.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

/** Underground mapsquares are the surface z + 6400 (wizard basement 3162 →
 *  9562-region). Surface z tops out ~4100, so 5000 splits cleanly. Pure. */
export function isUnderground(t: { z: number }): boolean {
    return t.z >= 5000;
}

/** A ladder hop is needed when here/anchor disagree about undergroundness —
 *  the A* graph doesn't span the boundary (no baked edge; the 2D heuristic
 *  can't cross the +6400 offset usefully). Pure. */
export function needsHop(here: { z: number }, anchor: { z: number }): boolean {
    return isUnderground(here) !== isUnderground(anchor);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/bot/quests/exec/primitives.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit && bunx eslint src/bot/quests/exec/primitives.ts src/bot/quests/exec/primitives.test.ts
git add src/bot/quests/exec/
git commit -m "feat(quests): exec primitives — pure dialogue/region helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Quest-exec I/O primitives (`hopLadder`, `gotoNpc`, `talkThrough`)

Live-I/O functions (Npcs/Locs/ChatDialog/Traversal) — no unit tests possible without mocking the client; they stay thin and are exercised end-to-end by Task 6's smoke. This matches the repo's split (cf. `walkOpening.ts`: pure predicates unit-tested, the walker itself smoke-tested).

**Files:**
- Modify: `src/bot/quests/exec/primitives.ts` (append below the pure helpers)

**Interfaces:**
- Consumes: `pickPreferred`, `isUnderground`, `needsHop` (Task 2, same file).
- Produces (Task 5 calls these exactly):
  - `interface LadderHop { stand: Tile; locName: string; op: string; arrive: Tile }`
  - `interface NpcStop { npc: string; anchor: Tile; leash: number; prefer: string[] }`
  - `hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean>`
  - `gotoNpc(stop: NpcStop, hops: LadderHop[], log: (m: string) => void): Promise<boolean>`
  - `talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean>`

- [ ] **Step 1: Add imports and the I/O functions**

Imports at the top of `src/bot/quests/exec/primitives.ts`:

```typescript
import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
```

Appended below the pure helpers:

```typescript
/** A scripted ladder/stair crossing the nav graph doesn't know. `stand` is a
 *  pack-walkable tile beside the loc on the NEAR side; `arrive` the scripted
 *  far-side landing (from the engine's ladders.rs2). */
export interface LadderHop {
    stand: Tile;
    locName: string;
    op: string;
    arrive: Tile;
}

/** Where a quest NPC lives and how to talk to it. `prefer` are the dialogue
 *  options to pick, in priority order, verbatim from the quest .rs2. */
export interface NpcStop {
    npc: string;
    anchor: Tile;
    leash: number;
    prefer: string[];
}

/**
 * Interact the hop's loc and wait until we land at (or beside) the scripted
 * far-side tile. Distance-to-arrive is the success test — NOT a level
 * change: underground hops keep level 0 and move z by ±6400, so `arrive`
 * (from the engine's ladders.rs2) is the only reliable signal for both
 * directions.
 */
export async function hopLadder(hop: LadderHop, log: (m: string) => void): Promise<boolean> {
    const ladder = Locs.query().name(hop.locName).action(hop.op).where(l => l.tile().distanceTo(hop.stand) <= 3).nearest();
    if (!ladder) {
        log(`no '${hop.locName}' offering '${hop.op}' near (${hop.stand.x},${hop.stand.z})`);
        return false;
    }
    if (!(await ladder.interact(hop.op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === hop.arrive.level && t.distanceTo(hop.arrive) <= 5;
    }, 8000);
}

/**
 * Web-walk until the stop's NPC is within its leash. Takes a region-crossing
 * hop first when here/anchor straddle the surface/underground boundary. The
 * final approach targets `anchor` (a probe-verified walkable tile near the
 * spawn), then re-checks the leash — NPCs wander, talkThrough re-finds them.
 */
export async function gotoNpc(stop: NpcStop, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    let here = Game.tile();
    if (!here) {
        return false;
    }
    const npcNear = (): boolean => {
        const n = Npcs.query().name(stop.npc).nearest();
        return n !== null && n.distance() <= stop.leash;
    };
    if (npcNear()) {
        return true;
    }
    if (needsHop(here, stop.anchor)) {
        const near = hops.filter(h => isUnderground(h.stand) === isUnderground(here!));
        const hop = near.sort((a, b) => a.stand.distanceTo(here!) - b.stand.distanceTo(here!))[0];
        if (!hop) {
            log(`no hop from (${here.x},${here.z}) toward (${stop.anchor.x},${stop.anchor.z})`);
            return false;
        }
        if (here.distanceTo(hop.stand) > 2 && !(await Traversal.walkResilient(hop.stand, { radius: 2, log }))) {
            return false;
        }
        if (!(await hopLadder(hop, log))) {
            return false;
        }
        here = Game.tile();
        if (!here) {
            return false;
        }
    }
    if (here.distanceTo(stop.anchor) > 3 && !(await Traversal.walkResilient(stop.anchor, { radius: 3, log }))) {
        return false;
    }
    return npcNear();
}

/**
 * Talk-to `npcName` and drive the whole conversation: continue through
 * pages, pick preferred options (fallback = LAST option + a warning — the
 * last option is the safe decline everywhere in this era's dialogues).
 * If a dialogue is already open (relog mid-talk, stray page), drives it
 * without re-interacting. Returns true once the dialog is closed.
 */
export async function talkThrough(npcName: string, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!ChatDialog.isOpen()) {
        const npc = Npcs.query().name(npcName).action('Talk-to').nearest();
        if (!npc) {
            log(`no '${npcName}' nearby to talk to`);
            return false;
        }
        if (!(await npc.interact('Talk-to'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 8000))) {
            log(`'${npcName}' never opened a dialogue`);
            return false;
        }
    }
    // The final Sedridor conversation is ~40 continue-pages; 120 iterations
    // bounds a stuck dialogue without cutting a long legitimate one short.
    for (let i = 0; i < 120 && ChatDialog.isOpen(); i++) {
        if (EventSignal.pending()) {
            return false; // let the runtime clear the random event
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
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}
```

- [ ] **Step 2: Verify types/lint and existing tests**

Run: `bun test src/bot/quests/exec/ && bunx tsc --noEmit && bunx eslint src/bot/quests/exec/primitives.ts`
Expected: 6 tests still PASS, tsc + eslint clean. If `Npcs`/`Locs` method names disagree with the code above, mirror the exact usage in `src/bot/scripts/CooksAssistant.ts` (`Npcs.query().name('Cook').action('Talk-to').nearest()`, `.distance()`, `.interact()`) and `FlaxSpinner.ts` (`Locs.query().name(...).action(...).where(l => l.tile()...).nearest()`).

- [ ] **Step 3: Commit**

```bash
git add src/bot/quests/exec/primitives.ts
git commit -m "feat(quests): gotoNpc/talkThrough/hopLadder exec primitives

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: RuneMysteries pure decision core (`heldQuestItem`, `nextStep`)

**Files:**
- Create: `src/bot/scripts/RuneMysteries.ts` (pure exports only — Task 5 adds the bot)
- Create: `src/bot/scripts/RuneMysteries.test.ts`

**Interfaces:**
- Consumes: `QuestStatus` type from `../api/hud/Quests.js` (`'notStarted' | 'inProgress' | 'complete' | 'unknown'`).
- Produces (Task 5 uses these):
  - `type Held = 'talisman' | 'package' | 'notes' | null`
  - `type StepId = 'DUKE' | 'SEDRIDOR' | 'AUBURY' | 'RECOVER' | 'DONE' | 'WAIT'`
  - `heldQuestItem(names: (string | null)[]): Held`
  - `nextStep(journal: QuestStatus, held: Held): StepId`

- [ ] **Step 1: Write the failing tests**

`src/bot/scripts/RuneMysteries.test.ts`:

```typescript
import { expect, test, describe } from 'bun:test';
import { heldQuestItem, nextStep } from './RuneMysteries.js';

describe('heldQuestItem', () => {
    test('exact case-insensitive full-name matches only', () => {
        expect(heldQuestItem(['Air talisman'])).toBe('talisman');
        expect(heldQuestItem(['research package'])).toBe('package');
        expect(heldQuestItem(['Notes'])).toBe('notes');
        // 'Notes' is generic — substring/partial names must NOT match
        expect(heldQuestItem(['Research notes'])).toBeNull();
        expect(heldQuestItem(['Bronze axe', null, 'Coins'])).toBeNull();
    });

    test('most-advanced item wins when several are present', () => {
        expect(heldQuestItem(['Air talisman', 'Notes'])).toBe('notes');
        expect(heldQuestItem(['Air talisman', 'Research package'])).toBe('package');
    });
});

describe('nextStep', () => {
    test('journal drives the ends', () => {
        expect(nextStep('complete', null)).toBe('DONE');
        expect(nextStep('complete', 'notes')).toBe('DONE');
        expect(nextStep('unknown', null)).toBe('WAIT'); // tab not loaded yet
        expect(nextStep('notStarted', null)).toBe('DUKE');
        expect(nextStep('notStarted', 'talisman')).toBe('DUKE'); // impossible server-side; Duke flow is safe
    });

    test('held item drives the deliveries', () => {
        expect(nextStep('inProgress', 'talisman')).toBe('SEDRIDOR');
        expect(nextStep('inProgress', 'package')).toBe('AUBURY');
        expect(nextStep('inProgress', 'notes')).toBe('SEDRIDOR');
    });

    test('inProgress empty-handed probes (covers the natural second Aubury talk and every lost item)', () => {
        expect(nextStep('inProgress', null)).toBe('RECOVER');
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bot/scripts/RuneMysteries.test.ts`
Expected: FAIL — module `./RuneMysteries.js` not found.

- [ ] **Step 3: Minimal implementation**

`src/bot/scripts/RuneMysteries.ts` (just the pure core for now):

```typescript
import type { QuestStatus } from '../api/hud/Quests.js';

// Quest items, exact display names from the quest configs
// (quest_runemysteries.obj). 'Notes' is deliberately matched as a FULL name:
// it is far too generic for substring matching.
const TALISMAN = 'air talisman';
const PACKAGE = 'research package';
const NOTES = 'notes';

export type Held = 'talisman' | 'package' | 'notes' | null;
export type StepId = 'DUKE' | 'SEDRIDOR' | 'AUBURY' | 'RECOVER' | 'DONE' | 'WAIT';

/** Which quest item the pack holds — most-advanced wins (can't co-occur
 *  server-side, but stay deterministic). Exact CI full-name equality. Pure. */
export function heldQuestItem(names: (string | null)[]): Held {
    const lower = names.filter((n): n is string => n !== null).map(n => n.toLowerCase());
    if (lower.includes(NOTES)) {
        return 'notes';
    }
    if (lower.includes(PACKAGE)) {
        return 'package';
    }
    if (lower.includes(TALISMAN)) {
        return 'talisman';
    }
    return null;
}

/**
 * The whole quest as one decision: journal colour (the only client-visible
 * quest progress — the varp is never transmitted, ADR-0007) + held item.
 * inProgress with empty hands is deliberately RECOVER: the fixed
 * Aubury → Sedridor → Duke probe order both performs the quest's natural
 * "talk to Aubury again" step and re-collects any lost item (each NPC's
 * dialogue re-gives its own — see the design spec). Pure.
 */
export function nextStep(journal: QuestStatus, held: Held): StepId {
    if (journal === 'complete') {
        return 'DONE';
    }
    if (journal === 'unknown') {
        return 'WAIT';
    }
    if (journal === 'notStarted') {
        return 'DUKE';
    }
    if (held === 'talisman' || held === 'notes') {
        return 'SEDRIDOR';
    }
    if (held === 'package') {
        return 'AUBURY';
    }
    return 'RECOVER';
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/bot/scripts/RuneMysteries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit && bunx eslint src/bot/scripts/RuneMysteries.ts src/bot/scripts/RuneMysteries.test.ts
git add src/bot/scripts/RuneMysteries.ts src/bot/scripts/RuneMysteries.test.ts
git commit -m "feat(runemysteries): pure decision core — journal+held item -> step

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: RuneMysteries bot + registration

**Files:**
- Modify: `src/bot/scripts/RuneMysteries.ts` (append bot below the pure core)
- Modify: `src/bot/scripts/index.ts` (register after the CooksAssistant block)

**Interfaces:**
- Consumes: `gotoNpc(stop, hops, log)`, `talkThrough(npc, prefer, log)`, `NpcStop`, `LadderHop` from `../quests/exec/primitives.js` (Task 3); `heldQuestItem`, `nextStep` (Task 4, same file); `Quests.status(name)/points()` from `../api/hud/Quests.js`; `ScriptRunner.stop()` from `../runtime/ScriptRunner.js`; `TaskBot`/`Task`, `ChatDialog`, `Inventory`, `Game`, `Execution`, `Tile` as used in `FlaxSpinner.ts`.
- Produces: registered script `RuneMysteries` (Task 6 starts it by this exact name).

- [ ] **Step 1: Append imports + bot to `RuneMysteries.ts`**

Add imports at the top:

```typescript
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Quests } from '../api/hud/Quests.js';
import { gotoNpc, talkThrough, type LadderHop, type NpcStop } from '../quests/exec/primitives.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
```

Append below the pure core:

```typescript
// Route/dialogue data — every tile probe-verified against the collision pack
// (docs/superpowers/plans/2026-07-12-rune-mysteries-quest-bot.md, "Verified
// geometry"); dialogue strings verbatim from the quest .rs2 sources.
const QUEST_NAME = 'Rune Mysteries Quest';

const DEFAULT_DUKE = new Tile(3212, 3220, 1); // castle 1st floor; stairs are baked transports
const DEFAULT_SEDRIDOR = new Tile(3103, 9572, 0); // tower basement, beside his spawn
const DEFAULT_AUBURY = new Tile(3253, 3402, 0); // Varrock rune shop
const DEFAULT_LEASH = 8;

const DUKE_PREFER = ['Have you any quests for me?', 'Sure, no problem.'];
const SEDRIDOR_PREFER = ["I'm looking for the head wizard.", 'Ok, here you are.', 'Yes, certainly.'];
const AUBURY_PREFER = ['I have been sent here with a package for you.'];

// The tower ladder is not a nav edge (underground is z+6400 on level 0 — the
// 2D A* can't span it), so it's a scripted hop. Arrival tiles are the
// engine's own scripted landings (ladders.rs2).
const HOPS: LadderHop[] = [
    { stand: new Tile(3105, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];

const NO_PROGRESS_WARN = 3;

export const SETTINGS: SettingsSchema = {
    questName: { type: 'string', default: QUEST_NAME, label: 'Quest journal name', help: 'matched case-insensitively against the quest side-tab' },
    dukeTile: { type: 'tile', default: DEFAULT_DUKE, label: 'Duke anchor (x,z,level)', help: 'Lumbridge castle 1st floor beside Duke Horacio' },
    sedridorTile: { type: 'tile', default: DEFAULT_SEDRIDOR, label: 'Sedridor anchor (x,z)', help: 'wizard-tower basement beside Sedridor' },
    auburyTile: { type: 'tile', default: DEFAULT_AUBURY, label: 'Aubury anchor (x,z)', help: 'Varrock rune shop' },
    leashRadius: { type: 'number', default: DEFAULT_LEASH, min: 3, max: 15, label: 'NPC search radius (tiles)' }
};

/**
 * Completes Rune Mysteries: Duke Horacio → Sedridor (wizard-tower basement)
 * → Aubury (Varrock) → Aubury again → Sedridor. Start anywhere, any quest
 * state — progress is read from the quest journal colour + held quest item
 * every loop (the varp is never transmitted; ADR-0007), so the bot is
 * restart-, relog- and random-event-safe by construction. No cheats.
 */
export default class RuneMysteries extends TaskBot {
    override loopDelay = 600;

    private questName = QUEST_NAME;
    private status = 'starting';
    private step: StepId = 'WAIT';
    private recoverIdx = 0;
    private lastSignature = '';
    private noProgress = 0;
    private duke!: NpcStop;
    private sedridor!: NpcStop;
    private aubury!: NpcStop;
    private recoverOrder!: NpcStop[];

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.questName = this.settings.str('questName', QUEST_NAME);
        const leash = this.settings.num('leashRadius', DEFAULT_LEASH);
        this.duke = { npc: 'Duke Horacio', anchor: this.settings.tile('dukeTile', DEFAULT_DUKE), leash: Math.min(leash, 6), prefer: DUKE_PREFER };
        this.sedridor = { npc: 'Sedridor', anchor: this.settings.tile('sedridorTile', DEFAULT_SEDRIDOR), leash, prefer: SEDRIDOR_PREFER };
        this.aubury = { npc: 'Aubury', anchor: this.settings.tile('auburyTile', DEFAULT_AUBURY), leash, prefer: AUBURY_PREFER };
        // Empty-handed mid-quest probes, fixed order: Aubury first is also the
        // quest's REQUIRED second talk after handing him the package.
        this.recoverOrder = [this.aubury, this.sedridor, this.duke];
        this.log(`RuneMysteries — off to earn ${this.questName}`);
        this.add(new ContinueDialog(), new QuestStep(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [
            `RuneMysteries — ${this.status}`,
            `journal ${Quests.status(this.questName)}  held ${heldQuestItem(Inventory.items().map(i => i.name)) ?? '—'}`,
            `step ${this.step}  QP ${Quests.points()}  tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#b8ffb8';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void { this.status = s; }
    journalName(): string { return this.questName; }

    /** Resolve the concrete stop for a step; RECOVER rotates its probe. */
    stopFor(step: StepId): NpcStop {
        if (step === 'DUKE') { return this.duke; }
        if (step === 'SEDRIDOR') { return this.sedridor; }
        if (step === 'AUBURY') { return this.aubury; }
        return this.recoverOrder[this.recoverIdx % this.recoverOrder.length];
    }

    /** Track (journal, held) between talks: progress resets the probe/warn
     *  counters; a completed talk with no change bumps them. */
    noteTalked(step: StepId, signature: string): void {
        if (signature !== this.lastSignature) {
            this.lastSignature = signature;
            this.recoverIdx = 0;
            this.noProgress = 0;
            return;
        }
        this.noProgress++;
        if (step === 'RECOVER') {
            this.recoverIdx++;
        }
        if (this.noProgress >= NO_PROGRESS_WARN) {
            this.log(`WARN: ${this.noProgress} talks with no progress at ${signature} — check the dialogue prefer lists`);
        }
    }

    noteStep(step: StepId): void { this.step = step; }
}

class ContinueDialog implements Task {
    validate(): boolean { return ChatDialog.canContinue(); }
    async execute(): Promise<void> { await ChatDialog.continue(); }
}

/** One decision + one leg per pass: read (journal, held), walk to the right
 *  NPC, run the conversation, note whether it moved the quest forward. */
class QuestStep implements Task {
    constructor(private bot: RuneMysteries) {}
    validate(): boolean { return !ChatDialog.canContinue() && Game.tile() !== null; }
    async execute(): Promise<void> {
        const journal = Quests.status(this.bot.journalName());
        const held = heldQuestItem(Inventory.items().map(i => i.name));
        const step = nextStep(journal, held);
        this.bot.noteStep(step);

        if (step === 'WAIT') {
            this.bot.setStatus('waiting for the quest journal');
            await Execution.delayTicks(2);
            return;
        }
        if (step === 'DONE') {
            this.bot.log(`${this.bot.journalName()} COMPLETE — ${Quests.points()} QP. Stopping.`);
            this.bot.setStatus('quest complete');
            ScriptRunner.stop();
            return;
        }

        const stop = this.bot.stopFor(step);
        this.bot.setStatus(`${step}: heading to ${stop.npc}`);
        if (!(await gotoNpc(stop, HOPS, m => this.bot.log(`  ${m}`)))) {
            await Execution.delayTicks(3); // walk failed/interrupted — re-decide next loop
            return;
        }
        this.bot.setStatus(`${step}: talking to ${stop.npc}`);
        if (await talkThrough(stop.npc, stop.prefer, m => this.bot.log(`  ${m}`))) {
            const after = `${Quests.status(this.bot.journalName())}|${heldQuestItem(Inventory.items().map(i => i.name)) ?? '-'}`;
            this.bot.noteTalked(step, after);
        }
        await Execution.delayTicks(2);
    }
}
```

Note: `StepId` is already exported by the pure core (Task 4) — the bot uses it directly.

- [ ] **Step 2: Register the script**

In `src/bot/scripts/index.ts`, add the import beside the other script imports:

```typescript
import RuneMysteries, { SETTINGS as RUNEMYSTERIES_SETTINGS } from './RuneMysteries.js';
```

and the registration immediately after the CooksAssistant block (keep the `--- quest ---` grouping):

```typescript
ScriptRegistry.register({
    name: 'RuneMysteries',
    description: 'Completes the Rune Mysteries quest — Duke Horacio → Sedridor (tower basement) → Aubury → back. No cheats.',
    category: 'Quest',
    tags: ['f2p', 'quest', 'lumbridge', 'wizard-tower', 'varrock'],
    settingsSchema: RUNEMYSTERIES_SETTINGS,
    create: () => new RuneMysteries()
});
```

(`settingsSchema` is the confirmed property name — see the FlaxSpinner entry at `src/bot/scripts/index.ts:285`.)

- [ ] **Step 3: Verify**

Run: `bun test && bunx tsc --noEmit && bunx eslint src/bot/scripts/RuneMysteries.ts src/bot/scripts/index.ts && bun run build:bot`
Expected: all green; bundle builds.

- [ ] **Step 4: Commit**

```bash
git add src/bot/scripts/RuneMysteries.ts src/bot/scripts/index.ts
git commit -m "feat(runemysteries): quest bot — journal+item state machine over exec primitives

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Live smoke `tools/rune-mysteries-test.ts`

**Files:**
- Create: `tools/rune-mysteries-test.ts` (auto-discovered by `run-all-smokes.ts` — no registration file)

**Interfaces:**
- Consumes: `mainlandAccount(page, base, user)`, `startScript(page, name)` from `tools/tutorial/harness.js`; the page-global `rs2b0t` ABI (`Quests.status/points`, `reader.inventory()/worldTile()`, `runner.state`).

- [ ] **Step 1: Write the smoke**

`tools/rune-mysteries-test.ts`:

```typescript
// Headless live smoke for RuneMysteries: fresh account, mainland-ready (the
// only cheats — off-island tele + tutorial varp + relog), start the script,
// and watch it walk the whole quest for real: talisman -> package -> notes ->
// journal complete + QP, script stops itself.
//
// Requires: engine on :8890 + local build deployed (deploy-local.sh).
// Budget ~18 min (three cross-map walks). In run-all-smokes sweeps pass
// --timeout 1200 or run it standalone.
// Usage: bun tools/rune-mysteries-test.ts [base-url] [username]

import { chromium } from 'playwright-core';
import { mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `rm${Date.now().toString(36).slice(-7)}`;
const BUDGET_MS = 18 * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    journal: string;
    held: string[];
    qp: number;
    runner: string;
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);
    await startScript(page, 'RuneMysteries');
    console.log('started RuneMysteries — watching');

    const QUEST_ITEMS = ['air talisman', 'research package', 'notes'];
    // Two page globals: `__rs2b0t` is the script ABI (Quests, reader — the
    // pattern quests-tab-test uses); `rs2b0t` is the dev handle (runner —
    // the pattern flax-spinner-test uses).
    const snap = (): Promise<Snapshot> =>
        page.evaluate(items => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null }[] };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string } };
            };
            const names = g.__rs2b0t.reader.inventory().map(i => (i.name ?? '').toLowerCase());
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                journal: g.__rs2b0t.Quests.status('Rune Mysteries Quest'),
                held: items.filter(q => names.includes(q)),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state
            };
        }, QUEST_ITEMS);

    const seen = { talisman: false, package: false, notes: false };
    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    while (Date.now() < deadline) {
        last = await snap();
        seen.talisman ||= last.held.includes('air talisman');
        seen.package ||= last.held.includes('research package');
        seen.notes ||= last.held.includes('notes');
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} journal=${last.journal} held=[${last.held.join(',')}] qp=${last.qp} runner=${last.runner}`);
        if (last.journal === 'complete' && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    if (!seen.talisman) { fail('never held the Air talisman (Duke leg failed)'); }
    if (!seen.package) { fail('never held the Research package (first Sedridor leg failed)'); }
    if (!seen.notes) { fail('never held the Notes (Aubury legs failed)'); }
    if (last.journal !== 'complete') { fail(`journal is '${last.journal}', expected 'complete'`); }
    if (last.qp < 1) { fail(`quest points ${last.qp}, expected >= 1`); }
    if (last.runner === 'running') { fail('script did not stop itself after completion'); }
    console.log(`PASS (Rune Mysteries: talisman -> package -> notes -> journal complete, QP=${last.qp}, clean stop)`);
} finally {
    await browser.close();
}
```

(Global access patterns verified: `__rs2b0t.Quests`/`__rs2b0t.reader` per `src/bot/runtime/abi.ts` + quests-tab-test; `rs2b0t.runner` per flax-spinner-test.)

- [ ] **Step 2: Deploy and run**

```bash
sh tools/deploy-local.sh
bun tools/rune-mysteries-test.ts
```

Expected: milestone lines showing the journey (Lumbridge castle → tower → basement → Varrock → basement), each `seen` flag flipping in order, ending `PASS (... QP=1, clean stop)`. Runtime roughly 8–15 min.

If it fails: read the bot log lines in the output; the usual suspects are an NPC display name ('Duke Horacio' — verify against `tools/scout-npcs.ts` live), a dialogue option that drifted from the .rs2 text (the WARN from talkThrough shows the actual options), or a walk leg (compare against the Task 1 probe).

- [ ] **Step 3: Commit**

```bash
git add tools/rune-mysteries-test.ts
git commit -m "test(smoke): rune mysteries full clean-run live smoke

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification sweep + docs

**Files:**
- Possibly modify: `docs/superpowers/specs/2026-07-12-rune-mysteries-quest-bot-design.md` (only if implementation diverged — keep the spec truthful)

- [ ] **Step 1: Full local verification**

```bash
bun test
bunx tsc --noEmit
bunx eslint src/bot/quests/exec/ src/bot/scripts/RuneMysteries.ts src/bot/scripts/index.ts tools/rune-mysteries-test.ts
bun run build && bun run build:bot
```

Expected: every command clean; test count grew by 11 (6 primitives + 5 decision-core).

- [ ] **Step 2: Re-run the smoke once more end-to-end**

```bash
bun tools/rune-mysteries-test.ts
```

Expected: PASS. (Fresh account each run — the smoke is idempotent.)

- [ ] **Step 3: True-up the spec if anything diverged, commit**

Known divergence to record: the spec's settings list included NPC names and
ladder name/op as settings; they shipped as constants (anchors, leash, and
quest name are the settings). Patch that spec line, plus any constant/name
that changed during implementation, then:

```bash
git add -A && git commit -m "docs(runemysteries): true-up spec to implementation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit entirely if nothing diverged.)
