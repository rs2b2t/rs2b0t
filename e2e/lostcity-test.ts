import { type Page } from 'playwright-core';
import { launchBrowser, positionalArgs } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8990');
const base = args[0];
// Usernames cap at 12 chars (Client.ts:1460, engine World.ts:2201); the old
// `lostcity101…` default was 16 and could never log in.
const user = args[1] ?? `lc${Date.now().toString(36).slice(-7)}`;
const timeoutMs = (Number(args[2]) || 6) * 60_000;

type Item = { count: number; name: string | null };
type Snapshot = {
    crash: string | null;
    equipment: Item[];
    inventory: Item[];
    logs: Array<{ level: string; msg: string; time: number }>;
    quest: string;
    runner: string;
    tile: { level: number; x: number; z: number } | null;
};

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const globals = globalThis as unknown as {
            rs2b0t: {
                runner: {
                    ctx: {
                        crashError: Error | null;
                        log: Array<{ level: string; msg: string; time: number }>;
                    } | null;
                    state: string;
                };
            };
            __rs2b0t: {
                Equipment: { items(): Item[] };
                Game: { tile(): { level: number; x: number; z: number } | null };
                Inventory: { items(): Item[] };
                Quests: { status(name: string): string };
            };
        };
        const { runner } = globals.rs2b0t;
        const api = globals.__rs2b0t;
        return {
            crash: runner.ctx?.crashError?.stack ?? runner.ctx?.crashError?.message ?? null,
            equipment: api.Equipment.items().map(item => ({ count: item.count, name: item.name })),
            inventory: api.Inventory.items().map(item => ({ count: item.count, name: item.name })),
            logs: runner.ctx?.log.slice(-100) ?? [],
            quest: api.Quests.status('Lost City'),
            runner: runner.state,
            tile: api.Game.tile()
        };
    });
}

function count(items: Item[], name: string): number {
    return items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0);
}

// launchBrowser resolves Chrome by channel; the old hardcoded /opt/google/chrome/chrome
// meant this harness could only ever run on Linux.
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));

try {
    await mainlandAccount(page, base, user);
    if (!(await cheatQuiet(page, '~clearinv inv'))) throw new Error('failed to clear the inventory');
    if (!(await cheatQuiet(page, 'setstat woodcutting 36'))) throw new Error('failed to seed Woodcutting');
    if (!(await cheatQuiet(page, 'setstat crafting 31'))) throw new Error('failed to seed Crafting');
    if (!(await cheatQuiet(page, 'setvar zanaris 3'))) throw new Error('failed to seed the spirit-defeated stage');
    if (!(await cheatQuiet(page, 'give knife 1'))) throw new Error('failed to seed a Knife');
    if (!(await cheatQuiet(page, 'give iron_axe 1'))) throw new Error('failed to seed an Iron axe');
    if (!(await cheatQuiet(page, 'give lobster 20'))) throw new Error('failed to seed Lobsters');
    if (!(await cheatQuiet(page, 'tele 0,44,152,44,6'))) throw new Error('failed to teleport to the Dramen tree');
    await relog(page, user);
    await cheatQuiet(page, 'speed 300');

    const beforeVar = await getServerVarQuiet(page, 'zanaris');
    const before = await snapshot(page);
    if (beforeVar !== 3) throw new Error(`expected Lost City stage 3, got ${beforeVar}`);
    if (count(before.inventory, 'Lobster') !== 20) {
        throw new Error(`expected 20 selected Lobsters before the run: ${JSON.stringify(before.inventory)}`);
    }
    if (count(before.inventory, 'Kebab') !== 0) throw new Error('test precondition unexpectedly contains Kebabs');

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'zanaris');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Lobster');
    });
    await startScript(page, 'AIOQuester');

    let current = before;
    let lastLogTime = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        current = await snapshot(page);
        for (const line of current.logs) {
            if (line.time > lastLogTime) console.log(`[${line.level}] ${line.msg}`);
            lastLogTime = Math.max(lastLogTime, line.time);
        }
        if (current.quest === 'complete' || current.runner === 'crashed') break;
    }

    const afterVar = await getServerVarQuiet(page, 'zanaris');
    const after = await snapshot(page);
    const screenshot = '/tmp/issue101-lost-city.png';
    await page.screenshot({ path: screenshot, fullPage: true });
    const staffCount = count(after.inventory, 'Dramen staff') + count(after.equipment, 'Dramen staff');
    console.log(JSON.stringify({ after, afterVar, before, beforeVar, pageErrors, screenshot, staffCount, user }, null, 2));

    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join('\n')}`);
    if (after.runner === 'crashed') throw new Error(`AIOQuester crashed: ${after.crash}`);
    if (afterVar !== 6 || after.quest !== 'complete') {
        throw new Error(`Lost City did not complete (var=${afterVar}, journal=${after.quest})`);
    }
    if (staffCount !== 5) throw new Error(`expected exactly 5 Dramen staves after completion, got ${staffCount}`);
    if (count(after.inventory, 'Kebab') !== 0 || count(after.equipment, 'Kebab') !== 0) {
        throw new Error('Lost City introduced a Kebab despite Lobster being selected');
    }
    if (after.logs.some(line => /kebab/i.test(line.msg))) throw new Error('Lost City logged a Kebab fallback');
    if (after.logs.some(line => line.msg === 'Lost City: check the bank')) {
        throw new Error('Lost City made an unnecessary bank detour with all five local staff materials');
    }
    console.log(`PASS (Lost City complete with ${staffCount} staves and no Kebab fallback)`);
} finally {
    await browser.close();
}
