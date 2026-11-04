import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Bank } from '../src/bot/api/bank/Bank.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import type { Prayer } from '../src/bot/api/prayer/Prayer.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import { CONTENT_HASH } from '../src/bot/scripts/JiveTT/lootData.js';
import type { Counters, ItemStack, Point, SessionState } from '../src/bot/scripts/JiveTT/types.js';
import { buildIdentityDefines, resolveBuildIdentity } from '../tools/lib/buildIdentity.js';
import { engineLoginKey } from './lib/engineLoginKey.js';
import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript, type BankSeedItem } from './tutorial/harness.js';

type Mode = 'audit' | 'banked-easy' | 'banked-hard' | 'stop' | 'cycle' | 'hunt-probe';
interface Diagnostic { phase: string; status: string; site: string | null; species: string | null; counters: Counters; lastFailure: string | null }
interface BrowserAbi {
    __rs2b0t: { Game: typeof Game; Inventory: typeof Inventory; Bank: typeof Bank; Skills: typeof Skills; Equipment: typeof Equipment; Prayer: typeof Prayer; Npcs: typeof Npcs };
    rs2b0t: {
        renderGate: { setEnabled(enabled: boolean): void };
        reader: { chat(count: number): { text: string }[] };
        runner: { state: string; bot: { diagnostic?(): Diagnostic } | null; ctx: { stopReason: string | null; crashError: { message: string } | null; log: { time: number; msg: string }[] } | null };
    };
}
interface Sample {
    at: number;
    runner: string;
    diagnostic: Diagnostic | null;
    tile: Point | null;
    hp: number;
    prayer: number;
    prayerXp: number;
    meleePrayer: boolean;
    combat: boolean;
    inventory: ItemStack[];
    equipment: ItemStack[];
    bank: ItemStack[] | null;
    reason: string | null;
    log: { time: number; msg: string }[];
    chat: string[];
    combatMode: number;
    targets: { index: number; id: number; health: number; totalHealth: number; combat: boolean; targetsMe: boolean; tile: Point }[];
}

const flag = (name: string, fallback: string): string => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const base = flag('--base', process.env.BASE ?? 'http://localhost:8891');
const origin = new URL(base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && origin.protocol === 'http:' && !origin.username && !origin.password, 'JiveTT acceptance only runs against a local HTTP server');
assert(!process.env.TARGET || process.env.TARGET === 'local', 'JiveTT acceptance requires TARGET=local');
const mode = flag('--mode', 'audit') as Mode;
assert(['audit', 'banked-easy', 'banked-hard', 'stop', 'cycle', 'hunt-probe'].includes(mode), 'Unknown --mode');
const stopPhase = flag('--stop-phase', 'audit');
assert(['audit', 'travel', 'hunt', 'solve', 'market'].includes(stopPhase), 'Unknown --stop-phase');
const minutes = Number(flag('--minutes', mode === 'cycle' ? '180' : '10'));
assert(Number.isFinite(minutes) && minutes > 0 && minutes <= 1440, '--minutes must be between 0 and 1440');
const reportedServerTickMs = Number(flag('--server-tick-ms', '600'));
assert(Number.isFinite(reportedServerTickMs) && reportedServerTickMs > 0, 'Invalid --server-tick-ms');
const account = flag('--user', `jtt${Date.now().toString(36)}`);
assert(/^jtt[a-z0-9]{1,9}$/i.test(account), 'Use a disposable local account beginning with jtt, at most 12 characters');
const engine = process.env.ENGINE_DIR ?? join(homedir(), 'code/rs2b2t-slot-patch/engine');
const tag = `jivett-${mode}-${Date.now().toString(36)}`;
const buildDir = 'out/jivett-acceptance';
const evidenceDir = `out/jivett-acceptance-evidence/${tag}`;
const bankStand = { x: 2946, z: 3369, level: 0 };
const seeds: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 1000000 },
    { debugName: 'dragon_longsword', displayName: 'Dragon longsword', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'antidragonbreathshield', displayName: 'Dragonfire shield', qty: 1 },
    { debugName: 'shark', displayName: 'Shark', qty: 300 },
    { debugName: '4doseprayerrestore', displayName: 'Prayer potion(4)', qty: 100 },
    { debugName: '4dose2attack', displayName: 'Super attack(4)', qty: 30 },
    { debugName: '4dose2strength', displayName: 'Super strength(4)', qty: 30 },
    { debugName: '4dose2defense', displayName: 'Super defence(4)', qty: 30 },
    { debugName: '4dose1antidragon', displayName: 'Antifire potion(4)', qty: 30 },
    { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 30 },
    { debugName: 'airrune', displayName: 'Air rune', qty: 1000 },
    { debugName: 'waterrune', displayName: 'Water rune', qty: 1000 },
    { debugName: 'firerune', displayName: 'Fire rune', qty: 1000 },
    { debugName: 'earthrune', displayName: 'Earth rune', qty: 1000 },
    { debugName: 'lawrune', displayName: 'Law rune', qty: 1000 },
    { debugName: 'dusty_key', displayName: 'Dusty key', qty: 1 },
    { debugName: 'spade', displayName: 'Spade', qty: 1 }
];
const samples: Sample[] = [];
const consoleLines: { at: number; text: string }[] = [];
const failures: string[] = [];
const startedAt = Date.now();
let outcome = 'incomplete';
let bundleHash = '';
let mapHash = '';
let interrupted = false;
process.on('SIGUSR1', () => { interrupted = true; });
const client = deployIsolatedClient(tag, engine, buildDir);
if (mode === 'hunt-probe') {
    const entry = join(process.cwd(), buildDir, 'validation-entry.ts');
    const source = `import ${JSON.stringify(join(process.cwd(), 'src/bot/main.ts'))};
import { SITES } from ${JSON.stringify(join(process.cwd(), 'src/bot/scripts/JiveTT/sites.ts'))};
Reflect.set(globalThis, '__jivettValidationProbe', () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Local validation only');
    const site = SITES.find(site => site.id === 'taverley-blue');
    if (!site) throw new Error('Missing Taverley site');
    site.validation = { revision: '289-local-probe', evidence: 'validation probe, not release evidence', entry: true, melee: true, loot: true, exit: true, npcIds: [55] };
    return site.validation;
});
`;
    try {
        await writeFile(entry, source);
        const key = engineLoginKey(engine);
        const build = await Bun.build({ entrypoints: [entry], minify: true, define: {
            'process.env.SECURE_ORIGIN': JSON.stringify('false'), 'process.env.RS2B0T_TARGET': JSON.stringify('local'),
            'process.env.LOGIN_RSAE': JSON.stringify(key.rsae), 'process.env.LOGIN_RSAN': JSON.stringify(key.rsan),
            'process.env.STRICT_PACKETS': JSON.stringify(''), 'process.env.STRICT_CONFIG': JSON.stringify(''), ...buildIdentityDefines(resolveBuildIdentity())
        } });
        assert(build.success, build.logs.map(String).join('\n'));
        const bundle = await build.outputs[0].arrayBuffer();
        await writeFile(`${buildDir}/botclient.js`, new Uint8Array(bundle));
        await writeFile(join(engine, 'public/bot', tag, 'botclient.js'), new Uint8Array(bundle));
    } finally { await rm(entry, { force: true }); }
}
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultNavigationTimeout(Number(process.env.BOOT_MS) || 180000);

async function sample(): Promise<Sample> {
    const result = await page.evaluate(() => {
        const { runner, reader }: BrowserAbi['rs2b0t'] = Reflect.get(globalThis as object, 'rs2b0t');
        const api: BrowserAbi['__rs2b0t'] = Reflect.get(globalThis as object, '__rs2b0t');
        const account = api.Game.myName()?.trim().toLowerCase();
        let memory: SessionState | null = null;
        try {
            const value = JSON.parse(localStorage.getItem(`rs2b0t:jivett:${account}`) ?? 'null');
            if (value && value.account === account && typeof value.phase === 'string' && value.counters && typeof value.counters === 'object') memory = value;
        } catch { memory = null; }
        const diagnostic = runner.bot?.diagnostic?.() ?? (memory ? { phase: memory.phase, status: memory.lastFailure ?? runner.ctx?.stopReason ?? '', site: memory.siteId, species: null, counters: memory.counters, lastFailure: memory.lastFailure } : null);
        return {
            at: Date.now(), runner: runner.state, diagnostic, tile: api.Game.tile(),
            hp: api.Skills.effective('hitpoints'), prayer: api.Skills.effective('prayer'), prayerXp: api.Skills.xp('prayer'), meleePrayer: api.Prayer.active('Protect from Melee'), combat: api.Game.inCombat(),
            inventory: api.Inventory.items().map(item => ({ id: item.id, count: item.count })), equipment: api.Equipment.items().map(item => ({ id: item.id, count: item.count })),
            bank: api.Bank.ready() ? api.Bank.items().map(item => ({ id: item.id, count: item.count })) : null,
            reason: runner.ctx?.crashError?.message ?? runner.ctx?.stopReason ?? null, log: runner.ctx?.log.slice(-25).map(line => ({ time: line.time, msg: line.msg })) ?? [], chat: reader.chat(20).map(line => line.text),
            combatMode: api.Game.combatMode(), targets: api.Npcs.all().filter(npc => npc.distance() <= 15).map(npc => ({ index: npc.index, id: npc.id, health: npc.health, totalHealth: npc.snap.totalHealth, combat: npc.inCombat, targetsMe: npc.targetsMe(), tile: npc.networkTile() }))
        };
    });
    samples.push(result);
    return result;
}

async function command(command: string): Promise<void> {
    assert(await cheatQuiet(page, command), `Local fixture command failed: ${command}`);
}

async function waitFor(predicate: (value: Sample) => boolean, timeoutMs: number): Promise<Sample> {
    const deadline = Date.now() + timeoutMs;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        const value = await sample();
        assert(!interrupted, 'Probe interrupted by operator');
        assert(value.hp > 0 && (value.diagnostic?.counters.deaths ?? 0) === 0, 'Death observed');
        if (predicate(value)) return value;
        if (value.runner === 'crashed' || value.diagnostic?.phase === 'parked') throw new Error(value.reason ?? value.diagnostic?.status ?? 'Controller parked');
        if (Date.now() - lastLogged > 30000) { console.log(JSON.stringify({ phase: value.diagnostic?.phase, status: value.diagnostic?.status, tile: value.tile, counters: value.diagnostic?.counters, combat: value.combat, hp: value.hp, prayer: value.prayer, combatMode: value.combatMode, equipment: value.equipment, targets: value.targets })); lastLogged = Date.now(); }
        await page.waitForTimeout(1000);
    }
    throw new Error(`Timed out after ${timeoutMs / 60000} minutes without the required ${mode} milestones`);
}

async function verifyStop(): Promise<void> {
    await stopScript(page);
    const stopped = await sample();
    assert(stopped.runner === 'stopped', `Stop left runner ${stopped.runner}`);
    await page.waitForTimeout(3000);
    const after = await sample();
    assert(after.runner === 'stopped', 'Controller automatically restarted after Stop');
}

try {
    await mkdir(evidenceDir, { recursive: true });
    page.on('console', message => consoleLines.push({ at: Date.now(), text: message.text() }));
    page.on('pageerror', error => { failures.push(error.message); console.error(`pageerror: ${error.message}`); });
    page.on('requestfailed', request => console.error(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
    const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    bundleHash = digest(await readFile(`${buildDir}/botclient.js`));
    mapHash = digest(await readFile(join(engine, 'data/pack/.cache/maps-server.zip')));
    const served = await fetch(`${base}/bot/${tag}/botclient.js`);
    assert(served.ok && digest(new Uint8Array(await served.arrayBuffer())) === bundleHash, 'Served bundle differs from acceptance build');
    await mainlandAccount(page, base, account, client.page);
    await page.evaluate(() => { const runtime: BrowserAbi['rs2b0t'] = Reflect.get(globalThis as object, 'rs2b0t'); runtime.renderGate.setEnabled(false); });
    const fullKit = mode === 'banked-hard' || mode === 'cycle' || mode === 'hunt-probe' || mode === 'stop' && stopPhase !== 'audit';
    if (fullKit) {
        for (const skill of ['attack', 'strength', 'defence', 'hitpoints', 'prayer', 'magic', 'agility', 'woodcutting']) {
            await command(`setstat ${skill} 99`);
            await page.waitForFunction(skill => { const api: BrowserAbi['__rs2b0t'] = Reflect.get(globalThis as object, '__rs2b0t'); return api.Skills.level(skill) === 99; }, skill, { timeout: 10000 });
        }
        await command('setvar zanaris 6');
        assert(await getServerVarQuiet(page, 'zanaris') === 6, 'Lost City fixture failed');
        await relog(page, account);
    }
    if (fullKit || mode === 'banked-easy') {
        await command('~clearinv inv');
        await command('~clearinv worn');
        await command('~clearbank');
        const bankSeeds = fullKit ? [...seeds] : [];
        if (mode === 'banked-hard' || mode === 'banked-easy') bankSeeds.push({ debugName: mode === 'banked-hard' ? 'trail_clue_hard_map001' : 'trail_clue_easy_simple001', displayName: 'Clue scroll', qty: 1 });
        await seedItemsToBank(page, bankSeeds, bankStand);
        await clearChatDialogs(page);
    }
    await setSettings(page, 'JiveTT', { clueTier: 'hard', allowedSites: 'taverley-blue', allowedWorlds: '1', marketEnabled: false, stopAfterDeath: true, blockedClue: 'discard' });
    if (mode === 'hunt-probe') await page.evaluate(() => {
        const enable: () => { evidence: string } = Reflect.get(globalThis as object, '__jivettValidationProbe');
        if (enable().evidence !== 'validation probe, not release evidence') throw new Error('Local validation marker missing');
    });
    if (mode === 'audit') {
        for (const tier of ['easy', 'medium']) {
            await setSettings(page, 'JiveTT', { clueTier: tier });
            const before = await sample();
            await startScript(page, 'JiveTT');
            await page.waitForTimeout(2000);
            const after = await sample();
            const expected = `${tier[0].toUpperCase()}${tier.slice(1)} clues are not implemented in JiveTT`;
            assert([after.reason ?? '', after.diagnostic?.status ?? '', ...after.log.map(line => line.msg)].some(message => message.includes(expected)), expected);
            assert.deepEqual(after.inventory, before.inventory, 'Unsupported tier changed inventory');
            assert.deepEqual(after.tile, before.tile, 'Unsupported tier travelled');
            assert(!after.combat && !after.bank, 'Unsupported tier entered combat or opened bank');
            await verifyStop();
        }
    } else {
        const before = await sample();
        await startScript(page, 'JiveTT');
        const timeout = minutes * 60000;
        if (mode === 'banked-easy') {
            const blocked = await waitFor(value => /existing easy|easy clue/i.test(`${value.diagnostic?.status ?? ''} ${value.reason ?? ''}`), timeout);
            assert((blocked.diagnostic?.counters.kills ?? 0) === 0, 'Farmed while an easy clue blocked drops');
            assert(blocked.inventory.some(item => item.id === 2677) || blocked.bank?.some(item => item.id === 2677), 'Pre-existing clue was not retained');
        } else if (mode === 'banked-hard') {
            const solving = await waitFor(value => ['prepare-clue', 'solve'].includes(value.diagnostic?.phase ?? ''), timeout);
            assert((solving.diagnostic?.counters.kills ?? 0) === 0, 'Farmed before solving a banked hard clue');
        } else if (mode === 'stop') {
            await waitFor(value => value.diagnostic?.phase === stopPhase, timeout);
        } else if (mode === 'hunt-probe') {
            const banked = await waitFor(value => (value.diagnostic?.counters.kills ?? 0) > 0 && value.prayerXp > before.prayerXp
                && value.bank?.some(item => item.id === 1751 && item.count > 0) === true && value.tile !== null && value.tile.z < 4000 && !value.combat, timeout);
            assert(samples.some(value => value.diagnostic?.phase === 'hunt' && value.combat && value.meleePrayer && value.equipment.some(item => item.id === 1540)), 'No protected melee fight observed');
            assert(samples.filter(value => value.diagnostic?.phase === 'hunt' && value.combat).every(value => value.prayer > 0 && value.meleePrayer && value.equipment.some(item => item.id === 1540)), 'Sampled hunt protection lapse');
            assert(samples.some(value => value.chat.some(text => /your potion protects you from the heat/i.test(text))), 'No server-confirmed antifire protection observed');
            assert(samples.some(value => value.inventory.some(item => item.id === 1751)), 'No collected blue dragonhide observed');
            assert((banked.diagnostic?.counters.deaths ?? 0) === 0, 'Probe recorded a death');
        } else {
            await waitFor(value => {
                const counters = value.diagnostic?.counters;
                return !!counters && counters.kills > 0 && counters.clueDrops > 0 && counters.completed > 0 && counters.rewardsBanked > 0 && value.diagnostic?.phase === 'hunt';
            }, timeout);
        }
        await verifyStop();
    }
    assert(failures.length === 0, failures.join('\n'));
    outcome = 'passed';
} catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    await mkdir(evidenceDir, { recursive: true });
    await sample().catch(() => {});
    await page.evaluate(() => { const runtime: BrowserAbi['rs2b0t'] = Reflect.get(globalThis as object, 'rs2b0t'); runtime.renderGate.setEnabled(true); }).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
    await page.screenshot({ path: `${evidenceDir}/final.png` }).catch(() => {});
    await stopScript(page).catch(() => {});
    await writeFile(`${evidenceDir}/result.json`, JSON.stringify({ mode, probeValidation: mode === 'hunt-probe', reportedServerTickMs, stopPhase: mode === 'stop' ? stopPhase : null, outcome, account, base, startedAt, finishedAt: Date.now(), bundleHash, contentHash: CONTENT_HASH, mapHash, failures, samples, console: consoleLines }, null, 2));
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
    console.log(`${outcome}: ${evidenceDir}/result.json${failures.length ? `\n${failures.join('\n')}` : ''}`);
}
