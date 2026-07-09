// Task 3 integration test: Equipment.equip/unequip, the untested worn-item
// op path every armed quest fight and the tutorial's combat leg depend on.
//
// Exercises the full round-trip on a Bronze dagger:
//   equip   -> backpack item's held Wield op (OPHELD2, content/scripts/
//              skill_combat/configs/melee/daggers.obj `iop2=Wield`)
//   unequip -> worn tab's component-level Remove button (INV_BUTTON1,
//              content/scripts/player/scripts/equip.rs2
//              `[inv_button1,wornitems:wear] ~unequip(last_slot)`)
// and asserts the item crosses between backpack and worn tab each time
// (verified against Inventory.items()/Equipment.contains(), not assumed).
//
// Equipment.equip/unequip both settle via Execution.delayUntil, which (like
// every Execution.* call) rejects with "Execution.* called with no script
// running" unless a script is actually active (Scheduler.enqueue,
// src/bot/runtime/Scheduler.ts) — confirmed empirically running this test
// against a bare `page.evaluate` first. So this registers and starts a tiny
// throwaway LoopingBot through the same public ABI/runtime handles a real
// script would use (registerScript + rs2b0t.runner), rather than calling
// Equipment.equip/unequip from an unstarted context — the same reason
// tools/chaosdruid-bank-test.ts exercises Bank.deposit via a real running
// script instead of a bare evaluate call.
//
// Usage: bun tools/equip-test.ts [base-url]

import { chromium, type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = 'eq' + Date.now().toString(36).slice(-6);

// debugname verified live against content/scripts/skill_combat/configs/melee/daggers.obj
// ([bronze_dagger] name=Bronze dagger, iop2=Wield) -- no display-name surprise this time.
const ITEM_DEBUGNAME = 'bronze_dagger';
const ITEM_NAME = 'Bronze dagger';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type EquipCheck = { worn: boolean; inv: boolean };
type EquipResult = { before: EquipCheck; equipped: boolean; mid: EquipCheck; unequipped: boolean; after: EquipCheck };

/** Minimal structural shape of a LoopingBot instance — just enough to drive onStart/loop. */
type BotInstance = { onStart?(): void | Promise<void>; loop?(): void | Promise<void> };
type BotCtor = new () => BotInstance;
type ScriptMetaLike = { name: string; create(): BotInstance };

type Abi = {
    __rs2b0t: {
        LoopingBot: BotCtor;
        registerScript(manifest: { name: string; create(): BotInstance }): ScriptMetaLike;
        Equipment: { contains(name: string): boolean; equip(name: string): Promise<boolean>; unequip(name: string): Promise<boolean> };
        Inventory: { contains(name: string): boolean; items(): { name: string | null }[] };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx: { log: { level: string; msg: string }[] } | null;
            start(meta: ScriptMetaLike): void;
            stop(): void;
        };
    };
    __equipTestResult?: EquipResult;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page: Page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    await cheat(page, `give ${ITEM_DEBUGNAME}`);

    const invNames = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.items().map(i => i.name));
    console.log('inventory after ::give:', invNames);
    if (!invNames.some(n => n === ITEM_NAME)) {
        fail(`expected '${ITEM_NAME}' in inventory after '::give ${ITEM_DEBUGNAME}', got ${JSON.stringify(invNames)}`);
    }

    // Register + start a throwaway bot whose onStart() drives the equip/unequip
    // round-trip and stashes the result on a page-global for Playwright to read.
    await page.evaluate(itemName => {
        const abi = (globalThis as never as Abi).__rs2b0t;
        const host = (globalThis as never as Abi).rs2b0t;

        const createBot = (): BotInstance => {
            const bot = new abi.LoopingBot();
            bot.onStart = async () => {
                const { Equipment, Inventory } = abi;
                const before = { worn: Equipment.contains(itemName), inv: Inventory.contains(itemName) };
                const equipped = await Equipment.equip(itemName);
                const mid = { worn: Equipment.contains(itemName), inv: Inventory.contains(itemName) };
                const unequipped = await Equipment.unequip(itemName);
                const after = { worn: Equipment.contains(itemName), inv: Inventory.contains(itemName) };
                (globalThis as never as Abi).__equipTestResult = { before, equipped, mid, unequipped, after };
            };
            bot.loop = () => {};
            return bot;
        };

        const meta = abi.registerScript({ name: 'Rs2b0tEquipTestBot', create: createBot });
        host.runner.start(meta);
    }, ITEM_NAME);

    try {
        await page.waitForFunction(() => (globalThis as never as Abi).__equipTestResult !== undefined, undefined, { timeout: 20000 });
    } catch {
        const diag = await page.evaluate(() => {
            const { state, ctx } = (globalThis as never as Abi).rs2b0t.runner;
            return { state, log: ctx?.log.map(l => `${l.level}: ${l.msg}`) ?? [] };
        });
        fail(`timed out waiting for the equip/unequip round-trip -- runner state: ${JSON.stringify(diag)}`);
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__equipTestResult as EquipResult);
    await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop());

    console.log(result);
    const pass =
        !result.before.worn && result.before.inv &&
        result.equipped && result.mid.worn && !result.mid.inv &&
        result.unequipped && !result.after.worn && result.after.inv;

    console.log(pass ? 'PASS' : 'FAIL');
    if (!pass) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
