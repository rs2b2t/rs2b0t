import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

import type { NpcSnapshot, WorldTile } from '../src/bot/adapter/ClientAdapter.js';
import { deployIsolatedClient, launchBrowser, positionalArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheb, teleArrive } from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount } from './tutorial/harness.js';

const [base] = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const proof = createHarnessProof({
    slug: 'hostile-random-damage',
    proofDir: process.env.PROOF_DIR,
    screenshotDir: process.env.SCREENSHOT_DIR
});
const fixtures = [
    { id: 431, key: 'macro_watchman1' },
    { id: 391, key: 'macro_rivertrollguardian_1' },
    { id: 408, key: 'macro_triffidseed_angry' },
    { id: 411, key: 'macro_swarm' },
    { id: 413, key: 'macro_golemguardian_1' },
    { id: 419, key: 'macro_zombie1' },
    { id: 425, key: 'macro_shade1' },
    { id: 438, key: 'macro_dryhadguardian_1' }
];

interface Snapshot {
    at: number;
    cycle: number;
    tile: WorldTile;
    hp: number;
    damage: boolean;
    hits: { damage: number; type: number; expires: number }[];
    npcs: NpcSnapshot[];
}

interface Observation {
    start: Snapshot;
    firstDamage?: Snapshot;
    blocked?: Snapshot;
    firstEvade?: Snapshot;
    escape?: Snapshot;
    movedBeforeDamage: boolean;
    maxDistance: number;
    minHp: number;
    walks: { destination: WorldTile; startedAt: number; finishedAt?: number; ok?: boolean }[];
    logs: string[];
}

interface Api {
    __rs2b0t: {
        Game: { setAutoRetaliate(enabled: boolean): boolean };
        Skills: { effective(name: string): number };
        Traversal: { walkTo(destination: WorldTile, options?: unknown): Promise<boolean> };
        reader: { worldTile(): WorldTile | null; npcs(): NpcSnapshot[] };
    };
    rs2b0t: {
        client: {
            constructor: { loopCycle: number };
            localPlayer: { damageValues: Int32Array; damageTypes: Int32Array; damageCycles: Int32Array };
        };
    };
    __hostileProof: Observation;
    __hostileSnapshot(): Snapshot;
    __hostileTimer: ReturnType<typeof setInterval>;
}

async function observe(page: Page, id: number): Promise<void> {
    await page.evaluate(id => {
        const g = globalThis as never as Api;
        clearInterval(g.__hostileTimer);
        const snapshot = (): Snapshot => {
            const { client } = g.rs2b0t;
            const player = client.localPlayer;
            const hits = Array.from(player.damageCycles).flatMap((expires, i) => expires > client.constructor.loopCycle
                ? [{ damage: player.damageValues[i], type: player.damageTypes[i], expires }]
                : []);
            const tile = g.__rs2b0t.reader.worldTile();
            if (!tile) throw new Error('player has no tile');
            return {
                at: Date.now(), cycle: client.constructor.loopCycle, tile, hp: g.__rs2b0t.Skills.effective('hitpoints'),
                damage: hits.some(h => h.type === 1 && h.damage > 0), hits,
                npcs: g.__rs2b0t.reader.npcs().filter(n => n.id === id)
            };
        };
        g.__hostileSnapshot = snapshot;
        const start = snapshot();
        g.__hostileProof = { start, movedBeforeDamage: false, maxDistance: 0, minHp: start.hp, walks: [], logs: [] };
        g.__hostileTimer = setInterval(() => {
            const s = snapshot();
            const p = g.__hostileProof;
            if (s.damage) p.firstDamage ??= s;
            if (s.hits.some(h => h.damage === 0)) p.blocked ??= s;
            p.minHp = Math.min(p.minHp, s.hp);
            const distance = Math.max(Math.abs(s.tile.x - p.start.tile.x), Math.abs(s.tile.z - p.start.tile.z));
            if (distance > p.maxDistance) {
                p.maxDistance = distance;
                p.escape = s;
            }
            if (distance > 0 && !p.firstDamage) p.movedBeforeDamage = true;
        }, 50);
    }, id);
}

async function readProof(page: Page): Promise<Observation & { end: Snapshot }> {
    return page.evaluate(() => {
        const g = globalThis as never as Api;
        return { ...g.__hostileProof, end: g.__hostileSnapshot() };
    });
}

async function finishEvade(page: Page): Promise<Observation & { end: Snapshot }> {
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        const p = g.__hostileProof;
        const s = g.__hostileSnapshot();
        return p.firstEvade && p.maxDistance >= 8 && s.npcs.length === 0
            && p.walks.length >= 2 && p.walks.every(w => w.finishedAt !== undefined)
            && Math.max(Math.abs(s.tile.x - p.start.tile.x), Math.abs(s.tile.z - p.start.tile.z)) <= 3;
    }, undefined, { timeout: 90_000 });
    const result = await readProof(page);
    assert(result.firstDamage, 'no positive server hit observed');
    assert(result.firstEvade?.damage, 'evasion started without a positive damage splat');
    assert(result.firstEvade.npcs.length > 0, 'evasion started without the hostile present');
    assert(!result.movedBeforeDamage, 'player moved before taking damage');
    assert(result.minHp < result.start.hp, 'HP never fell after the positive hit');
    assert(result.maxDistance >= 8, 'player did not escape');
    assert(cheb(result.start.tile, result.end.tile) <= 3, 'player did not return');
    assert(result.walks.every(w => w.ok), 'an evade or return walk failed');
    return result;
}

const client = process.env.BOT_PAGE ? null : deployIsolatedClient(`hrd-${Date.now().toString(36)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const results: Record<string, unknown>[] = [];
const build: Record<string, unknown> = {};
try {
    await proof.ensureDirs();
    await mainlandAccount(page, base, `hd${Date.now().toString(36).slice(-7)}`, process.env.BOT_PAGE ?? client!.page);
    const bundlePath = await page.locator('script[src*="botclient.js"]').getAttribute('src');
    assert(bundlePath, 'client bundle script missing');
    const bundle = await fetch(new URL(bundlePath, page.url()));
    assert(bundle.ok, 'could not read the deployed bundle');
    build.sha256 = new Bun.CryptoHasher('sha256').update(await bundle.arrayBuffer()).digest('hex');
    build.revision = process.env.BOT_REVISION ?? (client ? Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim() : null);
    build.dirty = client ? !!Bun.spawnSync(['git', 'status', '--porcelain']).stdout.toString().trim() : null;
    await cheatQuiet(page, 'setstat hitpoints 99');
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        g.__rs2b0t.Game.setAutoRetaliate(false);
        const walkTo = g.__rs2b0t.Traversal.walkTo.bind(g.__rs2b0t.Traversal);
        g.__rs2b0t.Traversal.walkTo = async (destination, options) => {
            const walk: Observation['walks'][number] = { destination, startedAt: Date.now() };
            g.__hostileProof?.walks.push(walk);
            try {
                return walk.ok = await walkTo(destination, options);
            } finally {
                walk.finishedAt = Date.now();
            }
        };
        const log = console.log.bind(console);
        console.log = (...args: unknown[]) => {
            const message = args.join(' ');
            const p = g.__hostileProof;
            if (p && /random event/i.test(message)) {
                p.logs.push(message);
                if (/evading/i.test(message)) {
                    const s = g.__hostileSnapshot();
                    p.firstEvade ??= s;
                    if (s.damage) p.firstDamage ??= s;
                }
            }
            log(...args);
        };
    });

    for (const fixture of fixtures) {
        await teleArrive(page, { x: 3248, z: 3252, level: 0 }, 0);
        await cheatQuiet(page, 'setstat hitpoints 99');
        await page.waitForTimeout(1600);
        await observe(page, fixture.id);
        await cheatQuiet(page, `npcadd ${fixture.key}`, 1200);
        const quiet = await readProof(page);
        assert.equal(quiet.end.npcs.length, 1, `${fixture.key} did not spawn`);
        assert(!quiet.firstEvade && !quiet.firstDamage && !quiet.movedBeforeDamage, `${fixture.key} reacted before damage`);

        await cheatQuiet(page, '~hit 0', 900);
        const blocked = await readProof(page);
        assert(blocked.blocked, `${fixture.key}: no zero hit received`);
        assert(!blocked.firstEvade && !blocked.firstDamage && !blocked.movedBeforeDamage, `${fixture.key} reacted to a zero hit`);
        assert.equal(blocked.end.npcs.length, 1, `${fixture.key} disappeared before the damage test`);
        assert.equal(blocked.end.hp, blocked.start.hp, `${fixture.key}: HP changed before positive damage`);
        if (fixture.id === 431) await page.screenshot({ path: proof.paths.successScreenshot.replace('-success', '-watchman-zero-hit') });

        await cheatQuiet(page, '~hit 2', 100);
        await page.waitForFunction(() => (globalThis as never as Api).__hostileProof.firstEvade, undefined, { timeout: 5000 });
        if (fixture.id === 431) await page.screenshot({ path: proof.paths.successScreenshot.replace('-success', '-watchman-damage') });
        const result = await finishEvade(page);
        assert.equal(result.firstEvade!.npcs[0].faceEntity, -1, `${fixture.key}: expected missing target information`);
        results.push({ fixture, seed: 'npcadd; ~hit 0; ~hit 2', quiet: quiet.end, blocked: blocked.blocked, ...result });
        console.log(`PASS ${fixture.key}: ignored spawn and zero hit; evaded after damage with faceEntity=-1; moved ${result.maxDistance} tiles and returned`);
    }

    await teleArrive(page, { x: 3222, z: 3218, level: 0 }, 0);
    await cheatQuiet(page, 'setstat hitpoints 99');
    await page.waitForTimeout(1600);
    await observe(page, 411);
    await cheatQuiet(page, '~macro_event 1', 100);
    const swarm = await finishEvade(page);
    results.push({ fixture: 'natural Swarm attack', seed: '~macro_event 1', ...swarm });
    await proof.writeSuccess(page, {
        harness: 'e2e/hostile-random-damage-live.ts',
        build,
        total: results.length, results
    });
    console.log(`PASS ${results.length} live scenarios`);
} catch (error) {
    await proof.writeFailure(page);
    await Bun.write(proof.paths.successProof.replace('-proof.json', '-failure.json'), JSON.stringify({
        result: 'FAIL', error: String(error), build, results,
        current: await readProof(page).catch(() => null)
    }, null, 2));
    throw error;
} finally {
    await browser.close();
    client?.cleanup();
}
