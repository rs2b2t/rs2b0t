import type { Page } from 'playwright-core';

import { launchBrowser, startFromLibrary } from './lib/harness.js';
import {
    cheatQuiet,
    getServerVarQuiet,
    mainlandAccount,
    relog
} from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://127.0.0.1:8950';
const username = process.argv[3] ?? `ttc${Date.now().toString(36).slice(-7)}`;
const budgetMinutes = Number(process.argv[4]) || 10;
const budgetMs = budgetMinutes * 60_000;

const RESCUE_MASK = 0x1f000;
const NATURAL_MECHANISMS = 2208;
const BARREL_ID = 1841;
const ANA_BARREL_ID = 1842;
const SLAVE_OUTFIT_IDS = [1844, 1845, 1846] as const;
const LOWER_CART_ID = 2684;
const START = { x: 3302, z: 9417, level: 0 };
const RETRY_STEP = 'retry the lower mine cart with the empty barrel';
const RECOVERY_SCREENSHOT = 'screenshots/tourist-trap-cart-recovery.png';
const COMPLETE_SCREENSHOT = 'screenshots/tourist-trap-cart-recovery-complete.png';
const PROOF_JSON = 'out/touristtrap-cart-recovery-proof.json';

type Tile = { x: number; z: number; level: number };
type Item = { id: number; name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };

interface Snapshot {
    tile: Tile | null;
    inventory: Item[];
    worn: Item[];
    agility: number;
    hitpoints: number;
    quest: string;
    runner: string;
    step: string | null;
    logs: LogLine[];
    chat: string[];
}

interface SeederResult {
    ok: boolean;
    failed: boolean;
    beforeHp: number;
    afterHp: number;
    tile: Tile | null;
    error?: string;
}

interface BrowserGlobal {
    __rs2b0t: {
        ChatDialog: {
            canContinue(): boolean;
            continue(): Promise<boolean>;
            isOpen(): boolean;
            options(): string[];
            chooseOption(text: string): Promise<boolean>;
        };
        Equipment: {
            contains(name: string): boolean;
            equip(name: string): Promise<boolean>;
            items(): Item[];
        };
        Execution: {
            delayTicks(ticks: number): Promise<void>;
            delayUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean>;
        };
        Inventory: { items(): Item[] };
        Locs: {
            query(): {
                where(predicate: (loc: { id: number }) => boolean): {
                    action(name: string): {
                        within(distance: number): {
                            nearest(): { interact(action: string): boolean | Promise<boolean> } | null;
                        };
                    };
                };
            };
        };
        LoopingBot: new () => { loop(): number | void | Promise<number | void> };
        Quests: { status(name: string): string };
        Skills: { effective(name: string): number; level(name: string): number };
        reader: {
            chat(count: number): { text: string }[];
            locs(): { id: number; ops: (string | null)[]; tile: Tile }[];
            varp(id: number): number;
            worldTile(): Tile | null;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        client: { tutComMessage: string | null };
        paint: { set(key: string, value: string): void };
        registry: { get(name: string): unknown };
        runner: {
            state: string;
            bot: { stepDesc?: string } | null;
            ctx: { log: LogLine[] } | null;
            start(meta: unknown): void;
            stop(): void;
        };
    };
    __touristCartEquip?: { ok: boolean; error?: string };
    __touristCartSeedMeta?: unknown;
    __touristCartSeedResult?: SeederResult;
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function count(items: readonly Item[], id: number): number {
    return items.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function area(tile: Tile | null): string {
    if (!tile) return 'unknown';
    if (tile.level === 0 && tile.x >= 3264 && tile.x <= 3327 && tile.z >= 9408 && tile.z <= 9471) {
        if (tile.x <= 3282) return 'mineEntrance';
        if (tile.x >= 3285 && tile.x <= 3292 && tile.z >= 9429 && tile.z <= 9452) return 'undergroundJail';
        if (tile.x >= 3315 || tile.z >= 9428) return 'mineDeep';
        return 'mineLower';
    }
    if (tile.x >= 3274 && tile.x <= 3306 && tile.z >= 3011 && tile.z <= 3043) return 'campSurface';
    if (tile.level === 0 && tile.z < 3117) return 'desert';
    if (tile.level === 0) return 'mainland';
    return 'unknown';
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value))) fail(`could not send ::${value}`);
    if (waitMs > 700) await page.waitForTimeout(waitMs - 700);
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            inventory: g.__rs2b0t.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            worn: g.__rs2b0t.Equipment.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            agility: g.__rs2b0t.Skills.level('agility'),
            hitpoints: g.__rs2b0t.Skills.effective('hitpoints'),
            quest: g.__rs2b0t.Quests.status('The Tourist Trap'),
            runner: g.rs2b0t.runner.state,
            step: g.rs2b0t.runner.bot?.stepDesc ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-500),
            chat: g.__rs2b0t.reader.chat(40).map(line => line.text)
        };
    });
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

async function serverRescueState(page: Page): Promise<{ stage: number; mechanisms: number }> {
    const stage = await getServerVarQuiet(page, 'desertrescue');
    const mechanisms = await getServerVarQuiet(page, 'desertrescue_map_mechanisms');
    await dismissDebugOverlay(page);
    if (stage === null || mechanisms === null) {
        fail(`server did not report rescue state: stage=${stage}, mechanisms=${mechanisms}`);
    }
    return { stage, mechanisms };
}

async function equipSlaveOutfit(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class EquipFixture extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    for (const name of [
                        'Slaves\' shirt',
                        'Slave robe',
                        'Slave boots'
                    ]) {
                        if (!api.Equipment.contains(name) && !(await api.Equipment.equip(name))) {
                            throw new Error(`could not wear ${name}`);
                        }
                    }
                    g.__touristCartEquip = { ok: true };
                } catch (error) {
                    g.__touristCartEquip = { ok: false, error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.__touristCartEquip = undefined;
        const meta = api.registerScript({ name: 'TouristCartEquipFixture', create: () => new EquipFixture() });
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(
        () => {
            const g = globalThis as never as BrowserGlobal;
            return g.__touristCartEquip !== undefined && g.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 20_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__touristCartEquip!);
    if (!result.ok) fail(result.error ?? 'slave outfit equip failed');
}

async function installFailureSeeder(page: Page): Promise<void> {
    await page.evaluate(cartId => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        class CartFailureSeeder extends api.LoopingBot {
            override async loop(): Promise<void> {
                const beforeHp = api.Skills.effective('hitpoints');
                try {
                    const cart = api.Locs.query()
                        .where(loc => loc.id === cartId)
                        .action('Search')
                        .within(4)
                        .nearest();
                    if (!cart) throw new Error('lower mine cart is not loaded');
                    if (!(await cart.interact('Search'))) throw new Error('lower mine cart rejected Search');
                    if (!(await api.Execution.delayUntil(
                        () => api.ChatDialog.isOpen() || api.ChatDialog.canContinue(),
                        8000
                    ))) throw new Error('mine-cart dialogue did not open');

                    for (let tick = 0; tick < 80; tick++) {
                        if (api.ChatDialog.canContinue()) {
                            if (!(await api.ChatDialog.continue())) throw new Error('mine-cart continue failed');
                            await api.Execution.delayTicks(1);
                            continue;
                        }
                        const options = api.ChatDialog.options();
                        if (options.length > 0) {
                            const yes = options.find(option => option.trim().toLowerCase() === 'yes, of course.');
                            if (!yes) throw new Error(`unexpected mine-cart options: ${options.join(' | ')}`);
                            if (!(await api.ChatDialog.chooseOption(yes))) throw new Error('mine-cart choice failed');
                            await api.Execution.delayTicks(1);
                            continue;
                        }
                        if (!api.ChatDialog.isOpen()) break;
                        await api.Execution.delayTicks(1);
                    }

                    await api.Execution.delayUntil(() => {
                        const tile = api.reader.worldTile();
                        return api.Skills.effective('hitpoints') < beforeHp || (tile !== null && (tile.x >= 3315 || tile.z >= 9428));
                    }, 8000);
                    const afterHp = api.Skills.effective('hitpoints');
                    const tile = api.reader.worldTile();
                    g.__touristCartSeedResult = {
                        ok: true,
                        failed: afterHp < beforeHp,
                        beforeHp,
                        afterHp,
                        tile
                    };
                } catch (error) {
                    g.__touristCartSeedResult = {
                        ok: false,
                        failed: false,
                        beforeHp,
                        afterHp: api.Skills.effective('hitpoints'),
                        tile: api.reader.worldTile(),
                        error: String(error)
                    };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.__touristCartSeedMeta = api.registerScript({
            name: 'TouristCartFailureSeeder',
            create: () => new CartFailureSeeder()
        });
    }, LOWER_CART_ID);
}

async function seedRealCartFailure(page: Page): Promise<SeederResult[]> {
    await installFailureSeeder(page);
    const attempts: SeederResult[] = [];
    for (let attempt = 1; attempt <= 10; attempt++) {
        await command(page, 'setstat hitpoints 99');
        await command(page, 'tele 0,51,147,38,9', 1400);
        await page.waitForFunction(
            start => {
                const g = globalThis as never as BrowserGlobal;
                const tile = g.__rs2b0t.reader.worldTile();
                return tile?.x === start.x && tile.z === start.z && tile.level === start.level
                    && g.__rs2b0t.reader.locs().some(loc => loc.id === 2684 && loc.ops.some(op => op === 'Search'));
            },
            START,
            { timeout: 15_000 }
        );
        await dismissDebugOverlay(page);
        await page.evaluate(() => {
            const g = globalThis as never as BrowserGlobal;
            g.__touristCartSeedResult = undefined;
            g.rs2b0t.runner.start(g.__touristCartSeedMeta);
        });
        await page.waitForFunction(
            () => {
                const g = globalThis as never as BrowserGlobal;
                return g.__touristCartSeedResult !== undefined && g.rs2b0t.runner.state === 'stopped';
            },
            undefined,
            { timeout: 30_000 }
        );
        const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__touristCartSeedResult!);
        attempts.push(result);
        console.log(`failure seed ${attempt}: ${JSON.stringify(result)}`);
        if (!result.ok) fail(result.error ?? 'cart failure seeder failed');
        if (result.failed) return attempts;
    }
    fail('ten real level-1 cart rolls all succeeded; could not materialize a natural failure');
}

async function prepareFixture(page: Page): Promise<SeederResult[]> {
    await mainlandAccount(page, base, username);
    await command(page, 'speed 300');
    await command(page, 'setstat agility 1');
    await command(page, 'setstat hitpoints 99');
    await command(page, 'setstat defence 99');
    await command(page, 'setstat fletching 10');
    await command(page, 'setstat smithing 20');
    await command(page, 'setvar desertrescue 19');
    await command(page, `setvar desertrescue_map_mechanisms ${NATURAL_MECHANISMS}`);
    await command(page, 'give thminebarrel_empty 1');
    await command(page, 'give slave_shirt 1');
    await command(page, 'give slave_robe 1');
    await command(page, 'give slave_boots 1');
    await command(page, 'give coins 606');
    await command(page, 'tele 0,51,147,38,9', 1400);

    const seededServer = await serverRescueState(page);
    if (seededServer.stage !== 19 || seededServer.mechanisms !== NATURAL_MECHANISMS) {
        fail(`server fixture did not stick: ${JSON.stringify(seededServer)}`);
    }

    // The journal/sidebar derives quest status during login.
    await relog(page, username);
    await page.waitForFunction(
        start => {
            const tile = (globalThis as never as BrowserGlobal).__rs2b0t.reader.worldTile();
            return tile?.x === start.x && tile.z === start.z && tile.level === start.level;
        },
        START,
        { timeout: 15_000 }
    );
    await dismissDebugOverlay(page);
    await equipSlaveOutfit(page);

    const reloggedServer = await serverRescueState(page);
    if (reloggedServer.stage !== 19 || reloggedServer.mechanisms !== NATURAL_MECHANISMS) {
        fail(`server fixture did not survive relog: ${JSON.stringify(reloggedServer)}`);
    }
    const equipped = await snapshot(page);
    if (equipped.quest !== 'inProgress') fail(`Tourist Trap journal is ${equipped.quest}, expected inProgress`);
    if (equipped.agility !== 1) fail(`Agility is ${equipped.agility}, expected 1`);
    if (count(equipped.inventory, BARREL_ID) !== 1 || count(equipped.inventory, ANA_BARREL_ID) !== 0) {
        fail(`wrong rescue items: ${JSON.stringify(equipped.inventory)}`);
    }
    for (const id of SLAVE_OUTFIT_IDS) {
        if (count(equipped.worn, id) !== 1) fail(`slave outfit item ${id} is not worn`);
    }

    const attempts = await seedRealCartFailure(page);
    const failed = await snapshot(page);
    if (area(failed.tile) !== 'mineLower' || failed.hitpoints !== 97) {
        fail(`natural cart failure did not leave the lower-mine/97hp state: ${JSON.stringify(failed)}`);
    }
    if (count(failed.inventory, BARREL_ID) !== 1) {
        fail(`natural cart failure consumed the ordinary Barrel: ${JSON.stringify(failed)}`);
    }
    if (!failed.chat.some(line => line.includes('You fail to fit yourself into the cart'))) {
        fail(`server failure message missing from chat: ${JSON.stringify(failed.chat)}`);
    }
    const failedServer = await serverRescueState(page);
    if (failedServer.stage !== 19 || failedServer.mechanisms !== NATURAL_MECHANISMS) {
        fail(`natural cart failure mutated the recovery oracle: ${JSON.stringify(failedServer)}`);
    }
    console.log('PRECONDITION PASS: observed a real failed cart roll and retained stage 19 + ordinary Barrel in the lower mine');
    return attempts;
}

async function startAioQuester(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'desertrescue');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', '');
        g.rs2b0t.paint.set('tabs:aio', 'Current');
    });
    // Select and start through the real BotPanel so its live-log subscription is part of the
    // proof too. Direct ScriptRunner.start() bypasses that UI-only subscription.
    await startFromLibrary(page, 'Quest', 'AIOQuester');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.waitForFunction(
        wanted => (globalThis as never as BrowserGlobal).rs2b0t.runner.bot?.stepDesc === wanted,
        RETRY_STEP,
        { timeout: 20_000 }
    );
}

async function validateRecovery(page: Page, seedAttempts: SeederResult[]): Promise<void> {
    await startAioQuester(page);
    let current = await snapshot(page);
    if (current.step !== RETRY_STEP) fail(`first AIO step is '${current.step}', expected '${RETRY_STEP}'`);
    if (current.logs.some(line => line.msg.includes('resolve the lower barrel/lift checkpoint'))) {
        fail('old lower barrel/lift detour was selected');
    }
    console.log(`FIRST-STEP PASS: ${current.step}`);
    await page.screenshot({ path: RECOVERY_SCREENSHOT, fullPage: true });

    const started = Date.now();
    const deadline = started + budgetMs;
    const timeline: { elapsedMs: number; tile: Tile | null; area: string; barrel: number; ana: number; step: string | null }[] = [];
    let anaSeen = false;
    let seenLogTime = 0;

    while (Date.now() < deadline) {
        await page.waitForTimeout(200);
        current = await snapshot(page);
        const here = area(current.tile);
        const barrel = count(current.inventory, BARREL_ID);
        const ana = count(current.inventory, ANA_BARREL_ID);
        timeline.push({
            elapsedMs: Date.now() - started,
            tile: current.tile,
            area: here,
            barrel,
            ana,
            step: current.step
        });

        for (const line of current.logs) {
            if (line.time > seenLogTime) console.log(`  [${line.level}] ${line.msg}`);
        }
        if (current.logs.length > 0) seenLogTime = Math.max(seenLogTime, ...current.logs.map(line => line.time));

        if (!anaSeen) {
            if (!['mineLower', 'mineDeep'].includes(here)) {
                fail(`failed-cart recovery detoured through ${here} before catching Ana: ${JSON.stringify(current.tile)}`);
            }
            if (ana > 0) {
                anaSeen = true;
                if (here !== 'mineDeep' || barrel !== 0) {
                    fail(`Ana recovery oracle is wrong: ${JSON.stringify({ here, barrel, ana })}`);
                }
                console.log(`RECOVERY PASS: ordinary Barrel -> Ana in a barrel at ${JSON.stringify(current.tile)} without leaving the mine route`);
                await page.screenshot({ path: RECOVERY_SCREENSHOT, fullPage: true });
            }
        }

        if (current.quest === 'complete' && current.runner === 'stopped') {
            const messages = current.logs.map(line => line.msg);
            if (!anaSeen) fail('quest completed without observing the repaired Ana recovery transition');
            if (!messages.some(message => message.includes('mine-cart attempt: lower mine -> deep mine'))) {
                fail('mine-cart attempt diagnostic was not emitted');
            }
            if (!messages.some(message => message.includes('mine-cart transit reached the deep mine'))) {
                fail('mine-cart success diagnostic was not emitted');
            }
            if (!messages.some(message => message.includes('lift checkpoint:'))) {
                fail('lift checkpoint diagnostics were not emitted');
            }
            if (!messages.some(message => message.includes('surface cart:'))) {
                fail('surface cart diagnostics were not emitted');
            }
            const finalServer = await serverRescueState(page);
            if (finalServer.stage !== 30 || (finalServer.mechanisms & RESCUE_MASK) !== 0) {
                fail(`quest completed with wrong server rescue state: ${JSON.stringify(finalServer)}`);
            }
            await page.waitForTimeout(500);
            await page.screenshot({ path: COMPLETE_SCREENSHOT, fullPage: true });
            await Bun.write(PROOF_JSON, JSON.stringify({
                base,
                username,
                seedAttempts,
                expectedFirstStep: RETRY_STEP,
                timeline,
                finalServer,
                final: current
            }, null, 2));
            console.log(
                'PASS: real failed cart -> in-place retry -> Ana recovered -> Tourist Trap complete in '
                + `${Math.round((Date.now() - started) / 1000)}s with a clean runner stop`
            );
            console.log(`proof: ${PROOF_JSON}; screenshots: ${RECOVERY_SCREENSHOT}, ${COMPLETE_SCREENSHOT}`);
            return;
        }
        if (current.runner === 'crashed' || (current.runner === 'stopped' && current.quest !== 'complete')) {
            fail(`AIOQuester ${current.runner} before completion; logs=${JSON.stringify(current.logs.slice(-20))}`);
        }
    }

    await Bun.write(PROOF_JSON, JSON.stringify({ base, username, seedAttempts, timeline, final: current }, null, 2));
    fail(`Tourist Trap did not complete within ${budgetMinutes} minutes; final=${JSON.stringify(current)}`);
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', error => console.error(`PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));
    page.on('console', message => {
        if (message.type() === 'error') console.error(`CONSOLE: ${message.text()}`);
    });
    const seedAttempts = await prepareFixture(page);
    await validateRecovery(page, seedAttempts);
} finally {
    await browser.close();
}
