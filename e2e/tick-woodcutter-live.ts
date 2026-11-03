import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';

type Abi = {
    __rs2b0t: {
        Skills: { xp(skill: string): number; level(skill: string): number };
        Inventory: { count(name: string): number; used(): number };
        Equipment: { contains(name: string): boolean };
    };
};

const CAMP = { x: 2711, z: 3500, level: 0 };
const MIN_XP_HR = Number(process.env.TICK_WC_MIN_XP_HR ?? 80_000);
const RUN_MS = Number(process.env.TICK_WC_MS ?? 60_000);
const PACK_FILL = Number(process.env.TICK_WC_PACK ?? 24);

const xpNow = (page: import('playwright-core').Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.xp('woodcutting'));
const count = (page: import('playwright-core').Page, name: string): Promise<number> =>
    page.evaluate(n => (globalThis as never as Abi).__rs2b0t.Inventory.count(n), name);
const used = (page: import('playwright-core').Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.used());

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const tag = `twc-${Date.now().toString(36).slice(-6)}`;
    const client = deployIsolatedClient(tag);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await mainlandAccount(page, base, tag, client.page);
        const timing = await cadence(page, false);
        assert(timing.after >= 550 && timing.after <= 650, `600ms server required (${timing.after}ms)`);
        assert(await cheatQuiet(page, 'setstat woodcutting 99'), 'woodcutting fixture');
        assert(await cheatQuiet(page, 'setstat fletching 99'), 'fletching fixture');
        assert(await teleTo(page, CAMP, 0, 20_000), 'teleport');
        for (const command of ['~clearinv', 'give rune_axe 1', 'give knife 1', 'give logs 3']) {
            assert(await cheatQuiet(page, command), command);
        }
        await setSettings(page, 'TickWoodcutter', {
            treeName: 'Willow',
            location: 'Seers Willows',
            bank: false,
            toolAcquire: 'Off',
            diagnostics: true
        });
        await startScript(page, 'TickWoodcutter');
        const startXp = await xpNow(page);
        const deadline = Date.now() + 120_000;
        let xp = startXp;
        while (Date.now() < deadline) {
            xp = await xpNow(page);
            if (xp > startXp) break;
            await page.waitForTimeout(250);
        }
        assert(xp > startXp, 'first 3-tick chop did not land');
        const from = Date.now();
        const xpStart = xp;
        await page.waitForTimeout(RUN_MS);
        const xpEnd = await xpNow(page);
        const elapsed = Date.now() - from;
        const gained = xpEnd - xpStart;
        const xpPerHour = elapsed > 0 ? Math.round(gained / (elapsed / 3_600_000)) : 0;
        const knife = await count(page, 'Knife');
        const logs = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return ['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs', 'Magic logs']
                .reduce((n, name) => n + g.__rs2b0t.Inventory.count(name), 0);
        });
        assert.equal(knife, 1, 'knife kept');
        assert(logs >= 1, 'carrier kept');
        assert(gained > 0, 'no woodcutting xp gained');
        if (xpPerHour < MIN_XP_HR) {
            console.log('STATE', JSON.stringify(await page.evaluate(() => {
                const g = globalThis as never as {
                    rs2b0t: {
                        runner: { bot?: { status?: string; debug?: () => unknown }; ctx?: { log?: { msg: string }[] } };
                        reader: { worldTile(): unknown };
                    };
                    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[]; used(): number } };
                };
                return {
                    status: g.rs2b0t.runner.bot?.status,
                    debug: g.rs2b0t.runner.bot?.debug?.(),
                    tile: g.rs2b0t.reader.worldTile(),
                    used: g.__rs2b0t.Inventory.used(),
                    inv: g.__rs2b0t.Inventory.items().map(i => [i.name, i.count]),
                    log: g.rs2b0t.runner.ctx?.log?.slice(-20).map(l => l.msg)
                };
            })));
        }
        assert(xpPerHour >= MIN_XP_HR, `xp/hr ${xpPerHour} below ${MIN_XP_HR}`);

        // Full pack: power mode drops; keep the carrier and resume.
        const usedBefore = await used(page);
        const fillXp = await xpNow(page);
        assert(await cheatQuiet(page, `give willow_logs ${PACK_FILL}`), 'fill pack');
        const usedFull = await used(page);
        const clearDeadline = Date.now() + 180_000;
        let usedAfter = usedFull;
        while (Date.now() < clearDeadline) {
            usedAfter = await used(page);
            if (usedAfter <= usedFull - Math.min(10, PACK_FILL / 2)) break;
            await page.waitForTimeout(500);
        }
        let resumeXp = fillXp;
        const resumeDeadline = Date.now() + 120_000;
        while (Date.now() < resumeDeadline) {
            resumeXp = await xpNow(page);
            if (resumeXp > fillXp) break;
            await page.waitForTimeout(250);
        }
        if (usedAfter >= usedFull) {
            console.log('PACKSTATE', JSON.stringify(await page.evaluate(() => {
                const g = globalThis as never as {
                    rs2b0t: { runner: { bot?: { status?: string; debug?: () => unknown }; ctx?: { log?: { msg: string }[] } }; reader: { worldTile(): unknown } };
                    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[]; used(): number } };
                };
                return {
                    status: g.rs2b0t.runner.bot?.status,
                    debug: g.rs2b0t.runner.bot?.debug?.(),
                    tile: g.rs2b0t.reader.worldTile(),
                    used: g.__rs2b0t.Inventory.used(),
                    inv: g.__rs2b0t.Inventory.items().map(i => [i.name, i.count]),
                    log: g.rs2b0t.runner.ctx?.log?.slice(-20).map(l => l.msg)
                };
            })));
        }
        assert(usedAfter < usedFull, `pack did not clear (${usedAfter}/${usedFull})`);
        assert(resumeXp > fillXp, 'chopping did not resume after the pack filled');
        const carrierAfter = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return ['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs', 'Magic logs']
                .reduce((n, name) => n + g.__rs2b0t.Inventory.count(name), 0);
        });
        assert(carrierAfter >= 1, 'carrier kept through full pack');
        const botStatus = await page.evaluate(() => {
            const g = globalThis as never as { rs2b0t: { runner: { bot?: { status?: string }; ctx?: { log?: { msg: string }[] } } } };
            return { status: g.rs2b0t.runner.bot?.status, log: g.rs2b0t.runner.ctx?.log?.slice(-10).map(l => l.msg) };
        });
        assert.deepEqual(errors, [], 'browser runtime errors');
        const directory = `out/e2e/${tag}`;
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/tick-woodcutter.png` });
        await writeFile(`${directory}/evidence.json`, JSON.stringify({
            status: 'pass', tickMs: timing.after, xpPerHour, gained, usedBefore, usedFull, usedAfter, botStatus, errors
        }, null, 2) + '\n');
        console.log('PASS', JSON.stringify({ tickMs: timing.after, xpPerHour, gained, logs, usedBefore, usedFull, usedAfter, botStatus }));
    } finally {
        await stopScript(page).catch(() => undefined);
        await logout(page).catch(() => undefined);
        await browser.close();
        client.cleanup();
    }
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
