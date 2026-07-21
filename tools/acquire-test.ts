// Task 5 integration test: ItemNeed/AcquireTask, the item-acquisition helper
// every quest module (Plan B) and Task 6's DeathRecovery will declare needs
// against instead of hand-rolling their own walk-then-buy/walk-then-grab
// logic.
//
// Exercises the full round-trip starting from mainlandAccount's default
// landing spot (the Lumbridge east chicken pen, off Tutorial Island):
//   shop need   -> Hammer x1 from the Lumbridge general store ('Shop keeper',
//                  world (3211,3246) -- the real working tele confirmed live
//                  in Task 4's "Shop interface ids" work; NOT the brief's
//                  guessed coords)
//   ground need -> Egg x1 from the chicken-pen ground spawn (EGG_PEN,
//                  world (3227,3300) -- copied verbatim from
//                  src/bot/scripts/CooksAssistant.ts, NOT the brief's guess)
// and asserts both land in the real backpack (Inventory.contains), not just
// hasAll()'s bookkeeping. Also exercises one cheap negative case: a 'gather'
// source must throw AcquireTask's documented Plan-B error, not silently
// no-op or fail some other way.
//
// AcquireTask.execute() settles via Traversal.walkTo/Shop.*/Execution.*,
// which (like every Execution.* call) only resolves inside a running script
// (confirmed empirically in Task 3, tools/equip-test.ts). So, same as every
// other tools/*-test.ts that drives Execution-dependent api surface, this
// registers and starts a throwaway LoopingBot through the public ABI/runtime
// handles a real script would use, and runs the acquisition loop from its
// onStart() with a bounded iteration cap (a stall fails loudly with a
// diagnostic dump instead of hanging).
//
// Usage: bun tools/acquire-test.ts [base-url]

import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = 'acq' + Date.now().toString(36).slice(-6);

const SHOP_NPC = 'Shop keeper';
// Lumbridge general store, world (3211,3246) -- confirmed live in Task 4,
// NOT the task-5 brief's guessed coords.
const HAMMER_NEAR = { x: 3211, z: 3246, level: 0 };
// EGG_PEN, copied verbatim from src/bot/scripts/CooksAssistant.ts (NOT the
// task-5 brief's guessed coords) -- also right where mainlandAccount's
// off-island tele lands, so this need starts almost on top of its target.
const EGG_AT = { x: 3227, z: 3300, level: 0 };

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/** Structural mirror of src/bot/api/ItemAcquisition.ts's exported types (tools run under Node, not the bot bundle -- see harness.ts). */
type ItemSource = { kind: 'shop'; npc: string; near: { x: number; z: number; level: number } } | { kind: 'ground'; at: { x: number; z: number; level: number } } | { kind: 'gather' } | { kind: 'make' };
type ItemNeed = { name: string; count: number; source: ItemSource };

type AcquireResult = {
    gatherThrew: boolean;
    gatherMessage: string;
    done: boolean;
    hammer: boolean;
    egg: boolean;
    iterations: number;
    afterFirst: { hammer: boolean; egg: boolean };
};

/** Minimal structural shape of a LoopingBot instance -- just enough to drive onStart/loop. */
type BotInstance = { onStart?(): void | Promise<void>; loop?(): void | Promise<void> };
type BotCtor = new () => BotInstance;
type ScriptMetaLike = { name: string; create(): BotInstance };

type Abi = {
    __rs2b0t: {
        LoopingBot: BotCtor;
        registerScript(manifest: { name: string; create(): BotInstance }): ScriptMetaLike;
        AcquireTask: new (bot: unknown, needs: ItemNeed[]) => { validate(): boolean | Promise<boolean>; execute(): void | Promise<void> };
        hasAll(needs: ItemNeed[]): boolean;
        Inventory: { contains(name: string): boolean };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx: { log: { level: string; msg: string }[] } | null;
            start(meta: ScriptMetaLike): void;
            stop(): void;
        };
    };
    __acquireTestResult?: AcquireResult;
};

const browser = await launchBrowser();
try {
    const page: Page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    await cheat(page, 'give coins 200');

    // Register + start a throwaway bot whose onStart() drives the
    // gather-throws negative check then the shop+ground acquisition loop,
    // stashing the result on a page-global for Playwright to read.
    await page.evaluate(
        ({ shopNpc, hammerNear, eggAt }) => {
            const abi = (globalThis as never as Abi).__rs2b0t;
            const host = (globalThis as never as Abi).rs2b0t;

            const createBot = (): BotInstance => {
                const bot = new abi.LoopingBot();
                bot.onStart = async () => {
                    const { AcquireTask, hasAll, Inventory } = abi;

                    // Negative assertion: 'gather' sources are Plan B's
                    // territory -- AcquireTask must refuse them with the
                    // documented error, not silently no-op.
                    let gatherThrew = false;
                    let gatherMessage = '';
                    try {
                        const gatherTask = new AcquireTask(bot, [{ name: 'Logs', count: 1, source: { kind: 'gather' } }]);
                        await gatherTask.execute();
                    } catch (e) {
                        gatherThrew = true;
                        gatherMessage = e instanceof Error ? e.message : String(e);
                    }

                    const needs: ItemNeed[] = [
                        { name: 'Hammer', count: 1, source: { kind: 'shop', npc: shopNpc, near: hammerNear } },
                        { name: 'Egg', count: 1, source: { kind: 'ground', at: eggAt } }
                    ];
                    const task = new AcquireTask(bot, needs);

                    let iterations = 0;
                    let afterFirst = { hammer: false, egg: false };
                    const cap = 40;
                    while (iterations < cap && !hasAll(needs)) {
                        if (!(await task.validate())) {
                            break;
                        }
                        await task.execute();
                        iterations++;
                        if (iterations === 1) {
                            afterFirst = { hammer: Inventory.contains('Hammer'), egg: Inventory.contains('Egg') };
                        }
                    }

                    (globalThis as never as Abi).__acquireTestResult = {
                        gatherThrew,
                        gatherMessage,
                        done: hasAll(needs),
                        hammer: Inventory.contains('Hammer'),
                        egg: Inventory.contains('Egg'),
                        iterations,
                        afterFirst
                    };
                };
                bot.loop = () => {};
                return bot;
            };

            const meta = abi.registerScript({ name: 'Rs2b0tAcquireTestBot', create: createBot });
            host.runner.start(meta);
        },
        { shopNpc: SHOP_NPC, hammerNear: HAMMER_NEAR, eggAt: EGG_AT }
    );

    try {
        await page.waitForFunction(() => (globalThis as never as Abi).__acquireTestResult !== undefined, undefined, { timeout: 300000 });
    } catch {
        const diag = await page.evaluate(() => {
            const { state, ctx } = (globalThis as never as Abi).rs2b0t.runner;
            return { state, log: ctx?.log.map(l => `${l.level}: ${l.msg}`) ?? [] };
        });
        fail(`timed out waiting for the acquire round-trip -- runner state: ${JSON.stringify(diag)}`);
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__acquireTestResult as AcquireResult);
    await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop());

    console.log(result);
    const gatherOk = result.gatherThrew && result.gatherMessage === 'ItemSource.gather: not implemented yet';
    const pass = result.done && result.hammer && result.egg && gatherOk && result.afterFirst.hammer && !result.afterFirst.egg;

    console.log(pass ? 'PASS' : 'FAIL');
    if (!pass) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
