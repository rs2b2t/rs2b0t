// Issue #429 — live BrimhavenAgility proof: [base].

//   bun e2e/brimhaven-agility-test.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `bag${Date.now().toString(36).slice(-5)}`;

// Cap'n Izzy / ladder stand at Brimhaven arena entrance
const ENTRANCE = { x: 2809, z: 3194 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; contains(name: string): boolean; used(): number };
        Skills: { level(name: string): number; effective(name: string): number; xp(name: string): number };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            varp(id: number): number;
            hintTile?(): { x: number; z: number; level: number } | null;
        };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            varp(id: number): number;
            hintTile?(): { x: number; z: number; level: number } | null;
        };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const dump = async (label: string) => {
    const log = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-16).map(l => l.msg));
    const tile = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.worldTile());
    const paid = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.reader.varp(309) >> 1) & 1);
    console.log(`--- ${label} @ ${JSON.stringify(tile)} paid=${paid} ---`);
    for (const l of log) console.log(`  ${l}`);
};

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    // 3x world speed for faster pillar cycles (98 ticks → ~20s)
    await cheatQuiet(page, 'speed 200', 800);

    for (const [stat, lvl] of [
        ['agility', 50],
        ['hitpoints', 50]
    ] as const) {
        await cheatQuiet(page, `setstat ${stat} ${lvl}`, 900);
    }

    // Seed bank supplies via inventory + bank deposit path: give items, tele to bank,
    // start script which banks them. Simpler: give directly and tele to entrance.
    await cheatQuiet(page, 'give coins 1000', 1200);
    await cheatQuiet(page, 'give lobster 25', 1500);
    await cheatQuiet(page, `tele 0,${ENTRANCE.x >> 6},${ENTRANCE.z >> 6},${ENTRANCE.x & 63},${ENTRANCE.z & 63}`, 3000);

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return {
            food: api.Inventory.count('Lobster'),
            coins: api.Inventory.count('Coins'),
            agi: api.Skills.level('agility'),
            tile: api.reader.worldTile()
        };
    });
    if (seeded.food < 5) fail(`seeding food failed: ${JSON.stringify(seeded)}`);
    if (seeded.coins < 260) fail(`seeding coins failed: ${JSON.stringify(seeded)}`);
    if (seeded.agi < 20) fail(`agility seed failed: ${seeded.agi}`);
    console.log(`seeded: ${seeded.food} lobster, ${seeded.coins} coins, agi ${seeded.agi} @ ${JSON.stringify(seeded.tile)}`);

    await setSettings(page, 'BrimhavenAgility', { food: 'Lobster', foodWithdraw: 25, bankAtTickets: 1000 });
    const started = await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('BrimhavenAgility');
        if (!meta) return false;
        g.rs2b0t.runner.start(meta);
        return true;
    });
    if (!started) fail('BrimhavenAgility is not registered');
    console.log('BrimhavenAgility started');

    // 1. Enter the arena (plane 3 / z > 9500)
    const entered = await page
        .waitForFunction(
            () => {
                const t = (globalThis as never as Api).rs2b0t.reader.worldTile();
                return t !== null && (t.level >= 3 || t.z >= 9500);
            },
            undefined,
            { timeout: 240_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump('after enter');
    if (!entered) fail('never entered the Brimhaven Agility Arena');
    console.log('PASS 1/3 — entered the arena');

    // 2. Paid bit set (or already was) — varp 309 bit 1
    const paid = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.reader.varp(309) >> 1) & 1);
    if (!paid) {
        // allow a bit more time if still paying
        await page
            .waitForFunction(() => (((globalThis as never as Api).rs2b0t.reader.varp(309) >> 1) & 1) === 1, undefined, { timeout: 60_000 })
            .catch(() => null);
    }
    const paidNow = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.reader.varp(309) >> 1) & 1);
    if (!paidNow) fail('entrance fee was never paid (varp 309 bit 1 still clear)');
    console.log('PASS 2/3 — Cap\'n Izzy paid (or already paid)');

    // 3. Leave the ladder landing and tag: log line, ticket gain, or tagged bit
    //    after moving off the entrance tile (2805,9591).
    const tagged = await page
        .waitForFunction(
            () => {
                const g = globalThis as never as Api;
                const tickets = g.__rs2b0t.Inventory.count('Agility arena ticket');
                const varp = g.rs2b0t.reader.varp(309);
                const taggedBit = (varp & 1) === 1;
                const log = g.rs2b0t.runner.ctx?.log ?? [];
                const logHit = log.some(l => /tagged pillar/i.test(l.msg));
                const t = g.rs2b0t.reader.worldTile();
                const leftLanding = t !== null && (Math.abs(t.x - 2805) > 4 || Math.abs(t.z - 9591) > 4);
                return (tickets > 0 || taggedBit || logHit) && leftLanding;
            },
            undefined,
            { timeout: 360_000 }
        )
        .then(() => true)
        .catch(() => false);
    await dump('after tag');
    await page.screenshot({ path: 'docs/e2e/issue-429-brimhaven.png' });
    console.log('screenshot: docs/e2e/issue-429-brimhaven.png');
    if (!tagged) fail('never tagged a ticket pillar');

    const final = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            tickets: g.__rs2b0t.Inventory.count('Agility arena ticket'),
            tile: g.rs2b0t.reader.worldTile(),
            xp: g.__rs2b0t.Skills.xp('agility'),
            log: (g.rs2b0t.runner.ctx?.log ?? []).slice(-8).map(l => l.msg)
        };
    });
    console.log(`PASS 3/3 — tagged (tickets=${final.tickets}) at ${JSON.stringify(final.tile)}`);

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    console.log('PASS — BrimhavenAgility entered the arena, paid, and tagged a pillar');
} finally {
    await browser.close();
}
