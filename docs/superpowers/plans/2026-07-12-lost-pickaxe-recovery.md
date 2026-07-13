# Lost-Pickaxe Worn-Aware Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "pickaxe head flies off" random can no longer eat a wielded rune pickaxe: detection sees the worn handle, recovery frees a slot / unequips / takes the head / reattaches / re-wields.

**Architecture:** Fix in place in `src/bot/api/RandomEvents.ts` — two new pure exported helpers (unit-tested), a reworked `handleLostTool`, and a worn-aware detection line. Verified by a live smoke that triggers the REAL event via a new two-line content debugproc. Spec: `docs/superpowers/specs/2026-07-12-lost-pickaxe-event-design.md`.

**Tech Stack:** Bun + TypeScript (ESM `.js` imports), bun:test colocated, playwright-core smoke vs the local engine (:8890), content cheat in `~/code/rs2b2t-content` (engine srcDir).

## Global Constraints

- Imports end `.js`; waits via `Execution.delayTicks/delayUntil` only.
- Every commit: `bun test` green, `bunx tsc --noEmit` clean, `bunx eslint <changed files>` clean.
- Commits conventional, ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verified event facts (from `macro_event_lost_pickaxe.rs2`): wielded pick → handle equipped in worn rhand (`inv_setslot(worn,...)`); head display name "Pickaxe head" (every tier), lands ≤7 tiles, despawns at `^lootdrop_duration = 200` ticks (2 min); reattach = use head↔handle → full pick into the PACK. Axe variant identical with "Axe head".
- Existing APIs (verified): `Inventory.items()/first()/used()/isFull()`, `InvItem.actions()/interact(op)/useOn(item)`, `Equipment.items()/contains()/equip(name)/unequip(name)`, `GroundItems.query().where(g => ...g.snap.name...).within(n).nearest()`, drop idiom `item.interact('Drop')` (FlaxPicker:230).

---

### Task 1: Pure helpers (`pickSacrificial`, `handleLocation`) — TDD

**Files:**
- Modify: `src/bot/api/RandomEvents.ts` (add two exported pure functions near the top, after the existing constants)
- Create: `src/bot/api/RandomEvents.test.ts`

**Interfaces:**
- Produces (Task 2 uses verbatim):
  - `pickSacrificial(names: (string | null)[]): string | null`
  - `handleLocation(invNames: (string | null)[], wornNames: (string | null)[]): 'worn' | 'inventory' | null`

- [ ] **Step 1: Write the failing tests**

`src/bot/api/RandomEvents.test.ts`:

```typescript
import { expect, test, describe } from 'bun:test';
import { handleLocation, pickSacrificial } from './RandomEvents.js';

describe('handleLocation', () => {
    test('worn handle wins (the wielded-pick case the old scan missed)', () => {
        expect(handleLocation(['Iron ore'], ['Pickaxe handle'])).toBe('worn');
        expect(handleLocation(['Pickaxe handle'], ['Pickaxe handle'])).toBe('worn');
    });

    test('inventory handle (tool was carried, not wielded)', () => {
        expect(handleLocation(['Axe handle', 'Logs'], [])).toBe('inventory');
        expect(handleLocation(['Pickaxe handle'], ['Amulet of power'])).toBe('inventory');
    });

    test('null when no handle anywhere', () => {
        expect(handleLocation(['Iron ore', null], ['Rune pickaxe'])).toBeNull();
    });
});

describe('pickSacrificial', () => {
    test('most-duplicated non-protected item wins (the mined ore)', () => {
        expect(pickSacrificial(['Rune pickaxe', 'Iron ore', 'Iron ore', 'Uncut sapphire', 'Iron ore'])).toBe('Iron ore');
    });

    test('never drops tools or the event pieces', () => {
        expect(pickSacrificial(['Pickaxe head', 'Pickaxe handle', 'Rune pickaxe', 'Bronze axe', 'Hammer', 'Knife', 'Tinderbox'])).toBeNull();
        expect(pickSacrificial(['Fishing rod', 'Small net', 'Harpoon', 'Chisel'])).toBeNull();
    });

    test('null-safe and null on empty', () => {
        expect(pickSacrificial([null, null])).toBeNull();
        expect(pickSacrificial([])).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bot/api/RandomEvents.test.ts`
Expected: FAIL — `Export named 'handleLocation' not found` (functions don't exist yet).

- [ ] **Step 3: Implement the helpers**

In `src/bot/api/RandomEvents.ts`, after the existing top-of-file constants (near the other `const` tables), add:

```typescript
// Lost-tool event pieces + tools we must never drop to free a slot. Ores,
// logs, fish and gems all fail this test — any of them is worth pennies next
// to the rune pickaxe the free slot is rescuing.
const PROTECTED_FROM_DROP = /(handle|head$|axe|pick|hammer|chisel|knife|tinderbox|rod|net|harpoon)/i;

/** Which sacrificial item to drop when the pack is full mid-recovery: the
 *  most-duplicated name that isn't a tool or an event piece. Null when the
 *  pack is all-protected (log loudly and attempt recovery anyway). Pure. */
export function pickSacrificial(names: (string | null)[]): string | null {
    const counts = new Map<string, number>();
    for (const n of names) {
        if (n && !PROTECTED_FROM_DROP.test(n)) {
            counts.set(n, (counts.get(n) ?? 0) + 1);
        }
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [name, count] of counts) {
        if (count > bestCount) {
            best = name;
            bestCount = count;
        }
    }
    return best;
}

/** Where the lost-tool event left the handle. WORN first: a wielded tool's
 *  handle is force-equipped into the rhand slot (macro_event_lost_pickaxe.rs2
 *  inv_setslot(worn, ...)) — invisible to an inventory-only scan, which is
 *  how wielded rune picks used to despawn. Pure. */
export function handleLocation(invNames: (string | null)[], wornNames: (string | null)[]): 'worn' | 'inventory' | null {
    const isHandle = (n: string | null): boolean => n !== null && /(axe|pickaxe) handle/i.test(n);
    if (wornNames.some(isHandle)) {
        return 'worn';
    }
    if (invNames.some(isHandle)) {
        return 'inventory';
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/bot/api/RandomEvents.test.ts`
Expected: PASS (6 tests). Then `bun test` — full suite green (no other test touches these names).

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit && bunx eslint src/bot/api/RandomEvents.ts src/bot/api/RandomEvents.test.ts
git add src/bot/api/RandomEvents.ts src/bot/api/RandomEvents.test.ts
git commit -m "feat(randoms): pure lost-tool helpers — handle location + sacrificial drop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Worn-aware detection + recovery rework

**Files:**
- Modify: `src/bot/api/RandomEvents.ts` — the detection line (~:236-238), `handleLostTool` (~:648-679), one new private `freeSlot` method, plus `import { Equipment } from './hud/Equipment.js';` beside the other hud imports.

**Interfaces:**
- Consumes: Task 1's `pickSacrificial`/`handleLocation` (same file); `Equipment.items()/equip()/unequip()`; `Inventory.isFull()/used()/first()/items()`; `InvItem.actions()/interact()/useOn()`.
- Produces: no signature changes — `detectRaw` still returns `{ kind: 'lost-tool', name: 'lost tool' }`; `handleLostTool(log): Promise<boolean>` unchanged shape.

- [ ] **Step 1: Replace the detection block**

Find (~line 236):

```typescript
        // lost tool: a broken axe/pickaxe handle in the inventory
        if (Inventory.items().some(i => /(axe|pickaxe) handle/i.test(i.name ?? ''))) {
            return { kind: 'lost-tool', name: 'lost tool' };
        }
```

Replace with:

```typescript
        // lost tool: the event leaves an axe/pickaxe handle in the pack — or,
        // when the tool was WIELDED, force-equipped in the worn rhand slot
        // (macro_event_lost_pickaxe.rs2 inv_setslot(worn, ...)) while the head
        // despawns in 200 ticks. Worn was invisible to the old inventory-only
        // scan: the "bot mines with a bare handle until the rune pick is gone"
        // loss.
        if (handleLocation(Inventory.items().map(i => i.name), Equipment.items().map(i => i.name)) !== null) {
            return { kind: 'lost-tool', name: 'lost tool' };
        }
```

- [ ] **Step 2: Replace `handleLostTool` and add `freeSlot`**

Replace the whole existing `handleLostTool` method with:

```typescript
    /** Drop one sacrificial item (ore/log — never a tool or event piece) so
     *  the unequip/Take has a slot to land in. Full packs are ROUTINE while
     *  mining; without this the head Take silently fails until the 200-tick
     *  despawn eats the head. */
    private async freeSlot(log: (msg: string) => void): Promise<void> {
        if (!Inventory.isFull()) {
            return;
        }
        const drop = pickSacrificial(Inventory.items().map(i => i.name));
        if (!drop) {
            log('random event: pack full and nothing sacrificial to drop — attempting recovery anyway');
            return;
        }
        const item = Inventory.first(drop);
        if (item) {
            log(`random event: dropping one ${drop} to free a slot`);
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 4000);
        }
    }

    private async handleLostTool(log: (msg: string) => void): Promise<boolean> {
        log('random event: lost tool — recovering the head');
        const where = handleLocation(Inventory.items().map(i => i.name), Equipment.items().map(i => i.name));
        if (where === null) {
            return false;
        }

        // A WORN handle (the tool was wielded when the event fired) must come
        // off first — useOn needs both pieces in the pack — and unequipping
        // needs a free inventory slot for the handle to land in.
        const wasWorn = where === 'worn';
        if (wasWorn) {
            const worn = Equipment.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
            await this.freeSlot(log);
            if (worn?.name != null && !(await Equipment.unequip(worn.name))) {
                log('random event: could not unequip the handle — will retry next pass');
                return false;
            }
        }

        // the head lands <=7 tiles away (map_findsquare lineofwalk) and
        // despawns after 200 ticks — grab it, freeing a slot first
        const head = GroundItems.query()
            .where(g => /(axe|pickaxe) head/i.test(g.snap.name ?? ''))
            .within(12)
            .nearest();
        if (head) {
            await this.freeSlot(log);
            const before = Inventory.used();
            await head.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 6000);
        }

        // reattach: use the head on the handle (either direction — opheldu is
        // wired on both ends in macro_event_lost_pickaxe.rs2)
        const headItem = Inventory.items().find(i => /(axe|pickaxe) head/i.test(i.name ?? ''));
        const handleItem = Inventory.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
        if (!headItem || !handleItem) {
            log('random event: head or handle still missing — cannot reattach yet');
            return true;
        }
        const before = Inventory.used();
        await headItem.useOn(handleItem);
        if (!(await Execution.delayUntil(() => Inventory.used() < before, 5000))) {
            log('random event: reattach did not resolve');
            return true;
        }

        // the reattached tool lands in the PACK even when the original was
        // wielded — restore the pre-event state
        if (wasWorn) {
            const tool = Inventory.items().find(i => /(pickaxe|axe)$/i.test(i.name ?? '') && i.actions().some(o => /wield|wear/i.test(o)));
            if (tool?.name != null) {
                const rewielded = await Equipment.equip(tool.name);
                log(rewielded ? `random event: ${tool.name} reattached and re-wielded` : `random event: ${tool.name} reattached (re-wield failed — it stays in the pack)`);
                return true;
            }
        }
        log('random event: tool reattached');
        return true;
    }
```

Add the import beside the other `./hud/` imports at the top of the file:

```typescript
import { Equipment } from './hud/Equipment.js';
```

- [ ] **Step 3: Verify**

Run: `bun test && bunx tsc --noEmit && bunx eslint src/bot/api/RandomEvents.ts`
Expected: all green (Task 1's 6 tests still pass; no behavior change elsewhere — the `lost-tool` kind and dispatch are untouched).

- [ ] **Step 4: Commit**

```bash
git add src/bot/api/RandomEvents.ts
git commit -m "fix(randoms): worn-aware lost-tool recovery — stop losing wielded rune picks

Detection now sees the handle the event force-equips in the worn rhand
slot; recovery frees a pack slot (sacrificial ore drop), unequips the
handle, takes the head before its 200-tick despawn, reattaches, and
re-wields the restored tool.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Trigger cheat + live smoke

**Files:**
- Modify: `~/code/rs2b2t-content/scripts/_test/scripts/cheats/cheat_macro_event.rs2` (append the debugproc)
- Create: `tools/lost-pickaxe-test.ts`

**Interfaces:**
- Consumes: `mainlandAccount(page, base, user)`, `cheat(page, cmd)`, `startScript(page, name)` from `tools/tutorial/harness.js`; page globals `__rs2b0t` (Equipment, Inventory, reader) and `rs2b0t` (runner) — see `tools/rune-mysteries-test.ts` for the two-global pattern.
- Produces: `::~lost_pickaxe` debugproc on the local engine; a repeatable smoke.

- [ ] **Step 1: Add the debugproc**

Append to `~/code/rs2b2t-content/scripts/_test/scripts/cheats/cheat_macro_event.rs2` (mirrors the file's existing style; the spawn proc itself no-ops with a mesbox if no usable pickaxe is held):

```
[debugproc,lost_pickaxe]
if_close;
if (p_finduid(uid) = true) {
    ~macro_event_lost_pickaxe_spawn;
}
```

- [ ] **Step 2: Repack + restart the engine**

```bash
cd ~/code/rs2b2t-engine && npm run build
```

Then restart the engine — it only repacks scripts on explicit build, and only loads them at boot:

```bash
pkill -f "tsx src/app.ts" || true
cd ~/code/rs2b2t-engine && nohup npm run quickstart > /tmp/engine-quickstart.log 2>&1 &
until curl -sf -o /dev/null http://localhost:8890/bot.html; do sleep 2; done && echo engine up
```

(If the user runs the engine themselves in a terminal, say so in the report instead of pkilling blind — check `ps aux | grep "tsx src/app.ts"` first and note what was running.)

- [ ] **Step 3: Write the smoke**

`tools/lost-pickaxe-test.ts`:

```typescript
// Live smoke for the lost-pickaxe random: trigger the REAL event
// (::~lost_pickaxe, added to the content cheats) against the worst case — a
// WIELDED rune pickaxe and a FULL pack — and assert the supervisor recovers:
// handle unequipped, one sacrificial ore dropped, head taken before the
// 200-tick despawn, reattached, re-wielded.
//
// Requires: engine on :8890 with the ::~lost_pickaxe cheat packed
// (cd ~/code/rs2b2t-engine && npm run build, restart quickstart) + local
// build deployed (deploy-local.sh).
// Usage: bun tools/lost-pickaxe-test.ts [base-url]

import { chromium } from 'playwright-core';
import { cheat, mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `lp${Date.now().toString(36).slice(-7)}`;
const BUDGET_MS = 4 * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snap = { wornPick: boolean; wornHandle: boolean; invPick: boolean; invHandle: boolean; invHead: boolean; used: number };
type G = {
    __rs2b0t: {
        Equipment: { contains(n: string): boolean; equip(n: string): Promise<boolean> };
        Inventory: { contains(n: string): boolean; used(): number };
    };
    rs2b0t: { runner: { state: string } };
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    // Seed BEFORE maxme (maxme's level-up dialogs swallow the next typed
    // command): the rune pick + 27 iron ore = full pack once the pick is worn.
    await cheat(page, 'tele 0,50,50,15,15'); // barren castle-side spot: no chickens -> idle script
    await page.waitForTimeout(1200);
    await cheat(page, '~item rune_pickaxe 1');
    await cheat(page, '~item iron_ore 28'); // pack FULL once the pick is worn -> exercises freeSlot on BOTH the unequip and the take
    await cheat(page, '~maxme');
    await page.waitForTimeout(2000);

    const wielded = await page.evaluate(() => (globalThis as never as G).__rs2b0t.Equipment.equip('Rune pickaxe'));
    if (!wielded) fail('could not wield the Rune pickaxe');
    console.log('rune pickaxe wielded; pack full of iron ore');

    // Idle script so the runtime Supervisor polls randoms between loops.
    await startScript(page, 'ChickenKiller');
    await page.waitForTimeout(1500);

    await cheat(page, '~lost_pickaxe');
    console.log('triggered ::~lost_pickaxe — watching the recovery');

    const snap = (): Promise<Snap> =>
        page.evaluate(() => {
            const g = (globalThis as never as G).__rs2b0t;
            return {
                wornPick: g.Equipment.contains('Rune pickaxe'),
                wornHandle: g.Equipment.contains('Pickaxe handle'),
                invPick: g.Inventory.contains('Rune pickaxe'),
                invHandle: g.Inventory.contains('Pickaxe handle'),
                invHead: g.Inventory.contains('Pickaxe head'),
                used: g.Inventory.used()
            };
        });

    let sawWornHandle = false;
    let sawHeadInPack = false;
    const deadline = Date.now() + BUDGET_MS;
    let last: Snap | null = null;
    while (Date.now() < deadline) {
        last = await snap();
        sawWornHandle ||= last.wornHandle;
        sawHeadInPack ||= last.invHead;
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s worn[pick=${last.wornPick} handle=${last.wornHandle}] inv[pick=${last.invPick} handle=${last.invHandle} head=${last.invHead}] used=${last.used}`);
        if (last.wornPick && !last.invHandle && !last.invHead) break; // recovered + re-wielded
        await page.waitForTimeout(5000);
    }

    if (!last) fail('no snapshot');
    if (!sawWornHandle) fail('event never put a Pickaxe handle in the worn slot — did ::~lost_pickaxe fire? (pack the cheat + restart the engine)');
    if (!last.wornPick) fail(`Rune pickaxe not re-wielded (worn handle=${last.wornHandle}, inv pick=${last.invPick})`);
    if (last.invHandle || last.invHead) fail('leftover handle/head in the pack — reattach incomplete');
    console.log('PASS (lost-pickaxe: worn handle detected -> slot freed -> head taken -> reattached -> re-wielded)');
} finally {
    await browser.close();
}
```

- [ ] **Step 4: Deploy + run to PASS**

```bash
sh tools/deploy-local.sh
bun tools/lost-pickaxe-test.ts
```

Expected: `sawWornHandle` flips true within ~10s of the trigger, then within ~30-60s the pack dance (used 28 → 27 on the sacrificial drop → 28 on the take → 27 after reattach) and the final line `PASS (...)`. Diagnose failures from the printed snapshots + the bot log (the handler logs every stage). Iterate on the Task 2 code if a stage misbehaves — re-run is cheap (~2 min, fresh account each time).

- [ ] **Step 5: Commit (both repos)**

```bash
git add tools/lost-pickaxe-test.ts
git commit -m "test(smoke): lost-pickaxe real-event recovery smoke (worn pick, full pack)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
cd ~/code/rs2b2t-content && git add "scripts/_test/scripts/cheats/cheat_macro_event.rs2" && git commit -m "test(cheats): ::~lost_pickaxe debugproc for the mining lost-tool event

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final sweep

**Files:**
- Possibly modify: `docs/superpowers/specs/2026-07-12-lost-pickaxe-event-design.md` (true-up only if implementation diverged)

- [ ] **Step 1: Full verification**

```bash
bun test && bunx tsc --noEmit
bunx eslint src/bot/api/RandomEvents.ts src/bot/api/RandomEvents.test.ts tools/lost-pickaxe-test.ts
bun run build:bot
bun tools/lost-pickaxe-test.ts
```

Expected: suite green (+6 tests), builds clean, second smoke run PASS (fresh account — idempotent).

- [ ] **Step 2: True-up the spec if anything diverged, commit**

Known true-up: the spec's smoke section describes FABRICATING the post-event
state with `::~item` + a ground drop; the plan upgraded this to triggering
the REAL event via the new `::~lost_pickaxe` debugproc — higher fidelity.
Patch that section, plus any lines that no longer match reality (helper
names/regex), then:

```bash
git add -A && git commit -m "docs(randoms): true-up lost-pickaxe spec to implementation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit if nothing diverged.)
