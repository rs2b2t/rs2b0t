import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { CLIENT_VERSION } from '../src/client/io/ClientProt.js';
import Skill from '../src/client/shell/Skill.js';
import { CHECKLIST, KqEvidence, chamber, type KqAction, type KqRopeClick } from './lib/kqEvidence.js';
import type { Input } from '../src/bot/input/Input.js';
import { kqOptions } from './lib/kqOptions.js';
import { KqCleanup, type CleanupAction, type CleanupSample } from './lib/kqCleanup.js';
import { KqRecoveryEvidence, RECOVERY_CHECKLIST } from './lib/kqRecoveryEvidence.js';
import { KqGateDelay } from './lib/kqGateDelay.js';
import type { Page } from 'playwright-core';
import type { Game } from '../src/bot/api/game/Game.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Prayer } from '../src/bot/api/prayer/Prayer.js';
import type { reader } from '../src/bot/adapter/ClientAdapter.js';
import type JiveKQ from '../src/bot/scripts/JiveKQ/JiveKQ.js';
import { deployIsolatedClient, launchBrowser, logout, requireSim, setSettings, stopScript } from './lib/harness.js';
import { bootAndLogin, cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

interface WindowApi {
    kqActions: KqAction[];
    kqRopeClicks: KqRopeClick[];
    kqGateDelay?: { released: boolean; held: boolean };
    __rs2b0t: { Game: typeof Game; Inventory: typeof Inventory; Equipment: typeof Equipment; Npcs: typeof Npcs; Skills: typeof Skills; Prayer: typeof Prayer; reader: typeof reader };
    rs2b0t: { input: typeof Input; runner: { state: string; bot: JiveKQ | null; ctx: { log: { time: number; level: string; msg: string }[] } | null; pause(): void; resume(): void } };
}

const args = kqOptions(process.argv.slice(2));
const mode = args.recoveryProbe ? 'recovery-probe' : 'soak';
const checklist: Record<string, string> = { ...(args.recoveryProbe ? RECOVERY_CHECKLIST : CHECKLIST), ...(args.gateDelayProbe ? { gateDelay: 'Hold South at the bank for 225 gate-wait ticks without using ropes, then descend together' } : {}) };
const checks = Object.keys(checklist);
if (!['localhost', '127.0.0.1'].includes(new URL(args.base).hostname)) throw new Error('KQ harness requires a local server');
await requireSim(args.base);
const tag = `kq${Date.now().toString(36).slice(-6)}`;
const reuse = process.env.KQ_ACCOUNTS;
const names = reuse ? reuse.split(',') : [0, 1, 2, 3].map(i => `${tag}${i}`);
if (names.length !== 4 || new Set(names).size !== 4) throw new Error('KQ_ACCOUNTS requires four distinct test accounts');
const client = deployIsolatedClient(tag);
const bundle = await fetch(`${args.base}/bot/${tag}/botclient.js`);
if (!bundle.ok) throw new Error('Isolated client bundle is not served by this engine');
const bundleSha256 = createHash('sha256').update(new Uint8Array(await bundle.arrayBuffer())).digest('hex');
const output = `out/e2e/jivekq/${tag}`;
mkdirSync(output, { recursive: true });
const browser = await launchBrowser();
const context = await browser.newContext();
const pages = await Promise.all(names.map(() => context.newPage()));
const errors: string[] = [];
const skills = Skill.names.filter((_, i) => Skill.used[i]);
const startingStats: Record<string, { name: string; base: number; effective: number; xp: number }[]> = {};
const seed: BankSeedItem[] = [
    ['dragon_mace', 'Dragon mace', 1], ['magic_shortbow', 'Magic shortbow', 1], ['rune_full_helm', 'Rune full helm', 1],
    ['black_dragonhide_body', 'Dragonhide body', 1], ['black_dragonhide_chaps', 'Dragonhide chaps', 1], ['black_dragon_vambraces', 'Dragon vambraces', 1],
    ['amulet_of_power', 'Amulet of power', 1], ['leather_boots', 'Leather boots', 1], ['ring_of_recoil', 'Ring of recoil', 30],
    ['rune_arrow', 'Rune arrow', 3000], ['shark', 'Shark', 500], ['rope', 'Rope', 40], ['4doseprayerrestore', 'Prayer potion(4)', 60],
    ['4dose2antipoison', 'Superantipoison(4)', 30], ['4dose2attack', 'Super attack(4)', 30], ['4dose2strength', 'Super strength(4)', 30], ['4dose2defense', 'Super defence(4)', 30], ['ring_of_dueling_8', 'Ring of dueling(8)', 10],
    ['airrune', 'Air rune', 500], ['lawrune', 'Law rune', 100], ['coins', 'Coins', 10000]
].map(([debugName, displayName, qty]) => ({ debugName: String(debugName), displayName: String(displayName), qty: Number(qty) }));

function sample(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as typeof globalThis & WindowApi;
        const a: WindowApi['__rs2b0t'] = g.__rs2b0t;
        const bot = g.rs2b0t.runner.bot;
        return {
            actions: g.kqActions?.splice(0) ?? [],
            ropeClicks: g.kqRopeClicks ?? [],
            gateDelayHeld: g.kqGateDelay?.held ?? false,
            at: Date.now(), ingame: a.Game.ingame(), inCombat: a.Game.inCombat(), sceneReady: a.Game.sceneReady(), tick: a.Game.tick(), tile: a.Game.tile(), hp: a.Skills.effective('hitpoints'), prayer: a.Skills.effective('prayer'),
            serverTile: a.reader.serverTile(), animation: a.reader.selfAnim(), dialogs: a.reader.chatOptions(),
            food: a.Inventory.count('Shark'), pack: a.Inventory.items().map(i => ({ id: i.id, name: i.name, count: i.count })),
            bankOpen: a.reader.bankComId() !== -1, bank: a.reader.bankItems().map(i => ({ id: i.id, count: i.count })),
            ground: a.reader.groundItems().map(i => {
                const type = a.reader.objCatalog().find(o => o.id === i.id);
                return { id: i.id, count: i.count, name: i.name, tile: i.tile, bankId: type && type.certtemplate !== -1 ? type.certlink : i.id };
            }),
            ropes: a.reader.locs().map(l => l.id).filter(id => [3827, 3828, 3830, 3831].includes(id)),
            xp: { melee: a.Skills.xp('strength'), ranged: a.Skills.xp('ranged') },
            boosts: { attack: { base: a.Skills.level('attack'), effective: a.Skills.effective('attack') }, strength: { base: a.Skills.level('strength'), effective: a.Skills.effective('strength') }, defence: { base: a.Skills.level('defence'), effective: a.Skills.effective('defence') } },
            gear: a.Equipment.items().map(i => ({ id: i.id, count: i.count })), mode: a.Game.combatMode(), styles: a.Game.combatStyles(),
            protectMagic: a.reader.varp(95) === 1, protectMelee: a.reader.varp(97) === 1, prayers: Array.from({ length: 15 }, (_, i) => i + 83).filter(id => a.reader.varp(id) === 1),
            queens: a.Npcs.all().filter(n => [1158, 1159, 1160].includes(n.id)).map(n => ({ id: n.id, hp: n.health, total: n.snap.totalHealth, tile: n.tile(), serverTile: n.networkTile() })),
            visitors: a.Npcs.all().filter(n => ['genie', 'mysterious old man'].includes(n.name?.toLowerCase() ?? '')).map(n => ({ id: n.id, name: n.name, tile: n.tile(), targetsMe: n.targetsMe() })),
            status: bot?.status, stage: bot?.stage, restocking: bot?.restocking ?? false, trip: bot?.trip ?? 0, entries: bot?.entries ?? 0,
            sighting: bot?.['sighting'], lure: bot?.['lure'], searching: bot?.['searching'],
            kills: bot?.kills ?? 0, tripKills: bot?.tripKills ?? 0, dps: bot?.stats?.dps ?? 0, damage: bot?.stats?.damage ?? 0, looted: bot?.looted ?? 0, retreats: bot?.retreats ?? 0, runner: g.rs2b0t.runner.state,
            death: bot?.['death'] ?? null, recoveredItems: bot?.recoveredItems ?? [],
            logs: g.rs2b0t.runner.ctx?.log.slice(-25) ?? [], chat: a.reader.chat(8).map(c => c.text), deathChatCount: a.reader.chat(100).filter(c => /oh dear,? you are dead/i.test(c.text)).length
        };
    });
}

type Sample = Awaited<ReturnType<typeof sample>>;
const history: Sample[][] = [];
const observations = Bun.file(`${output}/observations.jsonl`).writer();
const minimumHp = names.map(() => Infinity);
let sampleCount = 0;
let pauseTrip: number | null = null;
let pauseNotice = args.recoveryProbe ? 'RECOVERY PROBE: one controlled teammate death; this is not a zero-death soak.' : 'Pause probe: waiting for all four to fight on a later visit.';
const soakTrips = () => evidence.trips.filter(t => t.number !== pauseTrip);
let result = 'FAIL';
let failure = '';
const evidence = new KqEvidence();
const recovery = new KqRecoveryEvidence(names);
const gateDelay = args.gateDelayProbe ? new KqGateDelay() : null;
const milestones = evidence.milestones;
const scenarioDeaths = () => args.recoveryProbe ? recovery.deaths.map(d => ({ ...d, phase: 'scenario' })) : (history.at(-1) ?? []).flatMap((s, player) => s.hp <= 0 || s.chat.some(line => /oh dear,? you are dead/i.test(line)) ? [{ player, at: s.at, expected: false, hp: s.hp, chat: s.chat, phase: 'scenario' }] : []);
const captured = new Set<string>();
const screenshots: Promise<unknown>[] = [];
async function drawChecklist(samples: Sample[]): Promise<void> {
    const lines = checks.map(check => `${milestones[check] ? '[x]' : '[ ]'} ${checklist[check]}`).join('\n');
    const progress = args.recoveryProbe ? `Expected deaths ${recovery.deaths.filter(d => d.expected).length}/1 | Unexpected ${recovery.deaths.filter(d => !d.expected).length}\nRecovered bows banked ${recovery.pickups.filter(p => p.bankedAt).length}` : `Trips ${soakTrips().length}/${args.trips} | Kills ${evidence.kills.length}/${args.trips}`;
    await Promise.all(pages.map((page, i) => page.evaluate(({ text, title }) => {
        const box = document.getElementById('kq-checklist');
        if (box) { box.querySelector('summary')!.textContent = title; box.querySelector('pre')!.textContent = text; }
    }, { title: `JiveKQ ${mode} ${checks.filter(check => milestones[check]).length}/${checks.length} | ${names[i]}`, text: `${pauseNotice}${gateDelay ? `\nGATE DELAY FIXTURE: ${gateDelay.proof.completedAt ? 'passed' : gateDelay.proof.releasedAt ? 'South released; checking both descents' : gateDelay.proof.startedAt ? 'holding South for 225 game ticks' : 'waiting for the first three at the surface'}` : ''}\n\n${lines}\n\n${progress}\n${samples[i].status ?? 'Waiting to start'}` })));
}
function capture(check: string): void {
    if (captured.has(check)) return;
    captured.add(check);
    console.log(`CHECK ${check}: PASS ${checklist[check] ?? check}`);
    if (['sharedKit', 'entered', 'formation', 'ranged', 'corner', 'looted', 'repeatFight', 'independentRestock', 'escape', 'restocked', 'reentered', 'pauseRetreat', 'recoveryDeath', 'recoveryRespawn', 'recoveryGround', 'recoveryPickup', 'recoveryBanked', 'recoveryWaiting'].includes(check)) {
        screenshots.push(Promise.allSettled(pages.map((page, i) => page.screenshot({ path: `${output}/${check}-${i + 1}.png` }))));
    }
}

async function finalPaint(): Promise<void> {
    await Promise.allSettled(screenshots);
    const results = await Promise.allSettled(pages.map(async (page, i) => {
        const canvas = await page.locator('#canvas').boundingBox();
        if (!canvas) throw new Error('Client canvas missing');
        const click = async (x: number, y: number) => {
            await page.mouse.click(canvas.x + x * canvas.width / 765, canvas.y + y * canvas.height / 503);
            await page.waitForTimeout(100);
        };
        await click(140, 355);
        await page.screenshot({ path: `${output}/team-chat-${i + 1}.png` });
        await click(40, 355);
        await click(35, 411);
        await page.screenshot({ path: `${output}/team-${i + 1}.png` });
        await page.screenshot({ path: `${output}/final-${i + 1}.png` });
    }));
    const failures = results.flatMap((r, i) => r.status === 'rejected' ? [`${names[i]} final screenshots: ${r.reason}`] : []);
    if (failures.length) throw new Error(failures.join('\n'));
}

async function cleanupClients() {
    if (gateDelay) await pages[3].evaluate(() => { const g = globalThis as typeof globalThis & WindowApi; if (g.kqGateDelay) g.kqGateDelay.released = true; }).catch(() => {});
    const startedAt = Date.now();
    const knownDeaths = scenarioDeaths().map(d => ({ player: d.player, chatCount: history.at(-1)?.[d.player]?.deathChatCount ?? 0, zeroHp: (history.at(-1)?.[d.player]?.hp ?? 1) <= 0 }));
    const cleanup = new KqCleanup(pages.length, startedAt, true, knownDeaths);
    const observations = Bun.file(`${output}/cleanup-observations.jsonl`).writer();
    const cleanupHistory: (Sample | CleanupSample)[][] = [];
    const failures = new Set<string>();
    const errorCount = errors.length;
    const pending = new Set<Promise<void>>();
    let sampleCount = 0;
    let lastPrint = 0;
    let capture: Promise<void> | undefined;
    console.log('CLEANUP: requesting retreat with runners active; observing until all four are safely logged out.');
    const perform = async (action: CleanupAction): Promise<boolean> => {
        const page = pages[action.player];
        if (action.kind === 'retreat') return page.evaluate(() => {
            const runner = (globalThis as typeof globalThis & WindowApi).rs2b0t.runner;
            if (runner.state === 'paused') runner.resume();
            if (!runner.bot?.requestRetreat) return false;
            runner.bot.requestRetreat('local harness cleanup');
            return true;
        });
        if (action.kind === 'teleport') {
            console.error(`FIXTURE CLEANUP: rescuing ${names[action.player]} to Shantay; this invalidates scenario success.`);
            return teleTo(page, { x: 3308, z: 3120, level: 0 }, 3, 2000);
        }
        if (action.kind === 'pause') return page.evaluate(() => {
            const runner = (globalThis as typeof globalThis & WindowApi).rs2b0t.runner;
            runner.pause();
            return runner.state === 'paused';
        });
        if (action.kind === 'stop') { await stopScript(page); return true; }
        return logout(page, 1500);
    };
    while (!cleanup.finished) {
        const samples = await Promise.all(pages.map(async (page, i): Promise<Sample | CleanupSample> => {
            try { return await sample(page); }
            catch (error) {
                failures.add(`${names[i]} cleanup observation: ${error}`);
                const ingame = await page.evaluate(() => (globalThis as typeof globalThis & { rs2b0t?: { client?: { ingame: boolean } } }).rs2b0t?.client?.ingame ?? null).catch(() => null);
                return { at: Date.now(), ingame, sceneReady: false, tile: null, serverTile: null, hp: -1, inCombat: true, runner: 'unknown', chat: [] };
            }
        }));
        observations.write(`${JSON.stringify(samples)}\n`);
        sampleCount++;
        cleanupHistory.push(samples);
        if (cleanupHistory.length > 600) cleanupHistory.shift();
        samples.forEach((s, i) => { if (s.ingame && s.hp >= 0) minimumHp[i] = Math.min(minimumHp[i], s.hp); });
        for (const action of cleanup.observe(samples)) {
            const operation = perform(action).then(ok => cleanup.complete(action, ok), error => cleanup.complete(action, false, String(error))).finally(() => pending.delete(operation));
            pending.add(operation);
        }
        if (cleanup.captureReady && !capture) {
            capture = finalPaint().catch(error => { failures.add(String(error)); }).finally(() => cleanup.releaseCapture());
        }
        if (Date.now() - lastPrint > 10_000) {
            console.log(`CLEANUP ${Math.round((Date.now() - startedAt) / 1000)}s: ${samples.map((s, i) => `${names[i]} ${s.ingame === false ? 'logged out' : `${s.runner} HP ${s.hp} at ${s.tile?.x},${s.tile?.z}`}`).join('; ')}`);
            lastPrint = Date.now();
            await observations.flush();
        }
        if (!cleanup.finished) await Bun.sleep(200);
    }
    await Promise.allSettled([...pending, ...(capture ? [capture] : [])]);
    await observations.end();
    return { startedAt, endedAt: Date.now(), sampleCount, loggedOut: pages.length, deaths: cleanup.deaths, fixtureTeleports: cleanup.fixtureTeleports, failures: [...cleanup.failures, ...failures, ...errors.slice(errorCount)], actions: cleanup.actions, history: cleanupHistory };
}
const started = Date.now();
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGUSR1', () => { interrupted = true; });
console.log(checks.map(check => `[ ] ${checklist[check]}`).join('\n'));
console.log(`KQ revision ${CLIENT_VERSION}: ${args.base}; evidence: ${output}`);
console.log(args.recoveryProbe ? `Recovery probe: exactly one intended death, survivor pickup and banking, victim returns Shantay waiting for gear; level ${args.level}; timeout ${args.minutes} minutes.` : `Soak target: ${args.trips} completed trips and at least ${args.trips} kills; level: ${args.level}; timeout: ${args.minutes} minutes after setup`);
if (gateDelay) console.log('GATE DELAY FIXTURE: South will wait at Shantay with a running heartbeat for 225 game ticks after the first three reach the surface rope. No runner pause is used.');
await Bun.write('out/jivekq-proof.json', JSON.stringify({ result: 'RUNNING', mode, gateDelay: gateDelay?.proof, expectedDeaths: args.recoveryProbe ? 1 : 0, names, evidenceDirectory: output, level: args.level, targetTrips: args.recoveryProbe ? null : args.trips, timeoutMinutes: args.minutes }, null, 2));
try {
    await Promise.all(pages.map(async (page, i) => {
        page.on('pageerror', error => errors.push(`${names[i]}: ${error.message}`));
        if (reuse) {
            await bootAndLogin(page, args.base, names[i], client.page);
        } else {
            await mainlandAccount(page, args.base, names[i], client.page);
            await cheatQuiet(page, 'setvar heroquest 15');
            await clearChatDialogs(page);
            await seedItemsToBank(page, seed, { x: 3269, z: 3167, level: 0 });
        }
        await stopScript(page);
        for (const skill of skills) {
            if (!(await cheatQuiet(page, `setstat ${skill} ${args.level}`))) throw new Error(`Could not set ${names[i]} ${skill}`);
        }
        await clearChatDialogs(page);
        await page.waitForFunction(({ skills, level }) => {
            const { Skills } = (globalThis as typeof globalThis & WindowApi).__rs2b0t;
            return skills.every(skill => Skills.level(skill) === level && Skills.effective(skill) === level);
        }, { skills, level: args.level }, { timeout: 10_000 });
        startingStats[names[i]] = await page.evaluate(skills => {
            const { Skills } = (globalThis as typeof globalThis & WindowApi).__rs2b0t;
            return skills.map(name => ({ name, base: Skills.level(name), effective: Skills.effective(name), xp: Skills.xp(name) }));
        }, skills);
        console.log(`FIXTURE ${names[i]}: all ${skills.length} enabled skills verified at ${args.level}`);
        if (i % 2 === 0) await seedItemsToBank(page, [{ debugName: 'shantay_pass', displayName: 'Shantay pass', qty: 3 }], { x: 3269, z: 3167, level: 0 });
        if (!(await teleTo(page, { x: 3308, z: 3120, level: 0 }, 3))) throw new Error('Could not reach Shantay bank');
        await setSettings(page, 'JiveKQ', { team: names.join(',') });
        await setSettings(page, 'Global', { navTeleports: false });
        await page.evaluate(() => {
            const g = globalThis as typeof globalThis & WindowApi;
            g.kqActions = [];
            g.kqRopeClicks = [];
            const { Game, Inventory, Skills, Npcs } = g.__rs2b0t;
            const input = g.rs2b0t.input;
            const interactLoc = input.interactLoc.bind(input);
            input.interactLoc = (...args) => {
                const loc = g.__rs2b0t.reader.locs().find(l => l.typecode === args[2] && [3828, 3831].includes(l.id));
                const tile = Game.tile();
                const sent = interactLoc(...args);
                if (sent && loc && tile) g.kqRopeClicks = [...g.kqRopeClicks.slice(-7), { id: loc.id, at: Date.now(), tile }];
                return sent;
            };
            const record = (kind: KqAction['kind']) => g.kqActions.push({ kind, tick: Game.tick(), at: Date.now(), food: Inventory.countById(385), hp: Skills.effective('hitpoints'), xp: Skills.xp('strength') + Skills.xp('ranged') });
            const heldOp = input.heldOp.bind(input);
            input.heldOp = (...args) => {
                const sent = heldOp(...args);
                if (sent && args[0] === 385 && args[3] === 1) record('eat');
                return sent;
            };
            const interactNpc = input.interactNpc.bind(input);
            input.interactNpc = (...args) => {
                const sent = interactNpc(...args);
                if (sent && Npcs.all().some(n => n.index === args[0] && [1158, 1160].includes(n.id) && n.snap.ops[args[1] - 1]?.toLowerCase() === 'attack')) record('attack');
                return sent;
            };
            const box = document.createElement('details');
            box.id = 'kq-checklist';
            box.open = true;
            box.style.cssText = 'position:fixed;right:8px;top:8px;z-index:99999;width:305px;background:#101814ed;color:#d8f3df;padding:10px;font:12px/1.5 monospace;border:1px solid #518966;border-radius:6px';
            box.append(document.createElement('summary'), document.createElement('pre'));
            box.querySelector('pre')!.style.cssText = 'white-space:pre-wrap;margin:6px 0 0';
            document.body.append(box);
        });
    }));
    await Bun.write(`${output}/starting-stats.json`, JSON.stringify(startingStats, null, 2));
    await Promise.all(pages.slice(0, 3).map(page => startScript(page, 'JiveKQ')));
    console.log(`Started three members of ${names.join(',')}; fourth joins after the readiness check`);
    let fourthStarted = false;
    let readySince = 0;
    let lastPrint = 0;
    let lastOverlay = 0;
    let reportedTrips = 0;
    const deadline = Date.now() + args.minutes * 60_000;
    while (Date.now() < deadline) {
        if (interrupted) throw new Error('Harness interrupted');
        const samples = await Promise.all(pages.map(sample));
        if (Date.now() >= deadline) break;
        observations.write(`${JSON.stringify(samples)}\n`);
        sampleCount++;
        samples.forEach((s, i) => { minimumHp[i] = Math.min(minimumHp[i], s.hp); });
        history.push(samples);
        if (history.length > 600) history.shift();
        if (args.recoveryProbe) recovery.observe(samples);
        if (!args.recoveryProbe || !recovery.fixture) evidence.observe(samples);
        if (gateDelay) {
            const startedAt = gateDelay.proof.startedAt;
            if (gateDelay.observe(samples, evidence.ropeAttempts)) {
                console.log(`GATE DELAY FIXTURE: ${gateDelay.proof.releaseTick! - gateDelay.proof.startTick!} game ticks elapsed with both leader ropes retained; releasing South.`);
                await pages[3].evaluate(() => { (globalThis as typeof globalThis & WindowApi).kqGateDelay!.released = true; });
            }
            if (!startedAt && gateDelay.proof.startedAt) console.log(`GATE DELAY FIXTURE: first three are physically at the surface; hold starts at tick ${gateDelay.proof.startTick}.`);
            if (gateDelay.proof.completedAt) milestones.gateDelay ??= gateDelay.proof.completedAt;
        }
        if (args.recoveryProbe) Object.assign(milestones, recovery.milestones);
        if (evidence.trips.length > reportedTrips) {
            for (const trip of evidence.trips.slice(reportedTrips)) console.log(`TRIP ${trip.number}: ${trip.kills} kills, ${Math.round((trip.returnedAt - trip.enteredAt) / 1000)}s, minimum HP ${trip.minimumHp.join('/')}, food ${trip.foodRemaining.join('/')}`);
            reportedTrips = evidence.trips.length;
        }
        if (!args.recoveryProbe && soakTrips().length >= args.trips && evidence.kills.length >= args.trips) milestones.soak ??= Date.now();
        if (Date.now() - lastOverlay > 1000) {
            await drawChecklist(samples);
            lastOverlay = Date.now();
        }
        if (!args.recoveryProbe && samples.some(s => s.chat.some(line => /oh dear,? you are dead/i.test(line)))) throw new Error('A team member died');
        if (samples.some((s, i) => (fourthStarted || i < 3) && !['running', 'paused'].includes(s.runner))) throw new Error('A KQ script stopped or crashed; inspect logs');
        if (!fourthStarted) {
            if (samples.some(s => s.tile && s.tile.z < 3117 || chamber(s) || s.tile?.level === 2)) throw new Error('A bot left before the fourth member joined');
            if (samples.slice(0, 3).every(s => s.status === 'waiting for four supplied players at Shantay bank')) readySince ||= Date.now();
            if (readySince && Date.now() - readySince >= 3000) {
                milestones.waitedForFourth = Date.now();
                await startScript(pages[3], 'JiveKQ');
                if (gateDelay) await pages[3].evaluate(() => {
                    const g = globalThis as typeof globalThis & WindowApi;
                    const bot = g.rs2b0t.runner.bot;
                    if (!bot) throw new Error('Gate-delay South bot is missing');
                    const state: NonNullable<WindowApi['kqGateDelay']> = { released: false, held: false };
                    g.kqGateDelay = state;
                    const loop = bot.loop.bind(bot);
                    bot.loop = async () => {
                        const tile = g.__rs2b0t.reader.serverTile();
                        state.held = !state.released && bot.trip === 1 && bot.stage === 'travel' && tile?.level === 0 && Math.abs(tile.x - 3308) <= 4 && Math.abs(tile.z - 3120) <= 4;
                        if (!state.held) await loop();
                    };
                });
                fourthStarted = true;
                capture('waitedForFourth');
                continue;
            }
        }
        for (const check of checks) if (milestones[check]) capture(check);
        if (args.recoveryProbe && !recovery.fixture && milestones.formation && recovery.ready(samples)) {
            pauseNotice = `CONTROLLED RECOVERY PROBE: dispatching ~hit 999 to ${names[recovery.player]}. Exactly one real death is expected; this run cannot count as a zero-death soak.`;
            console.log(pauseNotice);
            await drawChecklist(samples);
            recovery.arm(samples, Date.now());
            Object.assign(milestones, recovery.milestones);
            if (!(await cheatQuiet(pages[recovery.player], recovery.fixture!.command, 0))) throw new Error('Could not dispatch the controlled recovery death');
            continue;
        }
        if (!args.recoveryProbe && milestones.reentered && milestones.bankedLoot && milestones.repeatFight && evidence.readyForPause(samples) && !milestones.paused) {
            pauseTrip = Math.min(...evidence.crossings.chamber.map(t => t.length));
            pauseNotice = `DELIBERATE PAUSE PROBE: pausing ${names[3]} during combat on trip ${pauseTrip}. Group retreat is expected; this trip is excluded from the soak target.`;
            console.log(pauseNotice);
            milestones.pauseAnnounced = Date.now();
            await drawChecklist(samples);
            await pages[3].evaluate(() => (globalThis as typeof globalThis & WindowApi).rs2b0t.runner.pause());
            milestones.paused = Date.now();
            continue;
        }
        if (milestones.paused && !milestones.resumed && samples.slice(0, 3).every(s => (s.tile?.z ?? 9999) < 9000)) {
            pauseNotice = `PAUSE PROBE RECOVERY: three members escaped. Resuming ${names[3]} to verify its retreat.`;
            console.log(pauseNotice);
            await drawChecklist(samples);
            await pages[3].evaluate(() => (globalThis as typeof globalThis & WindowApi).rs2b0t.runner.resume());
            milestones.resumed = Date.now();
            continue;
        }
        if (milestones.resumed && !milestones.pauseRetreat && samples.every(s => (s.tile?.z ?? 9999) < 9000)) {
            milestones.pauseRetreat = Date.now();
            pauseNotice = `PAUSE PROBE PASSED: all four escaped. Trip ${pauseTrip} remains excluded from the soak target.`;
            console.log(pauseNotice);
            await drawChecklist(samples);
        }
        if (milestones.paused && !milestones.pauseRetreat && Date.now() - milestones.paused > 20_000) throw new Error('Team did not retreat after one client paused');
        if (Date.now() - lastPrint > 10_000) {
            console.log(JSON.stringify(samples.map((s, i) => ({ name: names[i], tile: s.tile, hp: s.hp, food: s.food, status: s.status, restocking: s.restocking, trip: s.trip, kills: s.kills, queens: s.queens }))));
            lastPrint = Date.now();
            await Bun.write(`${output}/current.json`, JSON.stringify(samples, null, 2));
            await observations.flush();
            await Bun.write(`${output}/progress.json`, JSON.stringify({ result: 'RUNNING', mode, gateDelay: gateDelay?.proof, ropeAttempts: evidence.ropeAttempts, recovery: args.recoveryProbe ? { fixture: recovery.fixture, deaths: recovery.deaths, pickups: recovery.pickups } : undefined, level: args.level, elapsedMs: Date.now() - started, targetTrips: args.recoveryProbe ? null : args.trips, completedTrips: args.recoveryProbe ? null : soakTrips().length, pauseTrip, trips: evidence.trips, kills: evidence.kills.length, restarts: evidence.restarts, eatAttacks: evidence.eatAttacks, searches: evidence.searches, independentRestocks: evidence.independentRestocks, escapes: evidence.escapes, milestones, minimumHp, sampleCount }, null, 2));
        }
        if (Date.now() < deadline && checks.every(check => milestones[check])) { await drawChecklist(samples); result = 'PASS'; break; }
        await pages[0].waitForTimeout(200);
    }
    if (result !== 'PASS' && args.recoveryProbe) throw new Error(`Recovery probe timed out. Missing checks: ${checks.filter(check => !milestones[check]).join(', ')}`);
    if (result !== 'PASS') throw new Error(`Timed out with ${soakTrips().length}/${args.trips} trips and ${evidence.kills.length}/${args.trips} kills. Missing checks: ${checks.filter(check => !milestones[check]).join(', ')}`);
    if (errors.length) throw new Error(errors.join('\n'));
} catch (error) {
    result = 'FAIL';
    failure = String(error);
    console.error(failure);
} finally {
    const cleanup = await cleanupClients();
    if (cleanup.failures.length) {
        result = 'FAIL';
        failure = [failure, ...cleanup.failures].filter(Boolean).join('\n');
    }
    await observations.end();
    const deaths = [...scenarioDeaths(), ...cleanup.deaths.map(d => ({ ...d, expected: false, phase: 'cleanup' }))];
    const summary = {
        result, failure, mode, soakEligible: !args.recoveryProbe, expectedDeaths: args.recoveryProbe ? 1 : 0, deaths, unexpectedDeaths: deaths.filter(d => !d.expected).length,
        recovery: args.recoveryProbe ? { fixture: recovery.fixture, deaths: recovery.deaths, ground: recovery.ground, pickups: recovery.pickups, milestones: recovery.milestones } : undefined,
        cleanup, names, base: args.base, revision: CLIENT_VERSION, fixture: `${reuse ? 'reused' : 'fresh'} level-${args.level} accounts`, level: args.level, startingStats,
        elapsedMs: Date.now() - started, milestones, errors, bundleSha256, crossings: evidence.crossings, ropeCounts: evidence.ropeCounts, sharedRopes: evidence.sharedRopes, ropeAttempts: evidence.ropeAttempts, gateDelay: gateDelay?.proof,
        targetTrips: args.recoveryProbe ? null : args.trips, timeoutMinutes: args.minutes, sampleCount, completedTrips: args.recoveryProbe ? null : soakTrips().length, pauseTrip, trips: evidence.trips,
        xpGains: evidence.xpGains, kills: evidence.kills, restarts: evidence.restarts, eatAttacks: evidence.eatAttacks, searches: evidence.searches, independentRestocks: evidence.independentRestocks, escapes: evidence.escapes, loot: evidence.loot, minimumHp
    };
    await Bun.write(`${output}/proof.json`, JSON.stringify({ ...summary, history }, null, 2));
    await Bun.write('out/jivekq-proof.json', JSON.stringify({ ...summary, evidenceDirectory: output }, null, 2));
    await Bun.write(`${output}/progress.json`, JSON.stringify(summary, null, 2));
    const report = (args.recoveryProbe ? [
        '# JiveKQ controlled death recovery probe', '', `Result: **${result}**`, '',
        'This probe deliberately causes one real player death. It is ineligible for zero-death soak validation.', '',
        `Server: ${args.base}, revision ${CLIENT_VERSION}. Fixture: ${summary.fixture}.`, '',
        `Bundle SHA-256: ${bundleSha256}`, '', `Controlled victim: ${names[recovery.player]}. Command: ${recovery.fixture?.command ?? 'not dispatched'}.`, '',
        `Expected deaths observed: ${deaths.filter(d => d.expected).length}/1. Unexpected deaths: ${summary.unexpectedDeaths}.`, '', failure, '',
        '| Check | Result |', '|---|---|', ...checks.map(check => `| ${checklist[check]} | ${milestones[check] ? 'PASS' : 'MISSING'} |`), '',
        '| Collector | Owner | Item | Inventory gain | Bank deposit |', '|---|---|---|---|---|',
        ...recovery.pickups.map(p => `| ${names[p.player]} | ${p.owner} | Magic shortbow (${p.id}) | ${p.count} | ${p.bankedAt ? 'Observed at Shantay' : 'Missing'} |`), '',
        'Bank proof requires inventory to decrease, bank stock to increase, and combined inventory and bank stock to retain the recovered bow beyond the original loadout.', '',
        `Cleanup: ${cleanup.loggedOut}/4 verified logged out; ${cleanup.deaths.length} additional deaths; ${cleanup.fixtureTeleports.length} fixture rescue teleports.`, '',
        '[Starting levels and XP](starting-stats.json) · [Full proof](proof.json) · [Scenario observations](observations.jsonl) · [Cleanup observations](cleanup-observations.jsonl)', '',
        '[Team messages](team-chat-1.png) · [Team readiness and stats](team-1.png)', '',
        ...[...captured].filter(check => check.startsWith('recovery') && check !== 'recoveryArmed').flatMap(check => [`## ${check}`, '', ...names.map((name, i) => `![${name}](${check}-${i + 1}.png)`), ''])
    ] : [
        '# JiveKQ local validation', '', `Result: **${result}**`, '', `Server: ${args.base}, revision ${CLIENT_VERSION}. Fixture: ${summary.fixture}.`,
        '', `Starting stats: ${Object.keys(startingStats).length}/4 accounts verified with all ${skills.length} enabled skills at level ${args.level}. [Recorded levels and XP](starting-stats.json).`,
        '', `Bundle SHA-256: ${bundleSha256}`, '', failure, '', '| Check | Result |', '|---|---|',
        ...checks.map(check => `| ${checklist[check]} | ${milestones[check] ? 'PASS' : 'MISSING'} |`), '',
        `Strength XP gained: ${evidence.xpGains.melee.join(', ')}. Ranged XP gained: ${evidence.xpGains.ranged.join(', ')}.`, '',
        `Loot banked: ${evidence.loot.filter(l => l.bankedAt).map(l => `${names[l.player]}: ${l.count} ${l.name ?? l.id}`).join('; ') || 'none'}.`, '',
        `Completed soak trips: ${soakTrips().length}/${args.trips}. Observed kills: ${evidence.kills.length}/${args.trips} minimum. Timeout: ${args.minutes} minutes after setup.`, '',
        `Shared ropes observed and reused: ${evidence.sharedRopes.join(', ') || 'none'}.`, '',
        `Eat and attack in the same tick, followed by food consumption and combat XP: ${evidence.eatAttacks.length} observations across ${new Set(evidence.eatAttacks.map(e => e.player)).size}/4 accounts.`, '',
        `Queen searches ending in observed movement, visibility and combat XP: ${evidence.searches.length}.`, '',
        `Respawn to own Attack / confirmed XP: ${evidence.restarts.map(r => `${names[r.player]} ${((r.attackedAt - r.spawnedAt) / 1000).toFixed(2)}s / ${((r.damagedAt - r.spawnedAt) / 1000).toFixed(2)}s`).join(', ') || 'none observed'}.`, '',
        `Independent restocks: ${evidence.independentRestocks.map(r => `${names[r.player]} banked while ${names[r.combatPlayer]} stayed in the chamber (${r.xpGains.melee + r.xpGains.ranged} combat XP, ${r.queenDamage} observed queen HP lost)`).join('; ') || 'none observed'}.`, '',
        `Camelot then arena escapes: ${evidence.escapes.length}, covering ${new Set(evidence.escapes.map(e => e.player)).size}/4 accounts.`, '',
        `Trip ${pauseTrip ?? 'pending'} is the pause recovery probe and is excluded from the soak target.`, '',
        '| Trip | Chamber to bank | Kills | Minimum HP (W/E/N/S) | Food on return (W/E/N/S) | Zero-XP emergency departures |', '|---|---|---|---|---|---|',
        ...evidence.trips.map(t => `| ${t.number}${t.number === pauseTrip ? ' (pause probe)' : ''} | ${Math.round((t.returnedAt - t.enteredAt) / 1000)}s | ${t.kills} | ${t.minimumHp.join('/')} | ${t.foodRemaining.join('/')} | ${t.excusedPlayers.map(e => `${names[e.player]}: ${e.visitor ? `own-target ${e.visitor.name}, ` : ''}HP ${e.hp}, food ${e.food}`).join('; ') || 'none'} |`), '',
        '[Team messages](team-chat-1.png) · [Team readiness and stats](team-1.png)', '',
        `Observed deaths: ${deaths.length}. Cleanup: ${cleanup.loggedOut}/4 verified logged out; ${cleanup.deaths.length} additional deaths; ${cleanup.fixtureTeleports.length} fixture rescue teleports.`, '',
        '[Summary and last 600 observations](proof.json) · [Full observations](observations.jsonl) · [Cleanup observations](cleanup-observations.jsonl)', '',
        ...[...captured].filter(check => ['formation', 'ranged', 'corner', 'looted', 'independentRestock'].includes(check)).flatMap(check => [
            `## ${check}`, '', ...names.map((name, i) => `![${name}](${check}-${i + 1}.png)`), ''
        ])
    ]).join('\n');
    const gateReport = gateDelay ? `\n\n## Controlled gate delay\n\nSouth was held at Shantay with its runner active. Target: ${gateDelay.proof.holdTicks} game ticks after the first three physically reached the surface gate. Observed hold: ${gateDelay.proof.releaseTick !== undefined ? gateDelay.proof.releaseTick - gateDelay.proof.startTick! : 'incomplete'} ticks. Both leader ropes were required throughout the hold. Synchronized surface and chamber descents after release: ${gateDelay.proof.completedAt ? 'PASS' : 'MISSING'}.\n` : '';
    await Bun.write(`${output}/report.md`, report + gateReport);
    await browser.close();
    client.cleanup();
}
console.log(`${result}: ${output}/report.md`);
if (result !== 'PASS') process.exitCode = 1;
