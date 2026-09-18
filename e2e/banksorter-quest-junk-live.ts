/** Live proof, BankSorter names Recycling Centre leftovers once their quest-tab row is green.
 *  Why: main's list was two ids, so a finished Demon Slayer still filed Silverlight keys as ordinary junk. */

//   ENGINE_DIR=~/Documents/engine HEADED=1 bun e2e/banksorter-quest-junk-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';

import { deployIsolatedClient, fail, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888', minutes: 8 });
const deploy = !process.argv.includes('--no-deploy');
const user = process.env.USER_NAME || `bsqj${Date.now().toString(36).slice(-5)}`;
const SCREENSHOT = 'docs/e2e/banksorter-quest-junk.png';
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const BUDGET_MS = minutes * 60_000;

const SEED = [
    { debugName: 'silverlight_key_1', id: 2399 },
    { debugName: 'rats_tail', id: 300 },
    { debugName: 'stake', id: 1549 }
] as const;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null }>; used(): number };
        Bank: {
            isOpen(): boolean;
            openNearest(name: string, op: string): Promise<boolean>;
            close(): Promise<boolean>;
            depositAllMatching(match: (name: string) => boolean): Promise<void>;
        };
        LoopingBot: new () => { loop(): Promise<void | number> };
        registerScript(meta: { name: string; create: () => unknown }): unknown;
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx?: { log?: { msg: string }[] } };
        registry: { get(name: string): unknown };
    };
}

const packIds = (page: Page): Promise<number[]> => page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.items().map(i => i.id));

/** Why: :8888 has no givebank, so leftovers go into the pack with give and then into the booth. */
async function seedGive(page: Page, debugName: string, id: number): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        await cheatQuiet(page, `give ${debugName} 1`, 1500);
        if ((await packIds(page)).includes(id)) {
            console.log(`  gave ${debugName}`);
            return;
        }
    }
    fail(`could not give ${debugName} (id ${id})`);
}

async function depositPack(page: Page): Promise<void> {
    const name = `BsqjDeposit_${Date.now()}`;
    await page.evaluate(scriptName => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        class Seed extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    await api.Bank.openNearest('Bank booth', 'Use-quickly');
                    if (api.Bank.isOpen()) {
                        await api.Bank.depositAllMatching(() => true);
                        await api.Bank.close();
                    }
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: scriptName, create: () => new Seed() }));
    }, name);
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
        if ((await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.state)) === 'idle') {
            break;
        }
        await page.waitForTimeout(200);
    }
    if ((await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.used())) > 0) {
        fail(`pack still held ${JSON.stringify(await packIds(page))} after deposit`);
    }
}

interface RunnerSnap {
    state: string;
    logs: string[];
}

const runnerSnap = (page: Page): Promise<RunnerSnap> =>
    page.evaluate(() => {
        type Abi = { rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } } };
        const { runner } = (globalThis as never as Abi).rs2b0t;
        return { state: runner.state, logs: (runner.ctx?.log ?? []).map(l => l.msg) };
    });

const client = deploy ? deployIsolatedClient(`bsqj${Date.now().toString(36).slice(-6)}`) : { page: '/bot.html', cleanup: () => undefined };
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setvar hetty 3', 900);
    await cheatQuiet(page, 'setvar demonstart 30', 900);
    await cheatQuiet(page, 'setvar vampire 3', 900);
    await relog(page, user);

    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }
    await cheatQuiet(page, '~clearinv', 800);
    for (const item of SEED) {
        await seedGive(page, item.debugName, item.id);
    }
    await depositPack(page);
    console.log("banked Silverlight key, Rat's tail and Stake");

    await setSettings(page, 'BankSorter', { sortBank: false, reportQuestJunk: true, dropQuestJunk: false });
    await startScript(page, 'BankSorter');

    const startedAt = Date.now();
    let report = '';
    while (Date.now() - startedAt < BUDGET_MS) {
        await page.waitForTimeout(1500);
        const snap = await runnerSnap(page);
        const line = snap.logs.find(l => l.startsWith('BankSorter: quest leftovers'));
        if (line) {
            report = line;
        }
        if (snap.state === 'crashed') {
            fail(`BankSorter crashed: ${snap.logs.slice(-8).join(' | ')}`);
        }
        if (snap.state === 'stopped' && report) {
            break;
        }
        if (snap.state === 'stopped') {
            fail(`BankSorter stopped without a leftovers line: ${snap.logs.join(' | ')}`);
        }
    }
    if (!report) {
        fail(`no leftovers line within ${minutes} min`);
    }
    for (const want of ['Key (Demon Slayer, complete)', "Rat's tail (Witch's Potion, complete)", 'Stake (Vampire Slayer, complete)']) {
        if (!report.includes(want)) {
            fail(`report missed ${want}: ${report}`);
        }
    }

    await page.screenshot({ path: SCREENSHOT });
    console.log(`PASS: ${report} (${SCREENSHOT})`);
} finally {
    await browser.close();
    client.cleanup();
}
