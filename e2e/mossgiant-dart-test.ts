/** Live proof for MossGiant dart support (#420): --base --minutes.
 *  A fresh account at Ardougne North bank with empty pack and worn slots; darts and food exist only in the bank, so MossGiant must withdraw the dart stack as projectiles rather than a durable bow weapon, equip them, walk to the safespot and land Ranged XP with darts worn. */

//   bun e2e/mossgiant-dart-test.ts --base http://127.0.0.1:8888 --minutes 10
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { cheatQuiet, launchBrowser, parseArgs, startFromLibrary } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), {
    base: 'http://127.0.0.1:8888',
    minutes: 10
});

const SERVER_TICK_MS = 300;
const DART_SUPPLY = 80;
const FOOD_SUPPLY = 15;
const DART = { id: 806, name: 'Bronze dart', debug: 'bronze_dart' } as const;
const WRONG_AMMO = 'Rune arrow';
const BANK_TILE = { x: 2615, z: 3332, level: 0 } as const;
const SAFESPOT = { x: 2553, z: 3406, level: 0 } as const;
const FIELD_RADIUS = 12;
const SCREENSHOT_PATH = 'screenshots/mossgiant-dart-e2e.png';
const PROOF_PATH = 'out/mossgiant-dart-proof.json';
const FAILURE_SCREENSHOT_PATH = 'out/mossgiant-dart-failure.png';
const username = `mgd${Date.now().toString(36).slice(-7)}`;
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

interface NpcHandle {
    readonly id: number;
    readonly index: number;
    readonly name: string | null;
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

interface BrowserProbe {
    attacks: AttackEvent[];
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
        runner: {
            state: string;
            bot: { status?: string } | null;
            ctx: { crashError?: Error | null; log: LogLine[]; loopCount: number; loopInFlight: boolean; waiters: unknown[] } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
    };
    __mossGiantDartBankAudit?: BankAudit;
    __mossGiantDartProbe?: BrowserProbe;
    __mossGiantDartSockets?: string[];
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
    runner: string;
    crash: string | null;
    logs: LogLine[];
    attacks: AttackEvent[];
    status: string | null;
    inCombat: boolean;
    loopCount: number;
    loopInFlight: boolean;
    waiters: number;
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

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function near(actual: Tile | null, expected: Tile, radius: number): boolean {
    return actual !== null && actual.level === expected.level && chebyshev(actual, expected) <= radius;
}

function inField(tile: Tile | null): boolean {
    return tile !== null && tile.level === 0 && chebyshev(tile, SAFESPOT) <= FIELD_RADIUS;
}

function teleArgs(tile: Tile): string {
    return `0,${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`;
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

async function teleport(page: Page, tile: Tile, radius = 2): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await command(page, `tele ${teleArgs(tile)}`, 1200);
        const here = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rs2b0t.reader.worldTile());
        if (near(here, tile, radius)) return;
    }
    fail(`teleport did not reach ${tile.x},${tile.z}: ${JSON.stringify(await snapshot(page))}`);
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

async function runBankProbe(page: Page, mode: 'audit' | 'seed'): Promise<BankAudit> {
    const scriptName = `MossGiantDartBank${mode}${Date.now().toString(36)}`;
    await page.evaluate(
        ([name, deposit]) => {
            const g = globalThis as never as BrowserGlobal;
            const api = g.__rs2b0t;
            class BankProbe extends api.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        if (!(await api.Bank.openNearest('Bank booth', 'Use-quickly'))) throw new Error('bank did not open');
                        await api.Execution.delayTicks(2);
                        if (deposit) {
                            await api.Bank.depositInventory();
                            await api.Execution.delayTicks(2);
                        }
                        g.__mossGiantDartBankAudit = {
                            ok: true,
                            items: api.Bank.items().map(item => ({ id: item.id, name: item.name, count: item.count }))
                        };
                        await api.Bank.close();
                    } catch (error) {
                        g.__mossGiantDartBankAudit = { ok: false, items: [], error: String(error) };
                    } finally {
                        g.rs2b0t.runner.stop('harness stop');
                    }
                }
            }
            g.__mossGiantDartBankAudit = undefined;
            g.rs2b0t.runner.start(api.registerScript({ name, create: () => new BankProbe() }));
        },
        [scriptName, mode === 'seed'] as const
    );
    await waitRunnerStopped(page);
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__mossGiantDartBankAudit);
    if (!result?.ok) fail(`bank ${mode} failed: ${JSON.stringify(result)}`);
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
    const bank = await runBankProbe(page, 'audit');
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
    const bank = await runBankProbe(page, 'seed');
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
        g.__mossGiantDartProbe = { attacks: [] };

        api.Npc.prototype.interact = function (this: NpcHandle, action: string): boolean | Promise<boolean> {
            if (action.toLowerCase() === 'attack') {
                g.__mossGiantDartProbe!.attacks.push({
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
            runner: g.rs2b0t.runner.state,
            crash: crash?.stack ?? crash?.message ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-500),
            attacks: [...(g.__mossGiantDartProbe?.attacks ?? [])],
            status: g.rs2b0t.runner.bot?.status ?? null,
            inCombat: api.Game.inCombat(),
            loopCount: g.rs2b0t.runner.ctx?.loopCount ?? 0,
            loopInFlight: g.rs2b0t.runner.ctx?.loopInFlight ?? false,
            waiters: g.rs2b0t.runner.ctx?.waiters.length ?? 0
        };
    });
}

async function configureMossGiant(page: Page): Promise<void> {
    await page.evaluate(
        ([dart, wrongAmmo, amount, bank, spot]) => {
            const values: Record<string, string> = {
                combatStyle: 'range',
                bow: dart,
                ammo: wrongAmmo,
                ammoWithdraw: String(amount),
                rangeStyle: 'rapid',
                food: 'Lobster',
                foodWithdraw: '10',
                eatHp: '40',
                panicHp: '20',
                buryBones: 'false',
                bankCommonJunk: 'false',
                safespotTile: JSON.stringify(spot),
                bankTile: JSON.stringify(bank)
            };
            for (const [key, value] of Object.entries(values)) {
                sessionStorage.setItem(`rs2b0t:set:MossGiant:${key}`, value);
            }
        },
        [DART.name, WRONG_AMMO, DART_SUPPLY, BANK_TILE, SAFESPOT] as const
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
                    throw new Error(`MossGiant dart E2E blocked non-isolated WebSocket ${parsed.href}`);
                }
                if (protocols === undefined) super(url);
                else super(url, protocols);
                const g = globalThis as never as BrowserGlobal;
                g.__mossGiantDartSockets ??= [];
                g.__mossGiantDartSockets.push(parsed.href);
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
        document.querySelector('#mossgiant-dart-proof')?.remove();
        const frame = document.createElement('div');
        frame.id = 'mossgiant-dart-proof';
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
        title.textContent = 'PASS · MossGiant Bronze darts · real local E2E';
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
    const socketUrls = await page.evaluate(() => (globalThis as never as BrowserGlobal).__mossGiantDartSockets ?? []);
    if (socketUrls.length === 0) fail('no guarded local game WebSocket was observed');
    if (socketUrls.some(socket => new URL(socket).host !== baseUrl.host)) {
        fail(`game socket escaped the isolated origin: ${JSON.stringify(socketUrls)}`);
    }

    await enforceDoubleTickRate(page);
    await teleport(page, BANK_TILE);
    await clearFixture(page);
    await setLevel(page, 'ranged', 50);
    await setLevel(page, 'hitpoints', 40);
    await setLevel(page, 'defence', 40);
    await dismissDebugOverlay(page);

    const bankBefore = await seedExactBank(page);
    await teleport(page, BANK_TILE);
    const initial = await snapshot(page);
    if (!near(initial.tile, BANK_TILE, 2)) fail(`fixture is not at Ardougne North bank: ${JSON.stringify(initial.tile)}`);
    if (initial.inventory.length !== 0 || initial.worn.length !== 0) {
        fail(`darts must start bank-only: ${JSON.stringify({ inventory: initial.inventory, worn: initial.worn })}`);
    }
    if (count(bankBefore.items, DART.name) !== DART_SUPPLY || count(bankBefore.items, WRONG_AMMO) !== 0) {
        fail(`bad bank-only dart fixture: ${JSON.stringify(bankBefore.items)}`);
    }
    console.log(
        `PRECONDITION PASS: ${username} at Ardougne N; pack/worn empty; bank=${DART_SUPPLY} ${DART.name}; ` +
            `${WRONG_AMMO}=0; Ranged ${initial.rangedLevel}; tick=${SERVER_TICK_MS}ms`
    );

    await configureMossGiant(page);
    await installInteractionProbe(page);
    await startFromLibrary(page, 'Combat', 'MossGiant');
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    let lastLogTime = 0;
    let bankRestock: { at: number; withdrawnLog: string; worn: number; tile: Tile | null } | null = null;
    let reachedField = false;
    let sawWornDecrease = false;
    let killObserved = false;
    let fieldCombat: { at: number; tile: Tile; wornDarts: number; rangedXp: number; giants: NpcView[] } | null = null;
    let lastSnapshotLog = 0;
    let startLog = '';

    while (Date.now() < deadline) {
        const state = await snapshot(page);
        finalSnapshot = state;
        for (const line of state.logs) {
            if (line.time > lastLogTime) console.log(`[${line.level}] ${line.msg}`);
            lastLogTime = Math.max(lastLogTime, line.time);
        }
        if (state.runner === 'crashed') fail(`MossGiant crashed: ${state.crash ?? JSON.stringify(state.logs.slice(-40))}`);
        if (state.runner === 'stopped') fail(`MossGiant stopped before proof: ${JSON.stringify(state.logs.slice(-40))}`);
        if (Date.now() - lastSnapshotLog >= 10_000) {
            lastSnapshotLog = Date.now();
            console.log(
                `STATE: ${JSON.stringify({
                    tile: state.tile,
                    status: state.status,
                    inCombat: state.inCombat,
                    worn: count(state.worn, DART.name),
                    rangedXp: state.rangedXp,
                    npcs: state.npcs
                        .filter(npc => /moss/i.test(npc.name ?? ''))
                        .map(npc => ({ name: npc.name, health: npc.health, tile: npc.tile })),
                    loop: `${state.loopCount}/${state.loopInFlight ? 'busy' : 'idle'}/${state.waiters}w`
                })}`
            );
        }

        startLog = state.logs.find(line => /MossGiant — style range.*darts/i.test(line.msg))?.msg ?? startLog;
        const withdrawn = state.logs.find(line => new RegExp(`withdrew \\d+ ${DART.name} — \\d+ equipped`, 'i').test(line.msg));
        const worn = count(state.worn, DART.name);
        const fighting = state.npcs.filter(npc => npc.name === 'Moss giant' && npc.health > 0 && inField(npc.tile));
        if (!fieldCombat && state.inCombat && inField(state.tile) && worn > 0 && fighting.length > 0) {
            fieldCombat = {
                at: state.at,
                tile: state.tile!,
                wornDarts: worn,
                rangedXp: state.rangedXp,
                giants: fighting
            };
            console.log(`COMBAT OBSERVED: ${fighting.length} Moss giant(s), ${worn} ${DART.name} worn, Ranged XP ${state.rangedXp}`);
        }
        if (!bankRestock && withdrawn && worn > 0) {
            bankRestock = {
                at: Date.now(),
                withdrawnLog: withdrawn.msg,
                worn,
                tile: state.tile
            };
            if (state.logs.some(line => line.msg.includes(`withdrew and wielded ${DART.name}`))) {
                fail('dart was withdrawn once as a durable weapon before the projectile restock');
            }
            console.log(`BANK PASS: ${withdrawn.msg}`);
        }

        reachedField ||= inField(state.tile) && state.npcs.some(npc => npc.name === 'Moss giant');
        if (bankRestock && worn < bankRestock.worn) sawWornDecrease = true;
        killObserved ||= state.logs.some(line => /moss giant down/i.test(line.msg));

        const validAttack = state.attacks.some(event => event.name === 'Moss giant' && count(event.worn, DART.name) > 0 && count(event.worn, WRONG_AMMO) === 0);
        const validCombat = validAttack || fieldCombat !== null;
        const rangedProgress = state.rangedXp > initial.rangedXp;
        const noWrongGear = count(state.inventory, WRONG_AMMO) === 0 && count(state.worn, WRONG_AMMO) === 0;
        const dartStartBanner = /darts 'Bronze dart'/i.test(startLog);

        if (bankRestock && reachedField && validCombat && rangedProgress && sawWornDecrease && noWrongGear && dartStartBanner) {
            break;
        }

        await page.waitForTimeout(250);
    }

    const final = finalSnapshot ?? (await snapshot(page));
    const validAttacks = final.attacks.filter(event => event.name === 'Moss giant' && count(event.worn, DART.name) > 0);
    if (!/darts 'Bronze dart'/i.test(startLog)) fail(`startup log did not announce dart loadout: '${startLog}' / ${JSON.stringify(final.logs.slice(0, 20))}`);
    if (!bankRestock) fail(`no verified bank restock/equip: ${JSON.stringify(final.logs.slice(-80))}`);
    if (!reachedField) fail(`never reached the Moss giant field: ${JSON.stringify(final.tile)}`);
    if (validAttacks.length === 0 && fieldCombat === null) {
        fail(`no Moss giant combat was observed with Bronze darts equipped: ${JSON.stringify(final.attacks)}`);
    }
    if (final.rangedXp <= initial.rangedXp) fail(`Ranged XP did not increase (${initial.rangedXp} -> ${final.rangedXp})`);
    if (!sawWornDecrease) fail(`worn Bronze darts never decreased from ${bankRestock.worn}`);
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
            bank: bankBefore.items,
            configuredWeapon: DART.name,
            deliberatelyMismatchedBowAmmo: WRONG_AMMO
        },
        bankRestock,
        combat: {
            reachedField,
            fieldCombat,
            validAttacks: validAttacks.length,
            rangedXp: { from: initial.rangedXp, to: final.rangedXp },
            sawWornDecrease,
            killObserved,
            startLog
        },
        final: {
            tile: final.tile,
            worn: final.worn,
            inventory: final.inventory,
            status: final.status
        }
    };
    await Bun.write(PROOF_PATH, JSON.stringify(proof, null, 2));
    proofWritten = true;

    const overlay = [
        `user ${username}`,
        bankRestock.withdrawnLog,
        `Ranged XP ${initial.rangedXp} → ${final.rangedXp}`,
        `worn darts decreased from ${bankRestock.worn}`,
        `field combat: ${fieldCombat ? 'yes' : `attacks=${validAttacks.length}`}`,
        `kill log: ${killObserved ? 'yes' : 'not required'}`
    ];
    await addProofOverlay(page, overlay);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`PASS: MossGiant Bronze darts E2E (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    console.log(`  proof: ${PROOF_PATH}`);
    console.log(`  screenshot: ${SCREENSHOT_PATH}`);
} catch (error) {
    try {
        await page.screenshot({ path: FAILURE_SCREENSHOT_PATH, fullPage: true });
        console.error(`failure screenshot: ${FAILURE_SCREENSHOT_PATH}`);
    } catch {
        /* ignore */
    }
    if (!proofWritten && finalSnapshot) {
        await Bun.write(
            PROOF_PATH,
            JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    result: 'FAIL',
                    error: String(error),
                    final: finalSnapshot
                },
                null,
                2
            )
        );
    }
    throw error;
} finally {
    await browser.close();
}
