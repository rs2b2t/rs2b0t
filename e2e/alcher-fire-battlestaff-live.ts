/** Live proof, Alcher accepts a Fire battlestaff in place of Staff of fire.
 *  Why: EnsureGear used to stop unless Staff of fire was present; :8888 has no givebank so chainbodies are given then deposited. */

//   ENGINE_DIR=/path/to/engine bun e2e/alcher-fire-battlestaff-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME || `alb${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const ALCH_ITEM = 'Rune chainbody';
const ALCHS_PER_TRIP = 8;
const RUN_MS = 420_000;
const SCREENSHOT = 'docs/e2e/alcher-fire-battlestaff-live.png';

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number };
        Skills: { xp(name: string): number };
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
        registry: { get(name: string): unknown };
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
    const name = `AlbDeposit_${Date.now()}`;
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

const client = deployIsolatedClient(`alb${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 70', 1200);
    await cheatQuiet(page, 'setstat attack 40', 900);
    await clearChatDialogs(page, 'level-ups');
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await cheatQuiet(page, '~clearinv', 800);
    await seedGive(page, 'give fire_battlestaff 1', async () => (await held(page, 'Fire battlestaff')) >= 1);
    await depositPack(page);
    await seedGive(page, 'give naturerune 200', async () => (await held(page, 'Nature rune')) >= 200);
    await seedGive(page, 'give rune_chainbody 8', async () => (await held(page, ALCH_ITEM)) >= 8);
    await depositPack(page);
    console.log('banked Fire battlestaff, natures and rune chainbodies (no Staff of fire)');

    await setSettings(page, 'Alcher', { items: 'rune_chainbody', alchs: ALCHS_PER_TRIP });

    const magicBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('magic'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Alcher');
        if (!meta) {
            throw new Error('Alcher not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('Alcher started on Rune chainbody with a Fire battlestaff in the bank');

    const deadline = Date.now() + RUN_MS;
    let notesPeak = 0;
    let notesNow = 0;
    let coinsPeak = 0;
    let magicXp = 0;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(item => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                notes: g.__rs2b0t.Inventory.count(item),
                coins: g.__rs2b0t.Inventory.count('Coins'),
                magic: g.__rs2b0t.Skills.xp('magic')
            };
        }, ALCH_ITEM);
        logs = snap.logs;
        notesPeak = Math.max(notesPeak, snap.notes);
        notesNow = snap.notes;
        coinsPeak = Math.max(coinsPeak, snap.coins);
        magicXp = snap.magic - magicBefore;
        if (snap.state !== 'running') {
            await page.screenshot({ path: SCREENSHOT });
            fail(`script stopped early: ${logs.slice(-8).join(' | ')}`);
        }
        if (
            logs.some(msg => /wore Fire battlestaff/i.test(msg))
            && notesPeak > 0
            && notesNow < notesPeak
            && coinsPeak > 0
            && magicXp > 0
        ) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: SCREENSHOT });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!logs.some(msg => /withdrawing Fire battlestaff/i.test(msg))) {
        fail('never logged withdrawing Fire battlestaff');
    }
    if (!logs.some(msg => /wore Fire battlestaff/i.test(msg))) {
        fail('never wielded the Fire battlestaff');
    }
    if (magicXp <= 0) {
        fail(`no magic XP in ${RUN_MS / 1000}s, the alch never fired`);
    }
    if (coinsPeak <= 0 || notesNow >= notesPeak) {
        fail(`the note stack never turned into coins: notes ${notesNow}/${notesPeak}, coins ${coinsPeak}`);
    }
    console.log(`PASS, Fire battlestaff wielded, ${notesPeak - notesNow} of ${notesPeak} noted ${ALCH_ITEM} alched into ${coinsPeak} coins: magic +${magicXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
