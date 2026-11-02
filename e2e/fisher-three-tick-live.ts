import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';
import { cadence } from './fisher-shilo/cadence.js';

type Abi = {
    __rs2b0t: {
        Skills: { xp(skill: string): number; level(skill: string): number };
        Inventory: { count(name: string): number; used(): number };
    };
    rs2b0t: {
        reader: {
            selfAnim(): number;
            selfAnimState(): { seq: number; cycle: number } | null;
        };
    };
};

const SPOT = { x: 2716, z: 3532, level: 0 };
const BANK = { x: 2725, z: 3491, level: 0 };
// Target floor measured at 96k on the real 600ms tick; override for slower hosts.
const MIN_XP_HR = Number(process.env.THREE_TICK_MIN_XP_HR ?? 90_000);
const RUN_MS = Number(process.env.THREE_TICK_MS ?? 60_000);
const PACK_FILL = Number(process.env.THREE_TICK_PACK ?? 24);

const xpNow = (page: import('playwright-core').Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.xp('fishing'));
const count = (page: import('playwright-core').Page, name: string): Promise<number> =>
    page.evaluate(n => (globalThis as never as Abi).__rs2b0t.Inventory.count(n), name);
const used = (page: import('playwright-core').Page): Promise<number> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.used());

async function waitForXp(page: import('playwright-core').Page, from: number, deadlineMs: number): Promise<number> {
    const deadline = Date.now() + deadlineMs;
    let xp = from;
    while (Date.now() < deadline) {
        xp = await xpNow(page);
        if (xp > from) return xp;
        await page.waitForTimeout(250);
    }
    return xp;
}

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const tag = `3t-${Date.now().toString(36).slice(-6)}`;
    const client = deployIsolatedClient(tag);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const directory = `out/e2e/${tag}`;
    const errors: string[] = [];
    const botLogs: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        const text = message.text();
        if (/tick manip|3-tick|restock|kit:/i.test(text)) botLogs.push(text);
    });
    try {
        await mainlandAccount(page, base, tag, client.page);
        const timing = await cadence(page, false);
        assert(timing.after >= 550 && timing.after <= 650, `600ms server required (measured ${timing.after}ms)`);
        assert(await cheatQuiet(page, 'setstat fishing 99'), 'fishing fixture');
        assert(await teleTo(page, SPOT, 0, 20_000), 'teleport to fly-fishing spot');
        // Deliberately no knife, axe or log: the Fisher must provision the 3-tick kit.
        for (const command of ['~clearinv', 'give fly_fishing_rod 1', 'give feather 5000']) {
            assert(await cheatQuiet(page, command), command);
        }
        await setSettings(page, 'Fisher', {
            fishMethod: 'Fly fishing — trout/salmon',
            location: 'Seers (fly fishing)',
            bank: true,
            bankLocation: 'Seers',
            cookMode: 'Off',
            toolAcquire: 'Off',
            muleMode: 'Off',
            tickManip: 'Off',
            threeTickFly: true,
            leashRadius: 18
        });
        const startedAt = Date.now();
        await startScript(page, 'Fisher');

        // Phase A: provisioning from the bank/spawn, then the 3-tick cadence.
        const startXp = await xpNow(page);
        const firstRoll = await waitForXp(page, startXp, 420_000);
        if (firstRoll <= startXp) {
            console.log('STATE', JSON.stringify(await page.evaluate(() => {
                const g = globalThis as never as {
                    rs2b0t: { runner: { bot?: { status?: string }; ctx?: { log?: { msg: string }[] } }; reader: { worldTile(): unknown } };
                    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] } };
                };
                return {
                    status: g.rs2b0t.runner.bot?.status,
                    tile: g.rs2b0t.reader.worldTile(),
                    inv: g.__rs2b0t.Inventory.items().map(i => [i.name, i.count]),
                    log: g.rs2b0t.runner.ctx?.log?.slice(-16).map(l => l.msg)
                };
            })));
        }
        assert(firstRoll > startXp, 'first 3-tick roll did not land after provisioning');
        const knife = await count(page, 'Knife');
        const logs = await count(page, 'Logs');
        const axe = await page.evaluate(() => [
            'Bronze axe', 'Iron axe', 'Steel axe', 'Black axe', 'Mithril axe', 'Adamant axe', 'Rune axe'
        ].reduce((n, name) => n + (globalThis as never as Abi).__rs2b0t.Inventory.count(name), 0));
        assert.equal(knife, 1, 'knife provisioned');
        assert.equal(logs, 1, 'one carrier log provisioned');
        assert(axe > 0, 'axe provisioned');

        // Phase A measurement.
        const measuredFrom = Date.now();
        const measuredXpStart = firstRoll;
        const rolls: { at: number; xp: number }[] = [{ at: 0, xp: firstRoll }];
        const rollTicks: number[] = [];
        let lastSeq = -1;
        let lastCycle = -1;
        while (Date.now() - measuredFrom < RUN_MS) {
            await page.waitForTimeout(50);
            const xp = await xpNow(page);
            if (xp > rolls[rolls.length - 1]!.xp) {
                rolls.push({ at: Date.now() - measuredFrom, xp });
            }
            const anim = await page.evaluate(() => {
                const r = (globalThis as never as Abi).rs2b0t.reader;
                const s = r.selfAnimState();
                return { tick: (globalThis as never as { __rs2b0t: { Game: { tick(): number } } }).__rs2b0t.Game.tick(), seq: s?.seq ?? -1, cycle: s?.cycle ?? -1 };
            });
            if (anim.seq === 623 && (anim.seq !== lastSeq || anim.cycle < lastCycle)) rollTicks.push(anim.tick);
            lastSeq = anim.seq;
            lastCycle = anim.cycle;
        }
        const rollGaps = rollTicks.slice(1).map((t, i) => t - rollTicks[i]!);
        const measuredXpEnd = await xpNow(page);
        const elapsedMs = Date.now() - measuredFrom;
        const gained = measuredXpEnd - measuredXpStart;
        const xpPerHour = elapsedMs > 0 ? Math.round(gained / (elapsedMs / 3_600_000)) : 0;
        assert(gained > 0, 'no fishing xp gained');
        assert(xpPerHour >= MIN_XP_HR, `xp/hr ${xpPerHour} below ${MIN_XP_HR}`);

        // Phase B: fill the pack and prove the 3-tick batch drains it and keeps fishing.
        const usedBefore = await used(page);
        const fillXp = await xpNow(page);
        assert(await cheatQuiet(page, `give raw_trout ${PACK_FILL}`), 'fill pack with fish');
        const usedFull = await used(page);
        assert(usedFull >= usedBefore, 'pack did not fill');
        // The batch drops fish as it fishes; wait for the fish slots to clear.
        const clearDeadline = Date.now() + 240_000;
        let usedAfter = usedFull;
        while (Date.now() < clearDeadline) {
            usedAfter = await used(page);
            if (usedAfter <= usedFull - Math.min(10, PACK_FILL / 2)) break;
            await page.waitForTimeout(500);
        }
        const resumeXp = await waitForXp(page, fillXp, 180_000);
        const knifeAfter = await count(page, 'Knife');
        const logsAfter = await count(page, 'Logs');
        if (resumeXp <= fillXp) {
            console.log('STATE', JSON.stringify(await page.evaluate(() => {
                const g = globalThis as never as {
                    rs2b0t: { runner: { bot?: { status?: string }; ctx?: { log?: { msg: string }[] } }; reader: { worldTile(): unknown } };
                    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[]; used(): number } };
                };
                return {
                    status: g.rs2b0t.runner.bot?.status,
                    tile: g.rs2b0t.reader.worldTile(),
                    used: g.__rs2b0t.Inventory.used(),
                    inv: g.__rs2b0t.Inventory.items().map(i => [i.name, i.count]),
                    log: g.rs2b0t.runner.ctx?.log?.slice(-25).map(l => l.msg)
                };
            })));
        }
        assert(usedAfter < usedFull, `pack did not clear (used ${usedAfter}/${usedFull})`);
        assert(resumeXp > fillXp, 'fishing did not resume after the pack filled');
        assert.equal(knifeAfter, 1, 'knife kept through the full pack');
        assert.equal(logsAfter, 1, 'carrier log kept through the full pack');

        const fishingLevel = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.level('fishing'));
        const tickDebug = await page.evaluate(() => {
            const bot = (globalThis as never as { rs2b0t: { runner: { bot?: { threeTickDebug?: () => unknown } } } }).rs2b0t.runner.bot;
            return bot?.threeTickDebug?.() ?? null;
        });
        assert.deepEqual(errors, [], 'browser runtime errors');
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/three-tick-provision.png` });
        await writeFile(`${directory}/evidence.json`, JSON.stringify({
            status: 'pass', spot: SPOT, bank: BANK, tickMs: timing.after, fishingLevel, startedAt,
            measuredXpStart, measuredXpEnd, gained, elapsedMs, xpPerHour, minXpPerHour: MIN_XP_HR,
            knife, logs, axe, knifeAfter, logsAfter, usedBefore, usedFull, usedAfter,
            rolls: rolls.length - 1, rollGapsMs: rolls.slice(1).map((r, i) => r.at - rolls[i]!.at),
            animRollTicks: rollTicks, animRollGaps: rollGaps, tickDebug, errors, botLogs
        }, null, 2) + '\n');
        console.log('PASS', JSON.stringify({
            tickMs: timing.after, fishingLevel, xpPerHour, gained, knife, logs, axe,
            usedBefore, usedFull, usedAfter, rolls: rolls.length - 1,
            animRolls: rollTicks.length, rollGaps, tickDebug, botLogs: botLogs.slice(-8)
        }));
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
