/** Live proof, FlaxAIO picks at the Seers field, climbs to the wheel and banks bow strings.
 *  Why: the combined script is two old scripts joined at the bank, so the run only counts if one
 *  session produces both halves: flax off the field and crafting XP off the wheel. */

//   bun e2e/flaxaio-pick-spin-live.ts [http://localhost:8890]
import type { Page } from 'playwright-core';
import { deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `fx${Date.now().toString(36).slice(-5)}`;

const SEERS_BANK = { x: 2725, z: 3493, level: 0 };
const FIELD = { x: 2741, z: 3444, level: 0 };
const WANT_FLAX = 10;
const RUN_MS = 900_000;
/** Why: spinning.struct gives flax `levelrequire,10`, and the check sits in `oploc2` after the Make-X pick, so a
 *  level-1 account takes the menu, takes the amount, then eats a mesbox and spins nothing. `::setstat` writes the
 *  level outright, where `::advancestat` would queue a level-up dialog for ContinueDialog to swallow. */
const SPIN_CRAFTING = 10;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null; count: number }> };
        Skills: { level(name: string): number; xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

async function craftingLevel(page: Page): Promise<number> {
    return page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.level('crafting'));
}

async function grantCrafting(page: Page, level: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if ((await craftingLevel(page)) >= level) {
            return;
        }
        if (!(await cheatQuiet(page, `setstat crafting ${level}`))) {
            fail('setstat crafting not sent (not ingame?)');
        }
        await page.waitForTimeout(500);
    }
    const have = await craftingLevel(page);
    if (have < level) {
        fail(`setstat crafting ${level} stuck at ${have}`);
    }
}

const client = deployIsolatedClient(`fx${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);
    if (!(await teleTo(page, SEERS_BANK, 6, 30_000))) {
        fail(`could not reach the Seers bank stand (${SEERS_BANK.x},${SEERS_BANK.z})`);
    }

    await grantCrafting(page, SPIN_CRAFTING);
    console.log(`crafting ${await craftingLevel(page)}, the wheel accepts flax`);

    await setSettings(page, 'FlaxAIO', { picking: true, spinning: true });

    const craftBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('crafting'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('FlaxAIO');
        if (!meta) {
            throw new Error('FlaxAIO not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('FlaxAIO started empty-handed at the Seers bank with both toggles on');

    const deadline = Date.now() + RUN_MS;
    let flaxPeak = 0;
    let stringPeak = 0;
    let craftXp = 0;
    let reachedField = false;
    let reachedWheelFloor = false;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const inv = g.__rs2b0t.Inventory.items();
            const named = (n: string): number => inv.filter(i => (i.name ?? '').toLowerCase() === n).length;
            return {
                tile: g.rs2b0t.reader.worldTile(),
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                flax: named('flax'),
                strings: named('bow string'),
                craft: g.__rs2b0t.Skills.xp('crafting')
            };
        });
        logs = snap.logs;
        flaxPeak = Math.max(flaxPeak, snap.flax);
        stringPeak = Math.max(stringPeak, snap.strings);
        craftXp = snap.craft - craftBefore;
        if (snap.tile) {
            reachedField = reachedField || cheb(snap.tile, FIELD) <= 12;
            reachedWheelFloor = reachedWheelFloor || snap.tile.level === 1;
        }
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-8).join(' | ')}`);
        }
        if (flaxPeak >= WANT_FLAX && craftXp > 0 && stringPeak > 0) {
            break;
        }
        await page.waitForTimeout(2500);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-40)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/flaxaio-pick-spin-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!reachedField || flaxPeak < WANT_FLAX) {
        fail(`picking never got going: field reached=${reachedField}, most flax held=${flaxPeak}`);
    }
    if (!reachedWheelFloor) {
        fail('never climbed the ladder to the spinning wheel floor');
    }
    if (craftXp <= 0 || stringPeak <= 0) {
        fail(`picked flax but never spun it: crafting xp +${craftXp}, most bow strings held=${stringPeak}, crafting level=${await craftingLevel(page)}`);
    }
    console.log(`PASS, picked ${flaxPeak} flax and spun ${stringPeak} bow strings upstairs: crafting +${craftXp}`);
} finally {
    client.cleanup();
    await browser.close();
}
