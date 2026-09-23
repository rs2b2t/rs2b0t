import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvItemSnapshot } from '../src/bot/adapter/ClientAdapter.js';
import type { ScriptMeta } from '../src/bot/runtime/ScriptRegistry.js';
import type GatheringBot from '../src/bot/scripts/GatheringBot/GatheringBot.js';
import { deployIsolatedClient, launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

interface DropProof {
    before: InvItemSnapshot[];
    after?: InvItemSnapshot[];
    startedAt: number;
    startedTick: number;
    elapsedMs?: number;
    elapsedTicks?: number;
    xpAfter?: number;
    requests: { at: number; slot: number; id: number }[];
}

interface PowerGlobal {
    rs2b0t: {
        registry: { get(name: string): ScriptMeta | undefined };
        reader: { inventory(): InvItemSnapshot[] };
        host: { tickCount: number };
        input: { heldOp(id: number, slot: number, com: number, op: number): boolean };
        runner: {
            state: string;
            ctx: { log: { msg: string }[] } | null;
            start(meta: ScriptMeta): void;
            stop(reason: string): void;
        };
    };
    __rs2b0t: {
        Skills: { xp(name: string): number };
        Inventory: { count(name: string): number };
        Equipment: { contains(name: string): boolean };
    };
    __powerProof: { drops: DropProof[]; xpBefore: number; locations: string[] };
}

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local test engine');
const tag = `gpd${Date.now().toString(36).slice(-7)}`;
const dir = `out/e2e/${tag}`;
await mkdir(dir, { recursive: true });
const sharedBundleHash = () => createHash('sha256').update(readFileSync('out/botclient.js')).digest('hex');
const originalBundle = sharedBundleHash();
const buildDir = mkdtempSync(join(tmpdir(), 'gathering-power-drop-'));
const client = deployIsolatedClient(tag, undefined, buildDir);
const build = await Bun.file(`${buildDir}/version.json`).json();
assert.equal(sharedBundleHash(), originalBundle, 'test build overwrote the running client bundle');
const browser = await launchBrowser({ swiftshader: true });
const results: { name: string; drops: DropProof[]; xpGained: number }[] = [];
const scenarios = [
    { name: 'iron-power', script: 'Miner', ore: 'Iron', item: 'Iron ore', debug: 'iron_ore', location: 'Southeast Varrock Mine', tile: { x: 3285, z: 3366, level: 0 }, naturalCycle: true, supplies: false },
    { name: 'clay-power', script: 'Miner', ore: 'Clay', item: 'Clay', debug: 'clay', location: 'Rimmington Mine', tile: { x: 2978, z: 3247, level: 0 }, naturalCycle: false, supplies: false },
    { name: 'coal-supplies', script: 'Miner', ore: 'Coal', item: 'Coal', debug: 'coal', location: 'Dwarven Mine', tile: { x: 3021, z: 9800, level: 0 }, naturalCycle: false, supplies: true }
];

try {
    for (const [index, scenario] of scenarios.entries()) {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.text().startsWith('drop-proof:')) console.log(message.text()); });
        try {
            await mainlandAccount(page, base, `${tag}${index}`, client.page);
            for (const stat of ['mining 99', 'hitpoints 99', 'defence 99']) await cheatQuiet(page, `setstat ${stat}`);
            await clearChatDialogs(page, 'mining fixture');
            const pickaxe = 'Rune pickaxe';
            await cheatQuiet(page, 'give rune_pickaxe 1');
            if (scenario.supplies) {
                for (const item of ['lobster 2', 'coins 100', 'gold_ore 1', 'uncut_sapphire 1']) await cheatQuiet(page, `give ${item}`);
            }
            const oreCount = scenario.supplies ? 22 : 27;
            await cheatQuiet(page, `give ${scenario.debug} ${oreCount}`);
            const seeded = await page.evaluate(item => {
                const g = globalThis as never as PowerGlobal;
                return { items: g.rs2b0t.reader.inventory().length, ore: g.__rs2b0t.Inventory.count(item) };
            }, scenario.item);
            assert.deepEqual(seeded, { items: 28, ore: oreCount }, 'Full inventory fixture missing');
            assert(await teleTo(page, scenario.tile, 3, 25000), 'Mine teleport failed');
            await setSettings(page, scenario.script, {
                rocks: scenario.ore, location: scenario.location, toolAcquire: 'Off',
                bank: false,
                purgePackOnStart: false, muleMode: 'Off', tickManip: 'Off', foodWithdraw: scenario.supplies ? 2 : 0,
                forgetfulBank: false, packJunk: 'Off'
            });
            await page.getByRole('button', { name: 'Browse…' }).click();
            await page.locator('.rs2b0t-card-name').filter({ hasText: new RegExp(`^${scenario.script}$`) }).click();
            await page.evaluate(script => {
                const g = globalThis as never as PowerGlobal;
                const meta = g.rs2b0t.registry.get(script);
                if (!meta) throw new Error('Mining script unavailable');
                const locations = meta.settingsSchema?.location.options ?? [];
                g.__powerProof = { drops: [], xpBefore: g.__rs2b0t.Skills.xp('mining'), locations };
                g.rs2b0t.runner.start({
                    ...meta,
                    create() {
                        const bot = meta.create() as GatheringBot;
                        const drop = bot.dropProducts.bind(bot);
                        bot.dropProducts = async () => {
                            const proof: DropProof = {
                                before: g.rs2b0t.reader.inventory(),
                                startedAt: performance.now(), startedTick: g.rs2b0t.host.tickCount, requests: []
                            };
                            g.__powerProof.drops.push(proof);
                            const heldOp = g.rs2b0t.input.heldOp;
                            g.rs2b0t.input.heldOp = (id, slot, com, op) => {
                                if (op === 5) proof.requests.push({ at: performance.now(), slot, id });
                                return heldOp(id, slot, com, op);
                            };
                            try {
                                await drop();
                            } finally {
                                g.rs2b0t.input.heldOp = heldOp;
                            }
                            proof.after = g.rs2b0t.reader.inventory();
                            proof.elapsedMs = performance.now() - proof.startedAt;
                            proof.elapsedTicks = g.rs2b0t.host.tickCount - proof.startedTick;
                            proof.xpAfter = g.__rs2b0t.Skills.xp('mining');
                            console.log(`drop-proof: ${script} ${proof.requests.length} drops in ${proof.elapsedMs.toFixed(1)} ms / ${proof.elapsedTicks} ticks`);
                        };
                        return bot;
                    }
                });
            }, scenario.script);
            await page.waitForFunction(({ item, naturalCycle }) => {
                const g = globalThis as never as PowerGlobal;
                const drops = g.__powerProof.drops;
                const last = drops.at(-1);
                return ['stopped', 'crashed'].includes(g.rs2b0t.runner.state) || (drops.length >= (naturalCycle ? 2 : 1)
                    && last?.xpAfter !== undefined && g.__rs2b0t.Skills.xp('mining') > last.xpAfter
                    && g.__rs2b0t.Inventory.count(item) > 0);
            }, scenario, { timeout: 240000 });
            const proof = await page.evaluate(pick => {
                const g = globalThis as never as PowerGlobal;
                return {
                    ...g.__powerProof, xpAfter: g.__rs2b0t.Skills.xp('mining'),
                    inventory: g.rs2b0t.reader.inventory(),
                    pickaxeKept: g.__rs2b0t.Inventory.count(pick) > 0 || g.__rs2b0t.Equipment.contains(pick),
                    state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log ?? []
                };
            }, pickaxe);
            await Bun.write(`${dir}/${scenario.name}.json`, JSON.stringify({ scenario, ...proof, errors }, null, 2) + '\n');
            await page.screenshot({ path: `${dir}/${scenario.name}.png` });
            assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
            assert.equal(proof.state, 'running', 'Mining script stopped');
            assert(proof.pickaxeKept, 'Pickaxe was lost');
            assert(proof.inventory.some(item => item.name === scenario.item), 'Did not resume mining the selected ore');
            assert(proof.drops.length >= (scenario.naturalCycle ? 2 : 1), 'Missing completed mining/drop cycle');
            assert.equal(proof.drops[0].before.filter(item => item.name === scenario.item).length, oreCount);
            for (const drop of proof.drops) {
                assert(drop.after, 'Drop did not complete');
                assert(!drop.after.some(item => item.name === scenario.item), 'Ore remained after drop');
                for (const item of drop.before.filter(item => item.name !== scenario.item)) {
                    const beforeCount = drop.before.filter(kept => kept.id === item.id).reduce((sum, kept) => sum + kept.count, 0);
                    const afterCount: number = drop.after.filter(kept => kept.id === item.id).reduce((sum, kept) => sum + kept.count, 0);
                    assert.equal(afterCount, beforeCount, `Lost ${item.name}`);
                }
                const ores = drop.before.filter(item => item.name === scenario.item);
                assert.equal(drop.requests.length, ores.length, 'Repeated or missing drop requests');
                assert(drop.requests.at(-1)!.at - drop.requests[0].at < 100, 'Drop dispatch was paced per item');
                assert(drop.elapsedMs! <= 4800, `Drop took ${drop.elapsedMs} ms`);
                assert(drop.elapsedTicks! <= Math.ceil(ores.length / 5) + 1, `Drop took ${drop.elapsedTicks} ticks`);
            }
            const lastDrop = proof.drops.at(-1)!;
            assert(proof.xpAfter > lastDrop.xpAfter!, 'Mining did not resume after the last drop');
            const result = { name: scenario.name, drops: proof.drops, xpGained: proof.xpAfter - proof.xpBefore };
            results.push(result);
            console.log(`PASS ${scenario.name}: ${proof.drops.length} drops, ${result.xpGained} XP gained; ${dir}/${scenario.name}.json`);
        } catch (error) {
            await page.screenshot({ path: `${dir}/${scenario.name}-failure.png` }).catch(() => {});
            const state = await page.evaluate(() => {
                const g = globalThis as never as PowerGlobal;
                return { proof: g.__powerProof, logs: g.rs2b0t?.runner.ctx?.log ?? [] };
            }).catch(() => null);
            await Bun.write(`${dir}/${scenario.name}-failure.json`, JSON.stringify({ error: String(error), state, errors }, null, 2));
            throw error;
        } finally {
            await page.evaluate(() => (globalThis as never as PowerGlobal).rs2b0t?.runner.stop('Gathering power drop e2e complete')).catch(() => {});
            await page.close();
        }
    }
    await Bun.write(`${dir}/summary.json`, JSON.stringify({ result: 'PASS', generatedAt: new Date().toISOString(), build, results }, null, 2) + '\n');
    console.log(`PASS Miner power dropping. Proof: ${dir}`);
} finally {
    await browser.close();
    client.cleanup();
    rmSync(buildDir, { recursive: true, force: true });
}
