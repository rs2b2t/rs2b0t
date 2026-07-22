# BankFletcher Arrow Fletching (Attach Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BankFletcher fletches arrows — feathers onto shafts (headless) and per-tier arrowheads onto headless arrows — inside its existing bank-standing cycle.

**Architecture:** A pure `ATTACH_PRODUCTS` table + `attachPlanFor()` resolver in `BankFletcherLogic.ts` drives a new mode: `BankTrip` becomes mode-aware (withdraw both stackable inputs instead of knife+logs), a new `Attach` task click-loops `inputA.useOn(inputB)` (engine attaches `min(a,b,15)` instantly per click, no dialog — content ground truth in the spec), and the knife tasks (`Fletch`, `FletchDialog`) gate themselves to knife products only.

**Tech Stack:** bun + TypeScript; existing api surface only (`Inventory`, `Bank.withdraw` + `withdrawOp`, `InvItem.useOn`, `Skills`, `ChatDialog`); smoke via `tools/bankfletcher-test.ts`.

## Global Constraints

- Engine ground truth (spec): one use = `min(inputA, inputB, 15)` attached instantly; tier levels bronze 1 / iron 15 / steel 30 / mithril 45 / adamant 60 / rune 75; below-level = engine mesbox refusal; F2P worlds refuse (both worlds are members — no in-bot handling).
- Products are per-tier options; one attach step per run (user decisions).
- `material`/`knife` settings are ignored in attach mode (help text says so).
- Item resolution follows the house idiom: resolve exact bank/pack names by SUBSTRING, then act on the exact resolved name; read withdraw ops off the item (`withdrawOp`).
- Work directly on `main` (session convention for small features); commit per task; GATE per task = `bun test 2>&1 | tail -3` (0 fail) + `bunx tsc --noEmit` (silent) + `bunx eslint src/bot/scripts/BankFletcher*.ts tools/bankfletcher-test.ts` (clean).

---

### Task 1: Pure attach table + resolver

**Files:**
- Modify: `src/bot/scripts/BankFletcherLogic.ts` (append)
- Test: `test/scripts/BankFletcherLogic.test.ts` (append)

**Interfaces:**
- Produces: `interface AttachPlan { inputs: [string, string]; product: string; level: number }`; `ATTACH_PRODUCTS: Record<string, AttachPlan>` (keys lowercase option names); `attachPlanFor(product: string): AttachPlan | null`. Task 2 consumes all three; `inputs[0]` is ALWAYS the item used ON `inputs[1]`.

- [ ] **Step 1: Write the failing tests** — append to `test/scripts/BankFletcherLogic.test.ts`:

```ts
describe('attachPlanFor', () => {
    test('headless arrows: feather onto shaft, level 1', () => {
        expect(attachPlanFor('Headless arrows')).toEqual({ inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 });
    });

    test('every tier resolves with the engine table levels', () => {
        const levels: Record<string, number> = { Bronze: 1, Iron: 15, Steel: 30, Mithril: 45, Adamant: 60, Rune: 75 };
        for (const [metal, level] of Object.entries(levels)) {
            const plan = attachPlanFor(`${metal} arrows`)!;
            expect(plan.inputs, metal).toEqual([`${metal} arrowheads`, 'Headless arrow']);
            expect(plan.product, metal).toBe(`${metal} arrow`);
            expect(plan.level, metal).toBe(level);
        }
    });

    test('knife products and unknowns resolve to null', () => {
        for (const p of ['Arrow shafts', 'Short bow', 'Long bow', 'Ogre arrows', '']) {
            expect(attachPlanFor(p), p).toBeNull();
        }
    });
});
```

Also add `attachPlanFor` to the file's import from `#/bot/scripts/BankFletcherLogic.js` and `describe` to the bun:test import if absent.

- [ ] **Step 2: Run to verify failure** — `bun test test/scripts/BankFletcherLogic.test.ts` → FAIL (no export `attachPlanFor`).
- [ ] **Step 3: Implement** — append to `src/bot/scripts/BankFletcherLogic.ts`:

```ts
/** One attach product: use `inputs[0]` ON `inputs[1]`; the engine attaches
 *  min(count(a), count(b), 15) per click (content: skill_fletching/arrows.rs2)
 *  and refuses below `level` (fletching_table). Display names, exact. */
export interface AttachPlan {
    inputs: [string, string];
    product: string;
    level: number;
}

/** Attach products by lowercase option name — the engine's fletching_table
 *  (bronze 1 / iron 15 / steel 30 / mithril 45 / adamant 60 / rune 75). */
export const ATTACH_PRODUCTS: Record<string, AttachPlan> = {
    'headless arrows': { inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 },
    'bronze arrows': { inputs: ['Bronze arrowheads', 'Headless arrow'], product: 'Bronze arrow', level: 1 },
    'iron arrows': { inputs: ['Iron arrowheads', 'Headless arrow'], product: 'Iron arrow', level: 15 },
    'steel arrows': { inputs: ['Steel arrowheads', 'Headless arrow'], product: 'Steel arrow', level: 30 },
    'mithril arrows': { inputs: ['Mithril arrowheads', 'Headless arrow'], product: 'Mithril arrow', level: 45 },
    'adamant arrows': { inputs: ['Adamant arrowheads', 'Headless arrow'], product: 'Adamant arrow', level: 60 },
    'rune arrows': { inputs: ['Rune arrowheads', 'Headless arrow'], product: 'Rune arrow', level: 75 }
};

/** The attach plan for a product option, or null for knife products. */
export function attachPlanFor(product: string): AttachPlan | null {
    return ATTACH_PRODUCTS[product.trim().toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Verify pass** — `bun test test/scripts/BankFletcherLogic.test.ts` → all pass.
- [ ] **Step 5: Commit** — `git add src/bot/scripts/BankFletcherLogic.ts test/scripts/BankFletcherLogic.test.ts && git commit -m "feat(fletcher): attach-product table + resolver (engine fletching_table mirror)"`

### Task 2: Attach mode in the bot

**Files:**
- Modify: `src/bot/scripts/BankFletcher.ts`

**Interfaces:**
- Consumes: `attachPlanFor(product)` / `AttachPlan` from Task 1.
- Produces (for the smoke): product option strings `'Headless arrows'`, `'Bronze arrows'`, …; log lines `attaching <a> onto <b> → <product>` and the standard `no '<name>' in the bank — idling`.

- [ ] **Step 1: Extend options + settings help** — in `src/bot/scripts/BankFletcher.ts` replace:

```ts
const PRODUCT_OPTIONS = ['Arrow shafts', 'Short bow', 'Long bow'];
```

with:

```ts
const PRODUCT_OPTIONS = [
    'Arrow shafts', 'Short bow', 'Long bow',
    'Headless arrows', 'Bronze arrows', 'Iron arrows', 'Steel arrows', 'Mithril arrows', 'Adamant arrows', 'Rune arrows'
];
```

and update the two setting help strings: `material` help gains `"; ignored for the arrow attach products"`, `knife` help gains the same suffix. `product` help becomes `'which product to make — knife products open the make-menu; arrow products attach item-on-item (material/knife ignored)'`.

- [ ] **Step 2: Import + gate + wire tasks** — add `attachPlanFor` to the `./BankFletcherLogic.js` import. In `onStart()` after settings are read, add the level gate and mode-aware startup log + task set:

```ts
        const plan = attachPlanFor(this.product);
        if (plan && Skills.level('fletching') < plan.level) {
            this.log(`BankFletcher: Fletching ${plan.level} required for ${this.product} (have ${Skills.level('fletching')}) — stopping.`);
            throw new Error('BankFletcher: fletching level too low for the chosen product');
        }

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('fletching');

        if (plan) {
            this.log(`BankFletcher attaching '${plan.inputs[0]}' onto '${plan.inputs[1]}' → ${plan.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        } else {
            this.log(`BankFletcher fletching '${this.material}' → ${this.product} at ${this.bankStand} (booth '${this.boothName}', r${this.leash})`);
        }
        this.add(new ContinueDialog(), new FletchDialog(this), new Attach(this), new BankTrip(this), new Fletch(this));
```

(the existing `startedAt`/`xpAtStart`/log/add lines are REPLACED by this block).

- [ ] **Step 3: Mode helpers on the bot class** — add beside `logCount()`:

```ts
    /** Live attach plan for the current product (null = knife mode). Live so
     *  the paint's product switch flips mode on the next task validate. */
    attachPlan(): ReturnType<typeof attachPlanFor> {
        return attachPlanFor(this.product);
    }

    /** Pack count of an attach input/product by exact-name-resolved substring. */
    packCount(name: string): number {
        const pat = name.toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    /** The pack item matching `name` (substring), or null. */
    packItem(name: string): InvItem | null {
        const pat = name.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }
```

- [ ] **Step 4: The Attach task** — add after the `Fletch` class:

```ts
/** Attach mode: both inputs held and no dialog → use input A on input B. The
 *  engine attaches min(a, b, 15) INSTANTLY per click (no menu, no count
 *  dialog — content arrows.rs2), so this is a click-loop verified by the
 *  product count rising; level-up interruptions are cleared by ContinueDialog. */
class Attach implements Task {
    constructor(private bot: BankFletcher) {}
    validate(): boolean {
        const plan = this.bot.attachPlan();
        return plan !== null && this.bot.packCount(plan.inputs[0]) > 0 && this.bot.packCount(plan.inputs[1]) > 0 && !ChatDialog.isOpen();
    }
    async execute(): Promise<void> {
        const plan = this.bot.attachPlan();
        if (!plan) { return; }
        this.bot.setStatus(`attaching ${plan.product}s`);
        for (let n = 0; n < 80; n++) {
            if (ChatDialog.isOpen()) { return; } // level-up etc. — ContinueDialog clears it
            const a = this.bot.packItem(plan.inputs[0]);
            const b = this.bot.packItem(plan.inputs[1]);
            if (!a || !b) { return; } // an input ran out — BankTrip takes over
            const before = this.bot.packCount(plan.product);
            if (!(await a.useOn(b))) { await Execution.delayTicks(2); continue; }
            const progressed = await Execution.delayUntil(
                () => this.bot.packCount(plan.product) > before || ChatDialog.isOpen(),
                4000
            );
            const now = this.bot.packCount(plan.product);
            if (now > before) {
                this.bot.recordMade(now - before);
            } else if (!progressed) {
                return; // no attach and no dialog — let the loop re-validate
            }
        }
    }
}
```

- [ ] **Step 5: Mode-aware BankTrip + knife-task gating** — change `BankTrip.validate` to:

```ts
    validate(): boolean {
        const plan = this.bot.attachPlan();
        if (plan) {
            return this.bot.packCount(plan.inputs[0]) === 0 || this.bot.packCount(plan.inputs[1]) === 0;
        }
        return this.bot.logCount() === 0;
    }
```

and at the TOP of `BankTrip.execute`, after the deposit block (`await Bank.depositInventory(); await Execution.delayTicks(1); this.bot.countTrip();`), insert the attach branch (the existing knife/log withdrawals stay as the fall-through):

```ts
        const plan = this.bot.attachPlan();
        if (plan) {
            for (const input of plan.inputs) {
                const pat = input.toLowerCase();
                const bankItem = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(pat));
                if (!bankItem || bankItem.name === null) {
                    this.bot.log(`no '${input}' in the bank — idling`);
                    await Execution.delayTicks(5);
                    return;
                }
                const allOp = withdrawOp(bankItem.ops, 'all') ?? withdrawOp(bankItem.ops, 'any') ?? 'Withdraw-All';
                this.bot.log(`withdrawing all ${bankItem.name} ('${allOp}')`);
                await Bank.withdraw(bankItem.name, allOp);
                await Execution.delayUntil(() => this.bot.packCount(input) > 0 || Bank.count(bankItem.name!) === 0, 4000);
            }
            return;
        }
```

Gate the knife tasks: `Fletch.validate` becomes `return this.bot.attachPlan() === null && this.bot.logCount() > 0 && !ChatDialog.isOpen();` and `FletchDialog.validate` becomes `return this.bot.attachPlan() === null && ChatDialog.isMakeMenu();`.

- [ ] **Step 6: Mode-aware paint row** — replace `p.row(`Logs left: ${this.logCount()}`);` with:

```ts
        const plan = this.attachPlan();
        if (plan) {
            p.row(`${plan.inputs[0]}: ${this.packCount(plan.inputs[0])}`, `${plan.inputs[1]}: ${this.packCount(plan.inputs[1])}`);
        } else {
            p.row(`Logs left: ${this.logCount()}`);
        }
```

- [ ] **Step 7: GATE** — `bun test 2>&1 | tail -3` (0 fail), `bunx tsc --noEmit` (silent), `bunx eslint src/bot/scripts/BankFletcher.ts` (clean).
- [ ] **Step 8: Commit** — `git add src/bot/scripts/BankFletcher.ts && git commit -m "feat(fletcher): arrow attach mode — feathers onto shafts, heads onto headless"`

### Task 3: Smoke phases (headless + bronze)

**Files:**
- Modify: `tools/bankfletcher-test.ts` (append two phases before the final PASS; read the file first — reuse its existing helpers: `type`, ABI evaluate idioms, and its `R`/`Rs2b0t` type alias)

**Interfaces:**
- Consumes: registered product options from Task 2; settings key `rs2b0t:set:BankFletcher:product` (raw localStorage string, ShopRunner-smoke idiom); `::give <debugname> <count>` cheats (`feather`, `arrow_shaft`, `bronze_arrowheads`).

- [ ] **Step 1: Append phase 2 (headless)** after the existing knife-phase assertions (keep its PASS line as a phase log, move `console.log('PASS')`/exit to the end):

```ts
    // ---- phase 2: attach mode — feathers onto shafts ----
    await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.stop?.());
    await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state !== 'running', undefined, { timeout: 10000 });
    await type('::give feather 60');
    await type('::give arrow_shaft 60');
    await page.evaluate(() => localStorage.setItem('rs2b0t:set:BankFletcher:product', 'Headless arrows'));
    await page.evaluate(() => { const r = (globalThis as never as Rs2b0t).rs2b0t; r.runner.start(r.registry.get('BankFletcher')); });
    const headless = () => page.evaluate(() => {
        const inv = (globalThis as never as Rs2b0t).rs2b0t.reader.inventory();
        return inv.filter(i => (i.name ?? '').toLowerCase() === 'headless arrow').reduce((n, i) => n + i.count, 0);
    });
    let attached = false;
    for (let i = 0; i < 60 && !attached; i++) {
        await page.waitForTimeout(2000);
        attached = (await headless()) >= 15; // at least one 15-set attached
    }
    if (!attached) fail('phase 2: no headless arrows attached within 2 min');
    console.log(`phase 2 PASS: headless arrows attached (${await headless()} in pack)`);
```

(if the smoke's inventory reader type lacks `count`, extend the local type alias — the ABI reader returns `{ name, count }` per slot.)

- [ ] **Step 2: Append phase 3 (bronze)**:

```ts
    // ---- phase 3: attach mode — bronze heads onto the headless arrows ----
    await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.stop?.());
    await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state !== 'running', undefined, { timeout: 10000 });
    await type('::give bronze_arrowheads 60');
    await page.evaluate(() => localStorage.setItem('rs2b0t:set:BankFletcher:product', 'Bronze arrows'));
    await page.evaluate(() => { const r = (globalThis as never as Rs2b0t).rs2b0t; r.runner.start(r.registry.get('BankFletcher')); });
    const bronze = () => page.evaluate(() => {
        const inv = (globalThis as never as Rs2b0t).rs2b0t.reader.inventory();
        return inv.filter(i => (i.name ?? '').toLowerCase() === 'bronze arrow').reduce((n, i) => n + i.count, 0);
    });
    let tipped = false;
    for (let i = 0; i < 60 && !tipped; i++) {
        await page.waitForTimeout(2000);
        tipped = (await bronze()) >= 15;
    }
    if (!tipped) fail('phase 3: no bronze arrows tipped within 2 min');
    console.log(`phase 3 PASS: bronze arrows tipped (${await bronze()} in pack)`);
```

Note: phase 3's headless input comes from phase 2's output (pack or bank — the cycle's deposit-all + withdraw-all round-trips it, which is the point).

- [ ] **Step 3: GATE + static check** — `bunx tsc --noEmit` silent; `bun tools/run-all-smokes.ts --list | grep bankfletcher` still shows the smoke at 360s.
- [ ] **Step 4: Run the smoke live** — engine up, then `bun tools/bankfletcher-test.ts http://localhost:8890` (deploy the current build first via `sh tools/deploy-local.sh` — the attach mode must be IN the served bundle). Expected: knife phase PASS + `phase 2 PASS` + `phase 3 PASS` + final `PASS`, exit 0.
- [ ] **Step 5: Commit** — `git add tools/bankfletcher-test.ts && git commit -m "test(fletcher): smoke phases for headless + bronze arrow attach"`

### Task 4: Regression + finish

- [ ] **Step 1:** Full static gate: `bun test 2>&1 | tail -3` (0 fail) + `bunx tsc --noEmit` + `bunx eslint . 2>&1 | tail -2` (frozen-18 baseline only) + `bun run build`.
- [ ] **Step 2:** Rerun the full bankfletcher smoke once more on the final build (all three phases green in one run).
- [ ] **Step 3:** Living-docs prune: `git rm docs/superpowers/specs/2026-07-21-bankfletcher-arrows-design.md docs/superpowers/plans/2026-07-21-bankfletcher-arrows.md && git commit -m "chore: prune shipped arrow-fletching design docs (history keeps them)"`.
- [ ] **Step 4:** Push (`git push`); report — and ask before any prod deploy (separate approval).
