/** Browser proof for issue #182: leave the Kharidian Desert through the Shantay Pass and walk to Varrock with the production navigation APIs. --base, --expect-unreachable; run `bun run build:bot` first.
 *  The harness accepts loopback HTTP only, refuses the live multibox port, and refuses to run when the served bot bundle differs from this worktree's build. */

//   bun run build:bot
//   bun e2e/shantay-pass-route-test.ts --base http://127.0.0.1:8990
//   bun e2e/shantay-pass-route-test.ts --base http://127.0.0.1:8990 --expect-unreachable
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog } from './tutorial/harness.js';

const START = { x: 3246, z: 3092, level: 0 } as const;
const VARROCK = { x: 3213, z: 3424, level: 0 } as const;
const ARRIVAL_RADIUS = 3;
const TICK_MS = 300;
const TOLL_COINS = 10;
const COINS_ID = 995;

type Tile = { x: number; z: number; level: number };
type Item = { id: number; name: string | null; count: number };

interface HarnessArgs {
    base: string;
    budgetMinutes: number;
    expectUnreachable: boolean;
}

interface FixtureSnapshot {
    tile: Tile | null;
    inventory: Item[];
    equipment: Item[];
    bankOpen: boolean;
    runner: string;
}

interface RouteResult {
    ok: boolean;
    tile: Tile | null;
    coins: number;
    logs: string[];
    error?: string;
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: { isOpen(): boolean; items(): Item[] };
        Equipment: { items(): Item[] };
        Inventory: { items(): Item[]; countById(id: number): number };
        LoopingBot: new () => { loop(): unknown; log(message: string): void };
        Traversal: {
            walkResilient(
                destination: Tile,
                options: {
                    radius: number;
                    attempts: number;
                    timeoutMs: number;
                    log(message: string): void;
                }
            ): Promise<boolean>;
        };
        reader: {
            chat(count: number): { text: string }[];
            worldTile(): Tile | null;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        client: { tutComMessage: string | null };
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
    };
    __issue182CrossingTile?: Tile;
    __issue182RouteResult?: RouteResult;
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function parseArgs(argv: string[]): HarnessArgs {
    let base = 'http://127.0.0.1:8990';
    let budgetMinutes = 10;
    let expectUnreachable = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--base') {
            base = argv[++index] ?? fail('--base needs a URL');
        } else if (arg === '--minutes') {
            budgetMinutes = Number(argv[++index]);
        } else if (arg === '--expect-unreachable') {
            expectUnreachable = true;
        } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
            base = arg;
        } else {
            fail(`unknown argument '${arg}'`);
        }
    }
    if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) {
        fail(`--minutes must be positive (got ${budgetMinutes})`);
    }
    return { base, budgetMinutes, expectUnreachable };
}

function assertSafeBase(rawBase: string): string {
    let url: URL;
    try {
        url = new URL(rawBase);
    } catch {
        fail(`invalid base URL '${rawBase}'`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
        fail(`refusing non-loopback server ${url.origin}`);
    }
    if (url.port === '8081') {
        fail("refusing port 8081: that is reserved for the user's live multibox session");
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        fail(`unsupported protocol '${url.protocol}'`);
    }
    if (url.pathname !== '/' || url.search || url.hash) {
        fail(`base must be an origin without a path, query, or fragment (got '${rawBase}')`);
    }
    return url.origin;
}

function sha256(bytes: ArrayBuffer | Uint8Array): string {
    return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

async function attestServedArtifacts(base: string): Promise<Record<string, string>> {
    const names = ['botclient.js', 'navworker.js', 'collision.lcnav.gz'] as const;
    const hashes: Record<string, string> = {};
    for (const name of names) {
        const local = Bun.file(`out/${name}`);
        if (!(await local.exists())) fail(`out/${name} is missing; build this worktree first`);

        const response = await fetch(new URL(`/bot/${name}`, base));
        if (!response.ok) fail(`served ${name} returned HTTP ${response.status}`);
        const localHash = sha256(await local.arrayBuffer());
        const servedHash = sha256(await response.arrayBuffer());
        if (servedHash !== localHash) {
            fail(`served ${name} ${servedHash} != worktree ${localHash}`);
        }
        hashes[name] = localHash;
    }
    console.log(`ARTIFACT ATTESTATION PASS: ${JSON.stringify(hashes)}`);
    return hashes;
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value))) fail(`could not send ::${value}`);
    if (waitMs > 700) await page.waitForTimeout(waitMs - 700);
}

async function dismissDebugOverlay(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
        if (message === null) return;
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(300);
    }
    const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
    if (message !== null) fail(`could not dismiss debug overlay '${message}'`);
}

async function enforceTickRate(page: Page): Promise<void> {
    await command(page, `speed ${TICK_MS}`);
    const confirmed = await page.evaluate(expected => (globalThis as never as BrowserGlobal).__rs2b0t.reader.chat(8).some(line => line.text.includes(`World speed was changed to ${expected}ms`)), TICK_MS);
    if (!confirmed) fail(`server did not confirm the ${TICK_MS}ms tick rate`);
}

async function snapshot(page: Page): Promise<FixtureSnapshot> {
    return page.evaluate(() => {
        const global = globalThis as never as BrowserGlobal;
        const api = global.__rs2b0t;
        const item = (value: Item): Item => ({ id: value.id, name: value.name, count: value.count });
        return {
            tile: api.reader.worldTile(),
            inventory: api.Inventory.items().map(item),
            equipment: api.Equipment.items().map(item),
            bankOpen: api.Bank.isOpen(),
            runner: global.rs2b0t.runner.state
        };
    });
}

function chebyshev(a: Tile | null, b: Tile): number {
    if (!a || a.level !== b.level) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

async function prepareFixture(page: Page, base: string, username: string): Promise<{ state: FixtureSnapshot; tutorial: number; bankSlots: number }> {
    await mainlandAccount(page, base, username);
    await enforceTickRate(page);
    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');

    // Inspect the empty bank through the live interface, then relog to close it
    // and refresh the ordinary backpack component before seeding the sole item.
    await command(page, '~bank', 1200);
    await page.waitForFunction(() => (globalThis as never as BrowserGlobal).__rs2b0t.Bank.isOpen(), undefined, {
        timeout: 5000
    });
    await page.waitForTimeout(TICK_MS * 3);
    const bankSlots = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rs2b0t.Bank.items().length);
    if (bankSlots !== 0) fail(`bank clear failed: ${bankSlots} item stacks remain`);

    await relog(page, username);
    await dismissDebugOverlay(page);
    await command(page, `give coins ${TOLL_COINS}`);
    await command(page, 'tele 0,50,48,46,20', 1500);
    await dismissDebugOverlay(page);
    await page.waitForFunction(
        start => {
            const tile = (globalThis as never as BrowserGlobal).__rs2b0t.reader.worldTile();
            return tile?.x === start.x && tile.z === start.z && tile.level === start.level;
        },
        START,
        { timeout: 15_000 }
    );
    await page.waitForTimeout(1200);

    const tutorial = await getServerVarQuiet(page, 'tutorial');
    await dismissDebugOverlay(page);
    const state = await snapshot(page);
    if (tutorial !== 1000) fail(`tutorial is ${tutorial}, expected 1000`);
    if (chebyshev(state.tile, START) !== 0) fail(`fixture is not at the exact reported start: ${JSON.stringify(state.tile)}`);
    if (state.bankOpen) fail('bank remained open after the fixture relog');
    if (state.equipment.length !== 0) fail(`worn inventory is not empty: ${JSON.stringify(state.equipment)}`);
    if (state.inventory.length !== 1 || state.inventory[0].id !== COINS_ID || state.inventory[0].count !== TOLL_COINS) {
        fail(`fixture must hold exactly ${TOLL_COINS} coins: ${JSON.stringify(state.inventory)}`);
    }
    return { state, tutorial, bankSlots };
}

async function runTraversal(page: Page, expectUnreachable: boolean): Promise<RouteResult> {
    await page.evaluate(
        ({ destination, radius, baseline, coinsId }) => {
            const global = globalThis as never as BrowserGlobal;
            const api = global.__rs2b0t;
            const logs: string[] = [];
            const watcher = globalThis.setInterval(() => {
                const tile = api.reader.worldTile();
                if (tile && tile.level === 0 && tile.x >= 3300 && tile.x <= 3306 && tile.z >= 3118 && tile.z <= 3122) {
                    global.__issue182CrossingTile = tile;
                    globalThis.clearInterval(watcher);
                }
            }, 50);

            class ShantayRouteProbe extends api.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const ok = await api.Traversal.walkResilient(destination, {
                            radius,
                            attempts: baseline ? 1 : 5,
                            timeoutMs: 240_000,
                            log: message => {
                                logs.push(message);
                                this.log(message);
                                console.log(`[issue182-route] ${message}`);
                            }
                        });
                        global.__issue182RouteResult = {
                            ok,
                            tile: api.reader.worldTile(),
                            coins: api.Inventory.countById(coinsId),
                            logs
                        };
                    } catch (error) {
                        global.__issue182RouteResult = {
                            ok: false,
                            tile: api.reader.worldTile(),
                            coins: api.Inventory.countById(coinsId),
                            logs,
                            error: String(error)
                        };
                    } finally {
                        globalThis.clearInterval(watcher);
                        global.rs2b0t.runner.stop('harness stop');
                    }
                }
            }

            global.__issue182CrossingTile = undefined;
            global.__issue182RouteResult = undefined;
            global.rs2b0t.runner.start(api.registerScript({ name: 'Issue182ShantayRouteProbe', create: () => new ShantayRouteProbe() }));
        },
        { destination: VARROCK, radius: ARRIVAL_RADIUS, baseline: expectUnreachable, coinsId: COINS_ID }
    );

    return page.evaluate(async () => {
        const global = globalThis as never as BrowserGlobal;
        while (global.__issue182RouteResult === undefined || global.rs2b0t.runner.state !== 'stopped') {
            await new Promise(resolve => globalThis.setTimeout(resolve, 100));
        }
        return global.__issue182RouteResult;
    });
}

const args = parseArgs(process.argv.slice(2));
const base = assertSafeBase(args.base);
const artifactSha256 = await attestServedArtifacts(base);
const username = `i182${args.expectUnreachable ? 'b' : 'f'}${Date.now().toString(36).slice(-6)}`;
const screenshotPath = args.expectUnreachable ? 'screenshots/issue182-shantay-baseline-unreachable.png' : 'screenshots/issue182-shantay-varrock.png';
const proofPath = args.expectUnreachable ? 'out/issue182-shantay-baseline-proof.json' : 'out/issue182-shantay-route-proof.json';

await mkdir('screenshots', { recursive: true });
await mkdir('out', { recursive: true });
const browser = await launchBrowser();
let page: Page | null = null;

try {
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('console', message => {
        if (message.text().startsWith('[issue182-route]')) console.log(message.text());
    });
    page.on('pageerror', error => console.error(`[${username}] PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`[${username}] REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));

    const fixture = await prepareFixture(page, base, username);
    console.log(`FIXTURE PASS: ${username} at (${START.x},${START.z},${START.level}), empty bank/worn, ${TOLL_COINS} coins only`);

    const startedAt = Date.now();
    const resultPromise = runTraversal(page, args.expectUnreachable);
    let budgetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
        budgetTimer = globalThis.setTimeout(() => reject(new Error(`route did not finish within ${args.budgetMinutes} minutes`)), args.budgetMinutes * 60_000);
    });
    const result = await Promise.race([resultPromise, budget]).finally(() => {
        if (budgetTimer !== undefined) globalThis.clearTimeout(budgetTimer);
    });
    const elapsedMs = Date.now() - startedAt;
    const crossingTile = await page.evaluate(() => (globalThis as never as BrowserGlobal).__issue182CrossingTile ?? null);
    const finalDistance = chebyshev(result.tile, VARROCK);
    const shantayLog = result.logs.find(message => message.includes('Go-through Shantay pass at (3304,3114) ok')) ?? null;
    const tollLog = result.logs.find(message => message.includes('Al Kharid toll gate: crossed')) ?? null;

    if (result.error) fail(`Traversal probe crashed: ${result.error}`);
    if (args.expectUnreachable) {
        if (result.ok || finalDistance <= ARRIVAL_RADIUS) {
            fail(`baseline unexpectedly reached Varrock: ${JSON.stringify(result)}`);
        }
        if (shantayLog || crossingTile) {
            fail(`baseline unexpectedly crossed Shantay Pass: ${JSON.stringify({ shantayLog, crossingTile })}`);
        }
        if (!result.logs.some(message => /no path|unreachable|no progress/i.test(message))) {
            fail(`baseline lacks an explicit route-failure log: ${JSON.stringify(result.logs)}`);
        }
        if (result.coins !== TOLL_COINS) fail(`baseline spent coins without reaching the toll: ${result.coins}`);
    } else {
        if (!result.ok || finalDistance > ARRIVAL_RADIUS) {
            fail(`route ended short of Varrock: ${JSON.stringify({ result, finalDistance })}`);
        }
        if (!shantayLog) fail(`missing Shantay execution proof: ${JSON.stringify(result.logs)}`);
        if (!crossingTile) fail('no northern Shantay landing tile was observed');
        if (!tollLog) fail(`normal Al Kharid toll was not crossed: ${JSON.stringify(result.logs)}`);
        if (result.coins !== 0) fail(`the exact ${TOLL_COINS}-coin toll fixture ended with ${result.coins} coins`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await Bun.write(
        proofPath,
        `${JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                result: args.expectUnreachable ? 'EXPECTED_UNREACHABLE' : 'PASS',
                mode: args.expectUnreachable ? 'baseline' : 'fixed',
                base,
                username,
                tickMs: TICK_MS,
                tickRateCommandConfirmed: true,
                artifactSha256,
                fixture: {
                    tutorial: fixture.tutorial,
                    bankSlots: fixture.bankSlots,
                    tile: fixture.state.tile,
                    inventory: fixture.state.inventory,
                    equipment: fixture.state.equipment
                },
                traversal: {
                    start: START,
                    destination: VARROCK,
                    radius: ARRIVAL_RADIUS,
                    elapsedMs,
                    ok: result.ok,
                    finalTile: result.tile,
                    finalDistance,
                    finalCoins: result.coins,
                    crossingTile,
                    shantayLog,
                    tollLog,
                    logs: result.logs
                },
                screenshot: screenshotPath
            },
            null,
            2
        )}\n`
    );
    console.log(args.expectUnreachable ? `EXPECTED-UNREACHABLE PASS: route stayed south of Shantay Pass; proof=${proofPath}` : `PASS: Shantay Pass crossed and Varrock reached in ${elapsedMs}ms; proof=${proofPath}`);
    console.log(`screenshot=${screenshotPath}`);
} catch (error) {
    if (page) {
        await page.screenshot({ path: 'screenshots/issue182-shantay-route-failure.png', fullPage: true }).catch(() => undefined);
    }
    throw error;
} finally {
    await browser.close();
}
