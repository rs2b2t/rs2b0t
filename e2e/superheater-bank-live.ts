/**
 * Superheater banking benchmark: gold ore + Goldsmith gauntlets.
 *
 * Runs the real script against a seeded Varrock West bank and reports bars/hour
 * from Smithing XP, plus trips, magic XP and whether the gauntlets stayed on.
 *
 *   ENGINE_DIR=/home/shonc/rs2bot/Server/engine SECONDS=150 bun e2e/superheater-bank-live.ts
 */
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `shs${Date.now().toString(36).slice(-5)}`;
const runMs = Number(process.env.SECONDS ?? 150) * 1000;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const GOLD_XP = 22.5;
const GOLD_XP_GAUNTLETS = 56.2;

interface Api {
    __rs2b0t: {
        Equipment: { contains(name: string): boolean };
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }>; count(name: string): number };
        Skills: { xp(name: string): number; level(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`sh${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat magic 55', 900);
    await cheatQuiet(page, 'setstat smithing 40', 900);
    await clearChatDialogs(page, 'level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'gold_ore', displayName: 'Gold ore', qty: 600 },
            { debugName: 'naturerune', displayName: 'Nature rune', qty: 300 },
            { debugName: 'staff_of_fire', displayName: 'Staff of fire', qty: 1 },
            { debugName: 'gauntlets_of_goldsmithing', displayName: 'Goldsmith gauntlet', qty: 1 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'Superheater', {
        bar: 'Gold',
        natures: Number(process.env.NATURES ?? 50),
        goldsmithGauntlets: true,
        fastBank: true
    });

    const before = await page.evaluate(() => {
        const s = (globalThis as never as Api).__rs2b0t.Skills;
        return { magic: s.xp('magic'), smithing: s.xp('smithing'), at: Date.now() };
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Superheater');
        if (!meta) {
            throw new Error('Superheater not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`Superheater started on Gold for ${runMs / 1000}s`);

    const deadline = Date.now() + runMs;
    let logs: string[] = [];
    let gauntlets = false;
    let smithing = before.smithing;
    let magic = before.magic;
    let naturesMax = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                gauntlets: g.__rs2b0t.Equipment.contains('Goldsmith gauntlet'),
                smithing: g.__rs2b0t.Skills.xp('smithing'),
                magic: g.__rs2b0t.Skills.xp('magic'),
                natures: g.__rs2b0t.Inventory.count('Nature rune')
            };
        });
        logs = snap.logs;
        gauntlets = snap.gauntlets;
        smithing = snap.smithing;
        magic = snap.magic;
        naturesMax = Math.max(naturesMax, snap.natures);
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        await page.waitForTimeout(1000);
    }

    const elapsed = (Date.now() - before.at) / 1000;
    const smithXp = smithing - before.smithing;
    const magicXp = magic - before.magic;
    const perBar = gauntlets ? GOLD_XP_GAUNTLETS : GOLD_XP;
    const bars = smithXp / perBar;
    const barsPerHour = bars / (elapsed / 3600);
    const trips = logs.filter(m => m.startsWith('restocked:')).length;
    const instant = logs.filter(m => m.startsWith('instant bank:')).length;

    console.log(`RESULT elapsed=${elapsed.toFixed(1)}s bars=${bars.toFixed(1)} bars/hr=${barsPerHour.toFixed(0)} ` +
        `smithXp=${smithXp.toFixed(1)} magicXp=${magicXp.toFixed(1)} trips=${trips} instant=${instant} gauntlets=${gauntlets} naturesMax=${naturesMax}`);

    if (smithXp <= 0) {
        fail('no Smithing XP — nothing was smelted');
    }
    if (magicXp <= 0) {
        fail('no Magic XP — Superheat Item never went off');
    }
    if (!gauntlets) {
        console.log('WARN: Goldsmith gauntlet was not equipped, so bars use the 22.5 XP rate');
    }
    await page.screenshot({ path: 'docs/e2e/superheater-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
} finally {
    client.cleanup();
    await browser.close();
}
