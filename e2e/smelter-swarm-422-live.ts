/** Live proof #422 — Swarm is handled by Supervisor / RandomEvents (evade) rather than by SmelterBot growing its own combat loop: [base].
 *  Seeds ore at the Al Kharid furnace, spawns macro_swarm, starts SmelterBot, and asserts a random-event intercept plus swarm despawn plus smelt progress. */

//   ENGINE_DIR=.../Server/engine sh tools/deploy-local.sh
//   bun e2e/smelter-swarm-422-live.ts [http://localhost:8890]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `sm${Date.now().toString(36).slice(-6)}`;

const FURNACE = { x: 3275, z: 3185 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        reader: {
            npcs(): Array<{ name: string | null; id: number }>;
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
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
    await cheatQuiet(
        page,
        `tele 0,${FURNACE.x >> 6},${FURNACE.z >> 6},${FURNACE.x & 63},${FURNACE.z & 63}`,
        3500
    );
    await cheatQuiet(page, 'give copper_ore 9', 1500);
    await cheatQuiet(page, 'give tin_ore 9', 1500);

    await cheatQuiet(page, 'npcadd macro_swarm', 2000);
    let swarmOk = await page.evaluate(() => {
        const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
        return npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411);
    });
    if (!swarmOk) {
        await cheatQuiet(page, 'npcadd Swarm', 2000);
        swarmOk = await page.evaluate(() => {
            const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
            return npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411);
        });
    }
    if (!swarmOk) {
        fail('could not spawn Swarm (npcadd macro_swarm)');
    }
    console.log('Swarm present');

    // setSettings(page, scriptName, flat map) — tiles are "x,z,level".
    await setSettings(page, 'SmelterBot', {
        bar: 'Bronze',
        bankStand: '3269,3167,0',
        furnaceStand: `${FURNACE.x},${FURNACE.z},0`
    });

    const started = await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('SmelterBot');
        if (!meta) {
            return false;
        }
        g.rs2b0t.runner.start(meta);
        return g.rs2b0t.runner.state === 'running';
    });
    if (!started) {
        fail('SmelterBot failed to start');
    }

    // Supervisor should log the intercept; RandomEvents handleEvade clears Swarm.
    const deadline = Date.now() + 120_000;
    let sawEvent = false;
    let swarmGone = false;
    let smeltProgress = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
            const npcs = g.__rs2b0t.reader.npcs();
            const bars = g.__rs2b0t.Inventory.count('Bronze bar');
            const copper = g.__rs2b0t.Inventory.count('Copper ore');
            return {
                logs,
                swarm: npcs.some(n => (n.name ?? '').toLowerCase() === 'swarm' || n.id === 411),
                bars,
                copper
            };
        });
        if (snap.logs.some(m => /random event/i.test(m) && /swarm/i.test(m))) {
            sawEvent = true;
        }
        if (!snap.swarm) {
            swarmGone = true;
        }
        if (snap.bars > 0 || snap.copper < 9) {
            smeltProgress = true;
        }
        if (sawEvent && swarmGone && smeltProgress) {
            break;
        }
        await page.waitForTimeout(1000);
    }

    if (!sawEvent) {
        fail('never saw Supervisor/RandomEvents log for Swarm');
    }
    if (!swarmGone) {
        fail('Swarm still present after random-event handling window');
    }
    if (!smeltProgress) {
        fail('no smelt progress after Swarm cleared');
    }
    console.log('PASS #422 — RandomEvents handled Swarm; SmelterBot resumed smelting');
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
}
