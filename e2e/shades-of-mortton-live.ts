import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { reader } from '../src/bot/adapter/ClientAdapter.js';
import { engineLoginKey } from './lib/engineLoginKey.js';
import { launchBrowser, parseArgs, requireSim, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 35 });
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const mode = rest[0] ?? 'cycle';
const tickMs = Number(process.env.SHADES_TICK_MS ?? 200);
assert(Number.isInteger(tickMs) && tickMs >= 100 && tickMs <= 600);
assert(['cycle', 'oil', 'make', 'food', 'logs', 'funds', 'progression', 'serum', 'pyre', 'hunt', 'unnote', 'prayer', 'alchemy', 'expedition'].includes(mode));
const tag = `sh${Date.now().toString(36)}`;
const startBank = ['food', 'logs', 'funds'].includes(mode) ? { x: 2809, z: 3441, level: 0 } : { x: 3510, z: 3480, level: 0 };
const output = `out/${tag}`;
await mkdir(output, { recursive: true });
await requireSim(base);
const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
const key = engineLoginKey(engine);
const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, LOCAL_RSAE: key.rsae, LOCAL_RSAN: key.rsan, B0T_OUT_DIR: output } });
assert.equal(build.exitCode, 0, build.stderr.toString());
const deployDir = `${engine}/public/bot/${tag}`;
const deployHtml = `${engine}/public/bot-${tag}.html`;
cpSync(output, deployDir, { recursive: true });
cpSync('out/collision.lcnav.gz', `${deployDir}/collision.lcnav.gz`);
const html = readFileSync(`${engine}/public/bot.html`, 'utf8').replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`);
assert(html.includes(`./bot/${tag}/botclient.js`));
writeFileSync(deployHtml, html);
const client = { page: `/bot-${tag}.html`, cleanup: () => { rmSync(deployDir, { recursive: true, force: true }); rmSync(deployHtml, { force: true }); } };
const browser = await launchBrowser();
const page = await browser.newPage();
type Abi = { reader: typeof reader; runner: { state: string; bot: { status?: string; activity?: string; cycles?: number; burns?: number; chests?: number; probe?: boolean; bankCalls?: number; expedition?: { phase: string; cycles: number } } | null; ctx: { log: { msg: string }[] } | null } };
const samples: unknown[] = [];
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, `speed ${tickMs}`));
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints', 'firemaking', 'woodcutting', 'fishing', 'cooking', 'crafting', 'herblore', 'magic', 'prayer']) {
        assert(await cheatQuiet(page, `setstat ${skill} 90`));
        await clearChatDialogs(page);
    }
    for (const [name, value] of [['prieststart', 60], ['priestperil', 61], ['druidspirit', 110], ['morttonquest', 85], ['morttonmulti', 536870912 + (mode === 'serum' ? 0 : 64)]] as const) {
        assert(await cheatQuiet(page, `setvar ${name} ${value}`));
    }
    await relog(page, tag);
    await clearChatDialogs(page);
    const bank: BankSeedItem[] = [
        { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 },
        { debugName: 'hammer', displayName: 'Hammer', qty: 1 },
        { debugName: 'rune_axe', displayName: 'Rune axe', qty: 1 },
        { debugName: 'lobster_pot', displayName: 'Lobster pot', qty: 1 }
    ];
    if (mode !== 'funds') bank.push({ debugName: 'coins', displayName: 'Coins', qty: 20000 });
    if (mode !== 'food') bank.push({ debugName: 'lobster', displayName: 'Lobster', qty: 60 });
    if (['unnote', 'prayer', 'expedition'].includes(mode)) bank.push({ debugName: '3doseprayerrestore', displayName: 'Prayer potion(3)', qty: 8 });
    if (['unnote', 'expedition'].includes(mode)) bank.push({ debugName: 'magic_logs_pyre', displayName: 'Magic pyre logs', qty: 40 });
    if (['cycle', 'progression', 'food'].includes(mode)) bank.push({ debugName: 'magic_logs_pyre', displayName: 'Magic pyre logs', qty: mode === 'cycle' ? 16 : 8 });
    if (['oil', 'make', 'serum'].includes(mode)) bank.push({ debugName: 'magic_logs', displayName: 'Magic logs', qty: 8 });
    if (mode === 'make') bank.push(
        { debugName: 'sacred_oil3', displayName: 'Sacred oil(3)', qty: 10 },
        { debugName: 'sacred_oil1', displayName: 'Sacred oil(1)', qty: 2 }
    );
    if (mode !== 'progression') bank.push({ debugName: 'shadekey_silver_brown', displayName: 'Silver key brown', qty: 1 });
    await seedItemsToBank(page, bank, startBank);
    for (const name of ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield']) {
        assert(await cheatQuiet(page, `give ${name} 1`));
    }
    for (let i = 0; i < 5; i++) {
        const equipped = await page.evaluate(() => {
            const g = Reflect.get(globalThis as object, 'rs2b0t');
            const item = g.reader.inventory().find((item: { ops: (string | null)[] }) => item.ops.some(op => /^(wear|wield)$/i.test(op ?? '')));
            if (!item) return false;
            return g.input.heldOp(item.id, item.slot, item.comId, item.ops.findIndex((op: string | null) => /^(wear|wield)$/i.test(op ?? '')) + 1);
        });
        assert(equipped, 'Equip seeded melee gear');
        await page.waitForTimeout(600);
    }
    assert.equal(await page.evaluate(() => Reflect.get(globalThis as object, 'rs2b0t').reader.equipment().length), 5, 'Seeded gear must be worn');
    assert(await teleTo(page, startBank, 2, 25000));
    await clearChatDialogs(page);
    assert(await cheatQuiet(page, `speed ${tickMs}`));
    await setSettings(page, 'ShadesOfMortton', { strategy: mode === 'expedition' ? 'Local' : 'Banked', targetRemains: 2 });
    if (['unnote', 'prayer', 'alchemy'].includes(mode)) {
        if (mode === 'alchemy') {
            for (const command of ['give rune_platebody 1', 'give naturerune 1', 'give firerune 5', 'give lobster 4']) assert(await cheatQuiet(page, command));
        }
        if (mode === 'prayer') assert(await cheatQuiet(page, 'setstat prayer 43'));
        await page.evaluate(mode => {
            const g = Reflect.get(globalThis as object, 'rs2b0t');
            const api = Reflect.get(globalThis as object, '__rs2b0t');
            const meta = g.registry.get('ShadesOfMortton');
            const bot = meta.create();
            let prepared = false;
            const held = (id: number) => g.reader.inventory().filter((item: { id: number }) => item.id === id).reduce((sum: number, item: { count: number }) => sum + item.count, 0);
            bot.loop = async () => {
                if (bot.probe) return;
                bot.status = `${mode} probe`;
                if (mode === 'alchemy') {
                    bot.probe = await bot.loot.process(new Map(), true) && held(1127) === 0 && held(561) === 0 && held(554) === 0 && held(995) === 39000;
                    return;
                }
                if (!prepared) {
                    if (!(await bot.supply.bank()) || !(await bot.supply.take(995, 20000)) || !(await bot.supply.take(379, 4))) return;
                    if (mode === 'unnote') {
                        await api.Bank.setNoteMode(true);
                        for (const id of [379, 139, 3448]) {
                            const note = g.reader.objCatalog().find((item: { certlink: number; certtemplate: number }) => item.certlink === id && item.certtemplate !== -1)?.id;
                            if (!note || !(await api.Bank.withdrawXById(id, 5, note))) throw new Error(`Could not withdraw notes for ${id}`);
                        }
                        await api.Bank.setNoteMode(false);
                    } else if (!(await bot.supply.take(139, 1)) || !(await bot.supply.take(3466, 1))) return;
                    await api.Bank.close();
                    prepared = true;
                    const command = mode === 'prayer' ? 'tele 0,54,151,8,34' : 'tele 0,54,51,32,31';
                    g.client.out.p1Enc(g.protocol.clientCheat);
                    g.client.out.p1(command.length + 1);
                    g.client.out.pjstr(command);
                    await api.Execution.delayUntil(() => g.reader.worldTile()?.z === (mode === 'prayer' ? 9698 : 3295), 5000);
                }
                if (mode === 'unnote') {
                    for (const [id, target] of [[379, 9], [139, 5], [3448, 5]]) if (!(await bot.shop.refill(id, target))) return;
                    bot.probe = held(379) === 9 && held(139) === 5 && held(3448) === 5;
                } else {
                    await bot.combat.maintain();
                    bot.probe = held(139) === 0 && held(141) === 1 && api.Prayer.points() > 8 && bot.combat.protected();
                }
            };
            g.runner.start({ ...meta, create: () => bot });
        }, mode);
    } else if (mode === 'expedition') {
        await page.evaluate(() => {
            const g = Reflect.get(globalThis as object, 'rs2b0t');
            const meta = g.registry.get('ShadesOfMortton');
            const bot = meta.create();
            bot.bankCalls = 0;
            const bank = bot.supply.bank.bind(bot.supply);
            bot.supply.bank = async () => { bot.bankCalls++; return bank(); };
            g.runner.start({ ...meta, create: () => bot });
        });
    } else if (mode === 'pyre' || mode === 'hunt') {
        const commands = mode === 'pyre'
            ? ['give tinderbox 1', 'give magic_logs_pyre 2', 'give shade_bones5 2', 'give lobster 4']
            : ['give shadekey_silver_brown 1', 'give lobster 12'];
        for (const command of commands) assert(await cheatQuiet(page, command));
        assert(await teleTo(page, mode === 'pyre' ? { x: 3504, z: 3277, level: 0 } : { x: 3464, z: 9698, level: 0 }, 1, 25000));
        await page.evaluate(mode => {
            const g = Reflect.get(globalThis as object, 'rs2b0t');
            const meta = g.registry.get('ShadesOfMortton');
            const bot = meta.create();
            bot.loop = async () => {
                bot.status = `${mode} probe`;
                if (mode === 'pyre' && bot.burns < 2) await bot.minigame.cremate(4);
                if (mode === 'hunt' && bot.minigame.stats.kills < 2) await bot.minigame.hunt(4, 2);
            };
            g.runner.start({ ...meta, create: () => bot });
        }, mode);
    } else await startScript(page, 'ShadesOfMortton');
    const deadline = Date.now() + minutes * 60000;
    let done = false;
    let last = '';
    while (Date.now() < deadline) {
        const sample = await page.evaluate(() => {
            const { reader, runner }: Abi = Reflect.get(globalThis as object, 'rs2b0t');
            return { at: Date.now(), tile: reader.worldTile(), inventory: reader.inventory().map(item => ({ id: item.id, count: item.count })),
                bank: reader.modals().main === 5292 ? reader.bankItems().map(item => ({ id: item.id, count: item.count })) : [],
                locs: reader.locs().filter(loc => loc.id >= 4093 && loc.id <= 4105).map(loc => ({ id: loc.id, tile: loc.tile, ops: loc.ops })),
                ground: reader.groundItems().map(item => ({ id: item.id, tile: item.tile, count: item.count })),
                npcs: reader.npcs().filter(npc => npc.id >= 1240 && npc.id <= 1250).map(npc => ({ index: npc.index, id: npc.id, tile: npc.tile, health: npc.health, totalHealth: npc.totalHealth, faceEntity: npc.faceEntity })),
                selfSlot: reader.selfSlot(),
                hp: reader.stat(3), state: runner.state, status: runner.bot?.status, activity: runner.bot?.activity,
                cycles: runner.bot?.cycles ?? 0, burns: runner.bot?.burns ?? 0, chests: runner.bot?.chests ?? 0,
                probe: runner.bot?.probe ?? false, bankCalls: runner.bot?.bankCalls ?? 0,
                expedition: runner.bot?.expedition ? { phase: runner.bot.expedition.phase, cycles: runner.bot.expedition.cycles } : null,
                prayer: reader.stat(5),
                meters: [reader.varp(343), reader.varp(344), reader.varp(345)],
                chat: reader.chat(5).map(line => line.text), logs: runner.ctx?.log.slice(-5).map(line => line.msg) ?? [] };
        });
        samples.push(sample);
        await writeFile(`${output}/latest.json`, JSON.stringify(sample, null, 2));
        const count = (id: number) => [...sample.inventory, ...sample.bank].filter(item => item.id === id).reduce((n, item) => n + item.count, 0);
        const state = `${sample.status} ${sample.tile?.x},${sample.tile?.z} burns=${sample.burns} chests=${sample.chests} cycles=${sample.cycles}`;
        if (state !== last) { console.log(state, sample.state, sample.logs); last = state; }
        assert(sample.state !== 'stopped' && sample.state !== 'crashed' && sample.state !== 'error', JSON.stringify(sample));
        if (mode === 'expedition') assert(sample.bankCalls <= 1, 'Local cycle returned to bank before completing');
        if (mode === 'pyre') done = sample.burns >= 2;
        if (mode === 'hunt') done = count(3404) >= 2;
        if (['unnote', 'prayer', 'alchemy'].includes(mode)) done = sample.probe;
        if (mode === 'expedition') done = sample.burns >= 2 && sample.chests >= 1 && (sample.expedition?.cycles ?? 0) >= 1 && sample.expedition?.phase === 'hunt' && sample.bankCalls === 1;
        if (mode === 'cycle') done = sample.burns >= 1 && sample.chests >= 1 && sample.cycles >= 3 && sample.activity === 'hunt';
        if (mode === 'progression') done = sample.burns > 0 && sample.status?.includes('Phrin') === true;
        if (mode === 'oil') done = sample.cycles > 0 && [3430, 3432, 3434, 3436].some(id => count(id) > 0);
        if (mode === 'make') done = sample.cycles > 0 && count(3448) >= 8;
        if (mode === 'food') done = sample.cycles > 0 && count(379) >= 12;
        if (mode === 'logs') done = sample.cycles > 0 && count(1513) >= 12;
        if (mode === 'funds') done = sample.cycles > 0 && count(995) >= 3000;
        if (mode === 'serum') done = sample.cycles > 1 && [3430, 3432, 3434, 3436].some(id => count(id) > 0);
        if (done) break;
        await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: `${output}/final.png` });
    assert(done, `${mode} did not complete within ${minutes} minutes`);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`PASS ${mode}: ${output}`);
} finally {
    await writeFile(`${output}/proof.json`, JSON.stringify({ mode, errors, samples }, null, 2));
    await stopScript(page).catch(() => {});
    await cheatQuiet(page, 'speed 600').catch(() => {});
    await browser.close();
    client.cleanup();
}
