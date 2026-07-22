# Black Knight's Fortress Quest Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new AIOQuester quest module (`defs/blackknight.ts`) that completes Black Knight's Fortress end-to-end and is queued like the other 13 quests.

**Architecture:** A standard `QuestModule` (record + pure `decide` + gather + food + grind + bank), one file. `decide()` infers the invisible `%spy` stage from observables (journal + worn disguise + whether the plain Cabbage is still held — the sabotage is the only thing that consumes it). A single re-entrant `infiltrate` custom leg drives the fortress: reach the Grill and Listen, then climb to the Hole and use the Cabbage on it — both ops are safe no-ops at the wrong stage, and listening must precede the sabotage, so no exact stage read is needed.

**Tech Stack:** existing quest engine (`QuestModule`, `QuestStep`, `Reach`, `talkThrough`/`gotoNpc`, `Traversal`), bun test.

## Global Constraints

- Content ground truth (quest_blackknight.rs2 / sir_amik_varze.rs2 / all.loc):
  - Sir Amik Varze @ `(2962,3338,2)` — start prefer `["I seek a quest!", "I laugh in the face of danger!"]`; completes on a plain Talk-to at `%spy=3`.
  - Disguise gate: BOTH `Iron chainbody` (worn torso) + `Bronze med helm` (worn hat) or entry refused.
  - Grill `witchgrill` name `"Grill"` op1 `"Listen-at"` @ `(3025,3508,0)` — eavesdrop at `%spy=1`, else "I can't hear much".
  - Hole `blackknighthole` name `"Hole"` @ `(3031,3508,1)` — USE Cabbage on it (oplocu) at `%spy=2`; `magic_cabbage` rejected.
  - Doors: `Sturdy door`/`Door` op `Open`; secret `Wall` op `Push` (`bksecretdoor`). Black Knights aggro inside (run past).
  - Plain Cabbage = obj 1965 `Cabbage`; the WRONG one is `magic_cabbage` from the Draynor MANOR patch — pick from an ordinary field only.
- `%spy` (quest varp) is NEVER transmitted to the client — never read a varp; decide off `snap.journal` / `snap.inv` / `snap.worn` / `snap.noProgress`.
- User decisions: `food: 4` (run past the knights, eat on low HP); disguise is bank-provided (park "missing" if the bank lacks it).
- Work on `main` (session convention); commit per task; GATE = `bun test 2>&1 | tail -3` (0 fail) + `bunx tsc --noEmit` (silent) + `bunx eslint src/bot/quests/defs/blackknight.ts test/quests/defs/blackknight.test.ts` (clean).
- The quest-bank integrity test (`test/api/bank-locations.test.ts`) already pins every QUEST_DEFS `bank` to a real BANK_LOCATIONS tile — so blackknight's `bank` must be a known tile.

---

### Task 1: Def skeleton, registration, and the decide() state machine (unit-tested)

**Files:**
- Create: `src/bot/quests/defs/blackknight.ts`
- Modify: `src/bot/quests/defs/index.ts` (add to `QUEST_DEFS`)
- Test: `test/quests/defs/blackknight.test.ts`

**Interfaces:**
- Produces: `export function decide(snap: QuestSnapshot): QuestStep`, `export const blackknight: QuestModule`. `infiltrate` + `pickCabbage` are added in Tasks 2–3 (Task 1 stubs them so `decide` compiles/tests).

- [ ] **Step 1: Write the failing decide test** — `test/quests/defs/blackknight.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { decide } from '#/bot/quests/defs/blackknight.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return { journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 0, ...over };
}
const held = (...names: string[]) => new Map(names.map(n => [n.toLowerCase(), 1] as const));
const wearing = (...names: string[]) => new Set(names.map(n => n.toLowerCase()));

describe('Black Knight decide', () => {
    test('complete → done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });
    test('not started → talk Sir Amik', () => {
        const s = decide(snap({ journal: 'notStarted' }));
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Sir Amik Varze');
    });
    test('in progress, disguise not worn → equip a disguise piece', () => {
        const s = decide(snap({ worn: wearing('iron chainbody'), inv: held('Bronze med helm', 'Cabbage') }));
        expect(s.kind).toBe('equip');
        expect(s.kind === 'equip' && s.item).toBe('Bronze med helm'); // the missing piece
    });
    test('in progress, disguise worn, cabbage held → infiltrate', () => {
        const s = decide(snap({ worn: wearing('iron chainbody', 'bronze med helm'), inv: held('Cabbage') }));
        expect(s.kind).toBe('custom');
        expect(s.kind === 'custom' && s.name).toBe('infiltrate');
    });
    test('in progress, disguise worn, cabbage GONE (sabotaged) → talk Sir Amik', () => {
        const s = decide(snap({ worn: wearing('iron chainbody', 'bronze med helm'), inv: new Map() }));
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Sir Amik Varze');
    });
    test('unknown journal → wait', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });
});
```

- [ ] **Step 2: Run it to verify it fails** — `bun test test/quests/defs/blackknight.test.ts` → FAIL (no module).
- [ ] **Step 3: Create `src/bot/quests/defs/blackknight.ts`** with the record, module, and decide (infiltrate/pickCabbage are stubs Tasks 2–3 fill):

```ts
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { talkThrough, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Black Knight's Fortress — content facts from quest_blackknight.rs2 /
// sir_amik_varze.rs2 / all.loc. State is the server varp %spy (0 start -> 1
// investigate -> 2 sabotage -> 3 report -> 4 complete), which is NEVER
// transmitted to the client, so decide() reads OBSERVABLES only: journal colour,
// the worn disguise, and whether the plain Cabbage is still held (the sabotage
// inv_dels it — the only consumer). Listening must precede the sabotage and both
// ops are safe no-ops off-stage, so ONE re-entrant infiltrate leg sequences them.

const SIR_AMIK: NpcStop = { npc: 'Sir Amik Varze', anchor: new Tile(2962, 3338, 2), leash: 6, prefer: ['I seek a quest!', 'I laugh in the face of danger!'] };
const IRON_CHAINBODY = 'Iron chainbody';
const BRONZE_MED_HELM = 'Bronze med helm';

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: SIR_AMIK }; }

    // inProgress. The entrance guard needs BOTH disguise pieces worn — equip the
    // missing one (provisioning withdrew them to the pack). One per pass.
    if (!worn(snap, IRON_CHAINBODY) && has(snap, IRON_CHAINBODY)) { return { kind: 'equip', item: IRON_CHAINBODY }; }
    if (!worn(snap, BRONZE_MED_HELM) && has(snap, BRONZE_MED_HELM)) { return { kind: 'equip', item: BRONZE_MED_HELM }; }

    // Cabbage still held -> still infiltrating (grill Listen + sabotage). Cabbage
    // gone -> the sabotage consumed it (provisioning guaranteed it was held), so
    // the deed is done: report to Sir Amik (his %spy=3 branch completes).
    if (has(snap, 'Cabbage')) { return { kind: 'custom', name: 'infiltrate', run: infiltrate }; }
    return { kind: 'talk', stop: SIR_AMIK };
}

// Filled in Task 2.
async function infiltrate(_log: (m: string) => void): Promise<boolean> { return false; }

export const blackknight: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackknight')!,
    bank: new Tile(2946, 3369, 0), // Falador West — nearest the White Knights' Castle
    food: 4, // carried for the black-knight run; eaten by the AIOQuester hook, never to fight
    // The fortress Black Knights aggro as we pass — whitelist them so the random-
    // event guard never flags them.
    grind: ['black knight', 'aggressive black knight'],
    // Plain Cabbage from an ordinary field (Task 3). NOT the Draynor Manor magic patch.
    gather: {
        'cabbage': () => ({ kind: 'custom', name: 'pick cabbage', run: pickCabbage })
    },
    decide
};

// Filled in Task 3.
async function pickCabbage(_log: (m: string) => void): Promise<boolean> { return false; }
```

- [ ] **Step 4: Register in `defs/index.ts`** — add the import and append to `QUEST_DEFS`:

```ts
import { blackknight } from './blackknight.js';
```
and add `blackknight` to the `QUEST_DEFS` array (end is fine — order is run-priority; a 12-QP quest naturally runs late).

- [ ] **Step 5: Run the tests** — `bun test test/quests/defs/blackknight.test.ts` → PASS (6/6). Then the quest-bank integrity test: `bun test test/api/bank-locations.test.ts` → PASS (blackknight's Falador West tile is a real BANK_LOCATIONS entry).
- [ ] **Step 6: GATE + commit** — `git add src/bot/quests/defs/blackknight.ts src/bot/quests/defs/index.ts test/quests/defs/blackknight.test.ts && git commit -m "feat(quests): Black Knight's Fortress def skeleton + decide state machine"`.

### Task 2: The `infiltrate` custom leg (grill Listen → sabotage)

**Files:**
- Modify: `src/bot/quests/defs/blackknight.ts` (replace the `infiltrate` stub)

**Interfaces:**
- Consumes: `Reach.locOp` (fixed multi-door reach), `Inventory`, `Locs`, `ChatDialog`, `Game`.
- Produces: the live fortress leg; returns false until the Cabbage is consumed (decide then routes to Sir Amik).

- [ ] **Step 1: Replace the `infiltrate` stub** with the real leg:

```ts
const GRILL_STAND = new Tile(3025, 3509, 0); // LIVE-VERIFY: reachable tile beside the Grill (3025,3508,0)
const HOLE_STAND = new Tile(3031, 3509, 1);  // LIVE-VERIFY: reachable tile beside the Hole (3031,3508,1)

/** Fortress infiltration (re-entrant): reach the Grill and Listen (advances
 *  %spy 1->2; a no-op "I can't hear much" once listened), then climb to the Hole
 *  and use the Cabbage on it (advances 2->3, consuming the Cabbage). Both ops
 *  are safe off-stage and listening must precede the sabotage, so this runs them
 *  in sequence without reading %spy. The fixed Reach drives the Sturdy-door /
 *  secret-Wall / aggro nav. False until the Cabbage is gone. */
async function infiltrate(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains('Cabbage')) { return true; } // sabotaged — decide routes to Sir Amik

    // 1) Listen at the Grill (level 0). Reach walks to the stand + opens any door
    //    on the server's "can't reach"; then drive the eavesdrop continues.
    const grillDone = await Reach.locOp({
        name: 'Grill', op: 'Listen-at', near: GRILL_STAND,
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    });
    if (grillDone === 'done') {
        for (let i = 0; i < 30 && ChatDialog.isOpen(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
            await Execution.delayTicks(1);
        }
        return false; // re-enter: next pass does the sabotage
    }
    if (grillDone === 'unreachable') { log('bkf: Grill unreachable — re-planning'); return false; }

    // 2) Sabotage: climb to the Hole (level 1) and use the Cabbage on it.
    const level = Game.tile()?.level ?? 0;
    if (level !== 1) {
        // The hole is one floor up; the fixed Reach climbs the fortress stair/ladder.
        await Reach.locOp({
            name: 'Ladder', op: 'Climb-up', near: HOLE_STAND,
            expect: () => (Game.tile()?.level ?? 0) >= 1, log
        });
        return false;
    }
    const hole = Locs.query().name('Hole').within(8).nearest();
    const cabbage = Inventory.first('Cabbage');
    if (hole && cabbage) {
        const before = Inventory.count('Cabbage');
        await cabbage.useOn(hole);
        await Execution.delayUntil(() => Inventory.count('Cabbage') < before, 6000);
    } else {
        await Traversal.walkResilient(HOLE_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log });
    }
    return false;
}
```

Note: the exact fortress route (which Sturdy doors, the secret Wall push, the ladder to the Hole) is driven by the fixed `Reach` opening doors on the server's "can't reach"; `GRILL_STAND`/`HOLE_STAND` and the Climb-up loc name (`Ladder` vs `Staircase`) are LIVE-VERIFY (Task 5). `Inventory.contains`/`first`/`count` and `Interactable.useOn` already exist (used by BankFletcher/ClueExecutor).

- [ ] **Step 2: Verify `useOn`/`Inventory.first` signatures** — `grep -n "useOn\|first(" src/bot/api/entities/index.ts src/bot/api/hud/Inventory.ts` and confirm `InvItem.useOn(loc)` and `Inventory.first(name)` exist (they do — BankFletcher `knife.useOn(log)`, ClueExecutor `first`). Adjust the call form to match if needed.
- [ ] **Step 3: GATE** — `bun test 2>&1 | tail -3` (0 fail; the decide tests still pass — infiltrate isn't unit-tested, it's live), `bunx tsc --noEmit` (silent), eslint clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(quests): Black Knight infiltrate leg — Grill listen + cabbage sabotage"`.

### Task 3: The `pickCabbage` gather (plain field, never the manor magic patch)

**Files:**
- Modify: `src/bot/quests/defs/blackknight.ts` (replace the `pickCabbage` stub)

- [ ] **Step 1: Replace the `pickCabbage` stub**:

```ts
// A PLAIN cabbage field — the field just south of Falador's south wall (NOT the
// Draynor Manor patch, which grows magic_cabbage the potion rejects). LIVE-VERIFY
// the exact field tile + that the picked obj is 'Cabbage', not 'Cabbage seed'.
const CABBAGE_FIELD = new Tile(3053, 3306, 0); // LIVE-VERIFY

/** Pick one plain Cabbage from an ordinary field (re-entrant; true once held).
 *  The pickable plant is a loc named 'Cabbage' with a 'Pick' op (all.loc
 *  [cabbage]); walk to the field if none is in range. */
async function pickCabbage(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Cabbage')) { return true; }
    const plant = Locs.query().name('Cabbage').action('Pick').within(10).nearest();
    if (!plant) {
        await Traversal.walkResilient(CABBAGE_FIELD, { radius: 4, attempts: 4, timeoutMs: 120_000, log });
        return false;
    }
    const before = Inventory.count('Cabbage');
    if (!(await plant.interact('Pick'))) { return false; }
    await Execution.delayUntil(() => Inventory.count('Cabbage') > before, 6000);
    return false;
}
```

- [ ] **Step 2: GATE** — tests 0 fail, tsc silent, eslint clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(quests): Black Knight cabbage gather — pick a plain field cabbage"`.

### Task 4: Full static regression

- [ ] **Step 1:** `bun test 2>&1 | tail -3` (0 fail — incl. blackknight.test.ts + the quest-bank + queue/eligibility tests), `bunx tsc --noEmit` (silent), `bunx eslint . 2>&1 | tail -2` (frozen-18 baseline only), `bun run build` (exit 0), `bun tools/clues/audit-clues.ts` (unaffected, still 120/2/0).
- [ ] **Step 2:** Fix anything red, commit.

### Task 5: Live verification + LIVE-VERIFY tile pinning

- [ ] **Step 1: Engine up?** `curl -fsS http://localhost:8890/bot.html >/dev/null && echo UP || echo DOWN`; start it if down. Deploy: `sh tools/deploy-local.sh`.
- [ ] **Step 2: Run the quest live** — `bun tools/aio-quest-test.ts http://localhost:8890 <user> blackknight 40 "iron_chainbody:1,bronze_med_helm:1" ""` (the harness seeds the account; give the disguise + 12 QP via its give-csv / a `::setqp 12`-style cheat — confirm the harness supports QP seeding, else add a `::advancestat`-style prep or set the quest-point varp). Watch the journal reach complete + QP +3.
- [ ] **Step 3: Triage** — read the `[bot]` log; the LIVE-VERIFY unknowns to pin from the live run: `GRILL_STAND`/`HOLE_STAND` reachable tiles, the fortress Climb-up loc name (`Ladder` vs `Staircase`), whether the secret `Wall`/`Push` needs an explicit step (if Reach's door-opening doesn't cover a `Push`-op wall — extend `openBlockingDoor`/`isOpenableBarrier` to include `wall`+`push`, or add an explicit push in `infiltrate`), and `CABBAGE_FIELD` + the pick op. Fix each, redeploy, re-run until the journal completes.
- [ ] **Step 4:** Commit the pinned tiles/ops: `git commit -am "fix(quests): Black Knight live-verified tiles/ops (grill/hole/cabbage/route)"`.

### Task 6: Finish

- [ ] **Step 1:** Prune the shipped design docs: `git rm docs/superpowers/specs/2026-07-22-blackknight-fortress-design.md docs/superpowers/plans/2026-07-22-blackknight-fortress.md && git commit -m "chore: prune shipped Black Knight design docs (history keeps them)"`.
- [ ] **Step 2:** Final GATE green. Report: what shipped, the LIVE-VERIFY items pinned, and whether the full live run reached QP +3 (or what remains).
