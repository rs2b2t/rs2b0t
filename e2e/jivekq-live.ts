import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { CLIENT_VERSION } from '../src/client/io/ClientProt.js';
import { CHECKLIST, CHECKS, KqEvidence, chamber } from './lib/kqEvidence.js';
import { kqOptions } from './lib/kqOptions.js';
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
import { bootAndLogin, cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

interface WindowApi {
    __rs2b0t: { Game: typeof Game; Inventory: typeof Inventory; Equipment: typeof Equipment; Npcs: typeof Npcs; Skills: typeof Skills; Prayer: typeof Prayer; reader: typeof reader };
    rs2b0t: { runner: { state: string; bot: JiveKQ | null; ctx: { log: { time: number; level: string; msg: string }[] } | null; pause(): void; resume(): void } };
}

const args = kqOptions(process.argv.slice(2));
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
const seed: BankSeedItem[] = [
    ['dragon_mace', 'Dragon mace', 1], ['magic_shortbow', 'Magic shortbow', 1], ['rune_full_helm', 'Rune full helm', 1],
    ['black_dragonhide_body', 'Dragonhide body', 1], ['black_dragonhide_chaps', 'Dragonhide chaps', 1], ['black_dragon_vambraces', 'Dragon vambraces', 1],
    ['amulet_of_power', 'Amulet of power', 1], ['leather_boots', 'Leather boots', 1], ['ring_of_recoil', 'Ring of recoil', 30],
    ['rune_arrow', 'Rune arrow', 3000], ['shark', 'Shark', 500], ['rope', 'Rope', 40], ['4doseprayerrestore', 'Prayer potion(4)', 60],
    ['4dose2antipoison', 'Superantipoison(4)', 30], ['4dose2attack', 'Super attack(4)', 30], ['4dose2strength', 'Super strength(4)', 30], ['4dose2defense', 'Super defence(4)', 30], ['ring_of_dueling_8', 'Ring of dueling(8)', 10],
    ['coins', 'Coins', 10000]
].map(([debugName, displayName, qty]) => ({ debugName: String(debugName), displayName: String(displayName), qty: Number(qty) }));

function sample(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as typeof globalThis & WindowApi;
        const a: WindowApi['__rs2b0t'] = g.__rs2b0t;
        const bot = g.rs2b0t.runner.bot;
        return {
            at: Date.now(), sceneReady: a.Game.sceneReady(), tick: a.Game.tick(), tile: a.Game.tile(), hp: a.Skills.effective('hitpoints'), prayer: a.Skills.effective('prayer'),
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
            queens: a.Npcs.all().filter(n => [1158, 1159, 1160].includes(n.id)).map(n => ({ id: n.id, hp: n.health, total: n.snap.totalHealth, tile: n.tile() })),
            status: bot?.status, stage: bot?.stage, trip: bot?.trip ?? 0, entries: bot?.entries ?? 0,
            kills: bot?.kills ?? 0, tripKills: bot?.tripKills ?? 0, dps: bot?.stats?.dps ?? 0, damage: bot?.stats?.damage ?? 0, looted: bot?.looted ?? 0, retreats: bot?.retreats ?? 0, runner: g.rs2b0t.runner.state,
            logs: g.rs2b0t.runner.ctx?.log.slice(-25) ?? [], chat: a.reader.chat(8).map(c => c.text)
        };
    });
}

type Sample = Awaited<ReturnType<typeof sample>>;
const history: Sample[][] = [];
const observations = Bun.file(`${output}/observations.jsonl`).writer();
const minimumHp = names.map(() => Infinity);
let sampleCount = 0;
let pauseTrip: number | null = null;
const soakTrips = () => evidence.trips.filter(t => t.number !== pauseTrip);
let result = 'FAIL';
let failure = '';
const evidence = new KqEvidence();
const milestones = evidence.milestones;
const captured = new Set<string>();
const screenshots: Promise<unknown>[] = [];
async function drawChecklist(samples: Sample[]): Promise<void> {
    const lines = CHECKS.map(check => `${milestones[check] ? '[x]' : '[ ]'} ${CHECKLIST[check]}`).join('\n');
    await Promise.all(pages.map((page, i) => page.evaluate(({ text, title }) => {
        const box = document.getElementById('kq-checklist');
        if (box) { box.querySelector('summary')!.textContent = title; box.querySelector('pre')!.textContent = text; }
    }, { title: `JiveKQ ${CHECKS.filter(check => milestones[check]).length}/${CHECKS.length} | ${names[i]}`, text: `${lines}\n\nTrips ${soakTrips().length}/${args.trips} | Kills ${evidence.kills.length}/${args.trips}\n${samples[i].status ?? 'Waiting to start'}` })));
}
function capture(check: string): void {
    if (captured.has(check)) return;
    captured.add(check);
    console.log(`CHECK ${check}: PASS ${CHECKLIST[check as keyof typeof CHECKLIST] ?? check}`);
    if (['sharedKit', 'entered', 'formation', 'ranged', 'corner', 'looted', 'repeatFight', 'restocked', 'reentered', 'pauseRetreat'].includes(check)) {
        screenshots.push(Promise.allSettled(pages.map((page, i) => page.screenshot({ path: `${output}/${check}-${i + 1}.png` }))));
    }
}
const started = Date.now();
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGUSR1', () => { interrupted = true; });
console.log(CHECKS.map(check => `[ ] ${CHECKLIST[check]}`).join('\n'));
console.log(`KQ revision ${CLIENT_VERSION}: ${args.base}; evidence: ${output}`);
console.log(`Soak target: ${args.trips} completed trips and at least ${args.trips} kills; timeout: ${args.minutes} minutes after setup`);
await Bun.write('out/jivekq-proof.json', JSON.stringify({ result: 'RUNNING', names, evidenceDirectory: output, targetTrips: args.trips, timeoutMinutes: args.minutes }, null, 2));
try {
    await Promise.all(pages.map(async (page, i) => {
        page.on('pageerror', error => errors.push(`${names[i]}: ${error.message}`));
        if (reuse) {
            await bootAndLogin(page, args.base, names[i], client.page);
        } else {
            await mainlandAccount(page, args.base, names[i], client.page);
            await maxmeAndClearDialogs(page);
            await cheatQuiet(page, 'setvar heroquest 15');
            await clearChatDialogs(page);
            await seedItemsToBank(page, seed, { x: 3269, z: 3167, level: 0 });
        }
        await stopScript(page);
        if (i % 2 === 0) await seedItemsToBank(page, [{ debugName: 'shantay_pass', displayName: 'Shantay pass', qty: 3 }], { x: 3269, z: 3167, level: 0 });
        if (!(await teleTo(page, { x: 3308, z: 3120, level: 0 }, 3))) throw new Error('Could not reach Shantay bank');
        await setSettings(page, 'JiveKQ', { team: names.join(',') });
        await setSettings(page, 'Global', { navTeleports: false });
        await page.evaluate(() => {
            const box = document.createElement('details');
            box.id = 'kq-checklist';
            box.open = true;
            box.style.cssText = 'position:fixed;right:8px;top:8px;z-index:99999;width:305px;background:#101814ed;color:#d8f3df;padding:10px;font:12px/1.5 monospace;border:1px solid #518966;border-radius:6px';
            box.append(document.createElement('summary'), document.createElement('pre'));
            box.querySelector('pre')!.style.cssText = 'white-space:pre-wrap;margin:6px 0 0';
            document.body.append(box);
        });
    }));
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
        evidence.observe(samples);
        if (evidence.trips.length > reportedTrips) {
            for (const trip of evidence.trips.slice(reportedTrips)) console.log(`TRIP ${trip.number}: ${trip.kills} kills, ${Math.round((trip.returnedAt - trip.enteredAt) / 1000)}s, minimum HP ${trip.minimumHp.join('/')}, food ${trip.foodRemaining.join('/')}`);
            reportedTrips = evidence.trips.length;
        }
        if (soakTrips().length >= args.trips && evidence.kills.length >= args.trips) milestones.soak ??= Date.now();
        if (Date.now() - lastOverlay > 1000) {
            await drawChecklist(samples);
            lastOverlay = Date.now();
        }
        if (samples.some(s => s.chat.some(line => /oh dear, you are dead/i.test(line)))) throw new Error('A team member died');
        if (samples.some((s, i) => (fourthStarted || i < 3) && !['running', 'paused'].includes(s.runner))) throw new Error('A KQ script stopped or crashed; inspect logs');
        if (!fourthStarted) {
            if (samples.some(s => s.tile && s.tile.z < 3117 || chamber(s) || s.tile?.level === 2)) throw new Error('A bot left before the fourth member joined');
            if (samples.slice(0, 3).every(s => s.status === 'waiting for four supplied players at Shantay bank')) readySince ||= Date.now();
            if (readySince && Date.now() - readySince >= 3000) {
                milestones.waitedForFourth = Date.now();
                await startScript(pages[3], 'JiveKQ');
                fourthStarted = true;
                capture('waitedForFourth');
                continue;
            }
        }
        for (const check of CHECKS) if (milestones[check]) capture(check);
        if (milestones.reentered && milestones.bankedLoot && milestones.repeatFight && samples.every(chamber) && !milestones.paused) {
            pauseTrip = Math.min(...evidence.crossings.chamber.map(t => t.length));
            await pages[3].evaluate(() => (globalThis as typeof globalThis & WindowApi).rs2b0t.runner.pause());
            milestones.paused = Date.now();
            continue;
        }
        if (milestones.paused && !milestones.resumed && samples.slice(0, 3).every(s => (s.tile?.z ?? 9999) < 9000)) {
            await pages[3].evaluate(() => (globalThis as typeof globalThis & WindowApi).rs2b0t.runner.resume());
            milestones.resumed = Date.now();
            continue;
        }
        if (milestones.resumed && samples.every(s => (s.tile?.z ?? 9999) < 9000)) milestones.pauseRetreat ??= Date.now();
        if (milestones.paused && !milestones.pauseRetreat && Date.now() - milestones.paused > 20_000) throw new Error('Team did not retreat after one client paused');
        if (Date.now() - lastPrint > 10_000) {
            console.log(JSON.stringify(samples.map((s, i) => ({ name: names[i], tile: s.tile, hp: s.hp, food: s.food, status: s.status, trip: s.trip, kills: s.kills, queens: s.queens }))));
            lastPrint = Date.now();
            await Bun.write(`${output}/current.json`, JSON.stringify(samples, null, 2));
            await observations.flush();
            await Bun.write(`${output}/progress.json`, JSON.stringify({ result: 'RUNNING', elapsedMs: Date.now() - started, targetTrips: args.trips, completedTrips: soakTrips().length, pauseTrip, trips: evidence.trips, kills: evidence.kills.length, restarts: evidence.restarts, milestones, minimumHp, sampleCount }, null, 2));
        }
        if (Date.now() < deadline && CHECKS.every(check => milestones[check])) { await drawChecklist(samples); capture('pauseRetreat'); result = 'PASS'; break; }
        await pages[0].waitForTimeout(200);
    }
    if (result !== 'PASS') throw new Error(`Timed out with ${soakTrips().length}/${args.trips} trips and ${evidence.kills.length}/${args.trips} kills. Missing checks: ${CHECKS.filter(check => !milestones[check]).join(', ')}`);
    if (errors.length) throw new Error(errors.join('\n'));
    for (const [i, page] of pages.entries()) {
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
    }
} catch (error) {
    result = 'FAIL';
    failure = String(error);
    console.error(failure);
} finally {
    await observations.end();
    const summary = {
        result, failure, names, base: args.base, revision: CLIENT_VERSION, fixture: reuse ? 'reused accounts' : 'fresh max-stat accounts',
        elapsedMs: Date.now() - started, milestones, errors, bundleSha256, crossings: evidence.crossings, ropeCounts: evidence.ropeCounts,
        targetTrips: args.trips, timeoutMinutes: args.minutes, sampleCount, completedTrips: soakTrips().length, pauseTrip, trips: evidence.trips,
        xpGains: evidence.xpGains, kills: evidence.kills, restarts: evidence.restarts, loot: evidence.loot, minimumHp
    };
    await Bun.write(`${output}/proof.json`, JSON.stringify({ ...summary, history }, null, 2));
    await Bun.write('out/jivekq-proof.json', JSON.stringify({ ...summary, evidenceDirectory: output }, null, 2));
    await Bun.write(`${output}/progress.json`, JSON.stringify(summary, null, 2));
    const report = [
        '# JiveKQ local validation', '', `Result: **${result}**`, '', `Server: ${args.base}, revision ${CLIENT_VERSION}. Fixture: ${summary.fixture}.`,
        '', `Bundle SHA-256: ${bundleSha256}`, '', failure, '', '| Check | Result |', '|---|---|',
        ...CHECKS.map(check => `| ${CHECKLIST[check]} | ${milestones[check] ? 'PASS' : 'MISSING'} |`), '',
        `Strength XP gained: ${evidence.xpGains.melee.join(', ')}. Ranged XP gained: ${evidence.xpGains.ranged.join(', ')}.`, '',
        `Loot banked: ${evidence.loot.filter(l => l.bankedAt).map(l => `${names[l.player]}: ${l.count} ${l.name ?? l.id}`).join('; ') || 'none'}.`, '',
        `Completed soak trips: ${soakTrips().length}/${args.trips}. Observed kills: ${evidence.kills.length}/${args.trips} minimum. Timeout: ${args.minutes} minutes after setup.`, '',
        `Respawn to first damage: ${evidence.restarts.map(r => `${((r.damagedAt - r.spawnedAt) / 1000).toFixed(2)}s`).join(', ') || 'none observed'}.`, '',
        `Trip ${pauseTrip ?? 'pending'} is the pause recovery probe and is excluded from the soak target.`, '',
        '| Trip | Chamber to bank | Kills | Minimum HP (W/E/N/S) | Food on return (W/E/N/S) |', '|---|---|---|---|---|',
        ...evidence.trips.map(t => `| ${t.number}${t.number === pauseTrip ? ' (pause probe)' : ''} | ${Math.round((t.returnedAt - t.enteredAt) / 1000)}s | ${t.kills} | ${t.minimumHp.join('/')} | ${t.foodRemaining.join('/')} |`), '',
        '[Team messages](team-chat-1.png) · [Team readiness and stats](team-1.png)', '',
        '[Summary and last 600 observations](proof.json) · [Full observations](observations.jsonl)', '',
        ...[...captured].filter(check => ['formation', 'ranged', 'corner', 'looted'].includes(check)).flatMap(check => [
            `## ${check}`, '', ...names.map((name, i) => `![${name}](${check}-${i + 1}.png)`), ''
        ])
    ].join('\n');
    await Bun.write(`${output}/report.md`, report);
    await Promise.allSettled(screenshots);
    await Promise.allSettled(pages.map(async (page, i) => {
        try { await page.screenshot({ path: `${output}/final-${i + 1}.png` }); }
        finally { await stopScript(page); await logout(page); }
    }));
    await browser.close();
    client.cleanup();
}
console.log(`${result}: ${output}/report.md`);
if (result !== 'PASS') process.exitCode = 1;
