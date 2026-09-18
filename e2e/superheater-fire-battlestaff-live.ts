/** Live proof, Superheater accepts a Fire battlestaff in place of Staff of fire.
 *  Why: EnsureGear used to stop unless Staff of fire was present; :8888 has no givebank so ores are given then deposited (they are unstackable). */

//   ENGINE_DIR=/path/to/engine bun e2e/superheater-fire-battlestaff-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME || `shb${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const WANT_BARS = 3;
const RUN_MS = 480_000;
const SCREENSHOT = 'docs/e2e/superheater-fire-battlestaff-live.png';

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; items(): Array<{ id: number; name: string | null; count: number }>; used(): number };
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
        registry: { get(name: string): unknown };
    };
}

async function dumpPack(page: Page, label: string): Promise<void> {
    const snap = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            used: g.__rs2b0t.Inventory.used(),
            items: g.__rs2b0t.Inventory.items().map(i => `${i.name ?? '?'}x${i.count}`),
            magic: g.__rs2b0t.Skills.level('magic')
        };
    });
    console.log(`  ${label}: magic=${snap.magic} used=${snap.used} [${snap.items.join(', ')}]`);
}

async function seedGive(page: Page, command: string, prove: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await cheatQuiet(page, command, 1500) && (await prove())) {
            return;
        }
    }
    await dumpPack(page, `failed ${command}`);
    fail(`could not seed '${command}'`);
}

function held(page: Page, name: string): Promise<number> {
    return page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);
}

async function depositPack(page: Page): Promise<void> {
    const name = `ShbDeposit_${Date.now()}`;
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
        await dumpPack(page, 'deposit left items');
        fail('pack was not empty after deposit');
    }
}

const client = deployIsolatedClient(`shb${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 55', 900);
    await cheatQuiet(page, 'setstat smithing 40', 900);
    await cheatQuiet(page, 'setstat attack 40', 900);
    await clearChatDialogs(page, 'level-ups');
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await cheatQuiet(page, '~clearinv', 800);
    await seedGive(page, 'give fire_battlestaff 1', async () => (await held(page, 'Fire battlestaff')) >= 1);
    await depositPack(page);
    console.log('banked Fire battlestaff');

    await seedGive(page, 'give naturerune 200', async () => (await held(page, 'Nature rune')) >= 200);
    await seedGive(page, 'give iron_ore 9', async () => (await held(page, 'Iron ore')) >= 9);
    await seedGive(page, 'give coal 18', async () => (await held(page, 'Coal')) >= 18);
    await depositPack(page);
    console.log('banked a steel trip of ore plus natures (no Staff of fire)');

    await setSettings(page, 'Superheater', { bar: 'Steel', natures: 50 });

    const before = await page.evaluate(() => {
        const s = (globalThis as never as Api).__rs2b0t.Skills;
        return { magic: s.xp('magic'), smithing: s.xp('smithing') };
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Superheater');
        if (!meta) {
            throw new Error('Superheater not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('Superheater started on Steel with a Fire battlestaff in the bank');

    const deadline = Date.now() + RUN_MS;
    let bars = 0;
    let magicXp = 0;
    let smithXp = 0;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const s = g.__rs2b0t.Skills;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                bars: g.__rs2b0t.Inventory.items()
                    .filter(i => (i.name ?? '').toLowerCase() === 'steel bar')
                    .reduce((n, i) => n + Math.max(1, i.count), 0),
                magic: s.xp('magic'),
                smithing: s.xp('smithing')
            };
        });
        logs = snap.logs;
        bars = Math.max(bars, snap.bars);
        magicXp = snap.magic - before.magic;
        smithXp = snap.smithing - before.smithing;
        if (snap.state !== 'running') {
            await page.screenshot({ path: SCREENSHOT });
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        if (bars >= WANT_BARS && magicXp > 0 && smithXp > 0 && logs.some(msg => /wore Fire battlestaff/i.test(msg))) {
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
        fail(`no magic XP in ${RUN_MS / 1000}s — Superheat Item never went off`);
    }
    if (smithXp <= 0) {
        fail('magic XP without smithing XP — the cast landed on nothing smeltable');
    }
    if (bars < WANT_BARS) {
        fail(`only ${bars} steel bar(s) made`);
    }
    console.log(`PASS, Fire battlestaff wielded, ${bars} steel bars: magic +${magicXp}, smithing +${smithXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
