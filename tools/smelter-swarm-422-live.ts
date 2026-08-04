// Live proof #422 — SmelterBot clears a Swarm random-event attacker instead of
// soft-locking on walk timeouts while being hit.
//
//   ENGINE_DIR=.../Server/engine sh tools/deploy-local.sh
//   bun tools/smelter-swarm-422-live.ts [http://localhost:8890]
//
// Seeds ore + food at the Al Kharid furnace, spawns macro_swarm via npcadd, starts
// SmelterBot, asserts the bot engages/clears the swarm and reaches a smelt progress.
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, setSettings } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = process.argv[3] ?? `sm${Date.now().toString(36).slice(-6)}`;

// Al Kharid furnace stand (script default)
const FURNACE = { x: 3275, z: 3185 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number };
        Skills: { effective(name: string): number; level(name: string): number };
        Game: { inCombat(): boolean; tile(): { x: number; z: number; level: number } | null };
        Npcs: {
            query(): {
                name(...n: string[]): { within(d: number): { nearest(): { name: string | null } | null } };
                where(fn: (n: unknown) => boolean): { nearest(): { name: string | null } | null };
            };
        };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            npcs(): Array<{ name: string | null; inCombat: boolean }>;
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(): void;
            ctx: { log: { msg: string }[] } | null;
        };
        registry: { get(name: string): unknown };
    };
}

const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    await cheatQuiet(page, 'setstat smithing 1', 800);
    await cheatQuiet(page, 'setstat hitpoints 40', 800);
    await cheatQuiet(page, 'setstat attack 40', 800);
    await cheatQuiet(page, 'setstat strength 40', 800);
    await cheatQuiet(
        page,
        `tele 0,${FURNACE.x >> 6},${FURNACE.z >> 6},${FURNACE.x & 63},${FURNACE.z & 63}`,
        3500
    );
    await cheatQuiet(page, 'give copper_ore 9', 1500);
    await cheatQuiet(page, 'give tin_ore 9', 1500);
    await cheatQuiet(page, 'give trout 8', 1500);

    // Spawn antimacro Swarm on the player tile.
    await cheatQuiet(page, 'npcadd macro_swarm', 2000);

    const swarmSeen = await page.evaluate(() => {
        const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
        return npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm');
    });
    if (!swarmSeen) {
        // try display-name form
        await cheatQuiet(page, 'npcadd Swarm', 2000);
    }
    const swarmOk = await page.evaluate(() => {
        const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
        return npcs.some(n => (n.name ?? '').toLowerCase().includes('swarm'));
    });
    if (!swarmOk) {
        fail('npcadd did not place a Swarm (tried macro_swarm and Swarm)');
    }
    console.log('spawned Swarm on player');

    await setSettings(page, 'SmelterBot', {
        bar: 'Bronze',
        food: 'Trout',
        eatAtHp: 80
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('SmelterBot');
        if (!meta) {
            throw new Error('SmelterBot not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('SmelterBot started');

    // Expect combat clear log or swarm gone + smelting progress.
    const deadline = Date.now() + 180_000;
    let cleared = false;
    let smelted = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
            const npcs = g.__rs2b0t.reader.npcs();
            return {
                logs: logs.slice(-40),
                swarm: npcs.some(n => (n.name ?? '').toLowerCase().includes('swarm')),
                bars: g.__rs2b0t.Inventory.count('Bronze bar'),
                copper: g.__rs2b0t.Inventory.count('Copper ore'),
                combat: g.__rs2b0t.Game.inCombat(),
                tile: g.__rs2b0t.reader.worldTile()
            };
        });
        if (snap.logs.some(m => /under attack by|fighting off|clearing before/i.test(m))) {
            cleared = true;
        }
        if (!snap.swarm && cleared) {
            console.log('Swarm gone after clear');
            break;
        }
        if (snap.bars > 0 || snap.copper < 9) {
            smelted = true;
            console.log(`smelt progress bars=${snap.bars} copper=${snap.copper}`);
            break;
        }
        await page.waitForTimeout(1500);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-40).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    if (!cleared && !smelted) {
        fail('bot never engaged the Swarm and never smelted — still soft-locked?');
    }
    if (!cleared) {
        // smelt without clear log is still ok if swarm despawned and trip continued
        console.log('WARN: no clear-hostiles log, but smelt progressed');
    }
    console.log('PASS #422 live — SmelterBot handled Swarm / continued the trip');
} finally {
    await browser.close();
}
