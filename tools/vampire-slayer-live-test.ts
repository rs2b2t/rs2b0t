import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    startScript
} from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:9020';
const mode = process.argv[3] ?? 'staged';
const username = process.argv[4] ?? (mode === 'full' ? 'v148full' : 'v148stage');
const budgetMinutes = Number(process.argv[5]) || (mode === 'full' ? 45 : 35);
const budgetMs = budgetMinutes * 60_000;

const START_LEVELS: Record<string, number> = {
    attack: 10,
    defence: 1,
    strength: 10,
    hitpoints: 10,
    ranged: 1,
    prayer: 1,
    magic: 1,
    cooking: 1,
    woodcutting: 1,
    fletching: 1,
    fishing: 1,
    firemaking: 1,
    crafting: 1,
    smithing: 1,
    mining: 1,
    herblore: 1,
    agility: 1,
    thieving: 1,
    runecraft: 1
};

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

type Item = { name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };
type Snapshot = {
    tile: { x: number; z: number; level: number } | null;
    inventory: Item[];
    worn: Item[];
    skills: Record<string, number>;
    quest: string;
    points: number;
    runner: string;
    logs: LogLine[];
};

type BrowserGlobal = {
    __rs2b0t: {
        Bank: {
            isOpen(): boolean;
            loaded(): boolean;
            count(name: string): number;
            items(): Item[];
            openNearest(name: string, op: string): Promise<boolean>;
            depositInventory(): Promise<void>;
            close(): Promise<boolean>;
        };
        Equipment: { items(): Item[] };
        Game: { openSideTab(tab: number): Promise<boolean> };
        Inventory: { count(name: string): number; items(): Item[]; used(): number };
        Quests: { status(name: string): string; points(): number };
        Skills: { level(name: string): number };
        LoopingBot: new () => { loop(): number | void | Promise<number | void> };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx: { log: LogLine[] } | null;
            start(meta: unknown): void;
            stop(): void;
        };
    };
    __issue148Prep?: { opened: boolean; bank: number; inv: number; names: string[]; error?: string };
    __issue148Tab?: { tab: number; opened: boolean; error?: string };
};

const count = (items: Item[], name: string): number => items
    .filter(item => item.name?.toLowerCase() === name.toLowerCase())
    .reduce((sum, item) => sum + item.count, 0);

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            inventory: g.__rs2b0t.Inventory.items().map(item => ({ name: item.name, count: item.count })),
            worn: g.__rs2b0t.Equipment.items().map(item => ({ name: item.name, count: item.count })),
            skills: {
                attack: g.__rs2b0t.Skills.level('attack'),
                defence: g.__rs2b0t.Skills.level('defence'),
                strength: g.__rs2b0t.Skills.level('strength'),
                hitpoints: g.__rs2b0t.Skills.level('hitpoints'),
                ranged: g.__rs2b0t.Skills.level('ranged'),
                prayer: g.__rs2b0t.Skills.level('prayer'),
                magic: g.__rs2b0t.Skills.level('magic'),
                cooking: g.__rs2b0t.Skills.level('cooking'),
                woodcutting: g.__rs2b0t.Skills.level('woodcutting'),
                fletching: g.__rs2b0t.Skills.level('fletching'),
                fishing: g.__rs2b0t.Skills.level('fishing'),
                firemaking: g.__rs2b0t.Skills.level('firemaking'),
                crafting: g.__rs2b0t.Skills.level('crafting'),
                smithing: g.__rs2b0t.Skills.level('smithing'),
                mining: g.__rs2b0t.Skills.level('mining'),
                herblore: g.__rs2b0t.Skills.level('herblore'),
                agility: g.__rs2b0t.Skills.level('agility'),
                thieving: g.__rs2b0t.Skills.level('thieving'),
                runecraft: g.__rs2b0t.Skills.level('runecraft')
            },
            quest: g.__rs2b0t.Quests.status('Vampire Slayer'),
            points: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-100)
        };
    });
}

async function stop(page: Page): Promise<void> {
    await page.evaluate(() => {
        const runner = (globalThis as never as BrowserGlobal).rs2b0t.runner;
        if (runner.state !== 'stopped') runner.stop();
    });
    await page.waitForFunction(
        () => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'stopped',
        undefined,
        { timeout: 15_000 }
    ).catch(() => undefined);
}

async function showSideTab(page: Page, tab: number): Promise<void> {
    await page.evaluate(wantedTab => {
        const g = globalThis as never as BrowserGlobal;
        const abi = g.__rs2b0t;
        class TabPrep extends abi.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    g.__issue148Tab = { tab: wantedTab, opened: await abi.Game.openSideTab(wantedTab) };
                } catch (error) {
                    g.__issue148Tab = { tab: wantedTab, opened: false, error: String(error) };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.__issue148Tab = undefined;
        const meta = abi.registerScript({ name: `Issue148Tab${wantedTab}`, create: () => new TabPrep() });
        g.rs2b0t.runner.start(meta);
    }, tab);
    await page.waitForFunction(
        wantedTab => {
            const g = globalThis as never as BrowserGlobal;
            return g.__issue148Tab?.tab === wantedTab && g.rs2b0t.runner.state === 'stopped';
        },
        tab,
        { timeout: 15_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__issue148Tab!);
    if (!result.opened) fail(`could not open side tab ${tab}: ${result.error ?? 'unknown error'}`);
}

async function send(page: Page, command: string, settleMs = 900): Promise<void> {
    if (!(await cheatQuiet(page, command))) fail(`could not send '${command}'`);
    await page.waitForTimeout(settleMs);
}

async function waitTile(page: Page, x: number, z: number, level = 0): Promise<void> {
    await page.waitForFunction(
        ([wantX, wantZ, wantLevel]) => {
            const tile = (globalThis as never as BrowserGlobal).__rs2b0t.reader.worldTile();
            return tile?.x === wantX && tile.z === wantZ && tile.level === wantLevel;
        },
        [x, z, level],
        { timeout: 15_000 }
    );
}

async function tele(page: Page, command: string, x: number, z: number, level = 0): Promise<void> {
    await send(page, `tele ${command}`);
    await waitTile(page, x, z, level);
    await page.waitForTimeout(1_500);
}

async function clearAccountItems(page: Page): Promise<void> {
    await send(page, '~clearinv inv');
    await send(page, '~clearinv worn');
    await send(page, '~clearbank');
    const state = await snapshot(page);
    if (state.inventory.length !== 0 || state.worn.length !== 0) {
        fail(`clear inventory failed: inv=${JSON.stringify(state.inventory)} worn=${JSON.stringify(state.worn)}`);
    }
}

async function give(page: Page, objectName: string, quantity = 1, displayName = objectName): Promise<void> {
    for (let attempt = 1; attempt <= 5; attempt++) {
        await send(page, `give ${objectName} ${quantity}`);
        const have = await page.evaluate(name =>
            (globalThis as never as BrowserGlobal).__rs2b0t.Inventory.count(name), displayName);
        if (have >= quantity) return;
        await page.waitForTimeout(attempt * 500);
    }
    fail(`could not seed ${quantity} x ${displayName}`);
}

async function makeExactBank(page: Page): Promise<void> {
    await give(page, 'coins', 2_000_000, 'Coins');
    await tele(page, '0,48,50,21,43', 3093, 3243);
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        const abi = g.__rs2b0t;
        class BankPrep extends abi.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    const opened = await abi.Bank.openNearest('Bank booth', 'Use-quickly');
                    if (!opened) {
                        g.__issue148Prep = {
                            opened,
                            bank: -1,
                            inv: abi.Inventory.count('Coins'),
                            names: []
                        };
                        return;
                    }
                    await abi.Bank.depositInventory();
                    await new Promise(resolve => setTimeout(resolve, 1_500));
                    g.__issue148Prep = {
                        opened,
                        bank: abi.Bank.count('Coins'),
                        inv: abi.Inventory.count('Coins'),
                        names: abi.Bank.items().map(item => item.name ?? '#unknown').sort()
                    };
                    await abi.Bank.close();
                } catch (error) {
                    g.__issue148Prep = {
                        opened: false,
                        bank: -1,
                        inv: abi.Inventory.count('Coins'),
                        names: [],
                        error: String(error)
                    };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        const meta = abi.registerScript({ name: 'Issue148BankPrep', create: () => new BankPrep() });
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(
        () => {
            const g = globalThis as never as BrowserGlobal;
            return g.__issue148Prep !== undefined && g.rs2b0t.runner.state === 'stopped';
        },
        undefined,
        { timeout: 30_000 }
    );
    const result = await page.evaluate(() => (globalThis as never as BrowserGlobal).__issue148Prep!);
    if (!result.opened || result.bank !== 2_000_000 || result.inv !== 0 || result.names.some(name => name !== 'Coins')) {
        fail(`exact bank setup failed: ${JSON.stringify(result)}`);
    }
}

async function setStartingLevels(page: Page): Promise<void> {
    await send(page, 'minme', 1_500);
    await send(page, 'setstat attack 10', 1_500);
    await send(page, 'setstat strength 10', 1_500);
    await page.waitForFunction(
        (expected: Record<string, number>) => {
            const skills = (globalThis as never as BrowserGlobal).__rs2b0t.Skills;
            return Object.entries(expected).every(([name, level]) => skills.level(name) === level);
        },
        START_LEVELS,
        { timeout: 15_000 }
    );
}

async function setQuestStage(page: Page, stage: number, refreshJournal: boolean): Promise<void> {
    await send(page, `setvar vampire ${stage}`);
    const actual = await getServerVarQuiet(page, 'vampire');
    if (actual !== stage) fail(`server vampire stage is ${actual}, expected ${stage}`);
    if (refreshJournal) await relog(page, username);
}

async function prepare(page: Page, stage: number, startAtLumbridge: boolean): Promise<void> {
    await mainlandAccount(page, base, username);
    await stop(page);
    await clearAccountItems(page);
    await makeExactBank(page);
    await setQuestStage(page, stage, stage !== 0);
    await setStartingLevels(page);
    if (startAtLumbridge) {
        await tele(page, '0,50,50,20,20', 3220, 3220);
    } else {
        await tele(page, '0,48,51,26,4', 3098, 3268);
    }

    const state = await snapshot(page);
    if (state.inventory.length !== 0 || state.worn.length !== 0) fail('starting pack or equipment is not empty');
    const wrongSkills = Object.entries(START_LEVELS)
        .filter(([name, level]) => state.skills[name] !== level)
        .map(([name, level]) => `${name}=${state.skills[name]} (expected ${level})`);
    if (wrongSkills.length > 0) fail(`wrong starting stats: ${wrongSkills.join(', ')}`);
    const expectedQuest = stage === 0 ? 'notStarted' : 'inProgress';
    if (state.quest !== expectedQuest) fail(`quest journal is ${state.quest}, expected ${expectedQuest}`);

    console.log(
        `PRECONDITION PASS: ${state.tile?.x},${state.tile?.z},${state.tile?.level}; empty inventory/equipment; ` +
        'bank=2,000,000 coins only; attack/strength=10; defence=1; hitpoints=10; other skills=1; ' +
        `journal=${state.quest}`
    );
}

async function start(page: Page): Promise<void> {
    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'vampire');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', '');
    });
    await startScript(page, 'AIOQuester');
    await page.waitForFunction(
        () => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'running',
        undefined,
        { timeout: 15_000 }
    );
}

async function run(page: Page): Promise<void> {
    await start(page);
    const started = Date.now();
    const deadline = started + budgetMs;
    let seen = 0;
    let lastReport = 0;
    const milestones = new Set<string>();
    let runtimeShot = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(2_000);
        const state = await snapshot(page);
        const allLogs = await page.evaluate(() =>
            (globalThis as never as BrowserGlobal).rs2b0t.runner.ctx?.log ?? []);
        for (const line of allLogs.slice(seen)) {
            console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${line.level}: ${line.msg}`);
        }
        seen = allLogs.length;

        const logText = allLogs.map(line => line.msg).join('\n').toLowerCase();
        const mark = (name: string, condition: boolean): void => {
            if (condition && !milestones.has(name)) {
                milestones.add(name);
                console.log(`MILESTONE PASS: ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
            }
        };

        mark('bank state scanned', logText.includes('check the bank'));
        mark('Morgan dialogue completed', mode === 'full' && state.quest !== 'notStarted');
        mark(
            'garlic cupboard completed',
            count(state.inventory, 'Garlic') > 0 || logText.includes("leave morgan's upper floor")
        );
        mark(
            'Dr Harlow stage reached',
            logText.includes('buy dr harlow a beer') || logText.includes('withdraw coins×')
        );
        mark('beer purchase completed', count(state.inventory, 'Beer') > 0 || count(state.inventory, 'Stake') > 0);
        mark('stake acquired', count(state.inventory, 'Stake') > 0);
        mark('hammer acquired', count(state.inventory, 'Hammer') > 0);
        mark(
            'weapon acquired and equipped',
            state.worn.some(item => /sword/i.test(item.name ?? ''))
        );
        mark(
            'twenty food acquired',
            count(state.inventory, 'Kebab') + count(state.inventory, 'Trout') >= 20
        );
        mark('crypt entered', (state.tile?.z ?? 0) > 9000);
        mark('Count Draynor engaged', logText.includes('defeat count draynor'));

        if (!runtimeShot && (state.tile?.z ?? 0) > 9000 && state.runner === 'running') {
            await page.screenshot({ path: 'screenshots/issue148-vampire-running.png', fullPage: true });
            runtimeShot = true;
            console.log('SCREENSHOT: screenshots/issue148-vampire-running.png');
        }

        if (Date.now() - lastReport >= 10_000) {
            lastReport = Date.now();
            const inv = state.inventory.map(item => `${item.name}×${item.count}`).join(', ') || 'empty';
            console.log(
                `STATE ${Math.round((Date.now() - started) / 1000)}s: tile=${state.tile?.x},${state.tile?.z},${state.tile?.level} ` +
                `quest=${state.quest} qp=${state.points} runner=${state.runner} inv=[${inv}]`
            );
        }

        if (state.quest === 'complete') {
            mark('Vampire Slayer complete', true);
            await page.waitForTimeout(2_000);
            await page.screenshot({ path: 'screenshots/issue148-vampire-complete.png', fullPage: true });
            const final = await snapshot(page);
            if (final.runner === 'crashed') fail('runner crashed after completion');
            console.log(
                `PASS: Vampire Slayer complete in ${Math.round((Date.now() - started) / 1000)}s; ` +
                `QP=${final.points}; milestones=${[...milestones].join(' | ')}`
            );
            return;
        }
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`runner ${state.runner} before completion; last logs=${JSON.stringify(state.logs.slice(-12))}`);
        }
    }

    const final = await snapshot(page);
    fail(`quest incomplete after ${budgetMinutes} minutes: ${JSON.stringify(final)}`);
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', error => console.error(`PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));
    page.on('response', response => {
        if (response.status() >= 400) console.error(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('console', message => {
        if (message.type() === 'error') console.error(`CONSOLE: ${message.text()}`);
    });

    try {
        await prepare(page, mode === 'full' ? 0 : 1, mode === 'full');
    } catch (error) {
        const diagnostic = await page.evaluate(() => {
            const g = globalThis as unknown as Record<string, unknown> & {
                rs2b0t?: { client?: Record<string, unknown> & { constructor?: Record<string, unknown> } };
            };
            const client = g.rs2b0t?.client;
            return {
                body: document.body.innerText.slice(-2_000),
                clientKeys: client ? Object.keys(client).slice(0, 100) : [],
                loopCycle: client?.constructor?.loopCycle,
                sceneState: client?.sceneState,
                titleScreenState: client?.titleScreenState,
                loadingText: client?.loadingText,
                loadingPercent: client?.loadingPercent,
                errorStarted: client?.errorStarted,
                errorLoading: client?.errorLoading,
                errorHost: client?.errorHost
            };
        }).catch(inner => ({ diagnosticFailed: String(inner) }));
        console.error(`BOOT DIAGNOSTIC: ${JSON.stringify(diagnostic)}`);
        await page.screenshot({ path: 'screenshots/issue148-boot-failure.png', fullPage: true }).catch(() => undefined);
        throw error;
    }
    await page.screenshot({ path: `screenshots/issue148-vampire-${mode}-start.png`, fullPage: true });
    await showSideTab(page, 1);
    await page.screenshot({ path: 'screenshots/issue148-vampire-stats-start.png', fullPage: true });
    await showSideTab(page, 3);
    await run(page);
} finally {
    await browser.close();
}
