import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

import Skill from '../src/client/shell/Skill.js';
import { auditSupplies } from '../src/bot/scripts/AccountLeveler/shopping.js';
import type { LevelerSnapshot } from '../src/bot/scripts/AccountLeveler/types.js';
import { LOGOUT_BUTTON_COM } from './lib/cleanLogout.js';
import { engineLoginKey } from './lib/engineLoginKey.js';
import { launchBrowser, setSettings, simUnreachable, stopScript } from './lib/harness.js';
import { mainlandAccount, seedItemsToBank, startScript } from './tutorial/harness.js';

type Item = { id: number; name: string | null; count: number };
type Tile = { x: number; z: number; level: number };
type Abi = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; logoutTimer?: number };
        actions: { ifButton(com: number): boolean };
        setAutoLogin(on: boolean): void;
        protocol: { version: number };
        build: unknown;
        renderGate: { setEnabled(on: boolean): void };
        runner: {
            state: string;
            ctx: { log: { level: string; msg: string }[] } | null;
            bot: {
                status?: string; detail?: string; phase?: string;
                session?: { plan: { id: string; objective: string; script: string; combat?: boolean; settings: Record<string, unknown> } | null; memory: { deaths: number } };
            } | null;
        };
        reader: {
            skillCount(): number;
            skillUsed(i: number): boolean;
            inCombat(): boolean;
            stat(i: number): { name: string; base: number; xp: number; effective: number };
            worldTile(): Tile | null;
            inventory(): Item[];
            equipment(): Item[];
            chat(n: number): { text: string }[];
        };
    };
    __rs2b0t: { Bank: { items(): Item[]; snapshotReady(): boolean; isOpen(): boolean; close(): Promise<boolean> } };
    __levelerBank?: { at: number; items: Item[] };
};
type Client = { user: string; context: BrowserContext; page: Page };
type Sample = Awaited<ReturnType<typeof sample>>;
type Recovery = { death: number; observedAt: number; combatXp: number; recoveredAt?: number; recoveredCombatXp?: number; recoveredCamp?: string };
type Cleanup = { user: string; loggedOut: boolean; attempts: number; durationMs: number; reason: string };

function combatXp(s: Sample): number {
    return ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'].reduce((sum, name) => sum + (s.skills[name]?.xp ?? 0), 0);
}

function campAt(s: Sample): string | null {
    if (!s.ingame || s.state !== 'running' || s.phase !== 'train' || !s.plan?.combat || !s.tile || (s.skills.hitpoints?.effective ?? 0) <= 0) return null;
    const anchor = s.plan.settings.coordinates as Partial<Tile> | undefined;
    const radius = s.plan.settings.leashRadius;
    if (typeof anchor?.x !== 'number' || typeof anchor.z !== 'number' || typeof radius !== 'number') return null;
    return s.tile.level === (anchor.level ?? 0) && Math.max(Math.abs(s.tile.x - anchor.x), Math.abs(s.tile.z - anchor.z)) <= radius ? s.plan.id : null;
}

function campGain(previous: Sample | undefined, s: Sample): number {
    const camp = campAt(s);
    return previous && camp && campAt(previous) === camp && previous.deaths === s.deaths ? Math.max(0, combatXp(s) - combatXp(previous)) : 0;
}

function recoveredAtCamp(event: Recovery, previous: Sample | undefined, s: Sample): boolean {
    return !!previous && previous.at >= event.observedAt && previous.deaths >= event.death && campGain(previous, s) > 0 && combatXp(s) > event.combatXp;
}

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
    const index = argv.indexOf(name);
    if (index < 0) return fallback;
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return argv[index + 1];
}
if (argv.includes('--help')) {
    console.log('bun e2e/account-leveler-concurrent-test.ts [--base http://localhost:8890] [--count 20] [--minutes 15] [--gold 100000] [--interval 20] [--fixture gold-only|combat-stocked]');
    process.exit(0);
}
const base = new URL(arg('--base', 'http://localhost:8890'));
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error('Only a local HTTP engine is permitted');
const count = Number(arg('--count', '20'));
const minutes = Number(arg('--minutes', '15'));
const gold = Number(arg('--gold', '100000'));
const interval = Number(arg('--interval', '20'));
const fixture = arg('--fixture', 'gold-only');
const pilot = count < 20 && minutes < 2;
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--count must be 1 through 20');
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) throw new Error('--minutes must be positive and at most 120');
if (![100000, 500000].includes(gold)) throw new Error('--gold must be 100000 or 500000');
if (!Number.isFinite(interval) || interval < 15 || interval > 30) throw new Error('--interval must be 15 through 30 seconds');
if (!['gold-only', 'combat-stocked'].includes(fixture)) throw new Error('--fixture must be gold-only or combat-stocked');
const initialSnapshot: LevelerSnapshot = {
    levels: Object.fromEntries(Skill.names.filter((_, i) => Skill.used[i]).map(name => [name, name === 'hitpoints' ? 10 : 1])),
    stock: { coins: gold }, bankReady: true, quests: {}, target: 40, wilderness: true, now: 0
};
const itemDefinitions = new Map<string, { id: number; debugName: string }>(([
    ['Iron scimitar', 1323, 'iron_scimitar'], ['Iron platebody', 1115, 'iron_platebody'], ['Iron platelegs', 1067, 'iron_platelegs'],
    ['Shortbow', 841, 'shortbow'], ['Staff of air', 1381, 'staff_of_air'], ['Mind rune', 558, 'mindrune'],
    ['Steel axe', 1353, 'steel_axe'], ['Tinderbox', 590, 'tinderbox'], ['Knife', 946, 'knife'], ['Hammer', 2347, 'hammer'],
    ['Small fishing net', 303, 'net'], ['Needle', 1733, 'needle'], ['Bronze arrow', 882, 'bronze_arrow'], ['Thread', 1734, 'thread']
] as [string, number, string][]).map(([name, id, debugName]) => [name, { id, debugName }]));
const initialAudit = auditSupplies(initialSnapshot);
const seededBank = [{ id: 995, debugName: 'coins', displayName: 'Coins', qty: gold }];
if (fixture === 'combat-stocked') {
    for (const need of initialAudit.needs) {
        const item = itemDefinitions.get(need.item);
        if (!item || (need.id !== undefined && item.id !== need.id)) throw new Error(`No verified fixture item for ${need.item}`);
        seededBank.push({ ...item, displayName: need.item, qty: need.count });
    }
    const stock = Object.fromEntries(seededBank.flatMap(item => [[item.displayName.toLowerCase(), item.qty], [`#${item.id}`, item.qty]]));
    if (auditSupplies({ ...initialSnapshot, stock }).needs.length) throw new Error('combat-stocked fixture still requires startup purchases');
}
const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
const tag = `leveler-${stamp}`;
const output = join('out', 'e2e', tag);
const engine = process.env.ENGINE_DIR ?? join(homedir(), 'code', 'rs2b2t-engine');
const users = Array.from({ length: count }, (_, i) => `al${stamp.replaceAll('-', '').slice(-8)}${String(i).padStart(2, '0')}`);
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });

async function timeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); })]);
    } finally {
        clearTimeout(timer);
    }
}

async function sample(client: Client) {
    return timeout(client.page.evaluate(user => {
        const globals = globalThis as never as Abi;
        const { rs2b0t: g, __rs2b0t: api } = globals;
        const stats = Array.from({ length: g.reader.skillCount() }, (_, i) => i).filter(i => g.reader.skillUsed(i)).map(i => g.reader.stat(i));
        const bot = g.runner.bot;
        const bank = globals.__levelerBank?.items ?? [];
        return {
            at: Date.now(), user, ingame: g.client.ingame, sceneReady: g.client.sceneState === 2,
            protocol: g.protocol.version, build: g.build,
            skills: Object.fromEntries(stats.map(s => [s.name, { level: s.base, xp: s.xp, effective: s.effective }])),
            totalLevel: stats.reduce((sum, s) => sum + s.base, 0),
            totalXp: stats.reduce((sum, s) => sum + s.xp, 0),
            tile: g.reader.worldTile(), state: g.runner.state,
            status: bot?.status ?? '', detail: bot?.detail ?? '', phase: bot?.phase ?? '',
            plan: bot?.session?.plan ? { id: bot.session.plan.id, objective: bot.session.plan.objective, script: bot.session.plan.script, combat: bot.session.plan.combat, settings: bot.session.plan.settings } : null,
            deaths: bot?.session?.memory.deaths ?? 0,
            bank, bankObservedAt: globals.__levelerBank?.at ?? null, bankOpen: api.Bank.isOpen(), bankSnapshotReady: api.Bank.snapshotReady(),
            bankFood: bank.filter(i => /^(shrimps|trout|salmon|lobster|tuna|swordfish|shark|cooked meat|bread)$/i.test(i.name ?? '')),
            inventory: g.reader.inventory().map(({ id, name, count }) => ({ id, name, count })),
            equipment: g.reader.equipment().map(({ id, name, count }) => ({ id, name, count })),
            logs: (g.runner.ctx?.log ?? []).slice(-150), chat: g.reader.chat(15).map(c => c.text)
        };
    }, client.user), 20000, `sample ${client.user}`);
}

async function cleanupAccount(client: Client): Promise<Cleanup> {
    const startedAt = Date.now();
    const deadline = startedAt + 120000;
    let attempts = 0;
    let loggedOut = false;
    let reason = 'Logout deadline expired';
    const save = (entry: Record<string, unknown>) => appendFileSync(join(output, 'cleanup.jsonl'), `${JSON.stringify({ at: Date.now(), user: client.user, ...entry })}\n`);
    try {
        await timeout(client.page.evaluate(() => (globalThis as never as Abi).rs2b0t.setAutoLogin(false)), 5000, `disable relog ${client.user}`);
        await timeout(stopScript(client.page), 10000, `stop ${client.user}`);
        await client.page.waitForFunction(() => !['running', 'paused', 'stopping'].includes((globalThis as never as Abi).rs2b0t.runner.state), undefined, { timeout: 15000 }).catch(error => save({ stopError: String(error) }));
        while (Date.now() < deadline) {
            const state = await timeout(client.page.evaluate(com => {
                const g = (globalThis as never as Abi).rs2b0t;
                const ingame = g.client.ingame;
                const inCombat = ingame && g.reader.inCombat();
                let requested = false;
                if (ingame && !inCombat) {
                    if (typeof g.client.logoutTimer === 'number') g.client.logoutTimer = 250;
                    requested = g.actions.ifButton(com);
                }
                return { ingame, inCombat, requested, state: g.runner.state, tile: g.reader.worldTile(), chat: g.reader.chat(8).map(line => line.text) };
            }, LOGOUT_BUTTON_COM), 10000, `logout check ${client.user}`);
            attempts += Number(state.requested);
            save(state);
            if (!state.ingame) {
                loggedOut = true;
                reason = attempts ? 'Observed offline after logout button request' : 'Already offline';
                break;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))));
        }
    } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
    }
    const result = { user: client.user, loggedOut, attempts, durationMs: Date.now() - startedAt, reason };
    save({ result });
    return result;
}

async function main(): Promise<void> {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'fixture.json'), JSON.stringify({ fixture, seededBank, initialAudit }, null, 2));
    const clients: Client[] = [];
    const baseline = new Map<string, Sample>();
    const latest = new Map<string, Sample>();
    const visited = new Map<string, Set<string>>();
    const regions = new Map<string, Set<string>>();
    const camps = new Set<string>();
    const reachedCamps = new Map<string, Set<string>>();
    const campXp = new Map<string, Record<string, number>>();
    const recoveries = new Map<string, Recovery[]>();
    const problems = new Set<string>();
    const cleanup: Cleanup[] = [];
    const buildDir = mkdtempSync(join(tmpdir(), 'leveler-build-'));
    const deployDir = join(engine, 'public', 'bot', tag);
    const deployHtml = join(engine, 'public', `bot-${tag}.html`);
    let browser: Browser | undefined;
    let startedAt = 0;
    let completedAt = 0;
    let simultaneous = 0;
    let simultaneousRunning = 0;
    let samples = 0;
    let failure = '';
    const record = async (kind: string): Promise<Sample[]> => {
        const results = await Promise.allSettled(clients.map(sample));
        const snapshots: Sample[] = [];
        for (const [index, result] of results.entries()) {
            if (result.status === 'rejected') {
                const message = `${clients[index].user}: ${String(result.reason)}`;
                problems.add(message);
                appendFileSync(join(output, 'progress.jsonl'), `${JSON.stringify({ at: Date.now(), kind, error: message })}\n`);
                continue;
            }
            const s = result.value;
            const previous = latest.get(s.user);
            snapshots.push(s);
            latest.set(s.user, s);
            if (s.plan) {
                const plans = visited.get(s.user) ?? new Set<string>();
                plans.add(s.plan.id);
                visited.set(s.user, plans);
                if (s.plan.combat) camps.add(s.plan.id);
            }
            if (s.tile) {
                const seen = regions.get(s.user) ?? new Set<string>();
                seen.add(`${s.tile.level}:${s.tile.x >> 6},${s.tile.z >> 6}`);
                regions.set(s.user, seen);
            }
            if (['running', 'final'].includes(kind) && (!s.ingame || s.state !== 'running')) problems.add(`${s.user}: ${s.ingame ? s.state : 'disconnected'} during ${kind} observation`);
            if (s.plan && ['Fisher', 'CookBot'].includes(s.plan.script) && ['attack', 'strength', 'defence'].some(name => (s.skills[name]?.level ?? 0) < 20)) problems.add(`${s.user}: ${s.plan.script} selected before melee level 20`);
            const recovery = recoveries.get(s.user) ?? [];
            for (let death = (previous?.deaths ?? 0) + 1; death <= s.deaths; death++) recovery.push({ death, observedAt: s.at, combatXp: combatXp(s) });
            for (const event of recovery) {
                if (!event.recoveredAt && recoveredAtCamp(event, previous, s)) {
                    event.recoveredAt = s.at;
                    event.recoveredCombatXp = combatXp(s);
                    event.recoveredCamp = campAt(s) ?? undefined;
                }
            }
            recoveries.set(s.user, recovery);
            const camp = campAt(s);
            if (camp) {
                const reached = reachedCamps.get(s.user) ?? new Set<string>();
                reached.add(camp);
                reachedCamps.set(s.user, reached);
                const gain = campGain(previous, s);
                if (gain > 0) {
                    const gains = campXp.get(s.user) ?? {};
                    gains[camp] = (gains[camp] ?? 0) + gain;
                    campXp.set(s.user, gains);
                }
            }
            appendFileSync(join(output, 'progress.jsonl'), `${JSON.stringify({ kind, combatXp: combatXp(s), campPresence: camp, ...s })}\n`);
        }
        samples++;
        simultaneous = Math.max(simultaneous, snapshots.filter(s => s.ingame).length);
        const active = snapshots.filter(s => s.ingame && s.state === 'running');
        if (active.length > simultaneousRunning && kind !== 'ready') {
            simultaneousRunning = active.length;
            writeFileSync(join(output, 'simultaneous-running-proof.json'), JSON.stringify({ requested: count, observed: active.length, earliestAt: Math.min(...active.map(s => s.at)), latestAt: Math.max(...active.map(s => s.at)), accounts: active }, null, 2));
        }
        const occupancy = (key: (s: Sample) => string) => Object.fromEntries([...new Set(snapshots.map(key))].map(value => [value, snapshots.filter(s => key(s) === value).map(s => s.user)]));
        appendFileSync(join(output, 'occupancy.jsonl'), `${JSON.stringify({ at: Date.now(), kind, plans: occupancy(s => s.plan?.id ?? 'preparing'), campPresence: occupancy(s => campAt(s) ?? 'away'), regions: occupancy(s => s.tile ? `${s.tile.level}:${s.tile.x >> 6},${s.tile.z >> 6}` : 'unknown') })}\n`);
        return snapshots;
    };
    try {
        const unreachable = await simUnreachable(base.origin);
        if (unreachable) throw new Error(unreachable);
        const key = engineLoginKey(engine);
        const build = Bun.spawn(['bun', 'run', 'build:bot'], {
            stdout: 'ignore', stderr: 'pipe',
            env: { ...process.env, TARGET: 'local', LOCAL_RSAE: key.rsae, LOCAL_RSAN: key.rsan, B0T_OUT_DIR: buildDir }
        });
        try {
            if (await timeout(build.exited, 180000, 'build') !== 0) throw new Error(`build failed: ${await new Response(build.stderr).text()}`);
        } finally {
            build.kill();
        }
        cpSync(buildDir, deployDir, { recursive: true });
        copyFileSync('out/collision.lcnav.gz', join(deployDir, 'collision.lcnav.gz'));
        const source = readFileSync(join(engine, 'public', 'bot.html'), 'utf8');
        const html = source.replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`);
        if (html === source) throw new Error('Isolated client HTML rewrite matched nothing');
        writeFileSync(deployHtml, html);
        browser = await launchBrowser();
        const queue = [...users];
        let prepFailed = false;
        const workers = Array.from({ length: Math.min(3, count) }, async () => {
            for (let user = queue.shift(); user && !interrupted && !prepFailed; user = queue.shift()) {
                try {
                    const context = await browser!.newContext();
                    const page = await context.newPage();
                    page.setDefaultTimeout(30000);
                    const client = { user, context, page };
                    clients.push(client);
                    page.on('pageerror', error => {
                        problems.add(`${user}: page error: ${error.message}`);
                        appendFileSync(join(output, 'errors.jsonl'), `${JSON.stringify({ at: Date.now(), user, error: error.message })}\n`);
                    });
                    await page.addInitScript(() => {
                        const timer = setInterval(() => {
                            const g = (globalThis as never as Partial<Abi>).rs2b0t;
                            if (g?.renderGate) { g.renderGate.setEnabled(false); clearInterval(timer); }
                        }, 100);
                        setInterval(() => {
                            const globals = globalThis as never as Partial<Abi>;
                            const bank = globals.__rs2b0t?.Bank;
                            if (bank?.isOpen() && bank.snapshotReady()) globals.__levelerBank = { at: Date.now(), items: bank.items().map(({ id, name, count }) => ({ id, name, count })) };
                        }, 100);
                    });
                    await timeout(mainlandAccount(page, base.origin, user, `/bot-${tag}.html`), 360000, `prepare ${user}`);
                    await page.evaluate(() => {
                        const globals = globalThis as never as Abi;
                        const bank = globals.__rs2b0t.Bank;
                        const close = bank.close;
                        bank.close = function (...args) {
                            if (this.isOpen() && this.snapshotReady()) globals.__levelerBank = { at: Date.now(), items: this.items().map(({ id, name, count }) => ({ id, name, count })) };
                            return close.apply(this, args);
                        };
                    });
                    await seedItemsToBank(page, seededBank, { x: 3093, z: 3244, level: 0 });
                    await stopScript(page);
                    await setSettings(page, 'AccountLeveler', { targetLevel: 40, marketAxes: false, wilderness: true });
                    const state = await sample(client);
                    writeFileSync(join(output, `${user}-baseline.json`), JSON.stringify({ fixture, seededBank, ...state }, null, 2));
                    if (Object.entries(state.skills).some(([name, s]) => s.level !== (name === 'hitpoints' ? 10 : 1))) throw new Error(`${user}: unexpected starting levels`);
                    if (state.inventory.length || state.equipment.length) throw new Error(`${user}: fresh account unexpectedly carries items`);
                    if (state.bank.length !== seededBank.length || seededBank.some(item => !state.bank.some(actual => actual.id === item.id && actual.count === item.qty))) throw new Error(`${user}: bank does not match the exact ${fixture} fixture`);
                    baseline.set(user, state);
                    console.log(`Prepared ${baseline.size}/${count}: ${user}`);
                } catch (error) {
                    prepFailed = true;
                    throw error;
                }
            }
        });
        const prepared = await Promise.allSettled(workers);
        const rejected = prepared.find(r => r.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        if (interrupted || baseline.size !== count) throw new Error('Preparation interrupted');
        const ready = await record('ready');
        if (ready.length !== count || ready.some(s => !s.ingame || !s.sceneReady)) throw new Error('Not all clients are simultaneously in game');
        writeFileSync(join(output, 'simultaneous-proof.json'), JSON.stringify({ requested: count, observed: ready.length, earliestAt: Math.min(...ready.map(s => s.at)), latestAt: Math.max(...ready.map(s => s.at)), accounts: ready }, null, 2));
        startedAt = Date.now();
        await Promise.all(clients.map(c => timeout(startScript(c.page, 'AccountLeveler'), 30000, `start ${c.user}`)));
        console.log(`Started all ${count} clients (${fixture}). Evidence: ${output}`);
        const deadline = startedAt + minutes * 60000;
        while (!interrupted && Date.now() < deadline) {
            const rows = await record('running');
            const gaining = rows.filter(s => combatXp(s) > combatXp(baseline.get(s.user)!)).length;
            console.log(`${Math.round((Date.now() - startedAt) / 1000)}s: ${rows.filter(s => s.ingame).length}/${count} in game, ${rows.filter(s => s.state === 'running').length} running, ${gaining} gaining combat XP`);
            await new Promise(resolve => setTimeout(resolve, Math.min(interval * 1000, Math.max(0, deadline - Date.now()))));
        }
        completedAt = Date.now();
        await record('final');
        if (interrupted) throw new Error('Observation interrupted');
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        console.error(failure);
    } finally {
        await Promise.allSettled(clients.map(async c => {
            try {
                cleanup.push(await timeout(cleanupAccount(c), 135000, `cleanup ${c.user}`));
            } catch (error) {
                cleanup.push({ user: c.user, loggedOut: false, attempts: 0, durationMs: 135000, reason: String(error) });
            } finally {
                await timeout(c.context.close(), 10000, `close ${c.user}`).catch(() => undefined);
            }
        }));
        await timeout(browser?.close() ?? Promise.resolve(), 15000, 'browser close').catch(() => undefined);
        rmSync(deployDir, { recursive: true, force: true });
        rmSync(deployHtml, { force: true });
        rmSync(buildDir, { recursive: true, force: true });
        const accounts = users.map(user => {
            const first = baseline.get(user);
            const last = latest.get(user);
            const recovery = recoveries.get(user) ?? [];
            return {
                user, prepared: !!first, totalLevel: last?.totalLevel ?? null,
                xpGain: last && first ? last.totalXp - first.totalXp : null,
                combatXpGain: last && first ? combatXp(last) - combatXp(first) : null,
                skillGains: last && first ? Object.fromEntries(Object.entries(last.skills).map(([name, s]) => [name, s.xp - (first.skills[name]?.xp ?? 0)])) : {},
                levelGain: last && first ? last.totalLevel - first.totalLevel : null,
                deaths: last?.deaths ?? null, state: last?.state ?? 'unprepared', status: last?.status ?? '',
                plan: last?.plan, phase: last?.phase, tile: last?.tile, plans: [...(visited.get(user) ?? [])], regions: [...(regions.get(user) ?? [])],
                reachedCamps: [...(reachedCamps.get(user) ?? [])], trainingCamps: Object.keys(campXp.get(user) ?? {}), combatXpByCamp: campXp.get(user) ?? {},
                observedRecovery: recovery.length > 0 && recovery.every(event => !!event.recoveredAt), recoveries: recovery,
                loggedOut: cleanup.find(c => c.user === user)?.loggedOut ?? false, cleanup: cleanup.find(c => c.user === user)
            };
        });
        for (const a of accounts) {
            if ((a.combatXpGain ?? 0) <= 0 && !pilot) problems.add(`${a.user}: no combat XP gained`);
            if (!a.trainingCamps.length && !pilot) problems.add(`${a.user}: no combat XP observed at a training camp`);
            if (!a.loggedOut) problems.add(`${a.user}: clean logout unverified`);
        }
        if (simultaneousRunning !== count) problems.add(`Only ${simultaneousRunning}/${count} clients observed simultaneously in game and running`);
        const result = failure || problems.size ? 'FAIL' : pilot ? 'INCOMPLETE' : 'PASS';
        const trainingCamps = [...new Set(accounts.flatMap(a => a.trainingCamps))];
        const summary = { result, pilot, failure, fixture, seededBank, base: base.origin, count, minutes, gold, settings: { marketAxes: false, wilderness: true }, startedAt, completedAt, simultaneous, simultaneousRunning, camps: [...camps], trainingCamps, samples, problems: [...problems], accounts };
        writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
        writeFileSync(join(output, 'summary.md'), [
            `# AccountLeveler concurrent test: ${result}`, '',
            `${simultaneous}/${count} clients observed simultaneously in game; ${simultaneousRunning}/${count} also running. Requested duration ${minutes} minutes; observed ${(Math.max(0, completedAt - startedAt) / 60000).toFixed(2)} minutes.`, '',
            ...(pilot ? ['Short pilot only; XP progress acceptance requires a full observation run.', ''] : []),
            `Fixture: ${fixture}. Fresh accounts: level 1, HP 10, empty inventory and equipment, no food. Market trades disabled; Wilderness enabled.`, '',
            `Seeded bank: ${seededBank.map(item => `${item.displayName} [${item.id}] x${item.qty}`).join(', ')}.`, '',
            'Full acceptance requires combat XP between two consecutive observations at the same training camp for every account. Combat XP gained only during shopping or travel does not satisfy this check.', '',
            'Cleanup disables auto-login, stops scripts, and retries the game logout button for up to 120 seconds while allowing combat to end. Closing a browser context after timeout does not count as verified logout.', '',
            `Selected camps: ${[...camps].join(', ') || 'none'}. Camps with observed combat XP: ${trainingCamps.join(', ') || 'none'}.`, '',
            '| Account | Combat XP gained | Total XP gained | Levels gained | Deaths | Last state | Last plan | Logged out |',
            '| --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
            ...accounts.map(a => `| ${a.user} | ${a.combatXpGain ?? '?'} | ${a.xpGain ?? '?'} | ${a.levelGain ?? '?'} | ${a.deaths ?? '?'} | ${a.state} | ${a.plan?.id ?? a.status} | ${a.loggedOut} |`), '',
            ...(failure ? [`Failure: ${failure}`, ''] : []), ...[...problems].map(p => `- ${p}`), ''
        ].join('\n'));
        console.log(`${result}: ${output}/summary.md`);
        if (result === 'FAIL') process.exitCode = 1;
    }
}

await main();
