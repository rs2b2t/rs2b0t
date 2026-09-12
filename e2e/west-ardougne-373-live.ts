import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { WorldTile } from '../src/bot/adapter/ClientAdapter.js';
import { deployIsolatedClient, launchBrowser, positionalArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheb, teleArrive } from './lib/navLiveHarness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';

const baseline = process.argv.includes('--baseline');
const [base] = positionalArgs(process.argv.slice(2), process.env.BASE ?? 'http://localhost:8890');
const proof = createHarnessProof({ slug: 'issue-373', proofDir: 'docs/e2e', screenshotDir: 'docs/e2e' });
const SEWER = { x: 2530, z: 9703, level: 0 };
const DIG = { x: 2488, z: 3308, level: 0 };
const GARDEN = { x: 2566, z: 3330, level: 0 };
const EAST = { x: 2559, z: 3300, level: 0 };
const WEST = { x: 2556, z: 3300, level: 0 };
const BANK = { x: 2616, z: 3332, level: 0 };

interface Snapshot {
    tile: WorldTile | null;
    plagueCity: string;
    biohazard: string;
    maskCarried: number;
    maskWorn: boolean;
}
interface WalkResult { ok: boolean; tile: WorldTile | null; logs: string[]; error?: string }
interface Abi {
    __rs2b0t: {
        reader: { worldTile(): WorldTile | null };
        Quests: { status(name: string): string };
        Equipment: { contains(name: string): boolean };
        Inventory: { count(name: string): number; first(name: string): { interact(op: string): boolean } | null };
        Traversal: { walkTo(dest: WorldTile, options: { radius: number; timeoutMs: number; useTeleportCatalog: boolean; policy: { useTeleports: boolean }; log(message: string): void }): Promise<boolean> };
        LoopingBot: new () => { loop(): Promise<void> };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { start(manifest: unknown): void; stop(reason: string): void } };
    __ardyWalk?: WalkResult;
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const api = (globalThis as never as Abi).__rs2b0t;
        return {
            tile: api.reader.worldTile(), plagueCity: api.Quests.status('Plague City'), biohazard: api.Quests.status('Biohazard'),
            maskCarried: api.Inventory.count('Gas mask'), maskWorn: api.Equipment.contains('Gas mask')
        };
    });
}

async function walk(page: Page, destination: WorldTile, allowed: boolean, label: string): Promise<WalkResult> {
    const before = await snapshot(page);
    const budget = allowed ? 180_000 : 20_000;
    await page.evaluate(({ destination, budget, label }) => {
        const g = globalThis as never as Abi;
        g.__ardyWalk = undefined;
        class Probe extends g.__rs2b0t.LoopingBot {
            override async loop(): Promise<void> {
                const logs: string[] = [];
                try {
                    const ok = await g.__rs2b0t.Traversal.walkTo(destination, {
                        radius: 0, timeoutMs: budget, useTeleportCatalog: false, policy: { useTeleports: false },
                        log: message => { logs.push(message); console.log(`[${label}] ${message}`); }
                    });
                    g.__ardyWalk = { ok, tile: g.__rs2b0t.reader.worldTile(), logs };
                } catch (error) {
                    g.__ardyWalk = { ok: false, tile: g.__rs2b0t.reader.worldTile(), logs, error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop('harness complete');
                }
            }
        }
        g.rs2b0t.runner.start(g.__rs2b0t.registerScript({ name: label, create: () => new Probe() }));
    }, { destination, budget, label });
    await page.waitForFunction(() => (globalThis as never as Abi).__ardyWalk !== undefined, undefined, { timeout: budget + 30_000 });
    const result = await page.evaluate(() => (globalThis as never as Abi).__ardyWalk!);
    assert.equal(result.error, undefined, `${label}: walk threw an error`);
    assert.equal(result.ok, allowed, `${label}: ${result.logs.slice(-12).join('\n')}`);
    assert(result.tile, `${label}: no final tile`);
    if (allowed) assert.equal(cheb(result.tile, destination), 0, `${label}: destination not reached`);
    else assert(before.tile && cheb(before.tile, result.tile) <= 2, `${label}: moved through a locked crossing`);
    const screenshot = `docs/e2e/issue-373-${label}.png`;
    await page.screenshot({ path: screenshot });
    results.push({ label, before, destination, allowed, ...result, after: await snapshot(page), screenshot });
    console.log(`PASS ${label}: ${JSON.stringify(result.tile)}`);
    return result;
}

async function quests(page: Page, user: string, elena: number, biohazard: number): Promise<void> {
    await cheatQuiet(page, `setvar elenaquest ${elena}`);
    await cheatQuiet(page, `setvar biohazard ${biohazard}`);
    await relog(page, user);
    await maxmeAndClearDialogs(page);
    assert.equal(await getServerVarQuiet(page, 'elenaquest'), elena);
    assert.equal(await getServerVarQuiet(page, 'biohazard'), biohazard);
}

async function mask(page: Page, worn: boolean): Promise<void> {
    await cheatQuiet(page, '~clearinv worn');
    await cheatQuiet(page, '~clearinv inv');
    await cheatQuiet(page, 'give gasmask 1');
    if (worn) {
        assert(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.first('Gas mask')?.interact('Wear')));
        await page.waitForFunction(() => (globalThis as never as Abi).__rs2b0t.Equipment.contains('Gas mask'));
    }
    const state = await snapshot(page);
    assert.equal(state.maskWorn, worn);
    assert.equal(state.maskCarried, worn ? 0 : 1);
}

const client = deployIsolatedClient(`ardy373-${Date.now().toString(36)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const results: Record<string, unknown>[] = [];
try {
    await proof.ensureDirs();
    const user = `wa${Date.now().toString(36).slice(-7)}`;
    await mainlandAccount(page, base, user, client.page);
    await maxmeAndClearDialogs(page);
    const bundlePath = await page.locator('script[src*="botclient.js"]').getAttribute('src');
    assert(bundlePath);
    const bundle = await fetch(new URL(bundlePath, page.url()));
    assert(bundle.ok);
    const build = {
        revision: Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim(),
        dirty: !!Bun.spawnSync(['git', 'status', '--porcelain']).stdout.toString().trim(),
        sha256: new Bun.CryptoHasher('sha256').update(await bundle.arrayBuffer()).digest('hex')
    };

    if (baseline) {
        await quests(page, user, 30, 16);
        await cheatQuiet(page, '~clearinv worn');
        await cheatQuiet(page, '~clearinv inv');
        await teleArrive(page, BANK, 0);
        const state = await snapshot(page);
        assert.equal(state.biohazard, 'complete');
        assert.equal(state.maskCarried, 0);
        assert.equal(state.maskWorn, false);
        await walk(page, DIG, false, 'gate-before');
        await proof.writeBaseline(page, { issue: 373, build, results });
    } else {
        await quests(page, user, 0, 0);
        await mask(page, true);
        await teleArrive(page, SEWER, 0);
        await walk(page, { x: 2529, z: 3304, level: 0 }, false, 'pipe-quest-locked');

        await quests(page, user, 30, 0);
        await mask(page, false);
        await teleArrive(page, SEWER, 0);
        await walk(page, { x: 2529, z: 3304, level: 0 }, false, 'pipe-mask-carried');

        await mask(page, true);
        const sewer = await walk(page, DIG, true, 'pipe-worn-arrival');
        assert(sewer.logs.some(line => /Sewer pipe/i.test(line)), 'sewer crossing was not executed');
        const returned = await walk(page, GARDEN, true, 'sewer-garden-return');
        assert(returned.logs.some(line => /Mud pile/i.test(line)), 'mud-pile return was not executed');

        await quests(page, user, 30, 15);
        await cheatQuiet(page, '~clearinv worn');
        await cheatQuiet(page, '~clearinv inv');
        await teleArrive(page, EAST, 0);
        await walk(page, WEST, false, 'gate-quest-locked');

        await quests(page, user, 30, 16);
        const state = await snapshot(page);
        assert.equal(state.biohazard, 'complete');
        assert.equal(state.maskCarried, 0);
        assert.equal(state.maskWorn, false);
        await teleArrive(page, BANK, 0);
        for (const [label, target] of [['gate-clue-arrival', DIG], ['gate-bank-return', BANK]] as const) {
            const result = await walk(page, target, true, label);
            assert(result.logs.some(line => /Door.*255[78],3300|Door.*255[78],3299/.test(line)), `${label}: gate crossing was not executed`);
            assert(!result.logs.some(line => /Sewer pipe|Mud patch|Mud pile/.test(line)), `${label}: took the sewer`);
        }
        await mask(page, true);
        await cheatQuiet(page, 'give spade 1');
        await teleArrive(page, GARDEN, 0);
        const kitted = await walk(page, DIG, true, 'gate-from-filled-garden');
        assert(kitted.logs.some(line => /Door.*255[78],3300|Door.*255[78],3299/.test(line)), 'kitted route skipped the gate');
        assert(!kitted.logs.some(line => /Sewer pipe|Mud patch|Mud pile/.test(line)), 'kitted route used the filled garden entrance');
        await proof.writeSuccess(page, { issue: 373, build, results });
    }
} catch (error) {
    await proof.writeFailure(page);
    throw error;
} finally {
    await browser.close();
    client.cleanup();
}
