import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const user = 'shp' + Date.now().toString(36).slice(-6);

const NPC_NAME = 'Shop keeper';
const ITEM_NAME = 'Hammer';
const SHOP_TELE = '0,50,50,11,46';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type ShopResult = {
    opened: boolean;
    stockHasHammer: boolean;
    bought: number;
    haveHammer: boolean;
    sold: number;
    hammerGone: boolean;
    closed: boolean;
};

type BotInstance = { onStart?(): void | Promise<void>; loop?(): void | Promise<void> };
type BotCtor = new () => BotInstance;
type ScriptMetaLike = { name: string; create(): BotInstance };

type Abi = {
    __rs2b0t: {
        LoopingBot: BotCtor;
        registerScript(manifest: { name: string; create(): BotInstance }): ScriptMetaLike;
        Shop: {
            isOpen(): boolean;
            open(npcName: string): Promise<boolean>;
            stock(): { name: string; count: number; slot: number }[];
            buy(name: string, n: number): Promise<number>;
            sell(name: string, n: number): Promise<number>;
            close(): Promise<void>;
        };
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
    __shopTestResult?: ShopResult;
};

const browser = await launchBrowser();
try {
    const page: Page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    await cheat(page, `tele ${SHOP_TELE}`);
    await cheat(page, 'give coins 1000');

    await page.evaluate(
        ([npcName, itemName]) => {
            const abi = (globalThis as never as Abi).__rs2b0t;
            const host = (globalThis as never as Abi).rs2b0t;

            const createBot = (): BotInstance => {
                const bot = new abi.LoopingBot();
                bot.onStart = async () => {
                    const { Shop, Inventory } = abi;
                    const opened = await Shop.open(npcName);
                    const stockHasHammer = Shop.stock().some(s => s.name === itemName);
                    const bought = await Shop.buy(itemName, 1);
                    const haveHammer = Inventory.contains(itemName);
                    const sold = await Shop.sell(itemName, 1);
                    const hammerGone = !Inventory.contains(itemName);
                    await Shop.close();
                    (globalThis as never as Abi).__shopTestResult = { opened, stockHasHammer, bought, haveHammer, sold, hammerGone, closed: !Shop.isOpen() };
                };
                bot.loop = () => {};
                return bot;
            };

            const meta = abi.registerScript({ name: 'Rs2b0tShopTestBot', create: createBot });
            host.runner.start(meta);
        },
        [NPC_NAME, ITEM_NAME]
    );

    try {
        await page.waitForFunction(() => (globalThis as never as Abi).__shopTestResult !== undefined, undefined, { timeout: 30000 });
    } catch {
        const diag = await page.evaluate(() => {
            const { state, ctx } = (globalThis as never as Abi).rs2b0t.runner;
            return { state, log: ctx?.log.map(l => `${l.level}: ${l.msg}`) ?? [] };
        });
        fail(`timed out waiting for the shop round-trip -- runner state: ${JSON.stringify(diag)}`);
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__shopTestResult as ShopResult);
    await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop());

    console.log(result);
    const pass = result.opened && result.stockHasHammer && result.bought === 1 && result.haveHammer && result.sold === 1 && result.hammerGone && result.closed;

    console.log(pass ? 'PASS' : 'FAIL');
    if (!pass) {
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
