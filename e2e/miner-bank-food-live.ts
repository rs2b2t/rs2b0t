import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { deployIsolatedClient, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';
import type { WorldTile } from '../src/bot/adapter/ClientAdapter.js';

interface State {
    hp: number; maxHp: number; coal: number; food: number;
    bankCoal: number; bankFood: number; xp: number; tile: WorldTile | null;
}
interface Api {
    __rs2b0t: {
        Skills: { effective(name: string): number; level(name: string): number; xp(name: string): number };
        Inventory: { count(name: string): number };
        Bank: { count(name: string): number; isOpen(): boolean };
    };
    rs2b0t: {
        reader: { worldTile(): WorldTile | null };
        registry: { get(name: string): unknown };
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
            bot: {
                walkHomeIfNeeded(log?: (message: string) => void): Promise<boolean>;
                closeScriptBank(...args: unknown[]): Promise<boolean>;
            } | null;
            ctx: { log: { msg: string }[] } | null;
        };
    };
    __foodProof: { before: State; bank?: State; departure?: State; returned?: boolean };
    __foodSnapshot(): State;
}

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local test engine');
const tag = `mbf${Date.now().toString(36).slice(-7)}`;
const dir = `out/e2e/${tag}`;
await mkdir(dir, { recursive: true });
const client = deployIsolatedClient(tag);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await mainlandAccount(page, base, tag, client.page);
    await cheatQuiet(page, 'setstat mining 99');
    await cheatQuiet(page, 'setstat defence 99');
    await cheatQuiet(page, 'setstat hitpoints 80');
    await clearChatDialogs(page, 'mining fixture');
    const bank = { x: 3094, z: 3493, level: 0 };
    await seedItemsToBank(page, [{ debugName: 'lobster', displayName: 'Lobster', qty: 20 }], bank);
    assert(await teleTo(page, bank, 2, 25000));
    await cheatQuiet(page, 'give rune_pickaxe 1');
    await cheatQuiet(page, 'give coal 27');
    await setSettings(page, 'Miner', {
        rocks: 'Coal', location: 'Wilderness Skeleton Mine', toolAcquire: 'Off',
        purgePackOnStart: false, muleMode: 'Off', tickManip: 'Off',
        food: 'Lobster', foodWithdraw: 0, forgetfulBank: false
    });
    await cheatQuiet(page, '~hit 30');
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        g.__foodSnapshot = () => ({
            hp: g.__rs2b0t.Skills.effective('hitpoints'), maxHp: g.__rs2b0t.Skills.level('hitpoints'),
            coal: g.__rs2b0t.Inventory.count('Coal'), food: g.__rs2b0t.Inventory.count('Lobster'),
            bankCoal: g.__rs2b0t.Bank.count('Coal'), bankFood: g.__rs2b0t.Bank.count('Lobster'),
            xp: g.__rs2b0t.Skills.xp('mining'), tile: g.rs2b0t.reader.worldTile()
        });
        g.__foodProof = { before: g.__foodSnapshot() };
        const meta = g.rs2b0t.registry.get('Miner');
        if (!meta) throw new Error('Miner missing');
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.bot, undefined, { timeout: 10000 });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const bot = g.rs2b0t.runner.bot!;
        const walk = bot.walkHomeIfNeeded.bind(bot);
        const close = bot.closeScriptBank.bind(bot);
        bot.closeScriptBank = async (...args) => {
            if (g.__rs2b0t.Bank.isOpen()) g.__foodProof.bank = g.__foodSnapshot();
            return close(...args);
        };
        bot.walkHomeIfNeeded = async log => {
            g.__foodProof.departure = g.__foodSnapshot();
            return g.__foodProof.returned = await walk(log);
        };
    });
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return g.__foodProof.departure || g.rs2b0t.runner.state !== 'running';
    }, undefined, { timeout: 60000 });
    const proof = await page.evaluate(() => ({
        ...(globalThis as never as Api).__foodProof,
        logs: (globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []
    }));
    console.log(JSON.stringify(proof));
    assert.equal(proof.before.hp, 50);
    assert.equal(proof.before.coal, 27);
    assert(proof.departure, 'never reached the return walk');
    assert(proof.departure.hp >= 74 && proof.departure.hp < 80, 'HP must include two lobster heals, allowing natural regeneration');
    assert.equal(proof.departure.coal, 0);
    assert.equal(proof.departure.food, 0);
    assert.equal(proof.bank?.bankCoal, 27);
    assert.equal(proof.bank?.bankFood, 18);
    await page.screenshot({ path: `${dir}/healed.png` });
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return g.__foodProof.returned && g.__rs2b0t.Skills.xp('mining') > g.__foodProof.before.xp;
    }, undefined, { timeout: 180000 });
    const completed = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return { ...g.__foodProof, after: g.__foodSnapshot(), logs: g.rs2b0t.runner.ctx?.log ?? [] };
    });
    assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
    await Bun.write(`${dir}/proof.json`, JSON.stringify({ result: 'PASS', ...completed }, null, 2) + '\n');
    await page.screenshot({ path: `${dir}/mining.png` });
    console.log(`PASS: deposited 27 coal, consumed 2 lobsters, left bank at ${proof.departure.hp}/80 HP, resumed mining. Proof: ${dir}`);
} catch (error) {
    await page.screenshot({ path: `${dir}/failure.png` });
    console.log(await page.evaluate(() => ({ proof: (globalThis as never as Api).__foodProof, logs: (globalThis as never as Api).rs2b0t.runner.ctx?.log ?? [] })));
    throw error;
} finally {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t?.runner.stop('bank food verification complete')).catch(() => {});
    await browser.close();
    client.cleanup();
}
