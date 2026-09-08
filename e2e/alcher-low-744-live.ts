/** Live proof, Alcher Low Level Alchemy at Magic 25 (#744).
 *  Why: main's Alcher is High only and stops below 55 Magic, so a 21-54 account cannot alch. */

//   ENGINE_DIR=~/Documents/engine HEADED=1 EXPECT_MODE=after bun e2e/alcher-low-744-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888', minutes: 8 });
const deploy = !process.argv.includes('--no-deploy');
const user = process.env.USER_NAME || `alL${Date.now().toString(36).slice(-5)}`;
const expectMode = process.env.EXPECT_MODE === 'before' ? 'before' : 'after';
const screenshot = process.env.SCREENSHOT
    ?? (expectMode === 'before'
        ? 'docs/e2e/alcher-low-744-before.png'
        : 'docs/e2e/alcher-low-744-after.png');
const BUDGET_MS = minutes * 60_000;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
/** Chainbody, not platebody: the house rule for every bank seed. */
const ALCH_ITEM = 'Rune chainbody';
const ALCH_OBJ = 'rune_chainbody';
const ALCHS_PER_TRIP = 10;
const BANKED_STOCK = 12;
const MIN_STACK = ALCHS_PER_TRIP - 3;
const HIGH_XP = 65;
const LOW_XP = 31;
const NEEDS_HIGH = /High Level Alchemy needs 55 Magic/i;
const CAST_LOW = /Low Level Alchemy/i;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number };
        Skills: { xp(name: string): number; level(name: string): number };
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
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
    };
}

async function seedGive(page: Page, command: string, prove: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await cheatQuiet(page, command, 1500) && (await prove())) {
            return;
        }
    }
    fail(`could not seed '${command}'`);
}

function held(page: Page, name: string): Promise<number> {
    return page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);
}

async function depositPack(page: Page): Promise<void> {
    const name = `AlchDeposit_${Date.now()}`;
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
        fail('pack was not empty after deposit');
    }
}

const client = deploy
    ? deployIsolatedClient(`alL${Date.now().toString(36).slice(-6)}`, process.env.ENGINE_DIR)
    : { page: '/bot.html', cleanup: () => undefined };
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 25', 1200);
    await clearChatDialogs(page, 'magic level-ups');
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    // Why: :8888 has no givebank, so the kit is given into the pack and deposited like Superheater.
    await cheatQuiet(page, '~clearinv', 800);
    await seedGive(page, `give ${ALCH_OBJ} ${BANKED_STOCK}`, async () => (await held(page, ALCH_ITEM)) >= BANKED_STOCK);
    await seedGive(page, 'give naturerune 200', async () => (await held(page, 'Nature rune')) >= 200);
    await seedGive(page, 'give staff_of_fire 1', async () => (await held(page, 'Staff of fire')) >= 1);
    await depositPack(page);
    console.log(`banked ${BANKED_STOCK} ${ALCH_ITEM}, natures, Staff of fire`);

    await setSettings(page, 'Alcher', { items: ALCH_OBJ, alchs: ALCHS_PER_TRIP, spell: 'Low' });

    const magicBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('magic'));
    const magicLevel = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.level('magic'));
    await startScript(page, 'Alcher');
    console.log(`Alcher started at Magic ${magicLevel} with spell=Low on ${BANKED_STOCK} banked ${ALCH_ITEM} (${expectMode})`);

    const deadline = Date.now() + BUDGET_MS;
    let notesPeak = 0;
    let notesNow = 0;
    let coinsPeak = 0;
    let magicXp = 0;
    let state = 'running';
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(item => {
            const g = globalThis as never as Api;
            return {
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                notes: g.__rs2b0t.Inventory.count(item),
                coins: g.__rs2b0t.Inventory.count('Coins'),
                magic: g.__rs2b0t.Skills.xp('magic')
            };
        }, ALCH_ITEM);
        logs = snap.logs;
        state = snap.state;
        notesPeak = Math.max(notesPeak, snap.notes);
        notesNow = snap.notes;
        coinsPeak = Math.max(coinsPeak, snap.coins);
        magicXp = snap.magic - magicBefore;
        if (expectMode === 'before' && state !== 'running') {
            break;
        }
        if (expectMode === 'after' && notesPeak > 0 && notesNow < notesPeak && coinsPeak > 0 && magicXp > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: screenshot });
    if (state === 'running') {
        await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    }

    if (expectMode === 'before') {
        if (state === 'running') {
            fail('Alcher was still running at Magic 25, High-only should have stopped');
        }
        if (!logs.some(msg => NEEDS_HIGH.test(msg))) {
            fail(`High-only never logged the 55 Magic stop: ${logs.slice(-8).join(' | ')}`);
        }
        if (magicXp > 0) {
            fail(`High-only alched at Magic 25: magic +${magicXp}`);
        }
        console.log(`PASS (before), Alcher stopped at Magic ${magicLevel}: High Level Alchemy needs 55 Magic`);
    } else {
        if (!logs.some(msg => CAST_LOW.test(msg))) {
            fail(`never logged Low Level Alchemy: ${logs.slice(-8).join(' | ')}`);
        }
        if (notesPeak < MIN_STACK) {
            fail(`never held a workable note stack, most seen ${notesPeak} of ${ALCHS_PER_TRIP}`);
        }
        if (magicXp <= 0) {
            fail(`no magic XP in ${BUDGET_MS / 1000}s, the alch never fired`);
        }
        if (magicXp % LOW_XP !== 0 || magicXp % HIGH_XP === 0) {
            fail(`magic +${magicXp} is High Level Alchemy (65xp) or not Low (31xp)`);
        }
        if (coinsPeak <= 0 || notesNow >= notesPeak) {
            fail(`the note stack never turned into coins: notes ${notesNow}/${notesPeak}, coins ${coinsPeak}`);
        }
        console.log(`PASS, ${notesPeak - notesNow} of ${notesPeak} noted ${ALCH_ITEM} low-alched into ${coinsPeak} coins: magic +${magicXp}`);
    }
} finally {
    client.cleanup();
    await browser.close();
}
