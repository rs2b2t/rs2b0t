# Conditional Crossings + Al Kharid Toll Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `WalkExecutor` to cross gates that need a precondition and/or a dialogue, and wire the Al Kharid toll gate as the first case (pay 10gp + click the dialogue; skip cleanly if you can't pay).

**Architecture:** A curated `specialCrossings.ts` data table (keyed by loc coord) describes crossings that need more than a plain `Open`. `WalkExecutor.handleTransport` gains a branch: on a matching coord it checks the precondition (skip + avoid if unmet) or drives the dialogue via the existing `ChatDialog` API until the player has crossed. `doors.json` is unchanged — the toll gate stays a routable door edge, and all special behavior is layered at execution time.

**Tech Stack:** Bun + TypeScript. Tests: `bun test` (happy-dom preload via `bunfig.toml`). Live verification: headless Chrome via `playwright-core` against the local engine.

## Global Constraints

- All subagents (implementers, reviewers, fixers) run on **Opus**, not cheaper tiers.
- Unit tests run with `bun test`. Type-check with `npx tsc --noEmit -p tsconfig.json` (expect exit 0). Lint changed files with `npx eslint <files>`.
- Live test prerequisites: engine at `~/code/rs2b2t-engine` running `npm run quickstart` (web :8890), and the local build deployed with `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh` (re-deploy after every source change before a live run).
- Local cheats (staffModLevel 4): `::tele 0,<mx>,<mz>,<lx>,<lz>`, debugprocs `::~<name>` (e.g. `::~maxme`), item spawn `::~item <objname> <count>` (coins objname = `coins`). Debugprocs need the `~`; `::tele` does not. `::~maxme` level-up dialogs swallow the next TYPED command — do state changes before it or clear dialogs via `rs2b0t.actions.continueDialog()`.
- No `lcbuddy`/`lcb-` references. Follow existing file patterns.
- Commit message trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Spec:** `docs/superpowers/specs/2026-07-10-conditional-crossings-alkharid-tollgate-design.md`

**Key domain facts (verified against `~/code/rs2b2t-content`):**
- Toll gate locs `border_gate_toll_left`/`_right`, name `"Gate"`, `op1=Open`, at `(3268,3227,0)` and `(3268,3228,0)`. Already in `doors.json` as two plain `"Gate"` door edges (locIds 2882/2883).
- Opening it runs `area_alkharid/scripts/border_gate.rs2`: a Border-guard dialogue. Non-quest path: NPC "You must pay a toll of 10 gold coins to pass." → 3-option `p_choice3` — pick **"Yes, ok."** → if `coins >= 10`, deletes 10 coins and `p_teleport`s the player to the far side of the gate; if `coins < 10`, "I don't have enough money" and nothing happens.
- Lumbridge is **west** of the gate (x < 3268); Al Kharid is **east** (x > 3268).

---

## Task 1: `specialCrossings` data + pure lookups

**Files:**
- Create: `src/bot/nav/data/specialCrossings.ts`
- Test: `test/bot/nav/specialCrossings.test.ts`

**Interfaces:**
- Produces:
  - `interface SpecialCrossing { x: number; z: number; level: number; locName: string; action: string; requires?: { item: string; count: number }; dialogue?: { choose: string[] }; label: string }`
  - `const SPECIAL_CROSSINGS: SpecialCrossing[]`
  - `specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null`
  - `pickChoice(options: string[], choose: string[]): string | null` — returns the first `options` entry that contains (case-insensitive) any `choose` term, else null.
  - `meetsRequirement(have: number, requires?: { item: string; count: number }): boolean` — true when there is no requirement or `have >= requires.count`.

- [ ] **Step 1: Write the failing test**

Create `test/bot/nav/specialCrossings.test.ts`:

```ts
import { expect, test, describe } from 'bun:test';
import { specialCrossingAt, pickChoice, meetsRequirement, SPECIAL_CROSSINGS } from '../../../src/bot/nav/data/specialCrossings.js';

describe('specialCrossingAt', () => {
    test('matches both Al Kharid toll gate tiles', () => {
        const a = specialCrossingAt(3268, 3227, 0);
        const b = specialCrossingAt(3268, 3228, 0);
        expect(a?.label).toBe('Al Kharid toll gate');
        expect(b?.label).toBe('Al Kharid toll gate');
        expect(a?.requires).toEqual({ item: 'Coins', count: 10 });
        expect(a?.dialogue?.choose).toContain('Yes, ok.');
    });

    test('misses other tiles and other levels', () => {
        expect(specialCrossingAt(3268, 3227, 1)).toBeNull();
        expect(specialCrossingAt(3200, 3200, 0)).toBeNull();
    });

    test('every crossing carries the fields the executor reads', () => {
        for (const c of SPECIAL_CROSSINGS) {
            expect(c.locName.length).toBeGreaterThan(0);
            expect(c.action.length).toBeGreaterThan(0);
            expect(c.label.length).toBeGreaterThan(0);
        }
    });
});

describe('pickChoice', () => {
    test('returns the matching option text (case-insensitive, substring)', () => {
        expect(pickChoice(['No thank you.', 'Who does my money go to?', 'Yes, ok.'], ['yes, ok.'])).toBe('Yes, ok.');
    });
    test('returns null when nothing matches', () => {
        expect(pickChoice(['No thank you.'], ['yes, ok.'])).toBeNull();
    });
});

describe('meetsRequirement', () => {
    test('no requirement is always met', () => {
        expect(meetsRequirement(0, undefined)).toBe(true);
    });
    test('met only at or above the count', () => {
        expect(meetsRequirement(9, { item: 'Coins', count: 10 })).toBe(false);
        expect(meetsRequirement(10, { item: 'Coins', count: 10 })).toBe(true);
        expect(meetsRequirement(11, { item: 'Coins', count: 10 })).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/bot/nav/specialCrossings.test.ts`
Expected: FAIL — cannot resolve `src/bot/nav/data/specialCrossings.js` (module doesn't exist).

- [ ] **Step 3: Write the implementation**

Create `src/bot/nav/data/specialCrossings.ts`:

```ts
/**
 * Crossings that need more than a plain `Open` — a precondition (e.g. a toll
 * fee) and/or a dialogue. Keyed by the loc's own coord + level. WalkExecutor
 * consults this table when it reaches an annotated crossing; a match diverts to
 * the conditional-crossing handler. doors.json still routes through these coords
 * as ordinary door edges, so the pathfinder can use them when the precondition
 * is met and avoid them (repath) when it isn't.
 *
 * This is the curated home for the nav audit's findings — add a row per special
 * gate rather than editing the generated doors.json.
 */
export interface SpecialCrossing {
    x: number;
    z: number;
    level: number;
    /** Loc name + interact op that starts the crossing (matches doors.json). */
    locName: string;
    action: string;
    /** Inventory requirement to attempt the crossing at all. */
    requires?: { item: string; count: number };
    /** Dialogue option text(s) to click while driving the conversation. */
    dialogue?: { choose: string[] };
    /** Human label for logs. */
    label: string;
}

export const SPECIAL_CROSSINGS: SpecialCrossing[] = [
    // Al Kharid toll gate (border_gate_toll_left/right). Opening starts a
    // Border-guard dialogue; "Yes, ok." pays 10 coins and teleports you across.
    { x: 3268, z: 3227, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' },
    { x: 3268, z: 3228, level: 0, locName: 'Gate', action: 'Open', requires: { item: 'Coins', count: 10 }, dialogue: { choose: ['Yes, ok.'] }, label: 'Al Kharid toll gate' }
];

/** The special crossing whose loc sits exactly on (x,z,level), or null. */
export function specialCrossingAt(x: number, z: number, level: number): SpecialCrossing | null {
    return SPECIAL_CROSSINGS.find(c => c.x === x && c.z === z && c.level === level) ?? null;
}

/** First `options` entry containing (case-insensitive) any `choose` term, or null. */
export function pickChoice(options: string[], choose: string[]): string | null {
    const wants = choose.map(c => c.toLowerCase());
    return options.find(o => wants.some(w => o.toLowerCase().includes(w))) ?? null;
}

/** True when there is no requirement, or `have` meets the required count. */
export function meetsRequirement(have: number, requires?: { item: string; count: number }): boolean {
    return !requires || have >= requires.count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/bot/nav/specialCrossings.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit -p tsconfig.json` (expect exit 0), then:

```bash
git add src/bot/nav/data/specialCrossings.ts test/bot/nav/specialCrossings.test.ts
git commit -m "feat(nav): specialCrossings table + lookup for conditional gates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire conditional crossings into `WalkExecutor`

**Files:**
- Modify: `src/bot/nav/WalkExecutor.ts` (imports near top; `handleTransport` ~line 354; add `handleSpecialCrossing`)

**Interfaces:**
- Consumes: `specialCrossingAt`, `pickChoice`, `SpecialCrossing` (Task 1); `Inventory.count(name: string): number` (`src/bot/api/hud/Inventory.js`); `ChatDialog.options(): string[]`, `ChatDialog.canContinue(): boolean`, `ChatDialog.continue(): Promise<boolean>`, `ChatDialog.chooseOption(match?: string): Promise<boolean>` (`src/bot/api/hud/ChatDialog.js`); existing module-local `chebyshev(a, b)`.
- Produces: `WalkExecutor.handleTransport` transparently routes special crossings; no new public surface.

Note: `WalkExecutor` (nav) importing `api/hud` is safe — `api/hud` depends on the adapter/router, not on `nav` (no cycle). No unit test here: the executor is only meaningfully exercisable against a live client (existing nav executor code is verified by the live harnesses, e.g. `tools/nav-test.ts`), so this task is verified by type-check + the full unit suite staying green, then proven end-to-end in Task 3.

- [ ] **Step 1: Add imports**

At the top of `src/bot/nav/WalkExecutor.ts`, alongside the existing `import { Locs, type Loc } ...` line, add:

```ts
import { Inventory } from '../api/hud/Inventory.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { specialCrossingAt, pickChoice, meetsRequirement, type SpecialCrossing } from './data/specialCrossings.js';
```

- [ ] **Step 2: Add a constant for the dialogue-drive budget**

Next to the other module constants near the top (e.g. after `const TRANSPORT_WAIT_MS = 8000;`), add:

```ts
const DIALOGUE_STEPS = 24; // max continue/choose iterations to drive a crossing dialogue
```

- [ ] **Step 3: Branch `handleTransport` to the special-crossing handler**

In `handleTransport`, immediately after `const transport = step.transport!;` (the first line of the method body), insert:

```ts
        const special = specialCrossingAt(transport.locX, transport.locZ, step.level);
        if (special) {
            return this.handleSpecialCrossing(step, special, log);
        }
```

- [ ] **Step 4: Add the `handleSpecialCrossing` method**

Add this method to `WalkExecutorImpl`, directly after `handleTransport`:

```ts
    /**
     * Cross a gate that needs a precondition and/or a dialogue (see
     * specialCrossings.ts). If the precondition is unmet we return false so the
     * caller adds the gate to avoidDoors and repaths (there may be no alternate
     * route — then walkTo ends cleanly instead of hanging on a blocking dialogue,
     * the "ignore if you can't pay" behaviour). If it's met we interact and drive
     * the dialogue (continue through lines, click the configured choice) until the
     * player has crossed to the far tile.
     */
    private async handleSpecialCrossing(step: PathStep, sc: SpecialCrossing, log: (msg: string) => void): Promise<boolean> {
        if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
            log(`${sc.label}: need ${sc.requires.count} ${sc.requires.item} — skipping`);
            return false; // caller: failedDoor() + repath (avoids this gate)
        }

        const loc = this.findTransportLoc({ locName: sc.locName, action: sc.action, locX: sc.x, locZ: sc.z });
        if (!loc) {
            log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
            return false;
        }
        if (!loc.interact(sc.action)) {
            log(`${sc.label}: '${sc.action}' not offered (ops: ${loc.actions().join(', ')})`);
            return false;
        }

        const crossed = (): boolean => {
            const me = reader.worldTile();
            return me !== null && me.level === step.level && chebyshev(me, step) <= 1;
        };
        for (let i = 0; i < DIALOGUE_STEPS && !crossed(); i++) {
            const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
        if (crossed()) {
            log(`${sc.label}: crossed`);
            return true;
        }
        log(`${sc.label}: dialogue did not resolve — repathing`);
        return false;
    }
```

- [ ] **Step 5: Type-check, lint, and run the full unit suite**

Run each; all must pass:
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npx eslint src/bot/nav/WalkExecutor.ts` → exit 0
- `bun test` → 0 failures (unchanged count from before, plus Task 1's 5)

- [ ] **Step 6: Commit**

```bash
git add src/bot/nav/WalkExecutor.ts
git commit -m "feat(nav): drive precondition/dialogue crossings in WalkExecutor

Special crossings (specialCrossings.ts) that need a fee or a dialogue are no
longer treated as plain doors: unmet precondition -> skip + avoid + repath;
met -> interact and drive the dialogue until crossed. Fixes the Al Kharid toll
gate stall.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Live headless proof — `tools/tollgate-test.ts`

**Files:**
- Create: `tools/tollgate-test.ts`

**Interfaces:**
- Consumes: the deployed local build (WalkExecutor with Task 2), the `WalkTo` script + `Al Kharid` WalkDestination, `rs2b0t` dev handle (`.client`, `.runner.ctx.log`, `.reader.worldTile()`, `.reader.inventory()`).

Two phases with one auto-created account teleported to the Lumbridge (west) side of the gate: **Phase B** first (0 coins — a fresh off-tutorial account has none) asserts a clean skip and no crossing; **Phase A** (seed 100 coins) asserts coins drop by 10 and the player ends on the Al Kharid (east) side. Coins-removal is avoided by running the zero-coins phase first.

- [ ] **Step 1: Deploy the current build**

Run: `ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh`
Expected: `deployed: .../public/bot.html ...`. (Engine must already be running `npm run quickstart` on :8890.)

- [ ] **Step 2: Write the harness**

Create `tools/tollgate-test.ts`:

```ts
// Headless live smoke for the Al Kharid toll-gate conditional crossing.
// Phase B (0 coins): walk toward Al Kharid from the Lumbridge side; assert the
// walker SKIPS the toll gate (logs the skip) and does NOT end up east of it.
// Phase A (100 coins): walk again; assert coins drop by 10 and we cross east.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/tollgate-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `tg${Date.now().toString(36).slice(-7)}`;
const GATE_X = 3268;
const WEST = '::tele 0,51,50,3,27'; // (3267,3227) — Lumbridge side, at the gate

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null; count: number }[] };
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
    const coins = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().filter(i => i.name?.toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0));
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const startWalk = () => page.evaluate(() => { const p = (globalThis as never as { rs2b0t: { runner: { start(s: unknown): void }; registry: { get(n: string): unknown } } }).rs2b0t; p.runner.start(p.registry.get('WalkTo')); });
    const stopWalk = () => page.evaluate(() => (globalThis as never as { rs2b0t: { runner: { stop(): void } } }).rs2b0t.runner.stop());

    // WalkTo destination = Al Kharid (bank 3269,3167), east of the gate.
    await page.goto(`${base}/bot.html?WalkTo.destination=Al Kharid`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }

    // ---- Phase B: 0 coins -> must skip the gate ----
    await type(WEST);
    const startB = await tile();
    if (!startB || Math.abs(startB.x - 3267) > 3) { fail(`west tele failed (at ${JSON.stringify(startB)})`); }
    if ((await coins()) >= 10) { fail('expected <10 coins for phase B'); }
    console.log(`Phase B: at ${JSON.stringify(startB)}, coins ${await coins()}`);
    startWalk();
    let skipped = false;
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(2000);
        if ((await logLines()).some(l => /toll gate.*skipping|need 10 coins/i.test(l))) { skipped = true; }
        const t = await tile();
        if (t && t.x > GATE_X) { fail(`crossed the gate with <10 coins (at ${JSON.stringify(t)})`); }
        if (skipped) { break; }
    }
    stopWalk();
    const afterB = await tile();
    console.log(`Phase B: skipped=${skipped}, at ${JSON.stringify(afterB)}`);
    if (!skipped) { fail('did not observe the toll-gate skip with <10 coins'); }
    if (afterB && afterB.x > GATE_X) { fail('ended east of the gate without paying'); }

    // ---- Phase A: 100 coins -> pay 10 and cross ----
    await type(WEST); // back to the west side
    await type('::~item coins 100');
    const coinsBefore = await coins();
    if (coinsBefore < 10) { fail(`coin seed failed (have ${coinsBefore})`); }
    console.log(`Phase A: coins ${coinsBefore}, at ${JSON.stringify(await tile())}`);
    startWalk();
    let crossed = false;
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(2000);
        const t = await tile();
        if (t && t.x > GATE_X) { crossed = true; break; }
    }
    stopWalk();
    const coinsAfter = await coins();
    console.log(`--- bot log tail ---`);
    for (const l of (await logLines()).slice(-16)) { console.log(`  ${l}`); }
    console.log(`Phase A: crossed=${crossed}, coins ${coinsBefore} -> ${coinsAfter}, at ${JSON.stringify(await tile())}`);
    if (!crossed) { await page.screenshot({ path: 'out/tollgate-test.png' }); fail('did not cross the gate with >=10 coins'); }
    if (coinsAfter !== coinsBefore - 10) { fail(`expected coins to drop by 10 (from ${coinsBefore}), got ${coinsAfter}`); }

    console.log('PASS');
} finally {
    await browser.close();
}
```

- [ ] **Step 3: Run the smoke**

Run: `bun tools/tollgate-test.ts http://localhost:8890`
Expected: prints `Phase B: skipped=true ...`, `Phase A: crossed=true, coins 1XX -> 1XX-10 ...`, then `PASS`.

If it fails, read the printed bot-log tail and `out/tollgate-test.png`, fix the cause (Task 1/2 code, not the assertions), re-deploy (`sh tools/deploy-local.sh`), and re-run. Do NOT weaken the assertions to pass.

- [ ] **Step 4: Commit**

```bash
git add tools/tollgate-test.ts
git commit -m "test(nav): headless live smoke for the Al Kharid toll gate

Phase B (<10gp) asserts a clean skip (no crossing); Phase A (>=10gp) asserts
coins drop by 10 and the player crosses to the Al Kharid side.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Audit `doors.json` for other special gates

**Files:**
- Create: `docs/superpowers/notes/2026-07-10-special-gate-audit.md` (report)
- Modify (only if unambiguous rows are found): `src/bot/nav/data/specialCrossings.ts`, `test/bot/nav/specialCrossings.test.ts`

**Interfaces:**
- Consumes: `src/bot/nav/data/doors.json` (1105 edges; fields `x,z,level,locId,locName,dir`), the content repo `~/code/rs2b2t-content`.
- Produces: an audit report; zero or more new `SPECIAL_CROSSINGS` rows following Task 1's shape.

- [ ] **Step 1: Dispatch an Opus subagent to run the audit**

Dispatch a general-purpose subagent (model: Opus) with this task:

> Read `src/bot/nav/data/doors.json` in `/Users/elliottriplett/code/rs2b0t`. It lists door/gate edges with `locName` + `locId`. For each DISTINCT `locName` (there are ~34), find that loc's `oploc`/`opheld` `Open`-op handler in `~/code/rs2b2t-content/scripts` and classify its Open behavior as one of:
> (a) **plain** — opens/moves the gate immediately (`~door_open`, `loc_change`/`loc_add` of an open variant, no dialogue, no item/quest check);
> (b) **dialogue** — starts a chat/choice (like `border_gate.rs2`);
> (c) **conditional** — checks an item, coins, quest varp, or skill before opening.
> Produce a markdown table: `locName | locId(s) | example coord from doors.json | class (a/b/c) | evidence (script path + the deciding line)`. For every (b)/(c) gate, also give the `SpecialCrossing` row fields it would need (coord, locName, action, requires?, dialogue.choose?, label) — reading the exact dialogue option text / item / count from the script. Do NOT edit any files; return the table + proposed rows as your final message.

Save the returned report to `docs/superpowers/notes/2026-07-10-special-gate-audit.md`.

- [ ] **Step 2: Triage the report**

For each proposed (b)/(c) gate:
- **Unambiguous** (clear single required item/count and/or a single obvious "proceed" choice option, matching the toll-gate pattern): add its `SpecialCrossing` row(s) to `SPECIAL_CROSSINGS` in `src/bot/nav/data/specialCrossings.ts`, and add a `specialCrossingAt` assertion for one of its tiles to `test/bot/nav/specialCrossings.test.ts`.
- **Ambiguous** (multi-step quest gate, branching dialogue, unclear proceed option): leave it in the report under a "Needs review" heading — do not add a row.

If the report finds no additional unambiguous special gates, that is a valid outcome — commit the report alone.

- [ ] **Step 3: Verify**

Run: `bun test test/bot/nav/specialCrossings.test.ts` (PASS) and `npx tsc --noEmit -p tsconfig.json` (exit 0).

If any new row sits on a locally-reachable, cheaply-seedable gate, extend `tools/tollgate-test.ts` with an analogous phase and run it; otherwise the unit coverage plus the toll-gate live proof are sufficient (note this explicitly in the report).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-07-10-special-gate-audit.md src/bot/nav/data/specialCrossings.ts test/bot/nav/specialCrossings.test.ts
git commit -m "docs(nav): special-gate audit + annotate unambiguous conditional gates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- Tasks 1→2→3 are strictly ordered (2 consumes 1; 3 proves 2). Task 4 depends only on Task 1's shape and can follow 3.
- The only behavior change to existing walks is at coords listed in `SPECIAL_CROSSINGS`; every other crossing takes the unchanged path through `handleTransport`. Keep it that way — do not alter the plain-door/transport/stairs branches.
- "Crossed" is detected by position (the pay teleports the player to the far tile), not by loc-name matching — this mirrors the existing collision-truth approach in `handleTransport` and is robust to the gate re-closing behind you.
