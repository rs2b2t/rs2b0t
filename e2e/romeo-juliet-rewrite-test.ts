/** Local LostCity end-to-end proof for the Romeo & Juliet rewrite: [base] [minutes], CHROME_PROFILE=…
 *  Uses fresh isolated accounts, the AIOQuester UI, live navigation and server dialogue; it never points at a production server. */

//   CHROME_PROFILE=/tmp/rs2b0t-rj bun e2e/romeo-juliet-rewrite-test.ts http://127.0.0.1:8950 10
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createHash } from 'node:crypto';

import { positionalArgs, startFromLibrary } from './lib/harness.js';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://127.0.0.1:8950');
const base = args[0];
const budgetMinutes = Number(args[1]) || 10;
const budgetMs = budgetMinutes * 60_000;
const profile = process.env.CHROME_PROFILE ?? '/tmp/rs2b0t-romeo-juliet-profile';

const MESSAGE_ID = 755;
const REGRESSION_SCREENSHOT = 'screenshots/romeo-juliet-stage-40-fixed.png';
const COMPLETE_SCREENSHOT = 'screenshots/romeo-juliet-complete.png';
const CONTENTION_SCREENSHOT = 'screenshots/romeo-juliet-contention-complete.png';
const PROOF_JSON = 'out/romeo-juliet-rewrite-proof.json';

type Tile = { x: number; z: number; level: number };
type Item = { id: number; name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };

interface Snapshot {
    tile: Tile | null;
    inventory: Item[];
    quest: string;
    points: number;
    runner: string;
    step: string | null;
    logs: LogLine[];
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: {
            isOpen(): boolean;
            countById(id: number): number;
            openNearest(name: string, op: string, log?: (message: string) => void): Promise<boolean>;
            depositAllMatching(match: (name: string, id: number) => boolean): Promise<void>;
        };
        Execution: { delayUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> };
        Inventory: { items(): Item[] };
        LoopingBot: new () => { loop(): number | void | Promise<number | void> };
        Quests: { status(name: string): string; points(): number };
        reader: { worldTile(): Tile | null };
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
            stop(reason: string): void;
        };
    };
    __romeoBankSeed?: { ok: boolean; banked: number; error?: string };
}

interface ScenarioProof {
    name: string;
    username: string;
    elapsedMs: number;
    firstStep: string;
    finalStage: number;
    points: number;
    quest: string;
    questLogs: string[];
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

async function attestServedBundle(): Promise<string> {
    const localBundle = Bun.file('out/botclient.js');
    if (!(await localBundle.exists())) fail('out/botclient.js is missing; build and deploy this worktree first');

    const response = await fetch(new URL('/bot/botclient.js', base));
    if (!response.ok) fail(`served bot bundle returned HTTP ${response.status}`);

    const localHash = createHash('sha256')
        .update(new Uint8Array(await localBundle.arrayBuffer()))
        .digest('hex');
    const servedHash = createHash('sha256')
        .update(new Uint8Array(await response.arrayBuffer()))
        .digest('hex');
    if (servedHash !== localHash) {
        fail(`served bot bundle ${servedHash} does not match this worktree's built bundle ${localHash}`);
    }
    console.log(`BUNDLE ATTESTATION PASS: sha256=${localHash}`);
    return localHash;
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value))) fail(`could not send ::${value}`);
    if (waitMs > 700) await page.waitForTimeout(waitMs - 700);
}

async function dismissDebugOverlay(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
        if (message === null) return;
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(300);
    }
    const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
    if (message !== null) fail(`could not dismiss debug overlay '${message}'`);
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            inventory: g.__rs2b0t.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            quest: g.__rs2b0t.Quests.status('Romeo & Juliet'),
            points: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            step: g.rs2b0t.runner.bot?.stepDesc ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-600)
        };
    });
}

function questLogs(state: Snapshot): string[] {
    return state.logs.map(line => line.msg).filter(message => message.startsWith('Romeo & Juliet:'));
}

async function newAccount(context: BrowserContext, username: string, options: { stage?: number; items?: string[]; tile?: string; fullPack?: boolean } = {}): Promise<Page> {
    const page = await context.newPage();
    page.on('pageerror', error => console.error(`[${username}] PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`[${username}] REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));
    await bootAndLogin(page, base, username);
    await command(page, 'speed 300');
    await command(page, '~clearinv inv');
    await command(page, '~clearbank');
    await command(page, 'setvar tutorial 1000');
    if (options.stage !== undefined) await command(page, `setvar rjquest ${options.stage}`);
    for (const item of options.items ?? []) await command(page, `give ${item} 1`);
    if (options.fullPack) await command(page, 'give bones 28');
    await command(page, `tele ${options.tile ?? '0,50,53,11,33'}`, 1400);
    await relog(page, username);
    await dismissDebugOverlay(page);
    // Scene-ready precedes the first inventory component update by one client
    // cycle. Without this settle a deliberately full pack briefly reads empty.
    await page.waitForTimeout(1200);
    return page;
}

async function startAioQuester(page: Page): Promise<string> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'romeojuliet');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', '');
        g.rs2b0t.paint.set('tabs:aio', 'Current');
    });
    await startFromLibrary(page, 'Quest', 'AIOQuester');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        const first = questLogs(state)[0];
        if (first) return first.slice('Romeo & Juliet: '.length);
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`AIOQuester ${state.runner} before its first quest step: ${JSON.stringify(state.logs.slice(-20))}`);
        }
        await page.waitForTimeout(100);
    }
    fail('AIOQuester did not publish a Romeo & Juliet step within 30 seconds');
}

async function serverStage(page: Page): Promise<number> {
    const stage = await getServerVarQuiet(page, 'rjquest');
    await dismissDebugOverlay(page);
    if (stage === null) fail('server did not report rjquest');
    return stage;
}

async function waitForComplete(page: Page, username: string, started: number): Promise<ScenarioProof> {
    const deadline = started + budgetMs;
    let seenLogTime = 0;
    let lastStep = '';
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        if (state.step && state.step !== lastStep) {
            console.log(`[${username}] step: ${state.step}`);
            lastStep = state.step;
        }
        for (const line of state.logs) {
            if (line.time > seenLogTime && line.msg.startsWith('Romeo & Juliet')) {
                console.log(`[${username}] ${line.msg}`);
            }
        }
        if (state.logs.length > 0) seenLogTime = Math.max(seenLogTime, ...state.logs.map(line => line.time));

        if (state.quest === 'complete') {
            await page.waitForTimeout(1200);
            const final = await snapshot(page);
            const first = questLogs(final)[0]?.slice('Romeo & Juliet: '.length) ?? '';
            return {
                name: '',
                username,
                elapsedMs: Date.now() - started,
                firstStep: first,
                finalStage: await serverStage(page),
                points: final.points,
                quest: final.quest,
                questLogs: questLogs(final)
            };
        }
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`[${username}] AIOQuester ${state.runner} before completion: ${JSON.stringify(state.logs.slice(-30))}`);
        }
        await page.waitForTimeout(250);
    }
    const final = await snapshot(page);
    fail(`[${username}] quest incomplete after ${budgetMinutes} minutes: ${JSON.stringify(final)}`);
}

async function stopRunner(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.stop('harness stop'));
    await page.waitForFunction(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10_000 });
}

async function seedMessageInBank(page: Page): Promise<void> {
    await page.evaluate(messageId => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class RomeoBankSeeder extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    if (!(await api.Bank.openNearest('Bank booth', 'Use-quickly'))) {
                        throw new Error('could not open the nearby bank booth');
                    }
                    await api.Bank.depositAllMatching((_name, id) => id === messageId);
                    const settled = await api.Execution.delayUntil(() => api.Bank.countById(messageId) > 0, 5000);
                    if (!settled) throw new Error('exact quest message never appeared in the bank');
                    g.__romeoBankSeed = { ok: true, banked: api.Bank.countById(messageId) };
                } catch (error) {
                    g.__romeoBankSeed = { ok: false, banked: api.Bank.countById(messageId), error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__romeoBankSeed = undefined;
        const meta = api.registerScript({ name: 'RomeoBankSeeder', create: () => new RomeoBankSeeder() });
        g.rs2b0t.runner.start(meta);
    }, MESSAGE_ID);
    await page.waitForFunction(
        () => {
            const g = globalThis as never as BrowserGlobal;
            return g.__romeoBankSeed !== undefined && g.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 30_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__romeoBankSeed!);
    if (!result.ok || result.banked !== 1) fail(`bank message fixture failed: ${JSON.stringify(result)}`);
}

async function regressionScenario(context: BrowserContext, suffix: string): Promise<ScenarioProof> {
    const username = `rj40${suffix}`;
    const page = await newAccount(context, username, { stage: 40, items: ['cadavaberries'] });
    const fixtureStage = await serverStage(page);
    if (fixtureStage !== 40) fail(`stage-40 fixture is ${fixtureStage}`);
    const started = Date.now();
    const firstStep = await startAioQuester(page);
    const expected = 'stage 40: ask the Apothecary for a Cadava potion';
    if (firstStep !== expected) fail(`stage-40 first step is '${firstStep}', expected '${expected}'`);
    console.log(`REGRESSION FIRST-STEP PASS: ${firstStep}`);
    await page.screenshot({ path: REGRESSION_SCREENSHOT, fullPage: true });
    const proof = await waitForComplete(page, username, started);
    proof.name = 'stage-40 regression';
    proof.firstStep = firstStep;
    for (const required of [expected, 'stage 50: exchange Cadava berries with the Apothecary', 'stage 50: deliver the Cadava potion to Juliet', 'stage 60: tell Romeo that Juliet took the potion']) {
        if (!proof.questLogs.includes(`Romeo & Juliet: ${required}`)) {
            fail(`stage-40 run missed '${required}': ${JSON.stringify(proof.questLogs)}`);
        }
    }
    if (proof.questLogs.some(log => log.includes('talk to Father Lawrence') || log.includes('talk to Juliet'))) {
        fail(`old probe-rotation step survived: ${JSON.stringify(proof.questLogs)}`);
    }
    if (proof.finalStage !== 100 || proof.points !== 5) fail(`bad stage-40 completion: ${JSON.stringify(proof)}`);
    await page.close();
    return proof;
}

async function bankedMessageScenario(context: BrowserContext, suffix: string): Promise<ScenarioProof> {
    const username = `rj20${suffix}`;
    const page = await newAccount(context, username, {
        stage: 20,
        items: ['julietmessage'],
        tile: '0,49,53,49,48'
    });
    await seedMessageInBank(page);
    const started = Date.now();
    const firstStep = await startAioQuester(page);
    if (firstStep !== 'withdraw Message×1') fail(`banked-message first step is '${firstStep}'`);
    const deadline = Date.now() + 90_000;
    let state = await snapshot(page);
    while (Date.now() < deadline) {
        state = await snapshot(page);
        if (questLogs(state).includes('Romeo & Juliet: stage 30: ask Father Lawrence for help')) break;
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`banked-message recovery ${state.runner}: ${JSON.stringify(state.logs.slice(-30))}`);
        }
        await page.waitForTimeout(200);
    }
    if (!questLogs(state).includes('Romeo & Juliet: stage 30: ask Father Lawrence for help')) {
        fail(`banked message was not delivered in 90 seconds: ${JSON.stringify(questLogs(state))}`);
    }
    await stopRunner(page);
    const stage = await serverStage(page);
    if (stage !== 30) fail(`banked message recovery ended at stage ${stage}, expected 30`);
    const proof: ScenarioProof = {
        name: 'banked message restart',
        username,
        elapsedMs: Date.now() - started,
        firstStep,
        finalStage: stage,
        points: state.points,
        quest: state.quest,
        questLogs: questLogs(state)
    };
    console.log(`BANKED-MESSAGE PASS: ${firstStep} → stage ${stage}`);
    await page.close();
    return proof;
}

async function fullPackStageSixtyScenario(context: BrowserContext, suffix: string): Promise<ScenarioProof> {
    const username = `rj60${suffix}`;
    const page = await newAccount(context, username, { stage: 60, fullPack: true });
    const seeded = await snapshot(page);
    if (seeded.inventory.length !== 28) fail(`full-pack fixture has ${seeded.inventory.length} slots`);
    const started = Date.now();
    const firstStep = await startAioQuester(page);
    const expected = 'stage 60: tell Romeo that Juliet took the potion';
    if (firstStep !== expected) fail(`full-pack stage-60 first step is '${firstStep}', expected '${expected}'`);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'full-pack stage-60 restart';
    proof.firstStep = firstStep;
    if (proof.questLogs.some(log => log.includes('bank') || log.includes('berries'))) {
        fail(`stage 60 took an obsolete provisioning detour: ${JSON.stringify(proof.questLogs)}`);
    }
    if (proof.finalStage !== 100 || proof.points !== 5) fail(`bad stage-60 completion: ${JSON.stringify(proof)}`);
    console.log(`FULL-PACK STAGE-60 PASS: ${firstStep} → complete`);
    await page.close();
    return proof;
}

async function naturalScenario(context: BrowserContext, suffix: string): Promise<ScenarioProof> {
    const username = `rjfull${suffix}`;
    const page = await newAccount(context, username);
    const fixtureStage = await serverStage(page);
    if (fixtureStage !== 0) fail(`fresh natural fixture is stage ${fixtureStage}`);
    const started = Date.now();
    const firstStep = await startAioQuester(page);
    if (firstStep !== 'stage 0: ask Romeo how to help find Juliet') fail(`natural first step is '${firstStep}'`);
    const proof = await waitForComplete(page, username, started);
    proof.name = 'natural stage-0 quest';
    proof.firstStep = firstStep;
    for (const stage of [0, 10, 20, 30, 40, 50, 60]) {
        if (!proof.questLogs.some(log => log.startsWith(`Romeo & Juliet: stage ${stage}:`))) {
            fail(`natural run never logged stage ${stage}: ${JSON.stringify(proof.questLogs)}`);
        }
    }
    if (proof.finalStage !== 100 || proof.points !== 5) fail(`bad natural completion: ${JSON.stringify(proof)}`);
    await page.screenshot({ path: COMPLETE_SCREENSHOT, fullPage: true });
    console.log(`NATURAL QUEST PASS: stages 0 → 10 → 20 → 30 → 40 → 50 → 60 → 100; QP=${proof.points}`);
    await page.close();
    return proof;
}

async function contentionScenario(context: BrowserContext, suffix: string): Promise<ScenarioProof[]> {
    const fixtures = await Promise.all(
        Array.from({ length: 4 }, async (_, index) => {
            const username = `rjc${index}${suffix}`;
            const page = await newAccount(context, username, {
                stage: 50,
                tile: '0,51,52,8,49'
            });
            return { page, username };
        })
    );
    const started = Date.now();
    const firstSteps = await Promise.all(fixtures.map(({ page }) => startAioQuester(page)));
    const proofs = await Promise.all(
        fixtures.map(async ({ page, username }, index) => {
            const proof = await waitForComplete(page, username, started);
            proof.name = `berry contention client ${index + 1}`;
            proof.firstStep = firstSteps[index];
            if (proof.finalStage !== 100 || proof.points !== 5) fail(`bad contention completion: ${JSON.stringify(proof)}`);
            return proof;
        })
    );
    await fixtures[0].page.screenshot({ path: CONTENTION_SCREENSHOT, fullPage: true });
    console.log(`CONTENTION PASS: all ${proofs.length} simultaneous stage-50 clients completed with only three berry spawns`);
    await Promise.all(fixtures.map(({ page }) => page.close()));
    return proofs;
}

const suffix = Date.now().toString(36).slice(-5);
const bundleSha256 = await attestServedBundle();
const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: !process.env.HEADED,
    slowMo: process.env.HEADED ? Number(process.env.SLOWMO ?? 100) : 0,
    viewport: { width: 1500, height: 1000 }
});

try {
    for (const existing of context.pages()) await existing.close();
    const proofs: ScenarioProof[] = [];
    proofs.push(await regressionScenario(context, suffix));
    proofs.push(await bankedMessageScenario(context, suffix));
    proofs.push(await fullPackStageSixtyScenario(context, suffix));
    proofs.push(await naturalScenario(context, suffix));
    proofs.push(...(await contentionScenario(context, suffix)));
    await Bun.write(
        PROOF_JSON,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                base,
                bundleSha256,
                tickMs: 300,
                result: 'PASS',
                scenarios: proofs
            },
            null,
            2
        ) + '\n'
    );
    console.log(`PASS: ${proofs.length} real-browser scenarios; proof=${PROOF_JSON}`);
    console.log(`screenshots: ${REGRESSION_SCREENSHOT}, ${COMPLETE_SCREENSHOT}, ${CONTENTION_SCREENSHOT}`);
} finally {
    await context.close();
}
