/** Chrome + isolated LostCity proof for RockCrab dart support: --base --minutes.
 *  The fresh account starts at Seers with empty pack and equipment and Bronze darts only in its bank, so RockCrab must withdraw and wield that stack, walk to the Rellekka field, kill a Rock Crab for Ranged XP, and recover a dropped dart. */

//   bun e2e/rockcrab-dart-test.ts --base http://127.0.0.1:8995 --minutes 12
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { cheatQuiet, launchBrowser, parseArgs, startFromLibrary } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), {
    base: 'http://127.0.0.1:8995',
    minutes: 12
});

const SERVER_TICK_MS = 300;
const DART_SUPPLY = 80;
const FOOD_SUPPLY = 10;
const DART = { id: 806, name: 'Bronze dart', debug: 'bronze_dart' } as const;
const WRONG_AMMO = 'Rune arrow';
const BANK_TILE = { x: 2725, z: 3491, level: 0 } as const;
const BANK_TELE = '0,42,54,37,35';
const FIELD_BOUNDS = { minX: 2690, maxX: 2723, minZ: 3710, maxZ: 3733 } as const;
const SCREENSHOT_PATH = 'screenshots/rockcrab-dart-e2e.png';
const PROOF_PATH = 'out/rockcrab-dart-proof.json';
const FAILURE_SCREENSHOT_PATH = 'out/rockcrab-dart-failure.png';
const username = `rcd${Date.now().toString(36).slice(-7)}`;
const budgetMs = minutes * 60_000;

type Tile = { x: number; z: number; level: number };
type ItemView = { id: number; name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };
type NpcView = {
    id: number;
    index: number;
    name: string | null;
    health: number;
    totalHealth: number;
    tile: Tile;
};
type GroundItemView = { id: number; name: string | null; count: number; tile: Tile };

interface NpcHandle {
    readonly id: number;
    readonly index: number;
    readonly name: string | null;
    tile(): Tile;
}

interface GroundItemHandle {
    readonly id: number;
    readonly name: string | null;
    readonly count: number;
    tile(): Tile;
}

interface AttackEvent {
    at: number;
    id: number;
    index: number;
    name: string | null;
    tile: Tile;
    rangedXp: number;
    worn: ItemView[];
}

interface TakeEvent {
    at: number;
    id: number;
    name: string | null;
    count: number;
    tile: Tile;
    packBefore: number;
    wornBefore: number;
}

interface BrowserProbe {
    attacks: AttackEvent[];
    takes: TakeEvent[];
}

interface BankAudit {
    ok: boolean;
    items: ItemView[];
    error?: string;
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: {
            openNearest(name: string, action: string): Promise<boolean>;
            close(): Promise<boolean>;
            depositInventory(): Promise<void>;
            items(): ItemView[];
        };
        Equipment: { items(): ItemView[] };
        Execution: { delayTicks(ticks: number): Promise<void> };
        Game: { inCombat(): boolean };
        GroundItem: {
            prototype: {
                interact(this: GroundItemHandle, action: string): boolean | Promise<boolean>;
            };
        };
        Inventory: { count(name: string): number; items(): ItemView[]; used(): number };
        LoopingBot: new () => { loop(): void | Promise<void> };
        Npc: {
            prototype: {
                interact(this: NpcHandle, action: string): boolean | Promise<boolean>;
            };
        };
        Skills: { level(name: string): number; xp(name: string): number };
        reader: {
            chat(count: number): { text: string }[];
            groundItems(): GroundItemView[];
            npcs(): NpcView[];
            worldTile(): Tile | null;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        client: {
            ingame: boolean;
            tutComMessage: string | null;
        };
        host: { tickCount: number };
        registry: { get(name: string): unknown };
        runner: {
            state: string;
            bot: { status?: string } | null;
            ctx: { crashError?: Error | null; log: LogLine[]; loopCount: number; loopInFlight: boolean; waiters: unknown[] } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
    };
    __rockCrabDartBankAudit?: BankAudit;
    __rockCrabDartProbe?: BrowserProbe;
    __rockCrabDartSockets?: string[];
}

interface Snapshot {
    at: number;
    tick: number;
    tile: Tile | null;
    inventory: ItemView[];
    worn: ItemView[];
    rangedLevel: number;
    rangedXp: number;
    npcs: NpcView[];
    groundItems: GroundItemView[];
    runner: string;
    crash: string | null;
    logs: LogLine[];
    attacks: AttackEvent[];
    takes: TakeEvent[];
    status: string | null;
    inCombat: boolean;
    loopCount: number;
    loopInFlight: boolean;
    waiters: number;
}

interface GroundObservation {
    at: number;
    count: number;
    tile: Tile;
}

interface CombatObservation {
    at: number;
    tile: Tile;
    wornDarts: number;
    rangedXp: number;
    crabs: NpcView[];
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function assertIsolatedBase(): URL {
    let url: URL;
    try {
        url = new URL(base);
    } catch {
        fail(`invalid base URL '${base}'`);
    }
    const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (!loopback.has(url.hostname)) fail(`refusing non-loopback server ${url.origin}`);
    if (!['http:', 'https:'].includes(url.protocol)) fail(`unsupported base protocol '${url.protocol}'`);
    if (url.port === '8081') fail("refusing port 8081: that is the user's live multibox proxy");
    if (url.port === '' || Number(url.port) < 1024) fail(`isolated E2E requires an explicit unprivileged port, got '${url.port || '(default)'}'`);
    if (!Number.isFinite(minutes) || minutes <= 0) fail(`invalid minute budget '${minutes}'`);
    return url;
}

async function attestServedBundle(baseUrl: URL): Promise<string> {
    const local = Bun.file('out/botclient.js');
    if (!(await local.exists())) fail('out/botclient.js is missing; build this worktree before running the harness');
    const response = await fetch(new URL('/bot/botclient.js', baseUrl));
    if (!response.ok) fail(`served bot bundle returned HTTP ${response.status}`);
    const digest = (data: ArrayBuffer | Uint8Array): string => createHash('sha256').update(new Uint8Array(data)).digest('hex');
    const localHash = digest(await local.arrayBuffer());
    const servedHash = digest(await response.arrayBuffer());
    if (servedHash !== localHash) fail(`served bundle ${servedHash} != worktree bundle ${localHash}`);
    console.log(`BUNDLE ATTESTATION PASS: sha256=${localHash}`);
    return localHash;
}

function count(items: readonly ItemView[], name: string): number {
    const wanted = name.toLowerCase();
    return items.filter(item => item.name?.toLowerCase() === wanted).reduce((sum, item) => sum + item.count, 0);
}

function inField(tile: Tile | null): boolean {
    return tile !== null && tile.level === 0 && tile.x >= FIELD_BOUNDS.minX && tile.x <= FIELD_BOUNDS.maxX && tile.z >= FIELD_BOUNDS.minZ && tile.z <= FIELD_BOUNDS.maxZ;
}

function near(actual: Tile | null, expected: Tile, radius: number): boolean {
    return actual !== null && actual.level === expected.level && Math.max(Math.abs(actual.x - expected.x), Math.abs(actual.z - expected.z)) <= radius;
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value, waitMs))) fail(`could not send ::${value}`);
}

async function dismissDebugOverlay(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
        if (message === null) return;
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(250);
    }
    const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
    if (message !== null) fail(`could not dismiss debug overlay '${message}'`);
}

async function enforceDoubleTickRate(page: Page): Promise<void> {
    await command(page, `speed ${SERVER_TICK_MS}`);
    const confirmed = await page.evaluate(expected => (globalThis as never as BrowserGlobal).__rs2b0t.reader.chat(12).some(line => line.text.includes(`World speed was changed to ${expected}ms`)), SERVER_TICK_MS);
    if (!confirmed) fail(`server did not confirm the ${SERVER_TICK_MS}ms tick rate`);
}

async function setLevel(page: Page, skill: string, level: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await command(page, `setstat ${skill} ${level}`);
        const actual = await page.evaluate(name => (globalThis as never as BrowserGlobal).__rs2b0t.Skills.level(name), skill);
        if (actual === level) return;
    }
    const actual = await page.evaluate(name => (globalThis as never as BrowserGlobal).__rs2b0t.Skills.level(name), skill);
    fail(`${skill} is ${actual}, expected ${level}`);
}

async function teleport(page: Page, encoded: string, expected: Tile, radius = 2): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await command(page, `tele ${encoded}`, 1200);
        const tile = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rs2b0t.reader.worldTile());
        if (near(tile, expected, radius)) return;
    }
    fail(`teleport did not reach ${expected.x},${expected.z}: ${JSON.stringify(await snapshot(page))}`);
}

async function waitRunnerStopped(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const state = (globalThis as never as BrowserGlobal).rs2b0t.runner.state;
            return state === 'stopped' || state === 'crashed';
        },
        undefined,
        { timeout: 20_000 }
    );
    const state = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.state);
    if (state === 'crashed') fail('temporary bank audit crashed');
}

async function auditBank(page: Page): Promise<BankAudit> {
    const scriptName = `RockCrabDartBankAudit${Date.now().toString(36)}`;
    await page.evaluate(name => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class BankProbe extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    if (!(await api.Bank.openNearest('Bank booth', 'Use-quickly'))) throw new Error('bank did not open');
                    await api.Execution.delayTicks(2);
                    g.__rockCrabDartBankAudit = {
                        ok: true,
                        items: api.Bank.items().map(item => ({ id: item.id, name: item.name, count: item.count }))
                    };
                    await api.Bank.close();
                } catch (error) {
                    g.__rockCrabDartBankAudit = { ok: false, items: [], error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__rockCrabDartBankAudit = undefined;
        g.rs2b0t.runner.start(api.registerScript({ name, create: () => new BankProbe() }));
    }, scriptName);
    await waitRunnerStopped(page);
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rockCrabDartBankAudit);
    if (!result?.ok) fail(`bank audit failed: ${JSON.stringify(result)}`);
    return result;
}

async function clearFixture(page: Page): Promise<void> {
    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');
    const empty = await snapshot(page);
    if (empty.inventory.length !== 0 || empty.worn.length !== 0) {
        fail(`inventory/equipment clear did not stick: ${JSON.stringify({ inventory: empty.inventory, worn: empty.worn })}`);
    }
    const bank = await auditBank(page);
    if (bank.items.length !== 0) fail(`bank clear did not stick: ${JSON.stringify(bank.items)}`);
}

async function seedExactBank(page: Page): Promise<BankAudit> {
    const give = async (debugName: string, displayName: string, quantity: number): Promise<void> => {
        for (let attempt = 0; attempt < 6; attempt++) {
            await command(page, `give ${debugName} ${quantity}`);
            const held = count((await snapshot(page)).inventory, displayName);
            if (held >= quantity) return;
        }
        fail(`could not seed ${quantity} ${displayName} into the pack`);
    };

    await give(DART.debug, DART.name, DART_SUPPLY);
    await give('lobster', 'Lobster', FOOD_SUPPLY);

    const scriptName = `RockCrabDartBankSeed${Date.now().toString(36)}`;
    await page.evaluate(name => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class BankSeed extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    if (!(await api.Bank.openNearest('Bank booth', 'Use-quickly'))) throw new Error('bank did not open');
                    await api.Execution.delayTicks(2);
                    await api.Bank.depositInventory();
                    await api.Execution.delayTicks(2);
                    g.__rockCrabDartBankAudit = {
                        ok: true,
                        items: api.Bank.items().map(item => ({ id: item.id, name: item.name, count: item.count }))
                    };
                    await api.Bank.close();
                } catch (error) {
                    g.__rockCrabDartBankAudit = { ok: false, items: [], error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__rockCrabDartBankAudit = undefined;
        g.rs2b0t.runner.start(api.registerScript({ name, create: () => new BankSeed() }));
    }, scriptName);
    await waitRunnerStopped(page);

    const bank = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rockCrabDartBankAudit);
    if (!bank?.ok) fail(`bank seed failed: ${JSON.stringify(bank)}`);
    const after = await snapshot(page);
    if (after.inventory.length !== 0) fail(`fixture remained in the pack after deposit: ${JSON.stringify(after.inventory)}`);
    if (count(bank.items, DART.name) !== DART_SUPPLY || count(bank.items, 'Lobster') !== FOOD_SUPPLY || bank.items.length !== 2) {
        fail(`bad exact bank fixture: ${JSON.stringify(bank.items)}`);
    }
    return bank;
}

async function installInteractionProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        const npcInteract = api.Npc.prototype.interact;
        const groundInteract = api.GroundItem.prototype.interact;
        g.__rockCrabDartProbe = { attacks: [], takes: [] };

        api.Npc.prototype.interact = function (this: NpcHandle, action: string): boolean | Promise<boolean> {
            if (action.toLowerCase() === 'attack') {
                g.__rockCrabDartProbe!.attacks.push({
                    at: Date.now(),
                    id: this.id,
                    index: this.index,
                    name: this.name,
                    tile: this.tile(),
                    rangedXp: api.Skills.xp('ranged'),
                    worn: api.Equipment.items().map(item => ({ id: item.id, name: item.name, count: item.count }))
                });
            }
            return npcInteract.call(this, action);
        };

        api.GroundItem.prototype.interact = function (this: GroundItemHandle, action: string): boolean | Promise<boolean> {
            if (action.toLowerCase() === 'take' && this.id === 806) {
                g.__rockCrabDartProbe!.takes.push({
                    at: Date.now(),
                    id: this.id,
                    name: this.name,
                    count: this.count,
                    tile: this.tile(),
                    packBefore: api.Inventory.count('Bronze dart'),
                    wornBefore: api.Equipment.items()
                        .filter(item => item.name?.toLowerCase() === 'bronze dart')
                        .reduce((sum, item) => sum + item.count, 0)
                });
            }
            return groundInteract.call(this, action);
        };
    });
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        const crash = g.rs2b0t.runner.ctx?.crashError;
        return {
            at: Date.now(),
            tick: g.rs2b0t.host.tickCount,
            tile: api.reader.worldTile(),
            inventory: api.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            worn: api.Equipment.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            rangedLevel: api.Skills.level('ranged'),
            rangedXp: api.Skills.xp('ranged'),
            npcs: api.reader.npcs(),
            groundItems: api.reader.groundItems(),
            runner: g.rs2b0t.runner.state,
            crash: crash?.stack ?? crash?.message ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-500),
            attacks: [...(g.__rockCrabDartProbe?.attacks ?? [])],
            takes: [...(g.__rockCrabDartProbe?.takes ?? [])],
            status: g.rs2b0t.runner.bot?.status ?? null,
            inCombat: api.Game.inCombat(),
            loopCount: g.rs2b0t.runner.ctx?.loopCount ?? 0,
            loopInFlight: g.rs2b0t.runner.ctx?.loopInFlight ?? false,
            waiters: g.rs2b0t.runner.ctx?.waiters.length ?? 0
        };
    });
}

async function configureRockCrab(page: Page): Promise<void> {
    await page.evaluate(
        ([dart, wrongAmmo, amount]) => {
            const values: Record<string, string> = {
                combatStyle: 'range',
                bow: dart,
                ammo: wrongAmmo,
                ammoWithdraw: String(amount),
                rangeStyle: 'rapid',
                minStack: '1',
                collectRange: '30',
                stack: '2',
                solveClues: 'false',
                food: 'Lobster',
                foodWithdraw: '10',
                fightHpGate: '20',
                bankStrategy: 'Off'
            };
            for (const [key, value] of Object.entries(values)) {
                sessionStorage.setItem(`rs2b0t:set:RockCrab:${key}`, value);
            }
        },
        [DART.name, WRONG_AMMO, DART_SUPPLY] as const
    );
}

async function installNetworkGuard(page: Page, expectedHost: string): Promise<void> {
    await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (['http:', 'https:'].includes(requestUrl.protocol)) {
            const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(requestUrl.hostname);
            if (!loopback || requestUrl.port === '8081') {
                await route.abort('blockedbyclient');
                return;
            }
        }
        await route.continue();
    });
    await page.addInitScript(host => {
        const NativeWebSocket = window.WebSocket;
        const GuardedWebSocket = class extends NativeWebSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
                const parsed = new URL(String(url), window.location.href);
                const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
                if (!loopback || parsed.port === '8081' || parsed.host !== host) {
                    throw new Error(`RockCrab dart E2E blocked non-isolated WebSocket ${parsed.href}`);
                }
                if (protocols === undefined) super(url);
                else super(url, protocols);
                const g = globalThis as never as BrowserGlobal;
                g.__rockCrabDartSockets ??= [];
                g.__rockCrabDartSockets.push(parsed.href);
            }
        };
        Object.defineProperty(window, 'WebSocket', {
            configurable: true,
            writable: true,
            value: GuardedWebSocket
        });
    }, expectedHost);
}

async function addProofOverlay(page: Page, details: string[]): Promise<void> {
    await page.evaluate(lines => {
        document.querySelector('#rockcrab-dart-proof')?.remove();
        const frame = document.createElement('div');
        frame.id = 'rockcrab-dart-proof';
        Object.assign(frame.style, {
            position: 'fixed',
            inset: '0',
            border: '6px solid #20d35a',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: '2147483647'
        });
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'absolute',
            left: '18px',
            top: '18px',
            maxWidth: '610px',
            padding: '14px 18px',
            color: '#eaffef',
            background: 'rgba(3, 20, 8, 0.92)',
            border: '2px solid #20d35a',
            borderRadius: '8px',
            font: '16px/1.45 monospace',
            whiteSpace: 'pre-line'
        });
        const title = document.createElement('strong');
        title.textContent = 'PASS · RockCrab Bronze darts · real local E2E';
        title.style.color = '#52ff85';
        panel.append(title, document.createElement('br'), document.createTextNode(lines.join('\n')));
        frame.append(panel);
        document.body.append(frame);
    }, details);
}

const baseUrl = assertIsolatedBase();
const bundleSha256 = await attestServedBundle(baseUrl);
await mkdir('out', { recursive: true });
await mkdir('screenshots', { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors: string[] = [];
page.on('pageerror', error => {
    pageErrors.push(error.stack ?? error.message);
    console.error(`PAGEERROR: ${error.stack ?? error.message}`);
});
page.on('requestfailed', request => {
    console.error(`REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`);
});

let finalSnapshot: Snapshot | null = null;
let proofWritten = false;
try {
    await installNetworkGuard(page, baseUrl.host);
    await mainlandAccount(page, baseUrl.origin, username);
    const socketUrls = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rockCrabDartSockets ?? []);
    if (socketUrls.length === 0) fail('no guarded local game WebSocket was observed');
    if (socketUrls.some(socket => new URL(socket).host !== baseUrl.host)) {
        fail(`game socket escaped the isolated origin: ${JSON.stringify(socketUrls)}`);
    }

    await enforceDoubleTickRate(page);
    await teleport(page, BANK_TELE, BANK_TILE);
    await clearFixture(page);
    await setLevel(page, 'ranged', 50);
    await setLevel(page, 'hitpoints', 40);
    await setLevel(page, 'defence', 40);
    await dismissDebugOverlay(page);

    const bankBefore = await seedExactBank(page);
    // Opening the booth can pull the player several tiles from the configured
    // stand. Reset to the exact start so RockCrab itself owns every later move.
    await teleport(page, BANK_TELE, BANK_TILE);
    const initial = await snapshot(page);
    if (!near(initial.tile, BANK_TILE, 2)) fail(`fixture is not at Seers bank: ${JSON.stringify(initial.tile)}`);
    if (initial.inventory.length !== 0 || initial.worn.length !== 0) {
        fail(`darts must start bank-only: ${JSON.stringify({ inventory: initial.inventory, worn: initial.worn })}`);
    }
    if (count(bankBefore.items, DART.name) !== DART_SUPPLY || count(bankBefore.items, WRONG_AMMO) !== 0) {
        fail(`bad bank-only dart fixture: ${JSON.stringify(bankBefore.items)}`);
    }
    console.log(`PRECONDITION PASS: ${username} at Seers; pack/worn empty; bank=${DART_SUPPLY} ${DART.name}; ` + `${WRONG_AMMO}=0; Ranged ${initial.rangedLevel}; tick=${SERVER_TICK_MS}ms`);

    await configureRockCrab(page);
    await installInteractionProbe(page);
    await startFromLibrary(page, 'Combat', 'RockCrab');
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    let lastLogTime = 0;
    let bankRestock: { at: number; withdrawnLog: string; equippedLog: string; worn: number; tile: Tile | null } | null = null;
    let reachedField = false;
    let sawWornDecrease = false;
    let sawWornRecovery = false;
    let previousWorn = 0;
    let minimumWorn = Number.POSITIVE_INFINITY;
    let maximumRecoveryJump = 0;
    let killObserved = false;
    let sweepLog = '';
    let fieldCombat: CombatObservation | null = null;
    let lastSnapshotLog = 0;
    const ground = new Map<string, GroundObservation>();

    while (Date.now() < deadline) {
        const state = await snapshot(page);
        finalSnapshot = state;
        for (const line of state.logs) {
            if (line.time > lastLogTime) console.log(`[${line.level}] ${line.msg}`);
            lastLogTime = Math.max(lastLogTime, line.time);
        }
        if (state.runner === 'crashed') fail(`RockCrab crashed: ${state.crash ?? JSON.stringify(state.logs.slice(-40))}`);
        if (state.runner === 'stopped') fail(`RockCrab stopped before proof: ${JSON.stringify(state.logs.slice(-40))}`);
        if (Date.now() - lastSnapshotLog >= 10_000) {
            lastSnapshotLog = Date.now();
            console.log(
                `STATE: ${JSON.stringify({
                    tile: state.tile,
                    status: state.status,
                    inCombat: state.inCombat,
                    worn: count(state.worn, DART.name),
                    rangedXp: state.rangedXp,
                    npcs: state.npcs.map(npc => ({ name: npc.name, health: npc.health, tile: npc.tile })),
                    loop: `${state.loopCount}/${state.loopInFlight ? 'busy' : 'idle'}/${state.waiters}w`
                })}`
            );
        }

        const withdrawn = state.logs.find(line => new RegExp(`withdrew \\d+ ${DART.name}`, 'i').test(line.msg));
        const equipped = state.logs.find(line => new RegExp(`withdrew \\d+ ${DART.name} — \\d+ equipped`, 'i').test(line.msg)) ?? state.logs.find(line => new RegExp(`equipped ${DART.name} — \\d+ ready`, 'i').test(line.msg));
        const worn = count(state.worn, DART.name);
        const fightingCrabs = state.npcs.filter(npc => npc.name === 'Rock Crab' && npc.health > 0 && inField(npc.tile));
        if (!fieldCombat && state.inCombat && inField(state.tile) && worn > 0 && fightingCrabs.length > 0) {
            fieldCombat = {
                at: state.at,
                tile: state.tile!,
                wornDarts: worn,
                rangedXp: state.rangedXp,
                crabs: fightingCrabs
            };
            console.log(`COMBAT OBSERVED: ${fightingCrabs.length} natural Rock Crab(s), ${worn} ${DART.name} worn, Ranged XP ${state.rangedXp}`);
        }
        if (!bankRestock && withdrawn && equipped && worn > 0) {
            bankRestock = {
                at: Date.now(),
                withdrawnLog: withdrawn.msg,
                equippedLog: equipped.msg,
                worn,
                tile: state.tile
            };
            previousWorn = worn;
            minimumWorn = worn;
            if (state.logs.some(line => line.msg.includes(`withdrew and wielded ${DART.name}`))) {
                fail('dart was withdrawn once as a durable weapon before the projectile restock');
            }
            console.log(`BANK PASS: ${withdrawn.msg}; ${equipped.msg}`);
        }

        reachedField ||= inField(state.tile) && state.npcs.some(npc => npc.name === 'Rocks' || npc.name === 'Rock Crab');
        for (const item of state.groundItems.filter(item => item.id === DART.id && inField(item.tile))) {
            ground.set(`${item.tile.x},${item.tile.z},${item.tile.level}`, {
                at: state.at,
                count: item.count,
                tile: item.tile
            });
        }

        if (bankRestock) {
            if (worn < bankRestock.worn) sawWornDecrease = true;
            if (sawWornDecrease) {
                minimumWorn = Math.min(minimumWorn, worn);
                if (worn > previousWorn) {
                    sawWornRecovery = true;
                    maximumRecoveryJump = Math.max(maximumRecoveryJump, worn - previousWorn);
                }
            }
            previousWorn = worn;
        }

        killObserved ||= state.logs.some(line => /rock crab down/i.test(line.msg));
        sweepLog = state.logs.find(line => /swept \d+ Bronze dart off the ground/i.test(line.msg))?.msg ?? sweepLog;

        const validAttack = state.attacks.some(event => event.name === 'Rock Crab' && count(event.worn, DART.name) > 0 && count(event.worn, WRONG_AMMO) === 0);
        const validCombat = validAttack || fieldCombat !== null;
        const rangedProgress = state.rangedXp > initial.rangedXp;
        const tookNaturalDart = state.takes.some(event => event.id === DART.id && inField(event.tile));
        const recoveryEquipped = sawWornRecovery || (tookNaturalDart && sweepLog !== '' && worn > 0);
        const noWrongGear = count(state.inventory, WRONG_AMMO) === 0 && count(state.worn, WRONG_AMMO) === 0;

        if (bankRestock && reachedField && validCombat && rangedProgress && sawWornDecrease && killObserved && ground.size > 0 && tookNaturalDart && sweepLog !== '' && recoveryEquipped && noWrongGear) {
            break;
        }

        await page.waitForTimeout(250);
    }

    const final = finalSnapshot ?? (await snapshot(page));
    const validAttacks = final.attacks.filter(event => event.name === 'Rock Crab' && count(event.worn, DART.name) > 0);
    const naturalTakes = final.takes.filter(event => event.id === DART.id && inField(event.tile));
    if (!bankRestock) fail(`no verified bank restock/equip: ${JSON.stringify(final.logs.slice(-80))}`);
    if (!reachedField) fail(`never reached the natural Rock Crab field: ${JSON.stringify(final.tile)}`);
    if (validAttacks.length === 0 && fieldCombat === null) {
        fail(`no natural Rock Crab combat was observed with Bronze darts equipped: ${JSON.stringify(final.attacks)}`);
    }
    if (final.rangedXp <= initial.rangedXp) fail(`Ranged XP did not increase (${initial.rangedXp} -> ${final.rangedXp})`);
    if (!sawWornDecrease) fail(`worn Bronze darts never decreased from ${bankRestock.worn}`);
    if (!killObserved) fail(`no natural Rock Crab kill was logged: ${JSON.stringify(final.logs.slice(-80))}`);
    if (ground.size === 0) fail('no naturally dropped Bronze dart was observed in the field');
    if (naturalTakes.length === 0) fail(`RockCrab never took a field Bronze dart: ${JSON.stringify(final.takes)}`);
    if (sweepLog === '') fail(`no successful Bronze-dart sweep was logged: ${JSON.stringify(final.logs.slice(-80))}`);
    if (!(sawWornRecovery || (naturalTakes.length > 0 && count(final.worn, DART.name) > 0))) {
        fail(`recovered dart was not re-equipped: ${JSON.stringify({ minimumWorn, finalWorn: count(final.worn, DART.name) })}`);
    }
    if (count(final.inventory, WRONG_AMMO) > 0 || count(final.worn, WRONG_AMMO) > 0) {
        fail(`${WRONG_AMMO} was used despite the dart loadout`);
    }
    if (pageErrors.length > 0) fail(`${pageErrors.length} browser page error(s): ${pageErrors.join('\n')}`);

    const proof = {
        generatedAt: new Date().toISOString(),
        result: 'PASS',
        base: baseUrl.origin,
        username,
        bundleSha256,
        gameSockets: socketUrls,
        serverTickMs: SERVER_TICK_MS,
        elapsedMs: Date.now() - startedAt,
        fixture: {
            initialTile: initial.tile,
            initialInventory: initial.inventory,
            initialEquipment: initial.worn,
            bank: bankBefore.items,
            configuredWeapon: DART.name,
            deliberatelyMismatchedBowAmmo: WRONG_AMMO
        },
        bankRestock,
        combat: {
            reachedNaturalField: reachedField,
            rangedXp: { before: initial.rangedXp, after: final.rangedXp },
            validDartAttacks: validAttacks,
            fieldCombat,
            killObserved,
            minimumWorn,
            maximumRecoveryJump,
            groundDrops: [...ground.values()],
            takeEvents: naturalTakes,
            sweepLog,
            finalTile: final.tile,
            finalInventory: final.inventory,
            finalEquipment: final.worn
        },
        logs: final.logs.map(line => line.msg)
    };

    await addProofOverlay(page, [
        `bank-only ${DART.name} ×${DART_SUPPLY} → ${bankRestock.worn} wielded`,
        `natural Rock Crab combat + kill · Ranged XP +${Math.floor(final.rangedXp - initial.rangedXp)}`,
        `${sweepLog} · re-equipped`,
        `300ms isolated world · bundle ${bundleSha256.slice(0, 12)}…`
    ]);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    await Bun.write(PROOF_PATH, JSON.stringify(proof, null, 2));
    proofWritten = true;
    const combatEvidence = validAttacks.length > 0 ? `${validAttacks.length} explicit dart attack(s)` : 'natural proximity combat observed';
    console.log(`COMBAT PASS: ${combatEvidence}, Ranged XP +${Math.floor(final.rangedXp - initial.rangedXp)}`);
    console.log(`RECOVERY PASS: ${sweepLog}; ${naturalTakes.length} natural take event(s)`);
    console.log(`PASS: proof=${PROOF_PATH}; screenshot=${SCREENSHOT_PATH}`);
} catch (error) {
    await page.screenshot({ path: FAILURE_SCREENSHOT_PATH, fullPage: true }).catch(() => undefined);
    if (!proofWritten) {
        await Bun.write(
            PROOF_PATH,
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    result: 'FAIL',
                    base: baseUrl.origin,
                    username,
                    bundleSha256,
                    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
                    finalSnapshot
                },
                null,
                2
            )
        ).catch(() => undefined);
    }
    throw error;
} finally {
    const ingame = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t?.client.ingame ?? false).catch(() => false);
    if (ingame) {
        await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.stop('harness stop')).catch(() => undefined);
        await command(page, 'speed 600', 300).catch(() => undefined);
    }
    await page.close();
    await browser.close();
}
