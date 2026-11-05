/**
 * PowerMiner live proof.
 *
 * Seeded account (maxed combat, 99 Mining, rune pickaxe), teleports to the camp,
 * runs the script at the 600 ms server tick and checks the per-tick cadence + drops.
 *
 *   ENGINE_DIR=/home/shonc/rs2bot/Server/engine SECONDS=60 bun e2e/power-miner/power-miner-live.ts
 */
import assert from 'node:assert/strict';
import { deployIsolatedClient, launchBrowser, logout, setSettings } from '../lib/harness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, startScript, teleTo } from '../tutorial/harness.js';
import { cadence } from '../fisher-shilo/cadence.js';
import { MINING_LOCATIONS } from '../../src/bot/data/miningLocations.js';
import { POWER_MINE_CAMPS } from '../../src/bot/scripts/PowerMiner/locations.js';

const LOCATION = process.env.LOCATION ?? 'Legends Guild Iron (east)';
const CUSTOM = process.env.CUSTOM;
const SECONDS = Number(process.env.SECONDS ?? 60);
const MIN_XP_HR = Number(process.env.POWER_MINER_MIN_XP_HR ?? 30_000);
/** Optional route: comma-separated per-rock order (e.g. "1,2,5,3,4,Exclude"). */
const ROCK_ORDER = (process.env.ROCKS ?? '').split(',').map(value => value.trim()).filter(Boolean);
const DROP_MODE = process.env.DROP_MODE ?? '';

type Sample = {
    tick: number;
    at: number;
    xp: number;
    ore: number;
    used: number;
    anim: number;
    varp: number;
    retaliate: boolean;
    combat: boolean;
    paused: boolean;
};
type RockEvent = { key: string; tick: number; id: number };
type Proof = {
    samples: Sample[];
    depleted: RockEvent[];
    respawned: RockEvent[];
    stop(): void;
};
type Debug = {
    status: string;
    location: string;
    anchor: { x: number; z: number; level: number };
    radius: number;
    ores: number;
    controller: { current: string | null; clicks: number; drops: number; waits: number; recoveries: number; triggers: number; medianRespawn: number | null; ringCapacity: number; cadence: number };
    obs: { tick: number } | null;
};

type Abi = {
    rs2b0t: {
        host: { addFrameListener(cb: () => void): () => void; tickCount: number };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { id: number; name: string | null; tile: { x: number; z: number; level: number }; distance: number }[];
            inCombat(): boolean;
            selfAnim(): number;
            varp(i: number): number;
        };
        runner: { bot?: { debug?: () => Debug }; ctx?: { state?: string } };
    };
    __rs2b0t: {
        Game: { tick(): number; autoRetaliateOn(): boolean };
        Skills: { xp(name: string): number };
        Inventory: { used(): number; count(name: string): number };
    };
};

async function installProbe(page: import('playwright-core').Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Abi & { __pmProof?: Proof };
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
                varp: g.rs2b0t.reader.varp(58),
                retaliate: g.__rs2b0t.Game.autoRetaliateOn(),
                combat: g.rs2b0t.reader.inCombat(),
                paused: g.rs2b0t.runner.ctx?.state === 'paused'
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
    // Random events pause the script; measure mining throughput over the ticks
    // the script was running, and report wall-clock separately.
    const activeTicks = samples.filter(sample => !sample.paused).length;
    const xpPerTick = activeTicks > 0 ? gained / activeTicks : 0;
    // Sustained rate: drop the first-click warmup (no ore before the first gain).
    const firstGain = samples.findIndex((sample, index) => index > 0 && sample.xp > samples[index - 1]!.xp);
    const steadyStart = firstGain > 0 ? samples[firstGain - 1]! : first;
    const steadyTicks = end.tick - steadyStart.tick;
    const steadyGained = end.xp - steadyStart.xp;
    const steadyXpPerTick = steadyTicks > 0 ? steadyGained / steadyTicks : xpPerTick;

    const gains: number[] = [];
    let prevOre = first.ore;
    let prevUsed = first.used;
    let lastGainTick = -1;
    for (const sample of samples) {
        if (sample.ore > prevOre || sample.used > prevUsed) {
            if (lastGainTick >= 0) gains.push(sample.tick - lastGainTick);
            lastGainTick = sample.tick;
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
        activeTicks,
        pausedTicks: samples.length - activeTicks,
        seconds: Math.round(seconds),
        xpGained: gained,
        xpPerTick: Number(xpPerTick.toFixed(3)),
        msPerTick: ticks > 0 ? Number(((seconds * 1000) / ticks).toFixed(1)) : null,
        idealXpHr: Math.round(xpPerTick * 6000),
        steadyXpHr: Math.round(steadyXpPerTick * 6000),
        steadyTicks,
        wallXpHr: seconds > 0 ? Math.round(gained / (seconds / 3600)) : 0,
        oreGains: gains.length,
        meanOreGapTicks: Number(mean(gains).toFixed(2)),
        minOreGapTicks: gains.length ? Math.min(...gains) : null,
        maxOreGapTicks: gains.length ? Math.max(...gains) : null,
        gaps: gains,
        depletions: depleted.length,
        respawns: respawns.length,
        meanRespawnTicks: Number(mean(respawns).toFixed(2)),
        minRespawnTicks: respawns.length ? Math.min(...respawns) : null,
        retaliateOnTicks: samples.filter(s => s.retaliate).length,
        combatTicks: samples.filter(s => s.combat).length,
        fullTicks: samples.filter(s => s.used >= 28).length
    };
}

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const pmCamp = POWER_MINE_CAMPS.find(camp => camp.name === LOCATION);
    const miningCamp = MINING_LOCATIONS.find(camp => camp.name === LOCATION);
    const custom = CUSTOM ? CUSTOM.split(',').map(Number) : null;
    assert(
        custom ? custom.length >= 2 && custom.every(Number.isFinite) : pmCamp ?? miningCamp,
        `unknown location: ${LOCATION}`
    );
    const spot = custom
        ? { x: custom[0]!, z: custom[1]!, level: 0 }
        : (pmCamp?.anchor ?? miningCamp!.spot);
    const locationName = custom ? 'Use Custom Position' : (pmCamp?.name ?? miningCamp!.name);

    const tag = `pm-${Date.now().toString(36).slice(-6)}`;
    const client = deployIsolatedClient(tag);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await mainlandAccount(page, base, tag, client.page);
        const timing = await cadence(page, false);
        assert(timing.after >= 550 && timing.after <= 650, `600ms server required (${timing.after}ms)`);
        await maxmeAndClearDialogs(page);
        assert(await cheatQuiet(page, 'setstat mining 99'), 'mining fixture');
        for (const command of ['~clearinv', 'give rune_pickaxe 1']) {
            assert(await cheatQuiet(page, command), command);
        }
        assert(await teleTo(page, spot, 1, 25_000), 'teleport');

        const settings: Record<string, string | number | boolean> = {
            location: locationName,
            diagnostics: process.env.DIAG === '1'
        };
        if (custom) settings.customLocation = `${custom[0]},${custom[1]},0`;
        ROCK_ORDER.forEach((value, index) => {
            settings[`rock${index + 1}`] = value;
        });
        if (DROP_MODE) settings.dropMode = DROP_MODE;
        await setSettings(page, 'PowerMiner', settings);
        await startScript(page, 'PowerMiner');
        await page.waitForFunction(() => {
            const g = globalThis as never as Abi;
            return !g.__rs2b0t.Game.autoRetaliateOn();
        }, undefined, { timeout: 30_000 });
        await installProbe(page);

        const startXp = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.xp('mining'));
        await page.waitForTimeout(SECONDS * 1000);
        const proof = await page.evaluate(() => {
            const g = globalThis as never as { __pmProof: Proof };
            g.__pmProof.stop();
            return { samples: g.__pmProof.samples, depleted: g.__pmProof.depleted, respawned: g.__pmProof.respawned };
        });
        const debug = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.bot?.debug?.() ?? null);
        const log = await page.evaluate(() => {
            const g = globalThis as never as { rs2b0t: { runner: { ctx?: { log: { msg: string }[] } } } };
            return (g.rs2b0t.runner.ctx?.log ?? []).slice(-80).map(entry => entry.msg);
        });
        const endXp = proof.samples.at(-1)?.xp ?? startXp;
        if (endXp <= startXp) {
            console.log('NOXP', JSON.stringify({ startXp, endXp, debug, log, samples: proof.samples.slice(-6) }));
        }
        assert(endXp > startXp, 'no mining XP gained');
        const summary = summarize(proof.samples, proof.depleted, proof.respawned);
        console.log('POWERMINER', JSON.stringify({ ...summary, location: locationName, debug, log, samples: proof.samples }));
        assert.equal(summary.retaliateOnTicks, 0, 'auto-retaliate stayed off');
        assert.equal(summary.fullTicks, 0, 'pack never stayed full');
        if (MIN_XP_HR > 0) {
            assert(
                summary.steadyXpHr >= MIN_XP_HR,
                `steady xp/hr ${summary.steadyXpHr} below ${MIN_XP_HR} (ideal ${summary.idealXpHr})`
            );
        }
    } finally {
        await logout(page).catch(() => undefined);
        await browser.close();
        client.cleanup();
        if (errors.length) console.error('page errors:', errors);
    }
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
