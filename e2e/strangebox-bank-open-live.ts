/** Live proof, Strange box Open is a no-op while the bank is up until the solver closes it (#756).
 *  Why: leftover-box-while-banking is the stuck path; the gift-then-talk path often dismisses the bank first. */

//   bun e2e/strangebox-bank-open-live.ts [http://localhost:8888]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs } from './lib/harness.js';
import { mainlandAccount, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `sbb${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const SCREENSHOT = 'docs/e2e/strangebox-bank-open-live.png';
const LEFTOVER_MS = 8_000;
const SOLVE_MS = 60_000;

interface Api {
    __rs2b0t: {
        Inventory: {
            count(name: string): number;
            first(name: string): { actions(): string[] } | null;
        };
        Bank: {
            isOpen(): boolean;
            openBooth(stand: { x: number; z: number; level: number }, name: string, op: string): Promise<boolean>;
            openNearest(name: string, op: string): Promise<boolean>;
        };
        LoopingBot: new () => { loop(): Promise<void | number> };
        registerScript(meta: { name: string; create: () => unknown }): unknown;
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
    };
    __openBank?: { done: boolean; ok: boolean; reason?: string };
}

type BoxSnap = { bankOpen: boolean; boxes: number; ops: string[]; runner: string };

const snap = (page: import('playwright-core').Page): Promise<BoxSnap> =>
    page.evaluate(() => {
        const g = globalThis as never as Api;
        const box = g.__rs2b0t.Inventory.first('Strange box');
        return {
            bankOpen: g.__rs2b0t.Bank.isOpen(),
            boxes: g.__rs2b0t.Inventory.count('Strange box'),
            ops: box?.actions() ?? [],
            runner: g.rs2b0t.runner.state
        };
    });

const eventLogs = (page: import('playwright-core').Page, consoleLines: string[]): Promise<string[]> =>
    page.evaluate(() => {
        const g = globalThis as never as Api;
        return (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
    }).then(ctx => [...ctx, ...consoleLines]);

const client = deployIsolatedClient(`sbb${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const consoleLines: string[] = [];
page.on('console', m => {
    const t = m.text();
    if (/random event|rs2b0t/i.test(t)) {
        consoleLines.push(t);
    }
});

try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await page.evaluate(stand => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        class OpenBank extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    const opened =
                        (await api.Bank.openBooth(stand, 'Bank booth', 'Use-quickly'))
                        || (await api.Bank.openNearest('Bank booth', 'Use-quickly'));
                    g.__openBank = { done: true, ok: opened && api.Bank.isOpen() };
                } catch (e) {
                    g.__openBank = { done: true, ok: false, reason: String(e) };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__openBank = { done: false, ok: false };
        g.rs2b0t.runner.start(api.registerScript({ name: `SbbOpenBank_${Date.now()}`, create: () => new OpenBank() }));
    }, VARROCK_WEST_BANK);

    const opened = await page
        .waitForFunction(() => {
            const g = globalThis as never as Api;
            return g.__openBank?.done === true && g.__rs2b0t.Bank.isOpen() && g.rs2b0t.runner.state !== 'running';
        }, undefined, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
    const openInfo = await page.evaluate(() => (globalThis as never as Api).__openBank);
    if (!opened) {
        fail(`bank did not stay open after the opener stopped (${JSON.stringify(openInfo)})`);
    }
    console.log('bank open; seeding leftover Strange box');

    if (!(await cheatQuiet(page, 'give macro_cube 1', 50))) {
        fail('give macro_cube was not sent');
    }

    let leftover: BoxSnap | null = null;
    const leftoverDeadline = Date.now() + LEFTOVER_MS;
    while (Date.now() < leftoverDeadline) {
        const s = await snap(page);
        if (s.boxes >= 1 && s.bankOpen) {
            leftover = s;
            break;
        }
        await page.waitForTimeout(80);
    }
    if (!leftover) {
        const s = await snap(page);
        fail(`box never appeared while the bank was open: bankOpen=${s.bankOpen} boxes=${s.boxes} ops=${JSON.stringify(s.ops)}`);
    }
    const depositOnly = leftover.ops.some(o => /^deposit/i.test(o)) && !leftover.ops.some(o => o.toLowerCase() === 'open');
    console.log(`leftover: bankOpen=${leftover.bankOpen} boxes=${leftover.boxes} ops=${JSON.stringify(leftover.ops)}`);
    if (!depositOnly) {
        fail(`expected Deposit-* and no Open on the bank-side box, ops=${JSON.stringify(leftover.ops)}`);
    }

    const solveDeadline = Date.now() + SOLVE_MS;
    let solved = false;
    while (Date.now() < solveDeadline) {
        const logs = await eventLogs(page, consoleLines);
        if (logs.some(m => /strange box interface did not open/i.test(m))) {
            fail('solver still logged "strange box interface did not open" with the bank up');
        }
        const s = await snap(page);
        const closedThenSolved = logs.some(m => /closing bank so Open hits the backpack/.test(m))
            && logs.some(m => /solved \d+ strange box/.test(m));
        if (s.boxes === 0 && closedThenSolved) {
            solved = true;
            console.log(`solved after ${Math.round((SOLVE_MS - (solveDeadline - Date.now())) / 1000)}s bankOpen=${s.bankOpen}`);
            break;
        }
        await page.waitForTimeout(250);
    }

    const logs = await eventLogs(page, consoleLines);
    console.log('--- event log ---');
    for (const m of logs.filter(l => /random event/i.test(l))) {
        console.log(`  ${m}`);
    }
    if (!solved) {
        const s = await snap(page);
        fail(`box not solved with bank-close: boxes=${s.boxes} bankOpen=${s.bankOpen} logs=${JSON.stringify(logs.filter(l => /random event/i.test(l)))}`);
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: SCREENSHOT });
    console.log(`PASS leftover-box-while-banking; screenshot ${SCREENSHOT}`);
} finally {
    client.cleanup();
    await browser.close();
}
