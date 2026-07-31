/**
 * Real browser + current local LostCity end-to-end proof for Doric's Quest.
 *
 * The harness refuses non-loopback servers, attests the served bundle, creates
 * fresh accounts, and uses the real AIOQuester UI.  The natural scenario starts
 * in Lumbridge with 10 Hitpoints, every other skill at 1, an empty backpack,
 * and only 2m coins in the bank.
 *
 *   bun tools/doric-level3-test.ts http://127.0.0.1:8990 staged 12
 *   bun tools/doric-level3-test.ts http://127.0.0.1:8990 natural 30
 *   bun tools/doric-level3-test.ts http://127.0.0.1:8990 all 40
 */
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright-core';

import { startFromLibrary } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8990';
const mode = process.argv[3] ?? 'all';
const budgetMinutes = Number(process.argv[4]) || 40;
const budgetMs = budgetMinutes * 60_000;
const serverTickMs = 300;
const proofPath = 'out/doric-level3-proof.json';
const completeScreenshot = 'screenshots/doric-level3-complete.png';

const ITEM = {
    coins: { debug: 'coins', id: 995 },
    clay: { debug: 'clay', id: 434 },
    copper: { debug: 'copper_ore', id: 436 },
    iron: { debug: 'iron_ore', id: 440 },
    bronzePickaxe: { debug: 'bronze_pickaxe', id: 1265 },
    runePickaxe: { debug: 'rune_pickaxe', id: 1275 }
} as const;

const SKILLS = [
    'attack',
    'defence',
    'strength',
    'hitpoints',
    'ranged',
    'prayer',
    'magic',
    'cooking',
    'woodcutting',
    'fletching',
    'fishing',
    'firemaking',
    'crafting',
    'smithing',
    'mining',
    'herblore',
    'agility',
    'thieving',
    'slayer',
    'runecraft'
] as const;

type Item = { id: number; name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };
type Tile = { x: number; z: number; level: number };

interface Snapshot {
    tile: Tile | null;
    inventory: Item[];
    levels: Record<string, number>;
    miningXp: number;
    quest: string;
    points: number;
    runner: string;
    step: string | null;
    logs: LogLine[];
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: {
            close(): Promise<boolean>;
            countById(id: number): number;
            depositAllMatching(match: (name: string, id: number) => boolean): Promise<void>;
            openNearest(name: string, op: string): Promise<boolean>;
        };
        Execution: { delayUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> };
        Inventory: { items(): Item[] };
        LoopingBot: new () => { loop(): void | Promise<void> };
        Quests: { points(): number; status(name: string): string };
        Skills: { level(name: string): number; xp(name: string): number };
        reader: {
            chat(type: number): { text: string }[];
            worldTile(): Tile | null;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        client: { tutComMessage: string | null };
        paint: { set(key: string, value: string): void };
        runner: {
            state: string;
            bot: { stepDesc?: string } | null;
            ctx: { log: LogLine[] } | null;
            start(meta: unknown): void;
            stop(): void;
        };
    };
    __doricBankSeed?: { ok: boolean; counts: Record<number, number>; error?: string };
}

interface BankSeed {
    debug: string;
    id: number;
    qty: number;
}

interface FixtureOptions {
    stage: number;
    tile: string;
    mining?: number;
    bank?: BankSeed[];
    inventory?: BankSeed[];
}

interface ScenarioProof {
    name: string;
    username: string;
    elapsedMs: number;
    finalStage: number;
    final: Snapshot;
    logs: string[];
    questLogs: string[];
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function assertLocalBase(): void {
    const url = new URL(base);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
        fail(`refusing non-loopback server ${url.origin}`);
    }
    if (url.port === '8081') {
        fail("refusing port 8081: that is reserved for the user's live multibox session");
    }
}

async function attestServedBundle(): Promise<string> {
    const local = Bun.file('out/botclient.js');
    if (!(await local.exists())) fail('out/botclient.js is missing; build this worktree first');
    const response = await fetch(new URL('/bot/botclient.js', base));
    if (!response.ok) fail(`served bot bundle returned HTTP ${response.status}`);
    const hash = (bytes: ArrayBuffer | Uint8Array): string => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
    const localHash = hash(await local.arrayBuffer());
    const servedHash = hash(await response.arrayBuffer());
    if (servedHash !== localHash) fail(`served bundle ${servedHash} != worktree bundle ${localHash}`);
    console.log(`BUNDLE ATTESTATION PASS: sha256=${localHash}`);
    return localHash;
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value))) fail(`could not send ::${value}`);
    if (waitMs > 700) await page.waitForTimeout(waitMs - 700);
}

async function enforceDoubleTickRate(page: Page): Promise<void> {
    await command(page, `speed ${serverTickMs}`);
    const confirmed = await page.evaluate(expected => (globalThis as never as BrowserGlobal).__rs2b0t.reader.chat(5).some(line => line.text.includes(`World speed was changed to ${expected}ms`)), serverTickMs);
    if (!confirmed) fail(`server did not confirm the ${serverTickMs}ms tick rate`);
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

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(skillNames => {
        const g = globalThis as never as BrowserGlobal;
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            inventory: g.__rs2b0t.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            levels: Object.fromEntries(skillNames.map(name => [name, g.__rs2b0t.Skills.level(name)])),
            miningXp: g.__rs2b0t.Skills.xp('mining'),
            quest: g.__rs2b0t.Quests.status("Doric's Quest"),
            points: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            step: g.rs2b0t.runner.bot?.stepDesc ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-600)
        };
    }, SKILLS);
}

function countId(state: Snapshot, id: number): number {
    return state.inventory.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function doricLogs(lines: readonly LogLine[]): string[] {
    return lines.map(line => line.msg).filter(message => message.startsWith("Doric's Quest:"));
}

async function seedBank(page: Page, items: BankSeed[]): Promise<void> {
    for (const item of items) await command(page, `give ${item.debug} ${item.qty}`);
    await page.evaluate(expected => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class DoricBankSeeder extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    if (!(await api.Bank.openNearest('Bank booth', 'Use-quickly'))) throw new Error('bank did not open');
                    await api.Bank.depositAllMatching(() => true);
                    const ok = await api.Execution.delayUntil(() => expected.every(item => api.Bank.countById(item.id) >= item.qty), 6000);
                    const counts = Object.fromEntries(expected.map(item => [item.id, api.Bank.countById(item.id)]));
                    await api.Bank.close();
                    g.__doricBankSeed = { ok, counts };
                } catch (error) {
                    g.__doricBankSeed = { ok: false, counts: {}, error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.__doricBankSeed = undefined;
        g.rs2b0t.runner.start(api.registerScript({ name: 'DoricBankSeeder', create: () => new DoricBankSeeder() }));
    }, items);
    await page.waitForFunction(
        () => {
            const g = globalThis as never as BrowserGlobal;
            return g.__doricBankSeed !== undefined && g.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 30_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__doricBankSeed!);
    if (!result.ok) fail(`bank seed failed: ${JSON.stringify(result)}`);
}

async function freshFixture(browser: Browser, username: string, options: FixtureOptions): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', error => console.error(`[${username}] PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`[${username}] REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));
    await mainlandAccount(page, base, username);
    await enforceDoubleTickRate(page);
    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');
    await command(page, 'setvar tutorial 1000');
    await command(page, `setvar doricquest ${options.stage}`);
    if (options.mining !== undefined) await command(page, `setstat mining ${options.mining}`);
    await command(page, 'tele 0,48,50,21,43', 1400);
    await seedBank(page, options.bank ?? [{ ...ITEM.coins, qty: 2_000_000 }]);
    for (const item of options.inventory ?? []) await command(page, `give ${item.debug} ${item.qty}`);
    await command(page, `tele ${options.tile}`, 1400);
    await relog(page, username);
    await dismissDebugOverlay(page);
    await page.waitForTimeout(1200);
    return page;
}

async function serverStage(page: Page): Promise<number> {
    const stage = await getServerVarQuiet(page, 'doricquest');
    await dismissDebugOverlay(page);
    if (stage === null) fail('server did not report doricquest');
    return stage;
}

async function startAioQuester(page: Page): Promise<string> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'doric');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', '');
        g.rs2b0t.paint.set('tabs:aio', 'Current');
    });
    await startFromLibrary(page, 'Quest', 'AIOQuester');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        const first = doricLogs(state.logs)[0];
        if (first) return first.slice("Doric's Quest: ".length);
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`AIOQuester ${state.runner} before first Doric step: ${JSON.stringify(state.logs.slice(-30))}`);
        }
        await page.waitForTimeout(100);
    }
    fail('AIOQuester did not publish a Doric step within 30 seconds');
}

async function stopRunner(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.stop());
    await page.waitForFunction(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10_000 });
}

async function waitForComplete(page: Page, username: string, started: number, accumulated: LogLine[] = []): Promise<ScenarioProof> {
    const deadline = started + budgetMs;
    const seen = new Set(accumulated.map(line => `${line.time}|${line.level}|${line.msg}`));
    let lastStep = '';
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        if (state.step && state.step !== lastStep) {
            console.log(`[${username}] step: ${state.step} (Mining ${state.levels.mining}, ${Math.floor(state.miningXp)} XP)`);
            lastStep = state.step;
        }
        for (const line of state.logs) {
            const key = `${line.time}|${line.level}|${line.msg}`;
            if (!seen.has(key)) {
                seen.add(key);
                accumulated.push(line);
                if (line.msg.startsWith("Doric's Quest:") || line.msg.startsWith('  random event:')) {
                    console.log(`[${username}] ${line.msg}`);
                }
            }
        }
        if (state.quest === 'complete' && state.runner === 'stopped') {
            const final = await snapshot(page);
            return {
                name: '',
                username,
                elapsedMs: Date.now() - started,
                finalStage: await serverStage(page),
                final,
                logs: accumulated.map(line => line.msg),
                questLogs: doricLogs(accumulated)
            };
        }
        if ((state.runner === 'crashed' || state.runner === 'stopped') && state.quest !== 'complete') {
            fail(`[${username}] AIOQuester ${state.runner} before completion: ${JSON.stringify(state.logs.slice(-40))}`);
        }
        await page.waitForTimeout(400);
    }
    fail(`[${username}] incomplete after ${budgetMinutes} minutes: ${JSON.stringify(await snapshot(page))}`);
}

function verifyCompletion(proof: ScenarioProof): void {
    if (proof.finalStage !== 100 || proof.final.quest !== 'complete' || proof.final.points !== 1 || proof.final.runner !== 'stopped') {
        fail(`${proof.name} has bad completion state: ${JSON.stringify(proof)}`);
    }
    if (countId(proof.final, ITEM.coins.id) !== 180) {
        fail(`${proof.name} did not drain the post-scroll 180-coin reward: ${JSON.stringify(proof.final.inventory)}`);
    }
    if (!proof.logs.some(log => log.includes('reward queue drained; received 180 coins'))) {
        fail(`${proof.name} lacks the explicit reward-drain proof log: ${JSON.stringify(proof.logs)}`);
    }
}

async function turnInScenario(browser: Browser, suffix: string): Promise<ScenarioProof> {
    const username = `d186t${suffix}`;
    const page = await freshFixture(browser, username, {
        stage: 10,
        mining: 15,
        tile: '0,46,53,8,59',
        inventory: [
            { ...ITEM.clay, qty: 6 },
            { ...ITEM.copper, qty: 4 },
            { ...ITEM.iron, qty: 2 }
        ]
    });
    const started = Date.now();
    const first = await startAioQuester(page);
    if (!first.includes('collect the full reward')) fail(`turn-in first step was '${first}'`);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'stage-10 reward-queue hand-in';
    verifyCompletion(proof);
    await page.close();
    console.log('TURN-IN PASS: quest scroll closed, final dialogue drained, 180 coins observed');
    return proof;
}

async function bankedIronScenario(browser: Browser, suffix: string): Promise<ScenarioProof> {
    const username = `d186b${suffix}`;
    const page = await freshFixture(browser, username, {
        stage: 10,
        tile: '0,48,50,20,43',
        bank: [
            { ...ITEM.coins, qty: 2_000_000 },
            { ...ITEM.iron, qty: 2 }
        ],
        inventory: [
            { ...ITEM.clay, qty: 6 },
            { ...ITEM.copper, qty: 4 }
        ]
    });
    const started = Date.now();
    const first = await startAioQuester(page);
    if (first !== 'check the bank') fail(`banked-iron first step was '${first}'`);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'Mining-1 banked-iron bypass';
    verifyCompletion(proof);
    // The quest reward itself grants 1,300 Mining XP (level 1 -> 10).  Any
    // pre-reward copper training would make this value larger.
    if (proof.final.miningXp !== 1300) fail(`banked iron gained pre-reward Mining XP: ${proof.final.miningXp}`);
    if (proof.questLogs.some(log => /(?:train Mining|mine (?:Clay|Copper|Iron))/.test(log))) {
        fail(`banked iron took a mining detour: ${JSON.stringify(proof.questLogs)}`);
    }
    if (!proof.questLogs.some(log => log.includes('withdraw Iron ore×2'))) fail(`banked iron was not withdrawn: ${JSON.stringify(proof.questLogs)}`);
    await page.close();
    console.log('BANKED-IRON PASS: exact banked iron bypassed Mining training at level 1');
    return proof;
}

async function fullExactPackScenario(browser: Browser, suffix: string): Promise<ScenarioProof> {
    const username = `d186f${suffix}`;
    const page = await freshFixture(browser, username, {
        stage: 10,
        tile: '0,48,50,20,43',
        bank: [
            { ...ITEM.coins, qty: 2_000_000 },
            { ...ITEM.iron, qty: 1 }
        ],
        inventory: [
            { ...ITEM.clay, qty: 7 },
            { ...ITEM.copper, qty: 4 },
            { ...ITEM.iron, qty: 1 },
            { ...ITEM.bronzePickaxe, qty: 1 },
            { ...ITEM.runePickaxe, qty: 15 }
        ]
    });
    const initial = await snapshot(page);
    if (initial.inventory.length !== 28) fail(`full exact pack fixture has ${initial.inventory.length} slots`);
    const started = Date.now();
    await startAioQuester(page);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'full exact-item restart';
    verifyCompletion(proof);
    if (!proof.questLogs.some(log => log.includes('bank spillover'))) fail(`full exact pack was not rebalanced: ${JSON.stringify(proof.questLogs)}`);
    if (!proof.questLogs.some(log => log.includes('withdraw Clay×6, Copper ore×4, Iron ore×2'))) {
        fail(`full exact pack did not restore exact requirements: ${JSON.stringify(proof.questLogs)}`);
    }
    await page.close();
    console.log('FULL-PACK PASS: 28 exact quest/tool items rebalanced without parking');
    return proof;
}

async function restartScenario(browser: Browser, suffix: string): Promise<ScenarioProof> {
    const username = `d186r${suffix}`;
    const page = await freshFixture(browser, username, {
        stage: 10,
        mining: 14,
        tile: '0,46,50,34,47',
        inventory: [
            { ...ITEM.clay, qty: 6 },
            { ...ITEM.copper, qty: 4 },
            { ...ITEM.bronzePickaxe, qty: 1 }
        ]
    });
    const started = Date.now();
    await startAioQuester(page);
    const beforeLogs: LogLine[] = [];
    const deadline = Date.now() + Math.min(budgetMs, 8 * 60_000);
    let reachedIron = false;
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        beforeLogs.push(...state.logs.filter(line => !beforeLogs.some(seen => seen.time === line.time && seen.level === line.level && seen.msg === line.msg)));
        if (state.levels.mining >= 15 && state.step?.includes('mine Iron ore')) {
            reachedIron = true;
            break;
        }
        if (state.runner === 'crashed' || state.runner === 'stopped') fail(`restart fixture stopped early: ${JSON.stringify(state)}`);
        await page.waitForTimeout(300);
    }
    if (!reachedIron) fail('restart fixture never reached the iron-mining boundary');
    await stopRunner(page);
    const checkpoint = await snapshot(page);
    if (checkpoint.quest !== 'inProgress' || checkpoint.levels.mining < 15) fail(`bad restart checkpoint: ${JSON.stringify(checkpoint)}`);
    await relog(page, username);
    await dismissDebugOverlay(page);
    await page.waitForTimeout(1000);
    const firstAfterRestart = await startAioQuester(page);
    if (firstAfterRestart !== 'check the bank') fail(`restart did not rebuild bank knowledge first: '${firstAfterRestart}'`);
    const proof = await waitForComplete(page, username, started, beforeLogs);
    proof.name = 'level-15 mining-boundary restart';
    verifyCompletion(proof);
    if (!proof.questLogs.some(log => /mine Iron ore [01]\/2/.test(log))) fail(`restart never resumed iron: ${JSON.stringify(proof.questLogs)}`);
    await page.close();
    console.log('RESTART PASS: stopped/relogged at Mining 15, rescanned bank, resumed iron, completed');
    return proof;
}

async function naturalScenario(browser: Browser, suffix: string): Promise<ScenarioProof> {
    const username = `d186n${suffix}`;
    const page = await freshFixture(browser, username, {
        stage: 0,
        tile: '0,50,50,20,20'
    });
    const initial = await snapshot(page);
    if (initial.tile?.x !== 3220 || initial.tile.z !== 3220 || initial.tile.level !== 0) fail(`natural fixture is not in Lumbridge: ${JSON.stringify(initial.tile)}`);
    if (initial.inventory.length !== 0) fail(`natural fixture is not itemless: ${JSON.stringify(initial.inventory)}`);
    for (const skill of SKILLS) {
        const expected = skill === 'hitpoints' ? 10 : 1;
        if (initial.levels[skill] !== expected) fail(`natural ${skill}=${initial.levels[skill]}, expected ${expected}`);
    }
    if (initial.quest !== 'notStarted' || (await serverStage(page)) !== 0 || initial.points !== 0) {
        fail(`natural quest fixture is not fresh: ${JSON.stringify(initial)}`);
    }
    const started = Date.now();
    const first = await startAioQuester(page);
    if (!first.startsWith('stage 0:')) fail(`natural first step was '${first}'`);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'fresh level-3 Lumbridge-to-completion';
    verifyCompletion(proof);
    if (proof.final.levels.mining < 15) fail(`natural run completed below Mining 15: ${proof.final.levels.mining}`);
    for (const required of ['source a free Bronze pickaxe', 'mine Clay', 'mine Copper ore', 'train Mining', 'mine Iron ore']) {
        if (!proof.questLogs.some(log => log.includes(required))) fail(`natural run missed '${required}': ${JSON.stringify(proof.questLogs)}`);
    }
    await page.screenshot({ path: completeScreenshot, fullPage: true });
    await page.close();
    console.log(`NATURAL PASS: fresh level 3 → Mining ${proof.final.levels.mining} → Doric complete; ${proof.elapsedMs}ms`);
    return proof;
}

assertLocalBase();
if (!['staged', 'natural', 'all'].includes(mode)) fail(`mode must be staged, natural, or all (got '${mode}')`);
const bundleSha256 = await attestServedBundle();
const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    slowMo: process.env.HEADED ? Number(process.env.SLOWMO ?? 100) : 0,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});

try {
    const suffix = Date.now().toString(36).slice(-5);
    const proofs: ScenarioProof[] = [];
    if (mode !== 'natural') {
        proofs.push(await turnInScenario(browser, suffix));
        proofs.push(await bankedIronScenario(browser, suffix));
        proofs.push(await fullExactPackScenario(browser, suffix));
        proofs.push(await restartScenario(browser, suffix));
    }
    if (mode !== 'staged') proofs.push(await naturalScenario(browser, suffix));
    await Bun.write(
        proofPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                result: 'PASS',
                base,
                mode,
                tickMs: serverTickMs,
                tickRateCommandConfirmed: true,
                bundleSha256,
                scenarios: proofs
            },
            null,
            2
        ) + '\n'
    );
    console.log(`PASS: ${proofs.length} Doric real-browser scenarios; proof=${proofPath}`);
    if (mode !== 'staged') console.log(`screenshot=${completeScreenshot}`);
} finally {
    await browser.close();
}
