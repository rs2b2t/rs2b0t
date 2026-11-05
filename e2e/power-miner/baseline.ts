/**
 * PowerMiner baseline: run the existing GatheringBot `Miner` in power mode at a
 * chosen camp and measure true tick-rate throughput.
 *
 *   LOCATION='Legends Guild Iron (east)' SECONDS=60 bun e2e/power-miner/baseline.ts
 *
 * Reports XP/tick (frame-gap proof) beside wall-clock XP/hr, the ore-to-ore tick
 * gaps, and per-rock depletion/respawn ticks.
 */
import assert from 'node:assert/strict';
import { deployIsolatedClient, launchBrowser, logout, setSettings } from '../lib/harness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, startScript, teleTo } from '../tutorial/harness.js';
import { cadence } from '../fisher-shilo/cadence.js';
import { MINING_LOCATIONS } from '../../src/bot/data/miningLocations.js';

const LOCATION = process.env.LOCATION ?? 'Legends Guild Iron (east)';
const CUSTOM = process.env.CUSTOM; // "x,z" overrides LOCATION with Use Custom Position
const SECONDS = Number(process.env.SECONDS ?? 60);

type Sample = {
    tick: number;
    at: number;
    xp: number;
    ore: number;
    used: number;
    retaliate: boolean;
    combat: boolean;
    tile: { x: number; z: number; level: number } | null;
};
type RockEvent = { key: string; tick: number; id: number };
type Proof = {
    samples: Sample[];
    depleted: RockEvent[];
    respawned: RockEvent[];
    stop(): void;
};

type Abi = {
    rs2b0t: {
        host: { addFrameListener(cb: () => void): () => void; tickCount: number };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { id: number; name: string | null; tile: { x: number; z: number; level: number }; distance: number }[];
            inCombat(): boolean;
        };
    };
    __rs2b0t: {
        Game: { tick(): number; autoRetaliateOn(): boolean; tile(): { x: number; z: number; level: number } | null };
        Skills: { xp(name: string): number; level(name: string): number };
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
                retaliate: g.__rs2b0t.Game.autoRetaliateOn(),
                combat: g.rs2b0t.reader.inCombat(),
                tile: g.rs2b0t.reader.worldTile()
            });
            const now = new Map<string, number>();
            for (const loc of g.rs2b0t.reader.locs()) {
                if (loc.name !== 'Rocks' || (!iron.has(loc.id) && !depleted.has(loc.id))) continue;
                const key = `${loc.tile.x},${loc.tile.z}`;
                now.set(key, loc.id);
            }
            for (const [key, id] of now) {
                if (iron.has(id) && last.get(key) !== undefined && depleted.has(last.get(key)!)) {
                    proof.respawned.push({ key, tick, id });
                }
                if (depleted.has(id) && last.get(key) !== undefined && iron.has(last.get(key)!)) {
                    proof.depleted.push({ key, tick, id });
                }
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
    const idealXpHr = Math.round(xpPerTick * 6000);
    const wallXpHr = seconds > 0 ? Math.round(gained / (seconds / 3600)) : 0;

    // Ore-to-ore gaps in game ticks.
    const gains: number[] = [];
    let prevOre = first.ore;
    let prevUsed = first.used;
    let lastGainTick = -1;
    for (const sample of samples) {
        const gainedOre = sample.ore > prevOre || sample.used > prevUsed;
        if (gainedOre) {
            if (lastGainTick >= 0) gains.push(sample.tick - lastGainTick);
            lastGainTick = sample.tick;
        }
        prevOre = sample.ore;
        prevUsed = sample.used;
    }
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

    // Per-rock respawn ticks.
    const respawns = respawned.map(r => {
        const before = [...depleted].reverse().find(d => d.key === r.key && d.tick <= r.tick);
        return before ? r.tick - before.tick : null;
    }).filter((n): n is number => n !== null);

    return {
        location: LOCATION,
        ticks,
        seconds: Math.round(seconds),
        xpGained: gained,
        xpPerTick: Number(xpPerTick.toFixed(3)),
        idealXpHr,
        wallXpHr,
        oreGains: gains.length,
        meanOreGapTicks: Number(mean(gains).toFixed(2)),
        minOreGapTicks: gains.length ? Math.min(...gains) : null,
        maxOreGapTicks: gains.length ? Math.max(...gains) : null,
        depletions: depleted.length,
        respawns: respawns.length,
        meanRespawnTicks: Number(mean(respawns).toFixed(2)),
        minRespawnTicks: respawns.length ? Math.min(...respawns) : null,
        maxRespawnTicks: respawns.length ? Math.max(...respawns) : null,
        retaliateOnTicks: samples.filter(s => s.retaliate).length,
        combatTicks: samples.filter(s => s.combat).length,
        fullTicks: samples.filter(s => s.used >= 28).length
    };
}

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const camp = MINING_LOCATIONS.find(loc => loc.name === LOCATION);
    const custom = CUSTOM ? CUSTOM.split(',').map(Number) : null;
    assert(custom ? custom.length >= 2 && custom.every(Number.isFinite) : camp, `unknown location: ${LOCATION}`);
    const spot = custom ? { x: custom[0]!, z: custom[1]!, level: 0 } : camp!.spot;
    const locationName = custom ? 'Use Custom Position' : camp!.name;
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
        assert(await teleTo(page, spot, 4, 25_000), 'teleport');
        const settings: Record<string, string | number | boolean> = {
            rocks: 'Iron',
            location: locationName,
            bank: false,
            toolAcquire: 'Off',
            purgePackOnStart: false,
            muleMode: 'Off',
            tickManip: 'Off',
            foodWithdraw: 0,
            forgetfulBank: false
        };
        if (custom) settings.customLocation = `${custom[0]},${custom[1]},0`;
        await setSettings(page, 'Miner', settings);
        await startScript(page, 'Miner');
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
            return {
                samples: g.__pmProof.samples,
                depleted: g.__pmProof.depleted,
                respawned: g.__pmProof.respawned
            };
        });
        const endXp = proof.samples.at(-1)?.xp ?? startXp;
        assert(endXp > startXp, 'no mining XP gained');
        const summary = summarize(proof.samples, proof.depleted, proof.respawned);
        console.log('BASELINE', JSON.stringify(summary));
        const status = await page.evaluate(() => {
            const g = globalThis as never as { rs2b0t: { runner: { bot?: { status?: string; debug?: () => unknown } } } };
            return { status: g.rs2b0t.runner.bot?.status, debug: g.rs2b0t.runner.bot?.debug?.() };
        });
        console.log('STATUS', JSON.stringify(status));
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
