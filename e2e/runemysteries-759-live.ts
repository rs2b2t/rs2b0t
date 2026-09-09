/** Live proof, leftover air talisman + research package (#759).
 *  Why: decide() treated any held air talisman as talk to Sedridor, even after the package was in the pack. */

//   ENGINE_DIR=~/Documents/engine HEADED=1 EXPECT_NPC=Aubury bun e2e/runemysteries-759-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';

import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs } from './lib/harness.js';
import { mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888', minutes: 6 });
const deploy = !process.argv.includes('--no-deploy');
const user = process.env.USER_NAME || `rmy${Date.now().toString(36).slice(-5)}`;
const expectNpc = process.env.EXPECT_NPC ?? 'Aubury';
const screenshot = process.env.SCREENSHOT ?? 'docs/e2e/runemysteries-759-after.png';
const BUDGET_MS = minutes * 60_000;
const VARROCK_EAST = { x: 3251, z: 3420, level: 0 };
const AUBURY_TILE = { x: 3253, z: 3402 };
const TOWER_HALL = { x: 3108, z: 3162 };
const PACKAGE = 'Research package';
const TALISMAN = 'Air talisman';

interface Api {
    __rs2b0t: {
        Inventory: {
            contains(name: string): boolean;
            items(): Array<{ id: number; name: string | null; count: number }>;
        };
        Quests: { status(name: string): string };
    };
    rs2b0t: {
        runner: {
            state: string;
            bot: { stepDesc?: string } | null;
            ctx: { log: { time: number; msg: string }[] } | null;
        };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

type Pack = { names: string[]; talismans: number; hasPackage: boolean; status: string; step: string };

const pack = (page: Page): Promise<Pack> =>
    page.evaluate(([talisman, pkg, quest]) => {
        const g = globalThis as never as Api;
        const items = g.__rs2b0t.Inventory.items();
        const names = items.map(i => i.name ?? '');
        return {
            names,
            talismans: items.filter(i => (i.name ?? '').toLowerCase() === talisman.toLowerCase()).reduce((n, i) => n + i.count, 0),
            hasPackage: g.__rs2b0t.Inventory.contains(pkg),
            status: g.__rs2b0t.Quests.status(quest),
            step: g.rs2b0t.runner.bot?.stepDesc ?? ''
        };
    }, [TALISMAN, PACKAGE, 'Rune Mysteries Quest'] as const);

async function seedPack(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        await cheatQuiet(page, 'give air_talisman 2', 1200);
        await cheatQuiet(page, 'give research_package 1', 1200);
        const snap = await pack(page);
        if (snap.talismans >= 2 && snap.hasPackage) {
            return;
        }
    }
    const snap = await pack(page);
    fail(`could not seed leftover talismans + package: names=${JSON.stringify(snap.names)}`);
}

const talkRe = (npc: string): RegExp => new RegExp(`talk to ${npc}`, 'i');

const client = deploy
    ? deployIsolatedClient(`rmy${Date.now().toString(36).slice(-6)}`, process.env.ENGINE_DIR)
    : { page: '/bot.html', cleanup: () => undefined };
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await seedPack(page);
    await cheatQuiet(page, 'setvar runemysteries 3', 900);
    await relog(page, user);
    await seedPack(page);
    const started = await pack(page);
    if (started.status !== 'inProgress') {
        fail(`journal after setvar runemysteries 3 is '${started.status}', want inProgress`);
    }
    if (started.talismans < 2 || !started.hasPackage) {
        fail(`seed missing after relog, names=${JSON.stringify(started.names)}`);
    }
    if (!(await teleTo(page, VARROCK_EAST, 8, 25_000))) {
        fail(`could not reach Varrock East (${VARROCK_EAST.x},${VARROCK_EAST.z})`);
    }
    await cheatQuiet(page, 'speed 300', 700);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'runemysteries'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester expect talk to ${expectNpc} (${screenshot})`);

    const t0 = Date.now();
    let lastLog = 0;
    let sawExpected = false;
    while (Date.now() - t0 < BUDGET_MS) {
        const lines = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []);
        for (const line of lines) {
            if (line.time > lastLog) {
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
            if (talkRe(expectNpc).test(line.msg)) {
                sawExpected = true;
            }
            if (expectNpc === 'Aubury' && talkRe('Sedridor').test(line.msg) && !/Aubury/i.test(line.msg)) {
                fail(`leftover talisman still sent the bot to Sedridor: ${line.msg}`);
            }
            if (expectNpc === 'Sedridor' && talkRe('Aubury').test(line.msg) && !/Sedridor/i.test(line.msg)) {
                fail(`expected the pre-fix Sedridor loop, got Aubury: ${line.msg}`);
            }
        }
        const snap = await pack(page);
        if (talkRe(expectNpc).test(snap.step)) {
            sawExpected = true;
        }
        if (sawExpected) {
            break;
        }
        const runner = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.state);
        if (runner === 'crashed' || runner === 'stopped') {
            fail(`runner ${runner} before talk to ${expectNpc}: ${JSON.stringify(lines.slice(-12).map(l => l.msg))}`);
        }
        await page.waitForTimeout(400);
    }

    const end = await pack(page);
    if (!sawExpected) {
        fail(`never saw talk to ${expectNpc} within ${minutes} min; step='${end.step}' names=${JSON.stringify(end.names)}`);
    }
    const dest = expectNpc === 'Aubury' ? AUBURY_TILE : TOWER_HALL;
    const arrive = expectNpc === 'Aubury' ? 8 : 50;
    const walkUntil = Date.now() + 55_000;
    let lastTileLog = 0;
    while (Date.now() < walkUntil) {
        const tile = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.worldTile());
        if (tile) {
            const d = Math.max(Math.abs(tile.x - dest.x), Math.abs(tile.z - dest.z));
            if (Date.now() - lastTileLog > 4000) {
                console.log(`  walking (${tile.x},${tile.z}) d=${d} to ${expectNpc}`);
                lastTileLog = Date.now();
            }
            if (d <= arrive) {
                break;
            }
        }
        await page.waitForTimeout(400);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: screenshot });
    console.log(`PASS: leftover talisman + package, talk to ${expectNpc} (${screenshot})`);
} finally {
    await browser.close();
    client.cleanup();
}
