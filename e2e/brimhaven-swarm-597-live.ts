/** Live proof #597 — BrimhavenAgility ignores Swarm on arena platforms and keeps doing obstacles.
 *  Spawn Swarm on a 5x5 platform, start the script, and assert no evade intercept plus hop progress. */

//   ENGINE_DIR=.../engine sh tools/deploy-local.sh
//   bun e2e/brimhaven-swarm-597-live.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `bs${Date.now().toString(36).slice(-5)}`;

// Platform 19 — ticket grid, one hop south of the SE ladder landing.
const PLATFORM = { x: 2805, z: 9579, level: 3 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Skills: { level(name: string): number; xp(name: string): number };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            npcs(): Array<{ name: string | null; id: number }>;
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
            ctx: { log: { msg: string }[]; activeEvent: string | null } | null;
            bot: { ignoredRandoms(): string[] } | null;
        };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const snap = async () =>
    page.evaluate(() => {
        const g = globalThis as never as Api;
        const tile = g.rs2b0t.reader.worldTile();
        const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
        const npcs = g.__rs2b0t.reader.npcs();
        return {
            tile,
            logs,
            swarm: npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411),
            xp: g.__rs2b0t.Skills.xp('agility'),
            ignored: g.rs2b0t.runner.bot?.ignoredRandoms() ?? [],
            activeEvent: g.rs2b0t.runner.ctx?.activeEvent ?? null,
            state: g.rs2b0t.runner.state
        };
    });

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    await cheatQuiet(page, 'speed 200', 800);
    await cheatQuiet(page, 'setstat agility 50', 900);
    await cheatQuiet(page, 'setstat hitpoints 50', 900);
    await cheatQuiet(page, 'give coins 1000', 1200);
    await cheatQuiet(page, 'give lobster 25', 1500);
    await cheatQuiet(
        page,
        `tele ${PLATFORM.level},${PLATFORM.x >> 6},${PLATFORM.z >> 6},${PLATFORM.x & 63},${PLATFORM.z & 63}`,
        3500
    );

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return {
            food: api.Inventory.count('Lobster'),
            agi: api.Skills.level('agility'),
            tile: api.reader.worldTile()
        };
    });
    if (seeded.food < 5) {
        fail(`seeding food failed: ${JSON.stringify(seeded)}`);
    }
    if (seeded.agi < 20) {
        fail(`agility seed failed: ${seeded.agi}`);
    }
    if (!seeded.tile || seeded.tile.level < 3 || seeded.tile.z < 9500) {
        fail(`not on an arena platform after tele: ${JSON.stringify(seeded.tile)}`);
    }
    console.log(`seeded @ ${JSON.stringify(seeded.tile)} food=${seeded.food} agi=${seeded.agi}`);

    await setSettings(page, 'BrimhavenAgility', { food: 'Lobster', foodWithdraw: 25, bankAtTickets: 1000 });
    const started = await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('BrimhavenAgility');
        if (!meta) {
            return false;
        }
        g.rs2b0t.runner.start(meta);
        return g.rs2b0t.runner.state === 'running';
    });
    if (!started) {
        fail('BrimhavenAgility failed to start');
    }
    console.log('BrimhavenAgility started');

    // ScriptRunner applies ignoredRandoms after onStart.
    await page.waitForTimeout(1500);
    const pre = await snap();
    if (!pre.ignored.includes('swarm')) {
        fail(`ignoredRandoms() did not include swarm in the arena: ${JSON.stringify(pre)}`);
    }
    console.log('ignoredRandoms includes swarm while in the arena');

    await cheatQuiet(page, 'npcadd macro_swarm', 2000);
    let swarmOk = (await snap()).swarm;
    if (!swarmOk) {
        await cheatQuiet(page, 'npcadd Swarm', 2000);
        swarmOk = (await snap()).swarm;
    }
    if (!swarmOk) {
        fail('could not spawn Swarm (npcadd macro_swarm)');
    }
    console.log('Swarm present');

    const startXp = pre.xp;
    const startTile = pre.tile;
    const deadline = Date.now() + 180_000;
    let hopProgress = false;
    let evaded = false;
    while (Date.now() < deadline) {
        const now = await snap();
        const evadeLog = now.logs.some(m => /random event/i.test(m) && /swarm/i.test(m) && /evad|paused|attacking/i.test(m));
        if (evadeLog || (now.activeEvent !== null && /swarm/i.test(now.activeEvent))) {
            evaded = true;
            console.log(`FAIL evidence: activeEvent=${now.activeEvent}`);
            for (const line of now.logs.slice(-12)) {
                console.log(`  ${line}`);
            }
            break;
        }
        const leftPlatform =
            now.tile !== null &&
            startTile !== null &&
            (Math.abs(now.tile.x - startTile.x) > 6 || Math.abs(now.tile.z - startTile.z) > 6);
        const logHop = now.logs.some(m => /crossing |tagged pillar/i.test(m));
        if (leftPlatform || logHop || now.xp > startXp) {
            hopProgress = true;
            console.log(
                `progress @ ${JSON.stringify(now.tile)} xp=${now.xp} swarm=${now.swarm} ignored=${JSON.stringify(now.ignored)}`
            );
            break;
        }
        await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: 'docs/e2e/issue-597-brimhaven-swarm.png' });
    console.log('screenshot: docs/e2e/issue-597-brimhaven-swarm.png');

    if (evaded) {
        fail('BrimhavenAgility tried to evade Swarm instead of ignoring it');
    }
    if (!hopProgress) {
        const end = await snap();
        console.log(`stuck @ ${JSON.stringify(end.tile)} event=${end.activeEvent}`);
        for (const line of end.logs.slice(-16)) {
            console.log(`  ${line}`);
        }
        fail('no obstacle progress while Swarm was present');
    }

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    console.log('PASS #597 — BrimhavenAgility ignored Swarm and kept doing obstacles');
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
}
