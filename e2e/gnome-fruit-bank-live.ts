import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Tile = { x: number; z: number; level: number };
type Item = { id: number; name: string | null; count: number };
type Log = { time: number; msg: string };
type Snapshot = {
    tick: number;
    tile: Tile | null;
    scene: number;
    xp: number;
    level: number;
    inventory: Item[];
    held: number;
    fruitCount: number;
    bankOpen: boolean;
    bank: Item[];
    bankHeld: number;
    bankFruit: number;
    runner: string;
    logs: Log[];
    chat: string[];
};
type BrowserAbi = {
    __rs2b0t: {
        Game: { tick(): number; tile(): Tile | null; sceneState(): number };
        Skills: { xp(skill: string): number; level(skill: string): number };
        Inventory: { items(): Item[]; countById(id: number): number };
        Bank: { isOpen(): boolean; items(): Item[]; countById(id: number): number };
    };
    rs2b0t: {
        runner: { state: string; ctx: { log: Log[] } | null };
        reader: { chat(count: number): { text: string }[] };
    };
};

type Phase =
    | 'starting'
    | 'first-log'
    | 'first-bank'
    | 'first-bank-open'
    | 'returned'
    | 'fruit-added'
    | 'fruit-banked'
    | 'chopping-resumed';

const { base } = parseArgs(process.argv.slice(2));
const engine = process.env.ENGINE_DIR;
assert(engine, 'ENGINE_DIR required for revision-289 live proof');
const proofDir = process.env.PROOF_DIR ?? 'out';
const prefix = process.env.BOT_LIVE_NAME_PREFIX ?? 'gch';
assert(/^[a-z0-9]{1,4}$/i.test(prefix), 'BOT_LIVE_NAME_PREFIX must contain one to four letters or digits');
const stamp = Date.now().toString(36);
const tag = `gnome-fruit-${stamp}`;
const user = `${prefix}${stamp.slice(-8)}`;
const commit = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
const proof = createHarnessProof({ slug: tag, proofDir, screenshotDir: proofDir });
const client = deployIsolatedClient(tag, engine);
const treeTile = { x: 2433, z: 3409, level: 0 };
const scriptBudgetMs = 420_000;
let browser: Browser | null = null;
let page: Page | null = null;
let baseline: Snapshot | null = null;
let final: Snapshot | null = null;
let phase: Phase = 'starting';
let fruitState: { tick: number; xp: number } | null = null;
let fruitBanked = false;
let scriptStartedAt = 0;
const events: { phase: Phase | 'baseline'; snapshot: Snapshot }[] = [];
const pageErrors: string[] = [];

function record(name: Phase | 'baseline', snapshot: Snapshot): void {
    events.push({ phase: name, snapshot });
    console.log(`${name} ${JSON.stringify({ tick: snapshot.tick, tile: snapshot.tile, xp: snapshot.xp, held: snapshot.held, fruitCount: snapshot.fruitCount, bankOpen: snapshot.bankOpen, bankHeld: snapshot.bankHeld, bankFruit: snapshot.bankFruit })}`);
}

async function readSnapshot(target: Page): Promise<Snapshot> {
    return target.evaluate((): Snapshot => {
        const globals = globalThis as unknown as BrowserAbi;
        const api = globals.__rs2b0t;
        const g = globals.rs2b0t;
        return {
            tick: api.Game.tick(),
            tile: api.Game.tile(),
            scene: api.Game.sceneState(),
            xp: api.Skills.xp('woodcutting'),
            level: api.Skills.level('woodcutting'),
            inventory: api.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            held: api.Inventory.countById(1513),
            fruitCount: api.Inventory.countById(464),
            bankOpen: api.Bank.isOpen(),
            bank: api.Bank.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            bankHeld: api.Bank.countById(1513),
            bankFruit: api.Bank.countById(464),
            runner: g.runner.state,
            logs: (g.runner.ctx?.log ?? []).map(line => ({ time: line.time, msg: line.msg })),
            chat: g.reader.chat(10).map(line => line.text)
        };
    });
}

function nearTree(snapshot: Snapshot): boolean {
    const tile = snapshot.tile;
    return !!tile && tile.level === treeTile.level && Math.max(Math.abs(tile.x - treeTile.x), Math.abs(tile.z - treeTile.z)) <= 6;
}

function receipt(outcome: 'PASS' | 'FAIL', error: string | null) {
    return {
        case: 'gnome-magic-full-pack-fruit',
        outcome,
        commit,
        base,
        engine,
        user,
        tag,
        fixture: {
            treeTile,
            woodcutting: 75,
            inventory: 'Rune axe, 26 Knives, one free slot before Strange fruit',
            insertedItem: { id: 464, name: 'Strange fruit' }
        },
        scriptBudgetMs,
        elapsedMs: scriptStartedAt ? Date.now() - scriptStartedAt : null,
        phase,
        baseline,
        fruitState,
        fruitBanked,
        events,
        final,
        pageErrors,
        error
    };
}

try {
    await proof.ensureDirs();
    browser = await launchBrowser({ swiftshader: true, executablePath: process.env.HARNESS_CHROMIUM_EXECUTABLE });
    page = await browser.newPage();
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));

    await mainlandAccount(page, base, user, client.page);
    for (const command of ['~clearinv', 'setstat woodcutting 75', 'give rune_axe 1', 'give knife 26']) {
        assert(await cheatQuiet(page, command, 900), `account fixture command failed: ${command}`);
    }
    assert(await teleTo(page, treeTile, 1), 'teleport to the Gnome Stronghold tree fixture');
    await setSettings(page, 'GnomeMagicChopper', { fletchLogs: false });
    baseline = await readSnapshot(page);
    assert.equal(baseline.inventory.length, 27, 'fixture must leave one free inventory slot');
    assert.equal(baseline.held, 0, 'fixture must start without Magic logs');
    assert.equal(baseline.fruitCount, 0, 'fixture must start without Strange fruit');
    assert.equal(baseline.bankHeld, 0, 'fixture must start without banked Magic logs');
    assert.equal(baseline.bankFruit, 0, 'fresh account bank must start without Strange fruit');
    record('baseline', baseline);

    await startScript(page, 'GnomeMagicChopper');
    scriptStartedAt = Date.now();
    const deadline = scriptStartedAt + scriptBudgetMs;
    while (Date.now() < deadline) {
        final = await readSnapshot(page);
        if (phase === 'starting' && final.xp > baseline.xp) {
            phase = 'first-log';
            record(phase, final);
        }
        if (phase === 'first-log' && final.held > 0) {
            phase = 'first-bank';
            record(phase, final);
        }
        if (phase === 'first-bank' && final.bankOpen && final.bankHeld > 0) {
            phase = 'first-bank-open';
            record(phase, final);
        }
        if (phase === 'first-bank-open' && final.held === 0 && !final.bankOpen && nearTree(final)) {
            phase = 'returned';
            record(phase, final);
        }
        if (phase === 'returned' && fruitState === null) {
            assert(await cheatQuiet(page, 'give macro_triffidfruit 1', 900), 'account-only Strange fruit command failed');
            final = await readSnapshot(page);
            assert.equal(final.inventory.length, 28, 'Strange fruit must fill the last backpack slot');
            assert.equal(final.fruitCount, 1, 'the account must hold one Strange fruit');
            assert.equal(final.held, 0, 'the account must hold no Magic logs when fruit arrives');
            assert.equal(final.bankOpen, false, 'inject Strange fruit after the first bank trip closes');
            fruitState = { tick: final.tick, xp: final.xp };
            phase = 'fruit-added';
            record(phase, final);
        }
        if (phase === 'fruit-added' && final.bankOpen && final.bankFruit > baseline.bankFruit && final.fruitCount === 0) {
            fruitBanked = true;
            phase = 'fruit-banked';
            record(phase, final);
        }
        if (phase === 'fruit-banked' && fruitState && final.xp > fruitState.xp) {
            phase = 'chopping-resumed';
            record(phase, final);
            break;
        }
        if (final.runner === 'error' || final.runner === 'stopped') {
            throw new Error(`GnomeMagicChopper stopped in phase ${phase}: ${final.logs.slice(-8).map(line => line.msg).join(' | ')}`);
        }
        await page.waitForTimeout(600);
    }

    assert.equal(phase, 'chopping-resumed', `full-pack fruit flow did not recover before ${scriptBudgetMs} ms`);
    assert(fruitBanked, 'GnomeMagicChopper must deposit the Strange fruit');
    const body = receipt('PASS', null);
    await proof.writeSuccess(page, body);
    await Bun.write(`${proofDir}/${tag}-receipt.json`, `${JSON.stringify(body, null, 2)}\n`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const body = receipt('FAIL', message);
    await proof.writeFailure(page, body);
    await Bun.write(`${proofDir}/${tag}-receipt.json`, `${JSON.stringify(body, null, 2)}\n`);
    throw error;
} finally {
    if (page) {
        await stopScript(page).catch(() => undefined);
        await logout(page).catch(() => undefined);
    }
    if (browser) {
        await browser.close();
    }
    client.cleanup();
    for (const path of [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`]) {
        assert(!existsSync(path), `isolated client cleanup failed: ${path}`);
        console.log(`cleanup absent: ${path}`);
    }
}
