# AIO Questbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One registered `AIOQuester` bot that completes a user-picked queue of quests end-to-end — v1: Rune Mysteries (ported), Doric's Quest, Sheep Shearer, The Restless Ghost, Romeo & Juliet, Cook's Assistant.

**Architecture:** Each quest is a `QuestModule` in `src/bot/quests/defs/`: a pure `decide(snapshot) → QuestStep` function plus declarative `NpcStop`/`LadderHop`/gather data. A shared engine (`src/bot/quests/engine/`) executes steps via primitives in `quests/exec/`, provisions items bank-first with gather fallback, orders the queue by eligibility, and parks quests that stop progressing. All progress is re-derived from the quest journal + inventory every loop (ADR-0007: varps are never transmitted), so restart/relog/random-events are safe by construction.

**Tech Stack:** TypeScript (browser bot client), `bun:test` for pure-logic units, Playwright headless smokes in `tools/`, nav data in `src/bot/nav/data/*.json`.

**Spec:** `docs/superpowers/specs/2026-07-15-aio-questbot-design.md`

## Global Constraints

- Quest facts (dialogue option strings, item display names, QP) come from `~/code/content/scripts/quests/` `.rs2` sources — cite `file:line` in code comments like `quests/data/f2p.ts` does. LostHQ guides (https://2004.losthq.rs/?p=questguides) are cross-check only, never override sources.
- Pure decision logic NEVER imports client/DOM modules — same discipline as `quests/types.ts` ("imports NOTHING"). Tests run under `bun:test` with no game client.
- `decide()` functions are PURE: `(QuestSnapshot) → QuestStep`. All live reads happen in the engine.
- Never read quest varps — journal colour (`Quests.status`) + inventory/equipment are the only progress signals (ADR-0007).
- Dialogue `prefer` lists hold option strings verbatim from the `.rs2` sources; `talkThrough`'s fallback (last option + WARN) stays the safety net.
- Coordinates from content sources are best-effort; every anchor tile gets live verification during that quest's smoke run. Tiles already probe-verified by RuneMysteries are reused as-is.
- No-progress watchdog: warn at 3, park at 8 (named constants `NO_PROGRESS_WARN = 3`, `NO_PROGRESS_PARK = 8`). Park is 8, not the spec's provisional 6, because stage-invisible quests (Romeo & Juliet) probe up to 4 NPCs per cycle and the worst convergent cycle is 7 no-progress talks (traced in Task 12) — the constants were declared tunable in the spec for exactly this.
- Commit after every task (the repo's owner commits concurrently on the same checkout — run `git status`/`git log` before `git add`, add files EXPLICITLY by path, never `-A`).
- Run `bun test <file>` for unit suites; full-repo typecheck via `bun run typecheck` (if that script is missing, `bunx tsc --noEmit`).
- Live smokes need the engine on :8890 + `tools/deploy-local.sh` first, and must run from the main checkout (worktrees lack `collision.lcnav.gz` — silent navigator death).

---

## File structure (locked by this plan)

```
src/bot/quests/
  engine/
    types.ts          # QuestSnapshot, QuestStep union, QuestModule, ProvisionPlan
    provisioning.ts   # pure: diff record.items vs snapshot → withdraw/gather/blocked
    queue.ts          # pure: pick-list ordering, parking, next-quest selection
    watchdog.ts       # pure: progress-signature no-progress counter
    QuestEngine.ts    # live orchestrator Task (snapshot assembly, step dispatch)
  exec/
    primitives.ts     # existing gotoNpc/talkThrough/LadderHop (grows nothing)
    steps.ts          # executeStep(): one executor per QuestStep kind
  defs/
    index.ts          # QUEST_DEFS ordered list (run order = this order)
    runemysteries.ts  # port of scripts/RuneMysteries.ts decision + data
    doric.ts
    sheepshearer.ts
    restlessghost.ts
    cooksassistant.ts
    romeojuliet.ts    # LAST: cadava berries are an IMP DROP on this server (research below)
src/bot/scripts/
  AIOQuester.ts       # TaskBot shell: settings, paint (Queue/Current tabs), registry entry
tools/
  aio-quest-test.ts   # parameterized live smoke: run a picked queue on a fresh account
```

Nav data: NO changes needed. `src/bot/nav/data/stairEdges.json` (the derive-stairs pack) already holds the windmill ladders — (3165,3307) levels 0↔1↔2 — AND Juliet's staircase — (3155,3435) 0↔1 — AND the Lumbridge-castle stairs to the spinning wheel. The spec's two "nav-data work" items predated checking that pack; both drop to live-smoke verification. (`scripts/CooksAssistant.ts`'s "mill isn't navigable" limitation comment is stale for the same reason.)

Deleted at the END (Task 13, after live verification): `scripts/RuneMysteries.ts`, `scripts/RuneMysteries.test.ts` (tests move to defs), `scripts/CooksAssistant.ts`, their registry entries, `tools/rune-mysteries-test.ts` (superseded by the parameterized smoke).

---

### Task 1: Engine types + progress signature

**Files:**
- Create: `src/bot/quests/engine/types.ts`
- Create: `src/bot/quests/engine/watchdog.ts`
- Test: `src/bot/quests/engine/watchdog.test.ts`

**Interfaces:**
- Produces (all of `engine/types.ts` — later tasks import these exact shapes):

```ts
import type Tile from '../../api/Tile.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js'; // type-only import, no client at runtime
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

/** Plain-data view of the world for ONE quest's decide(). Engine-assembled. */
export interface QuestSnapshot {
    journal: QuestStatus;              // this quest's journal colour
    inv: Map<string, number>;          // LOWERCASED display name -> inventory count
    worn: Set<string>;                 // LOWERCASED equipped item names
    /** Current no-progress count from the engine watchdog (0 = last step
     *  moved the world). Lets a PURE decide() rotate empty-handed probes
     *  (probeOrder[noProgress % probeOrder.length]) without module state —
     *  quest varps are never transmitted, so mid-quest stages with no
     *  inventory signal (Romeo & Juliet 30/40/60) are only reachable this way. */
    noProgress: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'withdraw'; items: { name: string; qty: number }[] }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestModule {
    record: QuestRecord;               // the existing quests/data record (one source of truth)
    hops?: LadderHop[];                // scripted level crossings the nav graph lacks
    /** Per acquirable item (LOWERCASED name): next step toward obtaining it.
     *  Called by provisioning when the bank lacks the item; `need` is how many
     *  more are required. decide-shaped so multi-leg gathers (windmill flour)
     *  re-plan from the snapshot each loop. */
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    /** PURE quest brain: (journal, inv, worn) -> next step. */
    decide(snap: QuestSnapshot): QuestStep;
}
```

- Produces (`engine/watchdog.ts`):

```ts
export const NO_PROGRESS_WARN = 3;
export const NO_PROGRESS_PARK = 8;

/** Stable progress signature for one quest: journal + sorted item counts.
 *  Any journal change or inventory delta resets the no-progress counter. */
export function progressSignature(snap: QuestSnapshot): string;

/** Counter fed one signature per COMPLETED step. */
export class ProgressWatchdog {
    /** Returns the current no-progress count (0 when the signature moved). */
    note(signature: string): number;
    reset(): void;
}
```

**Steps:**

- [ ] **Step 1: Write the failing test**

`src/bot/quests/engine/watchdog.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import type { QuestSnapshot } from './types.js';

const snap = (journal: string, items: [string, number][]): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('progressSignature', () => {
    test('same state -> same signature regardless of map insertion order', () => {
        expect(progressSignature(snap('inProgress', [['egg', 1], ['pot', 2]])))
            .toBe(progressSignature(snap('inProgress', [['pot', 2], ['egg', 1]])));
    });
    test('journal or count change -> different signature', () => {
        const base = progressSignature(snap('inProgress', [['egg', 1]]));
        expect(progressSignature(snap('complete', [['egg', 1]]))).not.toBe(base);
        expect(progressSignature(snap('inProgress', [['egg', 2]]))).not.toBe(base);
    });
});

describe('ProgressWatchdog', () => {
    test('unchanged signature counts up; change resets', () => {
        const w = new ProgressWatchdog();
        expect(w.note('a')).toBe(0); // first sighting is progress
        expect(w.note('a')).toBe(1);
        expect(w.note('a')).toBe(2);
        expect(w.note('b')).toBe(0);
        expect(w.note('b')).toBe(1);
    });
    test('thresholds are 3 warn / 8 park (park must exceed the longest probe cycle — R&J needs 7)', () => {
        expect(NO_PROGRESS_WARN).toBe(3);
        expect(NO_PROGRESS_PARK).toBe(8);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/quests/engine/watchdog.test.ts`
Expected: FAIL — cannot resolve `./watchdog.js` / `./types.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/quests/engine/types.ts`: exactly the Interfaces block above, with a header comment mirroring `quests/types.ts` ("pure evaluators consume plain snapshots; live reads happen only in QuestEngine.ts").

`src/bot/quests/engine/watchdog.ts`:

```ts
import type { QuestSnapshot } from './types.js';

export const NO_PROGRESS_WARN = 3;
// 8, not 6: stage-invisible quests probe up to 4 NPCs per rotation and the
// worst convergent cycle (R&J stage 30 -> berries consumed) is 7 fruitless
// talks; parking earlier would bench a quest that was about to progress.
export const NO_PROGRESS_PARK = 8;

/** Journal + sorted inventory counts. Sorted so Map insertion order never
 *  fakes progress. Worn is deliberately excluded: equipping is a step SIDE
 *  EFFECT that shows up as an inventory delta anyway (item leaves the pack). */
export function progressSignature(snap: QuestSnapshot): string {
    const items = [...snap.inv.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => `${n}:${c}`);
    return `${snap.journal}|${items.join(',')}`;
}

export class ProgressWatchdog {
    private last = '';
    private count = 0;

    note(signature: string): number {
        if (signature !== this.last) {
            this.last = signature;
            this.count = 0;
        } else {
            this.count++;
        }
        return this.count;
    }

    reset(): void {
        this.last = '';
        this.count = 0;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/quests/engine/watchdog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git status --short   # confirm only the three new files are yours
git add src/bot/quests/engine/types.ts src/bot/quests/engine/watchdog.ts src/bot/quests/engine/watchdog.test.ts
git commit -m "feat(quests): AIO engine types + progress watchdog"
```

---

### Task 2: Provisioning (pure)

**Files:**
- Create: `src/bot/quests/engine/provisioning.ts`
- Test: `src/bot/quests/engine/provisioning.test.ts`

**Interfaces:**
- Consumes: `QuestSnapshot` from Task 1; `QuestItem`/`QuestRecord` from `../types.js`; `BankInventorySnapshot` from `../types.js`.
- Produces:

```ts
export interface ProvisionPlan {
    /** Items to withdraw at a bank (bank has them, pack doesn't — bank-first). */
    withdraw: { name: string; qty: number }[];
    /** Acquirable items still short after bank — gather via the module's gather fn. */
    gather: { name: string; need: number }[];
    /** mustHave items that neither pack nor bank can cover — quest is BLOCKED. */
    blocked: string[];
    /** True when the pack already holds everything. */
    satisfied: boolean;
}

/** Diff a quest's item list against pack + (last-seen) bank counts. Pure. */
export function planProvisioning(
    items: QuestItem[],
    inv: Map<string, number>,          // lowercased name -> count (pack only)
    bank: Map<string, number>          // lowercased name -> count (bank only)
): ProvisionPlan;
```

**Steps:**

- [ ] **Step 1: Write the failing test**

`src/bot/quests/engine/provisioning.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';
import { planProvisioning } from './provisioning.js';
import type { QuestItem } from '../types.js';

const it = (name: string, qty: number, kind: 'mustHave' | 'acquirable'): QuestItem => ({ name, qty, kind });

describe('planProvisioning', () => {
    test('pack already satisfied -> nothing to do', () => {
        const p = planProvisioning([it('Egg', 1, 'acquirable')], new Map([['egg', 1]]), new Map());
        expect(p.satisfied).toBe(true);
        expect(p.withdraw).toEqual([]);
        expect(p.gather).toEqual([]);
        expect(p.blocked).toEqual([]);
    });

    test('bank-first: banked items are withdrawn, not gathered', () => {
        const p = planProvisioning([it('Clay', 6, 'acquirable')], new Map(), new Map([['clay', 10]]));
        expect(p.withdraw).toEqual([{ name: 'Clay', qty: 6 }]);
        expect(p.gather).toEqual([]);
        expect(p.satisfied).toBe(false);
    });

    test('partial bank tops up from gather', () => {
        const p = planProvisioning([it('Clay', 6, 'acquirable')], new Map([['clay', 1]]), new Map([['clay', 2]]));
        expect(p.withdraw).toEqual([{ name: 'Clay', qty: 2 }]);
        expect(p.gather).toEqual([{ name: 'Clay', need: 3 }]);
    });

    test('mustHave that bank cannot cover blocks; acquirable does not', () => {
        const p = planProvisioning(
            [it('Redberry pie', 1, 'mustHave'), it('Cadava berries', 1, 'acquirable')],
            new Map(),
            new Map()
        );
        expect(p.blocked).toEqual(['Redberry pie x1']);
        expect(p.gather).toEqual([{ name: 'Cadava berries', need: 1 }]);
    });

    test('name matching is case-insensitive against the lowercased maps', () => {
        const p = planProvisioning([it('Ball of wool', 20, 'acquirable')], new Map([['ball of wool', 20]]), new Map());
        expect(p.satisfied).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/quests/engine/provisioning.test.ts`
Expected: FAIL — cannot resolve `./provisioning.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/quests/engine/provisioning.ts`:

```ts
import type { QuestItem } from '../types.js';

export interface ProvisionPlan {
    withdraw: { name: string; qty: number }[];
    gather: { name: string; need: number }[];
    blocked: string[];
    satisfied: boolean;
}

/**
 * Bank-first, gather fallback (design decision): pack counts first, then bank
 * (withdraw), then gather for acquirable / BLOCKED for mustHave. Inputs are
 * lowercased-name count maps so live casing never matters here. Pure.
 */
export function planProvisioning(
    items: QuestItem[],
    inv: Map<string, number>,
    bank: Map<string, number>
): ProvisionPlan {
    const plan: ProvisionPlan = { withdraw: [], gather: [], blocked: [], satisfied: true };
    for (const item of items) {
        const key = item.name.toLowerCase();
        const have = inv.get(key) ?? 0;
        if (have >= item.qty) {
            continue;
        }
        plan.satisfied = false;
        let short = item.qty - have;
        const banked = bank.get(key) ?? 0;
        if (banked > 0) {
            const take = Math.min(short, banked);
            plan.withdraw.push({ name: item.name, qty: take });
            short -= take;
        }
        if (short > 0) {
            if (item.kind === 'mustHave') {
                plan.blocked.push(`${item.name} x${item.qty}`);
            } else {
                plan.gather.push({ name: item.name, need: short });
            }
        }
    }
    return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/quests/engine/provisioning.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/bot/quests/engine/provisioning.ts src/bot/quests/engine/provisioning.test.ts
git commit -m "feat(quests): pure bank-first provisioning planner"
```

---

### Task 3: Queue manager (pure)

**Files:**
- Create: `src/bot/quests/engine/queue.ts`
- Test: `src/bot/quests/engine/queue.test.ts`

**Interfaces:**
- Consumes: `QuestEligibility` from `../types.js` (fields: `id`, `name`, `status: 'DONE'|'READY'|'BLOCKED'`, `reasons: string[]`).
- Produces:

```ts
export type QueueStatus = 'DONE' | 'RUNNING' | 'READY' | 'PARKED' | 'BLOCKED' | 'UNKNOWN';

export interface QueueRow {
    id: string;
    name: string;
    status: QueueStatus;
    reasons: string[];   // BLOCKED gate reasons, or ['no progress — parked'] for PARKED
}

/**
 * Pick the next quest to run. `order` is the implemented def order (run
 * order); `picked` the user's selection (ids); `elig` the latest eligibility
 * per id; `parked` quests the watchdog benched. READY-and-not-parked first
 * (in def order), then parked READY quests (retry once everything else had
 * its turn). Null when nothing is runnable. Pure.
 */
export function nextQuest(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>
): string | null;

/** Rows for the paint's Queue tab, in def order, picked quests only. */
export function queueRows(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>,
    runningId: string | null
): QueueRow[];
```

**Steps:**

- [ ] **Step 1: Write the failing test**

`src/bot/quests/engine/queue.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';
import { nextQuest, queueRows } from './queue.js';
import type { QuestEligibility } from '../types.js';

const e = (id: string, status: QuestEligibility['status'], reasons: string[] = []): [string, QuestEligibility] =>
    [id, { id, name: id.toUpperCase(), members: false, status, reasons }];

const ORDER = ['runemysteries', 'doric', 'sheep', 'priest'];

describe('nextQuest', () => {
    test('first READY in def order wins', () => {
        const elig = new Map([e('runemysteries', 'DONE'), e('doric', 'READY'), e('sheep', 'READY'), e('priest', 'BLOCKED', ['x'])]);
        expect(nextQuest(ORDER, new Set(ORDER), elig, new Set())).toBe('doric');
    });
    test('unpicked quests are invisible', () => {
        const elig = new Map([e('doric', 'READY'), e('sheep', 'READY')]);
        expect(nextQuest(ORDER, new Set(['sheep']), elig, new Set())).toBe('sheep');
    });
    test('parked quests defer to unparked, then retry', () => {
        const elig = new Map([e('doric', 'READY'), e('sheep', 'READY')]);
        expect(nextQuest(ORDER, new Set(['doric', 'sheep']), elig, new Set(['doric']))).toBe('sheep');
        // everything runnable is parked -> retry the parked one
        expect(nextQuest(ORDER, new Set(['doric']), elig, new Set(['doric']))).toBe('doric');
    });
    test('nothing runnable -> null', () => {
        const elig = new Map([e('doric', 'DONE'), e('sheep', 'BLOCKED', ['missing item'])]);
        expect(nextQuest(ORDER, new Set(['doric', 'sheep']), elig, new Set())).toBeNull();
    });
});

describe('queueRows', () => {
    test('def order, picked only, RUNNING and PARKED stamped over eligibility', () => {
        const elig = new Map([e('runemysteries', 'DONE'), e('doric', 'READY'), e('sheep', 'READY'), e('priest', 'BLOCKED', ['qp'])]);
        const rows = queueRows(ORDER, new Set(['runemysteries', 'doric', 'sheep', 'priest']), elig, new Set(['sheep']), 'doric');
        expect(rows.map(r => `${r.id}:${r.status}`)).toEqual([
            'runemysteries:DONE', 'doric:RUNNING', 'sheep:PARKED', 'priest:BLOCKED'
        ]);
        expect(rows[3].reasons).toEqual(['qp']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/quests/engine/queue.test.ts`
Expected: FAIL — cannot resolve `./queue.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/quests/engine/queue.ts`:

```ts
import type { QuestEligibility } from '../types.js';

export type QueueStatus = 'DONE' | 'RUNNING' | 'READY' | 'PARKED' | 'BLOCKED' | 'UNKNOWN';

export interface QueueRow {
    id: string;
    name: string;
    status: QueueStatus;
    reasons: string[];
}

/** READY-and-not-parked first in def order; then parked READY (retry after
 *  everything else had its turn); null when nothing is runnable. Pure. */
export function nextQuest(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>
): string | null {
    const ready = order.filter(id => picked.has(id) && elig.get(id)?.status === 'READY');
    return ready.find(id => !parked.has(id)) ?? ready[0] ?? null;
}

export function queueRows(
    order: string[],
    picked: Set<string>,
    elig: Map<string, QuestEligibility>,
    parked: Set<string>,
    runningId: string | null
): QueueRow[] {
    return order.filter(id => picked.has(id)).map(id => {
        const el = elig.get(id);
        if (id === runningId) {
            return { id, name: el?.name ?? id, status: 'RUNNING', reasons: [] };
        }
        if (!el) {
            return { id, name: id, status: 'UNKNOWN', reasons: ['eligibility not evaluated yet'] };
        }
        if (parked.has(id) && el.status === 'READY') {
            return { id, name: el.name, status: 'PARKED', reasons: ['no progress — parked'] };
        }
        return { id, name: el.name, status: el.status, reasons: el.reasons };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/bot/quests/engine/queue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/bot/quests/engine/queue.ts src/bot/quests/engine/queue.test.ts
git commit -m "feat(quests): pure queue ordering with parking"
```

---

### Task 4: Step executors

**Files:**
- Create: `src/bot/quests/exec/steps.ts`
- Test: none new (thin I/O wrappers over already-tested primitives; the pure pieces live in Tasks 1–3 and each quest's decide() tests. Live behavior is covered by the Task 12 smoke.)

**Interfaces:**
- Consumes: `QuestStep`, `LadderHop` (Task 1 / primitives); `gotoNpc`, `talkThrough` from `./primitives.js`; `Traversal.walkResilient`; queries `Npcs/Locs/GroundItems`; hud `Inventory/Equipment/Bank`; `nearestBank` from `#/bot/api/BankLocations.js`; `Execution`.
- Produces:

```ts
/** Execute one QuestStep. True = the step ran to its success signal; false =
 *  re-decide next loop (walk failed, target missing, timeout). */
export async function executeStep(step: QuestStep, hops: LadderHop[], log: (m: string) => void): Promise<boolean>;
```

**Steps:**

- [ ] **Step 1: Write the implementation** (I/O module — no unit test; typecheck + smoke verify)

`src/bot/quests/exec/steps.ts` — one executor per kind, each following an existing proven pattern (cited):

```ts
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { nearestBank } from '../../api/BankLocations.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import type { QuestStep } from '../engine/types.js';
import { gotoNpc, talkThrough, type LadderHop } from './primitives.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';

/** Walk within `radius` of anchor unless already there (walkResilient — the
 *  clue-solver leg pattern, SolveClue.bankFirst). */
async function ensureAt(anchor: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && anchor.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(anchor, { radius, attempts: 3, timeoutMs: 90_000, log });
}

export async function executeStep(step: QuestStep, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    switch (step.kind) {
        case 'talk': {
            if (!(await gotoNpc(step.stop, hops, log))) {
                return false;
            }
            return talkThrough(step.stop.npc, step.stop.prefer, log);
        }
        case 'grabGround': {
            // CooksAssistant GetEgg pattern: take if visible, else walk the anchor
            const before = Inventory.count(step.item);
            const g = GroundItems.query().name(step.item).within(12).nearest();
            if (!g) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await g.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'pickLoc': {
            const before = Inventory.count(step.item);
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'interactLoc': {
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            if (step.expectItem !== undefined) {
                const item = step.expectItem;
                return Execution.delayUntil(() => Inventory.contains(item), 8000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'useOn': {
            if (!(await ensureAt(step.anchor, 4, log))) {
                return false;
            }
            const held = Inventory.first(step.item);
            if (!held) {
                log(`useOn: no '${step.item}' in the pack`);
                return false;
            }
            const target = step.targetKind === 'npc'
                ? Npcs.query().name(step.target).within(10).nearest()
                : Locs.query().name(step.target).within(10).nearest();
            if (!target) {
                log(`useOn: no '${step.target}' near the anchor`);
                return false;
            }
            const beforeProduct = step.product !== undefined ? Inventory.count(step.product) : 0;
            if (!(await held.useOn(target))) {
                return false;
            }
            if (step.product !== undefined) {
                // COUNT increase, not contains(): repeat products (Ball of wool
                // x20) are already present from the previous pass.
                const product = step.product;
                return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'equip':
            return Equipment.equip(step.item);
        case 'withdraw': {
            // SolveClue.bankFirst pattern: nearest known bank -> openNearest -> withdrawX
            const here = Game.tile();
            const bank = here ? nearestBank(here) : null;
            if (!bank) {
                log('withdraw: no known bank');
                return false;
            }
            if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
                return false;
            }
            if (!(await Bank.openNearest(BANK_NAME, BANK_OP, log))) {
                return false;
            }
            let ok = true;
            for (const it of step.items) {
                if (!(await Bank.withdrawX(it.name, it.qty))) {
                    log(`withdraw: '${it.name}' x${it.qty} failed`);
                    ok = false;
                }
            }
            await Bank.close();
            return ok;
        }
        case 'mineRock': {
            // GatheringBot mining idiom, minimal: interact the named rock, wait for ore
            const before = Inventory.count(step.item);
            if (before >= step.qty) {
                return true;
            }
            const rock = Locs.query().name(step.rock).action('Mine').within(10).nearest();
            if (!rock) {
                return ensureAt(step.anchor, 3, log);
            }
            if (!(await rock.interact('Mine'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 20_000);
        }
        case 'custom':
            return step.run(log);
        case 'wait':
            await Execution.delayTicks(2);
            return true;
        case 'done':
            return true;
    }
}
```

NOTE for the implementer: verify `Bank.close()` exists (grep `close` in `src/bot/api/hud/Bank.ts`); if the repo idiom differs (e.g. `Bank.exit()` or pressing Escape), use that. Verify `InvItem.useOn` accepts both npc and loc wrappers (CooksAssistant `bucket.useOn(cow)` proves npc; grep a loc example — FlaxSpinner or SmelterBot use-on-furnace). `mineRock` matching by loc NAME is deliberately naive here — every rock is literally named "Rocks" in-game; Task 8 (Doric) refines the executor to resolve the ore type through `MiningRocks.ts`'s rock-id mapping (the `ROCK_OPTIONS` machinery GatheringBot already uses) so `rock: 'Clay'` mines clay rocks specifically.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit` (or the repo's typecheck script)
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/bot/quests/exec/steps.ts
git commit -m "feat(quests): QuestStep executors over proven leg patterns"
```

---

### Task 5: RuneMysteries def (the port)

**Files:**
- Create: `src/bot/quests/defs/runemysteries.ts`
- Create: `src/bot/quests/defs/index.ts`
- Test: `src/bot/quests/defs/runemysteries.test.ts`

**Interfaces:**
- Consumes: `QuestModule`, `QuestSnapshot`, `QuestStep` (Task 1); `NpcStop`/`LadderHop` (primitives); `F2P` records from `../data/f2p.js`.
- Produces:
  - `defs/runemysteries.ts`: `export const runemysteries: QuestModule` and, for tests, `export function decide(snap: QuestSnapshot): QuestStep`.
  - `defs/index.ts`: `export const QUEST_DEFS: QuestModule[]` — **run order**: `[runemysteries, doric, sheepshearer, restlessghost, cooksassistant, romeojuliet]` (grown as later tasks land; starts with just runemysteries; R&J last — its berries are an imp-drop grind) and `export function defById(id: string): QuestModule | undefined`.
  - Shared wizard-tower data other defs reuse: `export const WIZARD_HOPS: LadderHop[]` (the two tower-ladder hops, verbatim from `scripts/RuneMysteries.ts:91-94`).

**Steps:**

- [ ] **Step 1: Write the failing test**

`src/bot/quests/defs/runemysteries.test.ts` — port `scripts/RuneMysteries.test.ts` to the module shape. The held-item logic collapses into `decide` reading `snap.inv`:

```ts
import { expect, test, describe } from 'bun:test';
import { decide } from './runemysteries.js';
import type { QuestSnapshot } from '../../engine/types.js';

const snap = (journal: string, items: string[] = [], noProgress = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items.map(n => [n, 1])),
    worn: new Set(),
    noProgress
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);

describe('runemysteries decide', () => {
    test('journal drives the ends', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(npcOf(decide(snap('notStarted')))).toBe('Duke Horacio');
    });
    test('held item drives the deliveries (exact full-name CI match)', () => {
        expect(npcOf(decide(snap('inProgress', ['air talisman'])))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', ['research package'])))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', ['notes'])))).toBe('Sedridor');
        // 'Notes' is generic — substring must NOT match; empty-handed probe applies
        expect(npcOf(decide(snap('inProgress', ['research notes'])))).toBe('Aubury');
    });
    test('inProgress empty-handed rotates the RECOVER probe Aubury -> Sedridor -> Duke via noProgress', () => {
        // Same probe order as the old bot's recoverOrder (RuneMysteries.ts:134-136);
        // rotation now comes from the engine watchdog count instead of module state.
        expect(npcOf(decide(snap('inProgress', [], 0)))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', [], 1)))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', [], 2)))).toBe('Duke Horacio');
        expect(npcOf(decide(snap('inProgress', [], 3)))).toBe('Aubury'); // wraps
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/bot/quests/defs/runemysteries.test.ts`
Expected: FAIL — cannot resolve `./runemysteries.js`.

- [ ] **Step 3: Write the implementation**

`src/bot/quests/defs/runemysteries.ts` — constants moved VERBATIM from `scripts/RuneMysteries.ts` (tiles are probe-verified; do not retype them, copy them):

```ts
import Tile from '../../api/Tile.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Tiles/dialogue verbatim from scripts/RuneMysteries.ts (probe-verified;
// dialogue from the quest .rs2 sources — see that file's header).
const DUKE: NpcStop = { npc: 'Duke Horacio', anchor: new Tile(3212, 3220, 1), leash: 6, prefer: ['Have you any quests for me?', 'Sure, no problem.'] };
const SEDRIDOR: NpcStop = { npc: 'Sedridor', anchor: new Tile(3103, 9572, 0), leash: 8, prefer: ["I'm looking for the head wizard.", 'Ok, here you are.', 'Yes, certainly.'], approach: [new Tile(3108, 9572, 0)] };
const AUBURY: NpcStop = { npc: 'Aubury', anchor: new Tile(3253, 3402, 0), leash: 8, prefer: ['I have been sent here with a package for you.'] };

export const WIZARD_HOPS: LadderHop[] = [
    { stand: new Tile(3105, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];

const TALK = (stop: NpcStop): QuestStep => ({ kind: 'talk', stop });

// Empty-handed mid-quest probes, same fixed order as the old recoverOrder
// (RuneMysteries.ts:134-136): Aubury first is also the quest's REQUIRED second
// talk after handing him the package; each NPC's dialogue re-gives its own
// lost item.
const RECOVER_PROBES: NpcStop[] = [AUBURY, SEDRIDOR, DUKE];

/** Port of nextStep(journal, held) — held-item logic inlined over snap.inv
 *  (exact CI full-name equality, most-advanced wins; RuneMysteries.ts:26-38).
 *  The old bot's rotating recoverIdx becomes snap.noProgress % probes: the
 *  engine watchdog count IS the rotation, so decide stays pure. */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return TALK(DUKE);
    }
    if (snap.inv.has('notes') || snap.inv.has('air talisman')) {
        return TALK(SEDRIDOR);
    }
    if (snap.inv.has('research package')) {
        return TALK(AUBURY);
    }
    return TALK(RECOVER_PROBES[snap.noProgress % RECOVER_PROBES.length]);
}

export const runemysteries: QuestModule = {
    record: F2P.find(r => r.id === 'runemysteries')!,
    hops: WIZARD_HOPS,
    decide
};
```

`src/bot/quests/defs/index.ts`:

```ts
import type { QuestModule } from '../engine/types.js';
import { runemysteries } from './runemysteries.js';

/** Implemented quests, in RUN ORDER (cheapest/most-certain first). */
export const QUEST_DEFS: QuestModule[] = [runemysteries];

export function defById(id: string): QuestModule | undefined {
    return QUEST_DEFS.find(d => d.record.id === id);
}
```

Behavior parity note for the reviewer: the old bot's `noteTalked`/`recoverIdx` rotation survives exactly — `snap.noProgress` (the engine watchdog count, reset on any journal/inventory change) replaces the module-level counter, so an unchanged (journal, held) signature advances the probe just like before. No module state anywhere.

- [ ] **Step 4: Run tests**

Run: `bun test src/bot/quests/defs/runemysteries.test.ts`
Expected: PASS. Also run `bun test src/bot/scripts/RuneMysteries.test.ts` — still PASS (old bot untouched until Task 13).

- [ ] **Step 5: Commit**

```bash
git add src/bot/quests/defs/runemysteries.ts src/bot/quests/defs/index.ts src/bot/quests/defs/runemysteries.test.ts
git commit -m "feat(quests): RuneMysteries ported to QuestModule def"
```

---

### Task 6: QuestEngine + AIOQuester bot + registration

**Files:**
- Create: `src/bot/quests/engine/QuestEngine.ts`
- Create: `src/bot/scripts/AIOQuester.ts`
- Modify: `src/bot/scripts/index.ts` (register AIOQuester in the Quest category)
- Test: manual typecheck + Task 7 smoke (engine is live I/O; its pure parts were Tasks 1–3)

**Interfaces:**
- Consumes: everything above; `evaluate` from `../EligibilityEvaluator.js`; `Quests/Skills/Bank/Inventory/Equipment` hud APIs; `ContinueDialog` task; `EventSignal`; `Paint`; `ScriptRunner`.
- Produces:
  - `QuestEngine` — a `Task` (the RuneMysteries `QuestStep`-task pattern) with `validate()`/`execute()`, constructor `new QuestEngine(host: AIOQuester)`.
  - `AIOQuester` (default export) — TaskBot; settings schema `AIO_SETTINGS: SettingsSchema` with `quests: { type: 'string[]', default: [] /* empty = all implemented */, options: QUEST_DEFS.map(d => d.record.id), label: 'Quest queue (empty = all)' }`.
  - Host accessors QuestEngine uses: `host.pickedIds(): Set<string>`, `host.noteState(rows: QueueRow[], runningId: string | null, stepDesc: string): void` (feeds the paint), `host.log`.

**Engine `execute()` — one pass per loop (the whole live orchestration):**

```ts
// Pseudocode contract — implement with real APIs; every helper named here exists.
// 1. eligibility sweep (QuestDashboard.readPlayerState/readItemSnapshot logic,
//    inlined here over QUEST_DEFS records only — NOT all 63 records)
// 2. runningId ??= nextQuest(order, picked, elig, parked)
//    - none -> host.noteState(rows, null, 'queue drained'); log per-quest reasons; ScriptRunner.stop()
// 3. module = defById(runningId)
//    snapshot = { journal: Quests.status(record.name), inv: lowercased Inventory counts,
//                 worn: lowercased Equipment names, noProgress: watchdog's current count }
// 4. if journal === 'complete': log QP, parked.delete(id), provisioned.delete(id), runningId = null, return
// 5. provisioning — ONLY until first satisfied for this quest (a `provisioned: Set<id>` guard;
//    without it, quests that CONSUME their items (Doric's ores, Fred's wool) would re-gather
//    forever after handing them in):
//    if (!provisioned.has(id)) {
//      plan = planProvisioning(record.items, snapshot.inv, lastBankCounts)
//      - plan.satisfied -> provisioned.add(id)  // fall through to decide
//      - plan.blocked.length && !plan.withdraw.length -> mark blocked locally, park, runningId = null, return
//      - plan.withdraw.length -> step = { kind: 'withdraw', items: plan.withdraw }
//      - else if plan.gather.length -> step = module.gather?.[plan.gather[0].name.toLowerCase()]
//                                              ?.(snapshot, plan.gather[0].need)
//           (no gather fn for an acquirable item = def bug -> log ERROR, park)
//    }
//    else step = module.decide(snapshot)
// 6. ok = await executeStep(step, module.hops ?? [], log)
// 7. if ok && step.kind advanced the world: count = watchdog.note(progressSignature(freshSnapshot()))
//    - count === NO_PROGRESS_WARN -> log WARN (check prefer lists)
//    - count >= NO_PROGRESS_PARK -> parked.add(id); watchdog.reset(); runningId = null
// 8. update lastBankCounts whenever Bank.isOpen() (QuestDashboard.readItemSnapshot idiom)
```

`validate()`: `!ChatDialog.canContinue() && Game.tile() !== null` (RuneMysteries' guard). `AIOQuester.onStart` adds `new ContinueDialog(), new QuestEngine(this)`. `EventSignal.pending()` is already honored inside `talkThrough`; the engine also returns early from `execute()` when it's pending (RockCrab idiom) so randoms clear fast.

**Paint (in `AIOQuester.onPaint`, the ArdyThiever tab idiom):**

```ts
const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c8a2ff' });
p.title(`AIOQuester — ${this.status}`);
const tab = p.tabs('aio', ['Queue', 'Current']);
if (tab === 'Queue') {
    p.row(`QP: ${Quests.points()}`, `Done ${doneCount}/${rows.length}`);
    for (const r of rows) {          // one line per picked quest
        p.text(`${ICON[r.status]} ${r.name}${r.reasons.length ? ' — ' + r.reasons[0] : ''}`,
               r.status === 'RUNNING' ? undefined : '#8a919a');
    }
} else {
    p.row(`Quest: ${runningName ?? '—'}`, `Step: ${stepDesc}`);
    p.row(`No-progress: ${watchdogCount}`, `Parked: ${parkedCount}`);
}
p.gap();
const clicked = p.buttons([
    { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
    { id: 'skip', label: 'Skip quest' },
    { id: 'stop', label: 'Stop' }
]);
// pause/stop: the standard fleet handler; skip: host.requestSkip() -> engine parks the running quest
```

`ICON = { DONE: '✓', RUNNING: '▶', READY: '·', PARKED: '⏸', BLOCKED: '✗', UNKNOWN: '?' }`.

**Registration** in `src/bot/scripts/index.ts` (Quest category, after QuestDashboard):

```ts
ScriptRegistry.register({
    name: 'AIOQuester',
    description: 'All-in-one quest completer — queues the implemented quests (empty selection = all), provisions items bank-first, runs each to journal-complete',
    category: 'Quest',
    tags: ['f2p', 'quest', 'queue', 'aio'],
    settingsSchema: AIO_SETTINGS,
    create: () => new AIOQuester()
});
```

**Steps:**

- [ ] **Step 1: Implement `QuestEngine.ts` per the execute() contract above**
- [ ] **Step 2: Implement `AIOQuester.ts` (settings, status plumbing, paint, skip button) + register in `scripts/index.ts`**
- [ ] **Step 3: Typecheck + full unit suite**

Run: `bunx tsc --noEmit && bun test src/bot/quests`
Expected: clean; all engine tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/bot/quests/engine/QuestEngine.ts src/bot/scripts/AIOQuester.ts src/bot/scripts/index.ts
git commit -m "feat(quests): AIOQuester bot — queue engine, provisioning, paint"
```

---

### Task 7: AIO smoke — Rune Mysteries parity

**Files:**
- Create: `tools/aio-quest-test.ts`

**Interfaces:**
- Consumes: `mainlandAccount`, `startScript` from `tools/tutorial/harness.js` (the `rune-mysteries-test.ts` skeleton); settings URL override `?AIOQuester.quests=<ids>` (Settings URL format: `?<ScriptName>.<key>=<value>`, comma-separated for string[]).
- Produces: `bun tools/aio-quest-test.ts [base-url] [username] [quests-csv] [budget-min]` — generic runner used by every later quest task. PASS = every picked quest's journal `complete` + runner stopped.

**Steps:**

- [ ] **Step 1: Write the smoke** — copy `tools/rune-mysteries-test.ts` and generalize: quests come from argv (default `runemysteries`), the snapshot reports each picked quest's journal via `Quests.status(name)` (map ids → display names via a small inline table copied from `quests/data/f2p.ts` names), budget from argv (default 25 min). Start via `startScript(page, 'AIOQuester')` after navigating with the `?AIOQuester.quests=` URL override (check how `startScript` builds the URL — `smoke settings via rs2b0t:set:<Script>:<key>` localStorage raw strings is the existing alternative; use whichever the harness already supports, citing `shop` smokes as the precedent for settings injection).
- [ ] **Step 2: Deploy + run it live for Rune Mysteries**

```bash
tools/deploy-local.sh
bun tools/aio-quest-test.ts http://localhost:8890 '' runemysteries 25
```

Expected: `PASS` — journal complete, QP ≥ 1, runner stopped. This is the port-parity gate: same quest, new engine.
- [ ] **Step 3: Commit**

```bash
git add tools/aio-quest-test.ts
git commit -m "test(quests): parameterized AIO quest smoke; RuneMysteries parity PASS"
```

---

### Task 8: Doric's Quest def

Research (all cites `~/code/content/`): varp `%doricquest` stages 0/10/100; **two conversations required** — starting sets stage 10 and the dialogue ENDS (`quest_doric.rs2:57-62`); the material check lives only in the stage-10 branch (`quest_doric.rs2:68-89`), where hand-in is automatic and atomic (checks ≥6 Clay / ≥4 Copper ore / ≥2 Iron ore, `inv_del`s exactly 6/4/2, +180 coins, +1300 Mining XP, 1 QP). Item display names from `skill_mining/configs/ores.obj:13,27,59`: `Clay`, `Copper ore`, `Iron ore`. Doric spawn: npc 284 at `maps/m46_53.jm2:5943` → **(2952, 3451, 0)**, indoors (a door on the hut — the walker's door handling covers it; LIVE-VERIFY). Journal-name quirk: the quest LIST entry is `Doric's Quest` (matches `f2p.ts`; `Quests.status` reads the list) while the journal HEADER is misspelled `Dorics' Quest` — no code change needed, noted so nobody "fixes" the record.

**Files:**
- Create: `src/bot/quests/defs/doric.ts`
- Modify: `src/bot/quests/defs/index.ts` (append `doric` to `QUEST_DEFS`)
- Modify: `src/bot/quests/exec/steps.ts` (mineRock resolves ore→rock ids via `MiningRocks.ts`)
- Test: `src/bot/quests/defs/doric.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `NpcStop`; `F2P` record id `'doric'`.
- Produces: `export const doric: QuestModule`, `export function decide(...)`, `export function gatherOre(snap: QuestSnapshot, item: 'Clay' | 'Copper ore' | 'Iron ore', need: number): QuestStep`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, describe } from 'bun:test';
import { decide, gatherOre } from './doric.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('doric decide', () => {
    test('always talks to Doric until complete (start at 0, auto hand-in at stage 10)', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Doric');
        const s2 = decide(snap('inProgress', [['clay', 6], ['copper ore', 4], ['iron ore', 2]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Doric');
        expect(decide(snap('complete')).kind).toBe('done');
    });
});

describe('gatherOre', () => {
    test('mines with a pickaxe held', () => {
        const s = gatherOre(snap('inProgress', [['bronze pickaxe', 1]]), 'Clay', 6);
        expect(s.kind).toBe('mineRock');
        if (s.kind === 'mineRock') { expect(s.rock).toBe('Clay'); expect(s.qty).toBe(6); }
    });
    test('no pickaxe -> wait (watchdog will park with a visible reason)', () => {
        const s = gatherOre(snap('inProgress'), 'Clay', 6);
        expect(s.kind).toBe('wait');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL** (`bun test src/bot/quests/defs/doric.test.ts`)

- [ ] **Step 3: Implement**

`src/bot/quests/defs/doric.ts`:

```ts
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: quest_doric.rs2 (start :34-62, hand-in :68-89); ores.obj:13,27,59.
// Doric spawn npc 284 @ m46_53.jm2:5943 -> (2952,3451,0), indoors (door on hut).
const DORIC: NpcStop = {
    npc: 'Doric', anchor: new Tile(2952, 3451, 0), leash: 6,
    prefer: ['I wanted to use your anvils.', 'Yes, I will get you materials.']
};

// Gather fallback: Rimmington mine — the one SURFACE mine with clay + copper +
// iron in one cluster (LostHQ; the quest scripts don't dictate a mine). Anchor
// is the mine centre; refine per-ore anchors during the live smoke.
// LIVE-VERIFY (3001, 3245) against the baked pack before trusting.
const RIMMINGTON_MINE = new Tile(3001, 3245, 0);

function hasPickaxe(snap: QuestSnapshot): boolean {
    for (const name of snap.inv.keys()) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    return false;
}

export function gatherOre(snap: QuestSnapshot, item: 'Clay' | 'Copper ore' | 'Iron ore', need: number): QuestStep {
    if (!hasPickaxe(snap)) {
        // Tutorial accounts carry a bronze pickaxe; without one the quest parks
        // visibly rather than half-starting (mustHave semantics would be wrong —
        // the ores themselves may be banked next time).
        return { kind: 'wait', reason: `need a pickaxe to mine ${need} ${item}` };
    }
    return { kind: 'mineRock', rock: item, item, qty: need, anchor: RIMMINGTON_MINE };
}

/** Two talks total: stage 0 starts (dialogue ends, quest_doric.rs2:62); stage
 *  10 hand-in is automatic when >=6/>=4/>=2 held (:70-84). Provisioning has
 *  the ores gathered before the first talk, so decide is just "talk to Doric". */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    return { kind: 'talk', stop: DORIC };
}

export const doric: QuestModule = {
    record: F2P.find(r => r.id === 'doric')!,
    gather: {
        'clay': (s, n) => gatherOre(s, 'Clay', n),
        'copper ore': (s, n) => gatherOre(s, 'Copper ore', n),
        'iron ore': (s, n) => gatherOre(s, 'Iron ore', n)
    },
    decide
};
```

`steps.ts` mineRock refinement: replace the name-based `Locs.query().name(step.rock)` with the ore-type mapping `MiningRocks.ts` exposes (read that file first — GatheringBot's `ROCK_OPTIONS` machinery maps 'Clay'/'Copper'/'Iron' to concrete rock loc ids; query by those ids, `.action('Mine')`). Keep the same walk-to-anchor fallback and count-increase success signal. Note `ROCK_OPTIONS` names ('Copper', 'Iron') differ from ore item names ('Copper ore') — map explicitly in the executor: strip a trailing ' ore' / 'Clay' passes through.

Append `doric` to `QUEST_DEFS` in `defs/index.ts`.

- [ ] **Step 4: Run tests — verify PASS**, plus `bunx tsc --noEmit`
- [ ] **Step 5: Live smoke**

```bash
tools/deploy-local.sh
bun tools/aio-quest-test.ts http://localhost:8890 '' doric 40
```
Expected: PASS — walks to Rimmington, mines 6/4/2 (or withdraws if banked), two Doric talks, journal complete, QP +1. Fix any LIVE-VERIFY anchors it exposes (Doric's door, mine tiles) in `doric.ts` before committing.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/doric.ts src/bot/quests/defs/doric.test.ts src/bot/quests/defs/index.ts src/bot/quests/exec/steps.ts
git commit -m "feat(quests): Doric's Quest def — talk x2 + Rimmington ore gather"
```

---

### Task 9: Sheep Shearer def

Research: varp `%sheep` 0/1..20/22; Fred display name **`Fred the Farmer`** (`lumbridge.npc:168`) at **(3189, 3273, 0)** (`m49_51.jm2` `0 53 9`); start options verbatim `"I'm looking for a quest."` then `"Yes okay. I can do that."` (`fred_the_farmer.rs2:12,18,51-55`). Hand-in: automatic loop, one ball/tick, **partials accepted and persisted**; the 20th ball is consumed by the completion queue (+60 coins, +150 Crafting XP, 1 QP — `quest_sheep.rs2:1-7`). Shearing: sheep are NPCs named `Sheep`; **no Shear op — use Shears ON the sheep** (`[opnpcu,sheepunsheered]`, `shear_sheep.rs2`); ~20% escape chance (`random(4)=0`, `:11-15`). Free **Shears** ground spawn **(3152, 3306, 0)** (obj 1735, `m49_51.jm2` `0 16 42`); fallback Lumbridge general store (stock 2). **Spinning wheel** loc `Spinning wheel`, Lumbridge castle **level 1** at **(3209, 3212, 1)** (`m50_50.jm2` `1 9 12`), `forceapproach=south`; use-Wool-on-wheel spins ONE ball per use (`spinning.rs2:1-34`) — chosen over the op2 Spin skill-multi menu for simplicity. Items: `Shears`, `Wool`, `Ball of wool` (crafting.obj / spinning.obj).

**Files:**
- Create: `src/bot/quests/defs/sheepshearer.ts`
- Modify: `src/bot/quests/defs/index.ts` (append)
- Test: `src/bot/quests/defs/sheepshearer.test.ts`

**Interfaces:**
- Produces: `export const sheepshearer: QuestModule`, `export function decide(...)`, `export function gatherBalls(snap: QuestSnapshot, need: number): QuestStep`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, describe } from 'bun:test';
import { decide, gatherBalls } from './sheepshearer.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('sheepshearer gatherBalls', () => {
    test('no shears and short of wool -> grab the free shears spawn', () => {
        expect(gatherBalls(snap('inProgress'), 20).kind).toBe('grabGround');
    });
    test('shears held, short of wool -> shear (custom)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 3]]), 20);
        expect(s.kind).toBe('custom');
    });
    test('enough wool -> spin it (useOn wheel)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 20]]), 20);
        expect(s.kind === 'useOn' && s.target).toBe('Spinning wheel');
    });
});

describe('sheepshearer decide', () => {
    test('notStarted -> Fred; balls held -> Fred (hand-in); complete -> done', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Fred the Farmer');
        const s2 = decide(snap('inProgress', [['ball of wool', 20]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Fred the Farmer');
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('inProgress with no balls -> re-gather (partial hand-in / lost wool recovery)', () => {
        expect(decide(snap('inProgress')).kind).not.toBe('talk');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**
- [ ] **Step 3: Implement**

```ts
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: fred_the_farmer.rs2 (start :10-23,:51-55; hand-in loop :68-89),
// shear_sheep.rs2 (use-Shears-on-Sheep, 20% escape), spinning.rs2:1-34
// (use-Wool-on-wheel = one ball), quest_sheep.rs2:1-7 (completion).
// Spawns: Fred m49_51 (0 53 9)->(3189,3273); Shears obj m49_51 (0 16 42)->(3152,3306);
// wheel m50_50 (1 9 12)->(3209,3212,1) — castle stairs already in stairEdges.json.
const FRED: NpcStop = {
    npc: 'Fred the Farmer', anchor: new Tile(3189, 3273, 0), leash: 6,
    prefer: ["I'm looking for a quest.", 'Yes okay. I can do that.']
};
const SHEARS_SPAWN = new Tile(3152, 3306, 0);
const SHEEP_PEN = new Tile(3188, 3268, 0);
const WHEEL = new Tile(3209, 3212, 1);
const BALLS_NEEDED = 20;

/** One shearing attempt: use Shears on the nearest Sheep; the ~20% escape roll
 *  and "already shorn" both surface as no-wool-gained -> false -> retry. */
async function shearOne(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    const sheep = Npcs.query().name('Sheep').within(8).nearest();
    if (!sheep) {
        await Traversal.walkResilient(SHEEP_PEN, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    if (!shears || !(await shears.useOn(sheep))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Wool') > before, 6000);
}

export function gatherBalls(snap: QuestSnapshot, need: number): QuestStep {
    const wool = snap.inv.get('wool') ?? 0;
    if (wool >= need) {
        // one ball per use (spinning.rs2:1-34); the engine re-calls until need is met
        return { kind: 'useOn', item: 'Wool', targetKind: 'loc', target: 'Spinning wheel', anchor: WHEEL, product: 'Ball of wool' };
    }
    if (!snap.inv.has('shears')) {
        return { kind: 'grabGround', item: 'Shears', anchor: SHEARS_SPAWN };
    }
    return { kind: 'custom', name: 'shear a sheep', run: shearOne };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: FRED }; }
    if ((snap.inv.get('ball of wool') ?? 0) > 0) {
        return { kind: 'talk', stop: FRED }; // hand-in loop takes every ball held; partials persist server-side
    }
    // Mid-quest, empty-handed (partial hand-in then interruption): re-gather.
    // Worst case we over-gather (%sheep already counts handed balls) — surplus
    // wool/balls are cheap; convergence beats tracking an invisible varp.
    return gatherBalls(snap, BALLS_NEEDED);
}

export const sheepshearer: QuestModule = {
    record: F2P.find(r => r.id === 'sheep')!,
    gather: { 'ball of wool': gatherBalls },
    decide
};
```

Append to `QUEST_DEFS`. Note the def imports live APIs ONLY inside the custom `run` closure (`shearOne`) — `decide`/`gatherBalls` stay pure (returning a step that CONTAINS a thunk is pure; running it is not).

- [ ] **Step 4: Run tests — verify PASS**, `bunx tsc --noEmit`
- [ ] **Step 5: Live smoke**

```bash
tools/deploy-local.sh && bun tools/aio-quest-test.ts http://localhost:8890 '' sheep 45
```
Expected: PASS — shears grabbed, ~20 shears (some escapes), wheel spun on level 1, Fred hand-in, +1 QP. Watch the 21-slot inventory pressure (shears + 20 wool) on an account carrying tutorial gear — if the pack overflows, the smoke exposes it; add a deposit-first `withdraw`-step precursor only if actually hit.
- [ ] **Step 6: Commit** (`git add` the three files; message `feat(quests): Sheep Shearer def — shear/spin gather + Fred hand-in`)

---

### Task 10: The Restless Ghost def

Research: varp `%prieststart` 0..5 — stages are journal-INVISIBLE, but inventory/worn disambiguate everything except "talked to ghost yet", which the ghost+skull custom makes idempotent. Facts: start = Father Aereck option `"I'm looking for a quest!"` (`father_aereck.rs2:10,45`); amulet from Father Urhney via `"Father Aereck sent me to talk to you."` then `"He's got a ghost haunting his graveyard."` (`father_urhney.rs2:4,33,50-51`; lost-amulet re-supply option `"I've lost the amulet."` `:6,59-66`). Item display names: **`Ghostspeak amulet`** (NOT "Amulet of Ghostspeak" — that's dialogue prose), **`Skull`** (`quest_priest.obj`). **Amulet must be WORN** (`restless_ghost.rs2:15` checks the `worn` inv). Ghost display name **`Restless ghost`**, spawns ONLY after interacting with the coffin (`check_restlessghost_spawn`, `quest_priest.rs2:28-34`, spawn tile (3249,3194)); progress option `"Yep, now tell me what the problem is."` (`restless_ghost.rs2:21,29`). Coffin: name `Coffin`, shut variant `op1=Open`, open variant `op1=Close`/`op2=Search` (`all.loc:11479-11495`). Skull: ground obj at **(3120, 9565, 0)** in the wizard-tower basement (`quest_priest.rs2:74`) — grab is stage-gated (refused before the ghost talk) and spawns an aggressive level-13 Skeleton the same tick the skull auto-enters the pack — grab-and-run, never fight. Finish: skull ONTO the OPEN coffin (`oplocu` gate `quest_priest.rs2:53-64`; using it on the shut coffin gives "Maybe I should open it first" `:46-51`). +1,125 Prayer XP, 1 QP. Journal name `The Restless Ghost` ✓ f2p.ts.

**Files:**
- Create: `src/bot/quests/defs/restlessghost.ts`
- Modify: `src/bot/quests/defs/index.ts` (append)
- Modify: `src/bot/quests/exec/primitives.ts` (export a `walkWithHops` helper extracted from `gotoNpc`'s hop leg)
- Test: `src/bot/quests/defs/restlessghost.test.ts`

**Interfaces:**
- Produces: `export const restlessghost: QuestModule`, `export function decide(...)`.
- Produces in primitives: `export async function walkWithHops(dest: Tile, radius: number, hops: LadderHop[], log): Promise<boolean>` — cross the surface/underground boundary via the nearest hop when needed, then `walkResilient` to `dest` (this is `gotoNpc` lines 125-142 factored out; `gotoNpc` calls it so behavior is identical).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, describe } from 'bun:test';
import { decide } from './restlessghost.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, inv: string[] = [], worn: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(worn),
    noProgress: 0
});

describe('restlessghost decide', () => {
    test('ends and start', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Aereck');
    });
    test('no amulet anywhere -> Urhney (also the lost-amulet recovery)', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Urhney');
    });
    test('amulet in pack but not worn -> equip', () => {
        expect(decide(snap('inProgress', ['ghostspeak amulet'])).kind).toBe('equip');
    });
    test('amulet worn, no skull -> ghost+skull custom', () => {
        const s = decide(snap('inProgress', [], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('ghost + skull');
    });
    test('skull held -> return-to-coffin custom (works regardless of worn state)', () => {
        const s = decide(snap('inProgress', ['skull'], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('return skull');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**
- [ ] **Step 3: Implement**

First factor `walkWithHops` out of `gotoNpc` in `primitives.ts` (pure extraction — the `needsHop`/nearest-hop/`hopLadder` block plus a `walkResilient` to the destination; `gotoNpc` keeps its staged-approach + trapped-landing logic and calls the helper for the hop leg). Run `bun test src/bot/quests/exec/` after — the existing primitives tests must stay green.

`src/bot/quests/defs/restlessghost.ts`:

```ts
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import Tile from '../../api/Tile.js';
import { talkThrough, walkWithHops, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';
import { WIZARD_HOPS } from './runemysteries.js';

// Facts: father_aereck.rs2, father_urhney.rs2, restless_ghost.rs2,
// quest_priest.rs2 (see the plan's Task 10 research block for line cites).
const AMULET = 'Ghostspeak amulet';
const SKULL = 'Skull';

// LIVE-VERIFY both anchors (guide-derived; church beside Lumbridge castle,
// shack in the SE swamp — the walker's door handling covers both buildings).
const AERECK: NpcStop = { npc: 'Father Aereck', anchor: new Tile(3243, 3206, 0), leash: 6, prefer: ["I'm looking for a quest!"] };
const URHNEY: NpcStop = {
    npc: 'Father Urhney', anchor: new Tile(3147, 3172, 0), leash: 6,
    prefer: ['Father Aereck sent me to talk to you.', "He's got a ghost haunting his graveyard.", "I've lost the amulet."]
};
const GHOST_PREFER = ['Yep, now tell me what the problem is.'];
const COFFIN_STAND = new Tile(3250, 3193, 0); // graveyard beside the coffin — LIVE-VERIFY
const SKULL_TILE = new Tile(3120, 9565, 0);   // basement altar room (quest_priest.rs2:74)

/** Open the coffin when its shut variant (op Open) is present; already-open
 *  (op Close) is left alone. Opening/searching also SPAWNS the ghost
 *  (check_restlessghost_spawn — there is no static ghost spawn). */
async function ensureCoffinOpen(log: (m: string) => void): Promise<void> {
    const shut = Locs.query().name('Coffin').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
    }
}

/** Graveyard talk then basement grab, idempotent: re-talking a stage-3+ ghost
 *  is a harmless status line; a stage-gated skull grab ("looks scary") gains
 *  nothing and the next pass re-talks. Two passes worst case. */
async function ghostAndSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    if (!Npcs.query().name('Restless ghost').within(8).nearest()) {
        log('no ghost after opening the coffin — re-check next loop');
        return false;
    }
    if (!(await talkThrough('Restless ghost', GHOST_PREFER, log))) {
        return false;
    }
    if (!(await walkWithHops(SKULL_TILE, 2, WIZARD_HOPS, log))) {
        return false;
    }
    const skull = GroundItems.query().name(SKULL).within(10).nearest();
    if (!skull) {
        log('no Skull ground item in the altar room');
        return false;
    }
    if (!(await skull.interact('Take'))) {
        return false;
    }
    // skeleton spawns the same tick (quest_priest.rs2:74-77) — do NOT fight;
    // success = skull in pack, and the next decide() walks us straight out.
    return Execution.delayUntil(() => Inventory.contains(SKULL), 8000);
}

/** Skull onto the OPEN coffin (shut coffin refuses — quest_priest.rs2:46-51). */
async function returnSkull(log: (m: string) => void): Promise<boolean> {
    if (!(await walkWithHops(COFFIN_STAND, 2, WIZARD_HOPS, log))) {
        return false;
    }
    await ensureCoffinOpen(log);
    const coffin = Locs.query().name('Coffin').within(6).nearest();
    const skull = Inventory.first(SKULL);
    if (!coffin || !skull) {
        return false;
    }
    if (!(await skull.useOn(coffin))) {
        return false;
    }
    return Execution.delayUntil(() => !Inventory.contains(SKULL), 8000);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: AERECK }; }
    if (snap.inv.has('skull')) { return { kind: 'custom', name: 'return skull', run: returnSkull }; }
    const amuletLower = AMULET.toLowerCase();
    if (!snap.inv.has(amuletLower) && !snap.worn.has(amuletLower)) {
        return { kind: 'talk', stop: URHNEY }; // first visit AND lost-amulet recovery
    }
    if (!snap.worn.has(amuletLower)) {
        return { kind: 'equip', item: AMULET }; // ghost gate checks WORN (restless_ghost.rs2:15)
    }
    return { kind: 'custom', name: 'ghost + skull', run: ghostAndSkull };
}

export const restlessghost: QuestModule = {
    record: F2P.find(r => r.id === 'priest')!,
    hops: WIZARD_HOPS,
    decide
};
```

Deviation note (spec says ONE custom per quest): this quest's bespoke mechanic — the coffin/ghost/skull dance — is split across two custom steps because the two legs happen on opposite sides of a held-item boundary (`Skull` in pack) that decide() can see. One mechanic, two entry points; still zero module state.

Append to `QUEST_DEFS`.

- [ ] **Step 4: Run tests — verify PASS** (`bun test src/bot/quests` — includes the untouched primitives suite), `bunx tsc --noEmit`
- [ ] **Step 5: Live smoke**

```bash
tools/deploy-local.sh && bun tools/aio-quest-test.ts http://localhost:8890 '' priest 40
```
Expected: PASS — Aereck → Urhney (swamp door) → equip → coffin/ghost → basement skull grab (skeleton ignored) → skull into coffin, +1 QP. Fix the three LIVE-VERIFY anchors as found; if the basement walk to (3120,9565) freezes like Sedridor's horseshoe did, add `approach` waypoints to a dedicated NpcStop-less walk (the corridor-mouth trick from `SEDRIDOR_APPROACH`).
- [ ] **Step 6: Commit** (message `feat(quests): Restless Ghost def — coffin/ghost/skull legs over walkWithHops`)

---

### Task 11: Cook's Assistant def (the real one)

Research: `%cookquest` 0/1/2. Start options verbatim `"What's wrong?"` then `"Yes, I'll help you."` (`quest_cook.rs2:2,29,32`). Hand-in needs ALL THREE simultaneously (`:45`), no partials, one conversation, then +300 Cooking XP, 1 QP. Items (verified .obj): `Egg`, `Bucket of milk`, `Pot of flour`, `Pot`, `Grain`. **Windmill** (3166,3307; ladders already in stairEdges.json at (3165,3307) 0↔1↔2): hopper + **Hopper controls** (`op1=Operate`) on **level 2**; **Flour bin** (`op1=Empty`) on level 0; sequence = use Grain on `Hopper` (no click-op — it is only a use-target, `windmills.rs2:93-94`) → `Operate` controls (`:96-118`, mills exactly 1 grain) → `Empty` bin holding an empty `Pot` (`:58-75`). Flour state is per-player varps — a fresh bot ALWAYS runs the full fill→operate→collect cycle. Journal-name quirk: quest LIST says `Cook's Assistant` (matches f2p.ts ✓); the journal popup header is "The Cook's Quest" — irrelevant to `Quests.status`.

**Files:**
- Create: `src/bot/quests/defs/cooksassistant.ts`
- Modify: `src/bot/quests/defs/index.ts` (append)
- Test: `src/bot/quests/defs/cooksassistant.test.ts`

**Interfaces:**
- Produces: `export const cooksassistant: QuestModule`, `export function decide(...)`, `export function gatherFlour(snap: QuestSnapshot): QuestStep`, `export function gatherMilk(snap: QuestSnapshot): QuestStep`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test, describe } from 'bun:test';
import { decide, gatherFlour, gatherMilk } from './cooksassistant.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('cooksassistant gathers', () => {
    test('flour: pot first, then grain, then the mill custom', () => {
        expect(gatherFlour(snap('inProgress')).kind).toBe('grabGround');            // no Pot
        expect(gatherFlour(snap('inProgress', [['pot', 1]])).kind).toBe('pickLoc'); // no Grain
        expect(gatherFlour(snap('inProgress', [['pot', 1], ['grain', 1]])).kind).toBe('custom');
    });
    test('milk: bucket first, then use it on a cow', () => {
        expect(gatherMilk(snap('inProgress')).kind).toBe('grabGround');
        const s = gatherMilk(snap('inProgress', [['bucket', 1]]));
        expect(s.kind === 'useOn' && s.target).toBe('Cow');
    });
});

describe('cooksassistant decide', () => {
    test('notStarted and full-handed both talk to the Cook', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Cook');
        const s2 = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1], ['pot of flour', 1]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Cook');
    });
    test('inProgress missing an ingredient self-heals through the gathers', () => {
        const s = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1]]));
        expect(s.kind).not.toBe('talk'); // goes flour-gathering instead of nagging the Cook
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**
- [ ] **Step 3: Implement**

```ts
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: quest_cook.rs2 (start :2,29,32; all-three hand-in gate :45,:81-84),
// windmills.rs2 (fill :77-94, operate :96-118, bin :58-75). Tiles: egg/bucket/
// cow/wheat verbatim from the retired scripts/CooksAssistant.ts (live-proven);
// mill (3166,3307) from hopper.param; ladders already in stairEdges.json.
const COOK: NpcStop = { npc: 'Cook', anchor: new Tile(3209, 3215, 0), leash: 6, prefer: ["What's wrong?", "Yes, I'll help you."] };
const EGG_PEN = new Tile(3227, 3300, 0);
const FARMHOUSE_BUCKET = new Tile(3225, 3294, 0);
const COW_FIELD = new Tile(3255, 3288, 0);
const WHEAT_FIELD = new Tile(3158, 3300, 0);
const POT_SPAWN = new Tile(3208, 3213, 0);    // castle kitchen table — LIVE-VERIFY
const MILL_TOP = new Tile(3166, 3306, 2);     // hopper floor (level 2) — LIVE-VERIFY exact stand
const MILL_BASE = new Tile(3166, 3306, 0);    // flour bin floor

/** Fill (use Grain on Hopper) -> Operate controls -> Empty bin with the Pot.
 *  Flour state is per-player varps (hopper.varp) so the full cycle always
 *  runs; each leg re-checks live state, so an interrupted pass resumes. */
async function millFlour(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(MILL_TOP, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const grain = Inventory.first('Grain');
    const hopper = Locs.query().name('Hopper').within(4).nearest();
    if (grain && hopper) {
        await grain.useOn(hopper);           // "You put the grain in the hopper." (windmills.rs2:85)
        await Execution.delayTicks(2);
    }
    const controls = Locs.query().name('Hopper controls').action('Operate').within(4).nearest();
    if (!controls) {
        log('no Hopper controls on the top floor');
        return false;
    }
    await controls.interact('Operate');       // "The grain slides down the chute." (:113)
    await Execution.delayTicks(2);
    if (!(await Traversal.walkResilient(MILL_BASE, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const bin = Locs.query().name('Flour bin').within(4).nearest();
    if (!bin || !(await bin.interact('Empty'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains('Pot of flour'), 8000);
}

export function gatherFlour(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('pot')) {
        return { kind: 'grabGround', item: 'Pot', anchor: POT_SPAWN };
    }
    if (!snap.inv.has('grain')) {
        return { kind: 'pickLoc', loc: 'Wheat', op: 'Pick', item: 'Grain', anchor: WHEAT_FIELD };
    }
    return { kind: 'custom', name: 'mill flour', run: millFlour };
}

export function gatherMilk(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has('bucket')) {
        return { kind: 'grabGround', item: 'Bucket', anchor: FARMHOUSE_BUCKET };
    }
    return { kind: 'useOn', item: 'Bucket', targetKind: 'npc', target: 'Cow', anchor: COW_FIELD, product: 'Bucket of milk' };
}

const gatherEgg = (): QuestStep => ({ kind: 'grabGround', item: 'Egg', anchor: EGG_PEN });

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: COOK }; }
    // Hand-in needs ALL THREE at once (quest_cook.rs2:45) — self-heal any gap
    // (item lost after provisioning) instead of nagging the Cook.
    if (!snap.inv.has('egg')) { return gatherEgg(); }
    if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
    if (!snap.inv.has('pot of flour')) { return gatherFlour(snap); }
    return { kind: 'talk', stop: COOK };
}

export const cooksassistant: QuestModule = {
    record: F2P.find(r => r.id === 'cook')!,
    gather: {
        'egg': gatherEgg,
        'bucket of milk': gatherMilk,
        'pot of flour': gatherFlour
    },
    decide
};
```

Append to `QUEST_DEFS`.

- [ ] **Step 4: Run tests — verify PASS**, `bunx tsc --noEmit`
- [ ] **Step 5: Live smoke**

```bash
tools/deploy-local.sh && bun tools/aio-quest-test.ts http://localhost:8890 '' cook 45
```
Expected: PASS — this is the quest the old bot could never finish; the mill cycle (level-2 climb via stairEdges) is the headline check. LIVE-VERIFY the Pot spawn tile and the exact hopper/controls stand tiles; fix in the def.
- [ ] **Step 6: Commit** (message `feat(quests): Cook's Assistant def — full windmill flour cycle`)

---

### Task 12: Romeo & Juliet def

Research — **major source finding**: this server has **NO cadava bush**; `cadavaberries` enter the world ONLY as an imp drop (`drop tables/scripts/imp.rs2:67`, ~4/128 ≈ 3% per kill). The f2p.ts comment ("cadava berries picked from bushes") is wrong for this content. Stages `%rjquest` 0/10/20/30/40/50/60/200 are journal-invisible; `Message` and `Cadava potion` disambiguate 20 and 50→60; the rest need the noProgress probe rotation. NPCs (varrock.npc + map spawns): **Romeo** (3211,3425,0) — start options `"Can I help find her for you?"` then `"Yes, I will tell her."` (`romeo.rs2:21,26`); **Juliet** **(3158,3425, level 1)** — staircase (3155,3435) already in stairEdges.json — options `"I guess I could find him."` / `"Certainly, I will do so straight away!"` (`juliet.rs2:19,23,35`); **Father Lawrence** (3254,3475,0) — auto-dialogue; **Apothecary** (3195,3404,0) — auto on the quest path (its potion menu is non-quest; talkThrough's last-option fallback declines safely). Items: `Cadava berries`, `Message`, `Cadava potion` (`quest_romeojuliet.obj`). Completion: final Romeo talk at stage 60 → **5 QP**. Journal name `Romeo & Juliet` ✓ f2p.ts.

Probe-cycle trace justifying `NO_PROGRESS_PARK = 8` (probe order Juliet → Lawrence → Apothecary → Romeo, berries in pack): stage 30 worst case = J(1) L(2→40) A(3→50) R(4) J(5) L(6) A(7 → berries consumed, potion appears, **signature resets**). Stage 60 = J(1) L(2) A(3) R(4→complete). Max fruitless streak 7 < 8. ✓

**Files:**
- Create: `src/bot/quests/defs/romeojuliet.ts`
- Modify: `src/bot/quests/defs/index.ts` (append — LAST)
- Modify: `src/bot/quests/engine/types.ts` (add `grind?: string[]` to `QuestModule`)
- Modify: `src/bot/quests/data/f2p.ts` (correct the `romeojuliet` comment: berries are an imp drop in this content, not a bush pick; record itself unchanged)
- Modify: `src/bot/scripts/AIOQuester.ts` (aggregate `grindTargets()` from the active module — see below)
- Test: `src/bot/quests/defs/romeojuliet.test.ts`

**Interfaces:**
- Consumes: adds `grind?: string[]` to `QuestModule` (one-line addition to `engine/types.ts`): NPC names the quest legitimately fights, surfaced through `AIOQuester.grindTargets()` so the runtime event guard never flags them hostile (the ArdyFighter mechanism).
- Produces: `export const romeojuliet: QuestModule`, `export function decide(...)`.

- [ ] **Step 1: Derive the imp-hunt anchor from the content maps** (exact commands; imps classically cluster at the Wizards' Tower, which the bot already routes to):

```bash
grep -n "=imp$" ~/code/content/pack/npc.pack            # -> the imp npc id N
grep -rn "^0 .*: N$" ~/code/content/maps/m48_51.jm2 ~/code/content/maps/m48_52.jm2 ~/code/content/maps/m50_53.jm2 ~/code/content/maps/m49_53.jm2 2>/dev/null | head
# convert level_mx_mz_lx_lz -> abs (x=mx*64+lx, z=mz*64+lz); pick the cluster
# nearest Varrock (or the Wizards' Tower group) and set IMP_ANCHOR to it.
```

- [ ] **Step 2: Write the failing test**

```ts
import { expect, test, describe } from 'bun:test';
import { decide } from './romeojuliet.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, inv: string[] = [], noProgress = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(),
    noProgress
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);

describe('romeojuliet decide', () => {
    test('held items disambiguate their stages', () => {
        expect(npcOf(decide(snap('notStarted')))).toBe('Romeo');
        expect(npcOf(decide(snap('inProgress', ['message'])))).toBe('Romeo');       // deliver message (20->30)
        expect(npcOf(decide(snap('inProgress', ['cadava potion'])))).toBe('Juliet'); // deliver potion (50->60)
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('invisible stages rotate the probe Juliet -> Lawrence -> Apothecary -> Romeo', () => {
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 0)))).toBe('Juliet');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 1)))).toBe('Father Lawrence');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 2)))).toBe('Apothecary');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 3)))).toBe('Romeo');
        expect(npcOf(decide(snap('inProgress', ['cadava berries'], 4)))).toBe('Juliet'); // wraps
    });
});
```

- [ ] **Step 3: Run test — verify FAIL**
- [ ] **Step 4: Implement**

```ts
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: romeo.rs2 / juliet.rs2 / father_lawrence.rs2 / apothecary.rs2;
// spawns from m50_53/m49_53/m50_54.jm2 (see the plan's Task 12 research).
// BERRIES ARE AN IMP DROP in this content (imp.rs2:67) — no cadava bush exists.
const ROMEO: NpcStop = { npc: 'Romeo', anchor: new Tile(3211, 3425, 0), leash: 8, prefer: ['Can I help find her for you?', 'Yes, I will tell her.', 'He sent me to the Apothecary.'] };
const JULIET: NpcStop = { npc: 'Juliet', anchor: new Tile(3158, 3425, 1), leash: 6, prefer: ['I guess I could find him.', 'Certainly, I will do so straight away!'] };
const LAWRENCE: NpcStop = { npc: 'Father Lawrence', anchor: new Tile(3254, 3475, 0), leash: 6, prefer: [] };
const APOTHECARY: NpcStop = { npc: 'Apothecary', anchor: new Tile(3195, 3404, 0), leash: 6, prefer: [] };

const IMP_ANCHOR = new Tile(0, 0, 0); // <- from Step 1 derivation; LIVE-VERIFY

// Stage flow with berries pre-provisioned: 10->Juliet, 30->Lawrence,
// 40/50->Apothecary, 60->Romeo. None are inventory-visible, so rotate; any
// progress (Message appears, berries consumed, journal completes) resets
// noProgress and the held-item branches take over.
const PROBES: NpcStop[] = [JULIET, LAWRENCE, APOTHECARY, ROMEO];

/** Kill imps near the anchor until Cadava berries drop, then loot. ~3%/kill
 *  (imp.rs2:67): expect a grind; the smoke budget accounts for it. */
async function huntImps(log: (m: string) => void): Promise<boolean> {
    const berry = GroundItems.query().name('Cadava berries').within(12).nearest();
    if (berry) {
        if (!(await berry.interact('Take'))) { return false; }
        return Execution.delayUntil(() => Inventory.contains('Cadava berries'), 8000);
    }
    const imp = Npcs.query().name('Imp').action('Attack').within(15).nearest();
    if (!imp) {
        await Traversal.walkResilient(IMP_ANCHOR, { radius: 3, attempts: 2, timeoutMs: 120_000, log });
        return false;
    }
    if (!(await imp.interact('Attack'))) { return false; }
    // wait out the fight; imps also teleport away — either way, re-enter next loop
    await Execution.delayUntil(
        () => GroundItems.query().name('Cadava berries').within(12).nearest() !== null
            || Npcs.query().name('Imp').action('Attack').within(3).nearest() === null,
        30_000
    );
    return false; // not done until the berries branch above succeeds
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: ROMEO }; }
    if (snap.inv.has('cadava potion')) { return { kind: 'talk', stop: JULIET }; }
    if (snap.inv.has('message')) { return { kind: 'talk', stop: ROMEO }; }
    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const romeojuliet: QuestModule = {
    record: F2P.find(r => r.id === 'romeojuliet')!,
    grind: ['Imp'],
    gather: {
        'cadava berries': () => ({ kind: 'custom', name: 'hunt imps for cadava berries', run: huntImps })
    },
    decide
};
```

Engine/types additions: `grind?: string[]` on `QuestModule`; `AIOQuester.grindTargets()` returns the running module's `grind ?? []`. f2p.ts comment fix per Files above. Append to `QUEST_DEFS` (last).

- [ ] **Step 5: Run tests — verify PASS**, `bunx tsc --noEmit`
- [ ] **Step 6: Live smoke** (bigger budget — the imp grind):

```bash
tools/deploy-local.sh && bun tools/aio-quest-test.ts http://localhost:8890 '' romeojuliet 90
```
Expected: PASS — imp hunt → potion chain → two Juliet climbs (stairEdges) → 5 QP. Watch the probe rotation in the logs: fruitless-talk streaks must stay under 8; if a live streak parks the quest before converging, widen `NO_PROGRESS_PARK` (constants exist for this) rather than special-casing.
- [ ] **Step 7: Commit** (message `feat(quests): Romeo & Juliet def — imp-drop berries, probe rotation`)

---

### Task 13: Full-queue acceptance + retirement

**Files:**
- Delete: `src/bot/scripts/RuneMysteries.ts`, `src/bot/scripts/RuneMysteries.test.ts`, `src/bot/scripts/CooksAssistant.ts`, `tools/rune-mysteries-test.ts`
- Modify: `src/bot/scripts/index.ts` (remove the two standalone registrations + imports)
- Modify: whatever smoke-sweep list references `rune-mysteries-test` (grep `rune-mysteries` in `tools/` — it has a LONG entry in the run-all-smokes config; replace it with an `aio-quest-test` LONG entry)

- [ ] **Step 1: The acceptance run — full queue on a fresh account**

```bash
tools/deploy-local.sh
bun tools/aio-quest-test.ts http://localhost:8890 '' runemysteries,doric,sheep,priest,cook,romeojuliet 180
```
Expected: PASS — all six journals `complete`, **10 QP total** (1+1+1+1+1+5), runner stops itself with the queue-drained summary. Do NOT proceed to Step 2 on anything less than a clean PASS; a park/skip in the log is a bug to fix first.

- [ ] **Step 2: Retire the standalone bots** — delete the four files, remove both registrations and their imports from `scripts/index.ts`, update the smoke-sweep entry. Then `bunx tsc --noEmit && bun test src/bot` (all green — the ported defs tests replaced the deleted `RuneMysteries.test.ts` coverage in Task 5).

- [ ] **Step 3: Sweep for stragglers**

```bash
grep -rn "RuneMysteries\|CooksAssistant" src/ tools/ --include="*.ts" | grep -v "quests/defs"
```
Expected: no hits outside comments/docs; fix any.

- [ ] **Step 4: Commit**

```bash
git status --short   # the user commits concurrently — add explicitly
git add -u src/bot/scripts tools/
git add src/bot/scripts/index.ts
git commit -m "feat(quests): retire standalone RuneMysteries + CooksAssistant — AIOQuester owns quests"
```

---

## Execution notes

- Tasks 1–4 are engine-pure and can be built back-to-back; Task 5 gates on 1; Task 6 on 1–5; Task 7 (the parity smoke) gates everything after it — do not build quest defs on an engine that hasn't re-completed Rune Mysteries live.
- Tasks 8–12 are independent of each other (any order, though committed run order is doric → sheep → priest → cook → romeojuliet); each ends with its own live smoke.
- Every live smoke: engine on :8890, `tools/deploy-local.sh` first, run from the MAIN checkout (worktrees lack the collision pack), and remember the smoke deploy clobbers the live build — re-deploy afterwards if the wall is running.
- Anchor tiles marked LIVE-VERIFY are guide-derived starting guesses; the map-derived ones (Doric, Fred, shears, wheel, Romeo, Juliet, Lawrence, Apothecary, skull, mill) are authoritative from `.jm2` spawns but still get confirmed by their smoke.
