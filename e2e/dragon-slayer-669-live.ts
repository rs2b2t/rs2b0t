import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { reader } from '../src/bot/adapter/ClientAdapter.js';
import type { ScriptContext } from '../src/bot/runtime/ScriptContext.js';
import type AIOQuester from '../src/bot/scripts/AIOQuester/AIOQuester.js';
import { deployIsolatedClient, launchBrowser, logout, parseArgs, requireSim, setSettings, stopScript } from './lib/harness.js';
import {
    cheatQuiet, clearChatDialogs, getServerVarQuiet, mainlandAccount, relog,
    seedItemsToBank, startScript, type BankSeedItem
} from './tutorial/harness.js';

declare global {
    var rs2b0t: { readonly reader: typeof reader; readonly runner: {
        readonly bot: AIOQuester | null; readonly state: string; readonly ctx: ScriptContext | null
    } };
    var __rs2b0t: { readonly Inventory: typeof Inventory; readonly Skills: typeof Skills };
    var __seedBank: { readonly banked: Readonly<Record<string, number>> } | undefined;
}

const BANK = { x: 3013, z: 3355, level: 0 } as const;
const QP = [
    ['arthur', 7], ['goblinquest', 6], ['rjquest', 100], ['haunted', 3], ['druidquest', 4],
    ['princequest', 110], ['demonstart', 30], ['vampire', 3], ['spy', 4]
] as const;
const ORACLE_SEED: readonly BankSeedItem[] = [
    { debugName: 'melzarkey', displayName: 'Maze key', qty: 1 },
    { debugName: 'mappart1', displayName: 'Map part', qty: 1 },
    { debugName: 'lobster_pot', displayName: 'Lobster pot', qty: 1 },
    { debugName: 'wizards_mind_bomb', displayName: "Wizard's mind bomb", qty: 1 },
    { debugName: 'silk', displayName: 'Silk', qty: 1 }
];
const HULL_SEED: readonly BankSeedItem[] = [
    { debugName: 'dragonmap', displayName: 'Crandor map', qty: 1 },
    { debugName: 'hammer', displayName: 'Hammer', qty: 1 },
    { debugName: 'woodplank', displayName: 'Plank', qty: 3 }
];
type Outcome =
    | { readonly kind: 'item'; readonly id: number; readonly qty: number }
    | { readonly kind: 'blocked'; readonly id: number; readonly skill: string };
type Scenario = {
    readonly name: string;
    readonly stage: 2 | 3;
    readonly crafting: number;
    readonly smithing: number;
    readonly bank: readonly BankSeedItem[];
    readonly give: readonly string[];
    readonly outcome: Outcome;
};
const SCENARIOS: readonly Scenario[] = [
    { name: 'crafting7-blocked', stage: 2, crafting: 7, smithing: 1, bank: ORACLE_SEED,
        give: ['softclay 1'], outcome: { kind: 'blocked', id: 1791, skill: 'Crafting 8' } },
    { name: 'crafting8-production', stage: 2, crafting: 8, smithing: 1, bank: ORACLE_SEED,
        give: ['softclay 1'], outcome: { kind: 'item', id: 1791, qty: 1 } },
    { name: 'banked-bowl-low-skills', stage: 2, crafting: 1, smithing: 1,
        bank: [...ORACLE_SEED, { debugName: 'bowl_unfired', displayName: 'Unfired bowl', qty: 1 }],
        give: [], outcome: { kind: 'item', id: 1791, qty: 1 } },
    { name: 'smithing33-blocked', stage: 3, crafting: 1, smithing: 33, bank: HULL_SEED,
        give: ['steel_bar 6'], outcome: { kind: 'blocked', id: 1539, skill: 'Smithing 34' } },
    { name: 'banked-nails-low-skills', stage: 3, crafting: 1, smithing: 1,
        bank: [...HULL_SEED, { debugName: 'nails', displayName: 'Nails', qty: 12 }],
        give: [], outcome: { kind: 'item', id: 1539, qty: 12 } }
];

async function seed(page: Page, scenario: Scenario, user: string): Promise<void> {
    for (const command of [
        ...QP.map(([name, value]) => `setvar ${name} ${value}`),
        `setvar dragonquest ${scenario.stage}`, 'setvar dragonquestvar 0',
        'setvar dragon_oracle 2', 'setvar dragon_shield 1', 'setvar dragon_goblin 1',
        `setstat crafting ${scenario.crafting}`, `setstat smithing ${scenario.smithing}`, 'setstat mining 1'
    ]) assert(await cheatQuiet(page, command), `seed packet rejected: ${command}`);
    await relog(page, user);
    await clearChatDialogs(page);
    assert.equal(await getServerVarQuiet(page, 'dragonquest'), scenario.stage);
    await page.waitForFunction(({ crafting, smithing }) => {
        const { Skills } = globalThis.__rs2b0t;
        return Skills.effective('crafting') === crafting && Skills.effective('smithing') === smithing
            && Skills.effective('mining') === 1;
    }, scenario, { timeout: 10_000 });
    await seedItemsToBank(page, [
        { debugName: 'coins', displayName: 'Coins', qty: 20000 },
        { debugName: 'lobster', displayName: 'Lobster', qty: 3 },
        ...scenario.bank
    ], BANK);
    for (const item of scenario.give) assert(await cheatQuiet(page, `give ${item}`), `give failed: ${item}`);
    const initial = await page.evaluate(() => ({
        initialCoins: globalThis.__rs2b0t.Inventory.count('Coins'),
        bankCoins: globalThis.__seedBank?.banked['Coins']
    }));
    assert.equal(initial.initialCoins, 0);
    assert.equal(initial.bankCoins, 20000);
    await Bun.write(`out/ds669-${user}-initial.json`, JSON.stringify({ user, scenario: scenario.name, ...initial }, null, 2));
    console.log('verified bank-only initial coins', { user, ...initial });
    assert.equal(await page.evaluate(id => globalThis.__rs2b0t.Inventory.countById(id), scenario.outcome.id), 0);
}

async function observe(page: Page, outcome: Outcome, timeout: number): Promise<void> {
    await page.waitForFunction(want => {
        if (['stopped', 'crashed'].includes(globalThis.rs2b0t.runner.state)) return true;
        const count = globalThis.__rs2b0t.Inventory.countById(want.id);
        switch (want.kind) {
            case 'item': return count >= want.qty;
            case 'blocked': {
                const bot = globalThis.rs2b0t.runner.bot;
                return count === 0 && bot !== null && bot['parkedCount'] > 0 && bot['stepDesc'].includes(want.skill);
            }
            default: { const exhaustive: never = want; return exhaustive; }
        }
    }, outcome, { timeout, polling: 100 });
    const state = await page.evaluate(id => ({
        count: globalThis.__rs2b0t.Inventory.countById(id),
        parked: globalThis.rs2b0t.runner.bot?.['parkedCount'] ?? 0,
        step: globalThis.rs2b0t.runner.bot?.['stepDesc'] ?? ''
    }), outcome.id);
    switch (outcome.kind) {
        case 'item': assert(state.count >= outcome.qty, JSON.stringify(state)); break;
        case 'blocked':
            assert.equal(state.count, 0);
            assert(state.parked > 0 && state.step.includes(outcome.skill), JSON.stringify(state));
            break;
        default: { const exhaustive: never = outcome; throw exhaustive; }
    }
    console.log('verified supply outcome', { outcome, state });
}

async function evidence(page: Page, path: string, error: string | null): Promise<void> {
    const state = await page.evaluate(() => {
        const { runner, reader } = globalThis.rs2b0t;
        const bot = runner.bot;
        return {
            settings: sessionStorage.getItem('rs2b0t:set:AIOQuester:quests'),
            runner: runner.state, logs: runner.ctx?.log ?? [],
            picked: bot?.['picked'] ? [...bot['picked']] : [], rows: bot?.['rows'],
            parked: bot?.['parkedCount'], selected: bot?.['runningId'], step: bot?.['stepDesc'],
            tasks: bot?.['tasks']?.map(task => Object.fromEntries(Object.entries(task).filter(([key]) =>
                ['waitCount', 'waitKey', 'runningId', 'bankKnown', 'noProgressCount'].includes(key)))),
            tile: reader.worldTile(), inventory: reader.inventory(),
            skills: ['crafting', 'smithing', 'mining'].map(name => ({
                name, base: globalThis.__rs2b0t.Skills.level(name), effective: globalThis.__rs2b0t.Skills.effective(name)
            }))
        };
    });
    const stage = await getServerVarQuiet(page, 'dragonquest');
    await Bun.write(`${path}.json`, JSON.stringify({ error, stage, ...state }, null, 2));
    await page.screenshot({ path: `${path}.png`, fullPage: true });
    console.log('scenario evidence', { path, stage, runner: state.runner, selected: state.selected, parked: state.parked, step: state.step });
}

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 20 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engines only');
assert(minutes > 0 && minutes <= 60, '--minutes must be in (0, 60]');
await requireSim(base);
const tag = `ds669-${crypto.randomUUID().slice(0, 8)}`;
const client = deployIsolatedClient(tag);
try {
    const browser = await launchBrowser({ swiftshader: true });
    const deadline = Date.now() + minutes * 60_000;
    const timer = setTimeout(() => { void browser.close(); }, minutes * 60_000);
    try {
        for (const [index, scenario] of SCENARIOS.entries()) {
            const context = await browser.newContext();
            const page = await context.newPage();
            const user = `d669${tag.slice(-6)}${index}`;
            console.log('starting supply scenario', { name: scenario.name, user });
            try {
                await mainlandAccount(page, base, user, client.page);
                await seed(page, scenario, user);
                await setSettings(page, 'AIOQuester', { quests: 'dragon', food: 'Lobster', verbose: true });
                await startScript(page, 'AIOQuester');
                await page.waitForFunction(() => (globalThis.rs2b0t.runner.bot?.['picked']?.size ?? 0) > 0, undefined, { timeout: 10_000 });
                assert.deepEqual(await page.evaluate(() => [...(globalThis.rs2b0t.runner.bot?.['picked'] ?? [])]), ['dragon']);
                const remaining = deadline - Date.now();
                assert(remaining > 0, 'total harness budget exhausted');
                await observe(page, scenario.outcome, Math.min(remaining, 240_000));
                await evidence(page, `out/${tag}-${scenario.name}-success`, null);
                console.log('PASS', scenario.name);
            } catch (error) {
                await evidence(page, `out/${tag}-${scenario.name}-failure`, error instanceof Error ? error.message : String(error));
                throw error;
            } finally {
                try {
                    if (!page.isClosed()) {
                        await stopScript(page);
                        await logout(page);
                    }
                } finally {
                    await context.close();
                }
            }
        }
        console.log('PASS #669: all five supply scenarios');
    } finally {
        clearTimeout(timer);
        await browser.close();
    }
} finally {
    client.cleanup();
}
