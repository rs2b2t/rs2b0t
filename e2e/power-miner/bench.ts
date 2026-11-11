/**
 * PowerMiner variant bench.
 *
 * Deploys the client, boots and logs in ONCE, then runs each variant back to
 * back in the same page. Prints a `VARIANT {...}` line immediately after each
 * run, so a screen/tee shows progress instead of waiting for the batch.
 *
 *   ENGINE_DIR=/home/shonc/rs2bot/Server/engine SECONDS=30 \
 *     VARIANTS='ack:0:0,c4j0:4:0,c4j1:4:1,c4j2:4:2,c5j1:5:1' \
 *     bun e2e/power-miner/bench.ts
 *
 * Variant spec: name:cadence:jitter[:obsDelay[:sendDelay]]
 */
import assert from 'node:assert/strict';
import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from '../lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, startScript, teleTo } from '../tutorial/harness.js';
import { POWER_MINE_CAMPS } from '../../src/bot/scripts/PowerMiner/locations.js';

const LOCATION = process.env.LOCATION ?? 'Legends Guild Iron (east)';
const SECONDS = Number(process.env.SECONDS ?? 30);
const ROCK_ORDER = (process.env.ROCKS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const DROP_MODES: Record<string, string> = {
    two: 'Every 2 ores',
    three: 'Every 3 ores',
    four: 'Every 4 ores'
};
const VARIANTS = (process.env.VARIANTS ?? 'each:0:0:0:0:0:every,three:0:0:0:0:0:three')
    .split(',')
    .map(spec => {
        const [name, cadence, jitter, obsDelay, sendDelay, roll, drop] = spec.split(':');
        return {
            name: name!.trim(),
            cadence: Number(cadence ?? 0),
            jitter: Number(jitter ?? 0),
            obsDelay: Number(obsDelay ?? 0),
            sendDelay: Number(sendDelay ?? 0),
            rollOffset: Number(roll ?? 0),
            dropMode: DROP_MODES[drop?.trim() ?? ''] ?? 'Every ore'
        };
    });

type Sample = {
    tick: number;
    at: number;
    xp: number;
    ore: number;
    used: number;
    anim: number;
    retaliate: boolean;
    combat: boolean;
};
type RockEvent = { key: string; tick: number; id: number };
type Proof = { samples: Sample[]; depleted: RockEvent[]; respawned: RockEvent[]; stop(): void };
type Debug = {
    controller: { clicks: number; drops: number; waits: number; triggers: number; misses: number; medianRespawn: number | null };
    obs: { tile: { x: number; z: number; level: number } | null } | null;
};

type Abi = {
    rs2b0t: {
        host: { addFrameListener(cb: () => void): () => void };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { id: number; name: string | null; tile: { x: number; z: number; level: number }; distance: number }[];
            inCombat(): boolean;
            selfAnim(): number;
        };
        runner: { bot?: { debug?: () => Debug } };
    };
    __rs2b0t: {
        Game: { tick(): number; autoRetaliateOn(): boolean };
        Skills: { xp(name: string): number };
        Inventory: { used(): number; count(name: string): number };
    };
    __pmProof?: Proof;
};

async function installProbe(page: import('playwright-core').Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        g.__pmProof?.stop();
        const proof: Proof = { samples: [], depleted: [], respawned: [], stop: () => {} };
        g.__pmProof = proof;
        const iron = new Set([2092, 2093]);
        const depleted = new Set([450, 452]);
        let lastTick = -1;
        let last = new Map<string, number>();
        const observe = () => {
            const tick = g.__rs2b0t.Game.tick();
            if (tick === lastTick) return;
            lastTick = tick;
            proof.samples.push({
                tick,
                at: performance.now(),
                xp: g.__rs2b0t.Skills.xp('mining'),
                ore: g.__rs2b0t.Inventory.count('Iron ore'),
                used: g.__rs2b0t.Inventory.used(),
                anim: g.rs2b0t.reader.selfAnim(),
                retaliate: g.__rs2b0t.Game.autoRetaliateOn(),
                combat: g.rs2b0t.reader.inCombat()
            });
            const now = new Map<string, number>();
            for (const loc of g.rs2b0t.reader.locs()) {
                if (loc.name !== 'Rocks' || (!iron.has(loc.id) && !depleted.has(loc.id))) continue;
                now.set(`${loc.tile.x},${loc.tile.z}`, loc.id);
            }
            for (const [key, id] of now) {
                const before = last.get(key);
                if (before === undefined) continue;
                if (iron.has(id) && depleted.has(before)) proof.respawned.push({ key, tick, id });
                if (depleted.has(id) && iron.has(before)) proof.depleted.push({ key, tick, id });
            }
            last = now;
        };
        const unsubscribe = g.rs2b0t.host.addFrameListener(observe);
        proof.stop = () => unsubscribe();
        observe();
    });
}

function summarize(samples: Sample[], depleted: RockEvent[], respawned: RockEvent[]) {
    const first = samples[0];
    const end = samples.at(-1);
    if (!first || !end) throw new Error('no samples');
    const ticks = end.tick - first.tick;
    const seconds = (end.at - first.at) / 1000;
    const gained = end.xp - first.xp;
    const xpPerTick = ticks > 0 ? gained / ticks : 0;

    const gaps: number[] = [];
    let prevOre = first.ore;
    let prevUsed = first.used;
    let lastGain = -1;
    for (const sample of samples) {
        if (sample.ore > prevOre || sample.used > prevUsed) {
            if (lastGain >= 0) gaps.push(sample.tick - lastGain);
            lastGain = sample.tick;
        }
        prevOre = sample.ore;
        prevUsed = sample.used;
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const respawns = respawned
        .map(r => {
            const before = [...depleted].reverse().find(d => d.key === r.key && d.tick <= r.tick);
            return before ? r.tick - before.tick : null;
        })
        .filter((n): n is number => n !== null);

    return {
        ticks,
        seconds: Math.round(seconds),
        xpGained: gained,
        xpPerTick: Number(xpPerTick.toFixed(3)),
        msPerTick: ticks > 0 ? Number(((seconds * 1000) / ticks).toFixed(1)) : null,
        idealXpHr: Math.round(xpPerTick * 6000),
        wallXpHr: seconds > 0 ? Math.round(gained / (seconds / 3600)) : 0,
        oreGains: gaps.length,
        meanOreGapTicks: Number(mean(gaps).toFixed(2)),
        minOreGapTicks: gaps.length ? Math.min(...gaps) : null,
        maxOreGapTicks: gaps.length ? Math.max(...gaps) : null,
        meanRespawnTicks: Number(mean(respawns).toFixed(2)),
        gaps,
        retaliateOnTicks: samples.filter(s => s.retaliate).length,
        combatTicks: samples.filter(s => s.combat).length,
        fullTicks: samples.filter(s => s.used >= 28).length
    };
}

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const locations = (process.env.LOCATIONS ?? LOCATION)
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    assert(locations.length > 0, 'no locations');
    const t0 = Date.now();
    const mark = (label: string): void => {
        console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
    };

    const tag = `pmb-${Date.now().toString(36).slice(-5)}`;
    const noDeploy = process.argv.includes('--no-deploy');
    const pagePath = process.env.CLIENT_PAGE;
    const client = noDeploy && pagePath ? { page: pagePath, cleanup: () => {} } : deployIsolatedClient(tag);
    mark('client deployed');
    const browser = await launchBrowser();
    const page = await browser.newPage();
    mark('browser ready');
    try {
        await mainlandAccount(page, base, tag, client.page);
        mark('logged in');
        for (const stat of ['attack', 'strength', 'defence', 'hitpoints']) {
            await cheatQuiet(page, `setstat ${stat} 99`, 400);
        }
        await cheatQuiet(page, 'setstat mining 99', 500);
        await clearChatDialogs(page, 'stat fixture');
        mark('stats set');

        for (const locationName of locations) {
            const camp = POWER_MINE_CAMPS.find(c => c.name === locationName);
            if (!camp) {
                console.log('SKIP', JSON.stringify({ location: locationName, reason: 'unknown camp' }));
                continue;
            }
            await stopScript(page).catch(() => undefined);
            assert(await teleTo(page, camp.anchor, 1, 20_000), `teleport ${camp.name}`);

            for (const variant of VARIANTS) {
                const start = Date.now();
                await stopScript(page).catch(() => undefined);
                for (const command of ['~clearinv', 'give rune_pickaxe 1']) {
                    assert(await cheatQuiet(page, command, 500), command);
                }
                const rockSettings: Record<string, string> = {};
                ROCK_ORDER.forEach((value, index) => {
                    rockSettings[`rock${index + 1}`] = value;
                });
                await setSettings(page, 'PowerMiner', {
                    location: camp.name,
                    ...rockSettings,
                    dropMode: variant.dropMode,
                    diagnostics: false
                });
                await startScript(page, 'PowerMiner');
                await page.waitForFunction(() => {
                    const g = globalThis as never as Abi;
                    return !g.__rs2b0t.Game.autoRetaliateOn();
                }, undefined, { timeout: 20_000 });
                await installProbe(page);

                const startXp = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.xp('mining'));
                await page.waitForTimeout(SECONDS * 1000);
                const proof = await page.evaluate(() => {
                    const g = globalThis as never as Abi;
                    g.__pmProof!.stop();
                    return { samples: g.__pmProof!.samples, depleted: g.__pmProof!.depleted, respawned: g.__pmProof!.respawned };
                });
                const debug = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.bot?.debug?.() ?? null);
                const endXp = proof.samples.at(-1)?.xp ?? startXp;
                const summary = summarize(proof.samples, proof.depleted, proof.respawned);
                console.log('VARIANT', JSON.stringify({
                    location: camp.name,
                    name: variant.name,
                    jitter: variant.jitter,
                    rollOffset: variant.rollOffset,
                    dropMode: variant.dropMode,
                    elapsed: Math.round((Date.now() - start) / 1000),
                    gained: endXp - startXp,
                    tile: debug?.obs?.tile ?? null,
                    controller: debug?.controller ?? null,
                    ...summary
                }));
            }
        }
    } finally {
        await logout(page).catch(() => undefined);
        await browser.close();
        client.cleanup();
        mark('done');
    }
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
