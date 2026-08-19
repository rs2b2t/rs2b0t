/** Why: fresh-account mutation is allowed only after the dedicated server, profile, ports, and artifacts are attested. */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { firefox, type Frame, type Page } from 'playwright-core';

import { HARNESS_VIEWPORT, logout } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, clearMainModal, getServerVarQuiet, mainlandAccount, relog, teleTo } from './tutorial/harness.js';

type Surface = Page | Frame;
type Tile = { x: number; z: number; level: number };
type Item = { id: number; name: string | null; count: number; slot: number; ops: (string | null)[] };
type LogLine = { time: number; level: string; msg: string };

interface Args {
    base: string;
    pid: number;
    engineRoot: string;
    profile: string;
    managementPort: number;
    nodePort: number;
    username: string;
    minutes: number;
    evidenceDir: string;
}

interface Sample {
    at: number;
    tile: Tile | null;
    runner: string;
    crash: string | null;
    hp: number;
    maxHp: number;
    miningXp: number;
    miningLevel: number;
    inventory: Item[];
    equipment: Item[];
    bankOpen: boolean;
    bankLoaded: boolean;
    bankSnapshotReady: boolean;
    bank: Item[];
    quest: string;
    logs: LogLine[];
}

interface MilestoneSample {
    label: string;
    state: Omit<Sample, 'logs'>;
}

interface BankProbeResult {
    done: boolean;
    ok: boolean;
    reason: string;
    inventoryUsed: number;
    bankItemSlots: number;
    snapshotReady: boolean;
    counts: Record<string, number>;
    locs?: { id: number; name: string | null; tile: Tile; distance: number; ops: (string | null)[] }[];
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: {
            isOpen(): boolean;
            loaded(): boolean;
            snapshotReady(): boolean;
            normalBackpackSnapshot(): Item[] | null;
            items(): Item[];
            count(name: string): number;
            backpackReady(expected: readonly Item[]): Promise<boolean>;
            openNearestAccess(access: { name: string; op: string }, log?: (message: string) => void): Promise<boolean>;
            depositAllMatching(match: (name: string, id: number) => boolean): Promise<void>;
            close(): Promise<boolean>;
        };
        Equipment: {
            items(): Item[];
            contains(name: string): boolean;
            equip(name: string): Promise<boolean>;
        };
        Execution: {
            delayTicks(ticks: number): Promise<void>;
            delayUntil(condition: () => boolean, timeoutMs: number): Promise<boolean>;
        };
        Inventory: {
            items(): Item[];
            used(): number;
            free(): number;
            count(name: string): number;
        };
        Locs: {
            query(): {
                name(name: string): unknown;
                nearest(): unknown;
            };
        };
        reader: {
            worldTile(): Tile | null;
            bankSideItems(): Item[];
            locs(): { id: number; name: string | null; tile: Tile; distance: number; ops: (string | null)[] }[];
        };
        LoopingBot: new () => {
            onStart?(): void | Promise<void>;
            loop(): number | void | Promise<number | void>;
        };
        Quests: { status(name: string): string };
        Skills: { xp(name: string): number; level(name: string): number; effective(name: string): number };
        registerScript(manifest: { name: string; create(): unknown }): void;
    };
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            constructor: { loopCycle: number };
            out: { p1Enc(value: number): void; p1(value: number): void; pjstr(value: string): void } | null;
        };
        registry: { get(name: string): unknown };
        runner: {
            state: string;
            ctx: { log: LogLine[]; crashError?: Error | null } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
    };
    __desertBankProbe?: BankProbeResult;
}

interface WallGlobal {
    multibox: {
        add(account: { username: string; password: string }): unknown;
        slots(): { username: string; ingame: boolean }[];
    };
}

const SHANTAY_BANK_STAND = { x: 3308, z: 3120, level: 0 } as const;
const MINE_ANCHOR = { x: 3323, z: 9458, level: 0 } as const;
const FIXTURE_PASSWORD = 'test';
const TICK_MS = 300;
const FOOD_TARGET = 7;
const CAKE_FORMS = ['Cake', '2/3 cake', 'Slice of cake'] as const;
const DESERT_OUTFIT = ['Desert shirt', 'Desert robe', 'Desert boots'] as const;
const SLAVE_OUTFIT = ["Slaves' shirt", 'Slave robe', 'Slave boots'] as const;
const RECOVERED_KEYS = ['Metal key', 'Wrought iron key'] as const;
const BANK_SEED = [
    { debug: 'cake', name: 'Cake', count: 20 },
    { debug: 'slave_shirt', name: "Slaves' shirt", count: 1 },
    { debug: 'slave_robe', name: 'Slave robe', count: 1 },
    { debug: 'slave_boots', name: 'Slave boots', count: 1 }
] as const;
const FATAL_LOG =
    /bank item list did not load|cannot prepare|short by|missing supplies|could not open the Shantay chest|purchase failed|did not cross the boundary|desert camp: could not reach|desert camp: Shantay chest is unreachable|route gear incomplete|navigator unavailable|navigator failed|nav worker (?:error|failed|crash)|Desert Mining Camp .*dialogue did not resolve|Desert Mining Camp .*could not scene-step|Desert Mining Camp .*could not reach exact approach/i;
const METAL_KEY_RECOVERY = /desert camp: recovered Metal key .*Mercenary Captain/i;
const WROUGHT_KEY_RECOVERY = /desert camp: recovered Wrought iron key .*Captain Siad.*desk/i;
const ROUTE_ENTER = /desert camp: route enter;/i;
const ROUTE_EXIT_MINE_DEEP = /desert camp: route exit; area=mineDeep; phase=exitMine/i;
const FULL_HEAL_EAT = /food: eat .*full heal/i;
const CART_RETRY = /Desert Mining Camp mine cart (?:in|out): Agility roll failed; attempt \d+\/6;/i;
const BANKED_MITHRIL = /bank: deposited \d+ mithril/i;
const ENTRY_CROSSINGS = [
    /Shantay Pass -> Kharidian desert: crossed/i,
    /Desert Mining Camp outer gate in .*: crossed/i,
    /Desert Mining Camp mine door in: crossed/i,
    /Desert Mining Camp guarded cave in: crossed/i,
    /Desert Mining Camp mine cart in: crossed/i,
    /Desert Mining Camp wrought gate in: crossed/i
] as const;
const EXIT_CROSSINGS = [
    /Desert Mining Camp wrought gate out: crossed/i,
    /Desert Mining Camp mine cart out: crossed/i,
    /Desert Mining Camp guarded cave out: crossed/i,
    /Desert Mining Camp mine door out: crossed/i,
    /Desert Mining Camp outer gate out .*: crossed/i,
    /desert camp: shared walk completed Shantay north/i,
    /bank: deposited \d+ mithril/i
] as const;

class EventLedger {
    readonly lines: LogLine[] = [];
    private readonly seen = new Set<string>();

    ingest(lines: readonly LogLine[]): void {
        const occurrences = new Map<string, number>();
        for (const line of lines) {
            const base = `${line.time}\0${line.level}\0${line.msg}`;
            const occurrence = occurrences.get(base) ?? 0;
            occurrences.set(base, occurrence + 1);
            const key = `${base}\0${occurrence}`;
            if (!this.seen.has(key)) {
                this.seen.add(key);
                this.lines.push({ ...line });
            }
        }
    }

    count(pattern: RegExp): number {
        return this.lines.filter(line => matches(pattern, line.msg)).length;
    }

    find(pattern: RegExp): LogLine | undefined {
        return this.lines.find(line => matches(pattern, line.msg));
    }

    last(pattern: RegExp): LogLine | undefined {
        return this.lines.findLast(line => matches(pattern, line.msg));
    }
}

function matches(pattern: RegExp, text: string): boolean {
    pattern.lastIndex = 0;
    return pattern.test(text);
}

function recordMilestone(samples: MilestoneSample[], label: string, sample: Sample): void {
    const { logs: _logs, ...state } = sample;
    samples.push({ label, state });
}

function die(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

async function exists(path: string): Promise<boolean> {
    return access(path).then(
        () => true,
        () => false
    );
}

function usage(): never {
    console.log(`Usage:
  bun build e2e/desert-miner-proof.ts --target=node --packages=external --outfile=node_modules/.desert-miner-proof.mjs
  node node_modules/.desert-miner-proof.mjs \\
    --pid <quickstart-pid> \\
    --engine-root /tmp/rs2b0t-desert-engine \\
    --profile desert_e2e_<unique> \\
    [--base http://127.0.0.1:18971] [--management-port 18972] [--node-port 43971]

The named process must have WEB_PORT matching --base, WEB_MANAGEMENT_PORT and
NODE_PORT matching the arguments, NODE_PROFILE matching --profile,
LOGIN_SERVER=false, NODE_PRODUCTION=false, NODE_MEMBERS=true, and no
BOT_TEST_MODE=true. The account must not already exist in that profile.`);
    process.exit(0);
}

function positiveInt(raw: string | undefined, label: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) die(`${label} must be a positive integer (got '${raw ?? ''}')`);
    return value;
}

function parseArgs(argv: string[]): Args {
    const values = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i]!;
        if (key === '--help' || key === '-h') usage();
        if (!key.startsWith('--')) die(`unknown argument '${key}'`);
        const value = argv[++i];
        if (!value || value.startsWith('--')) die(`${key} needs a value`);
        values.set(key, value);
    }
    const tag = Date.now().toString(36).slice(-8);
    const username = values.get('--account') ?? `dmc${tag}`;
    if (!/^[a-z0-9_]{1,12}$/.test(username)) die(`--account must match [a-z0-9_]{1,12} (got '${username}')`);
    const base = values.get('--base') ?? 'http://127.0.0.1:18971';
    const pid = positiveInt(values.get('--pid'), '--pid');
    const engineRoot = values.get('--engine-root') ?? die('--engine-root is required');
    const profile = values.get('--profile') ?? die('--profile is required');
    const managementPort = positiveInt(values.get('--management-port') ?? '18972', '--management-port');
    const nodePort = positiveInt(values.get('--node-port') ?? '43971', '--node-port');
    const minutes = positiveInt(values.get('--minutes') ?? '20', '--minutes');
    const evidenceDir = values.get('--evidence-dir') ?? `/tmp/desert-miner-e2e-${username}`;
    const known = new Set(['--base', '--pid', '--engine-root', '--profile', '--management-port', '--node-port', '--account', '--minutes', '--evidence-dir']);
    for (const key of values.keys()) if (!known.has(key)) die(`unknown argument '${key}'`);
    return {
        base,
        pid,
        engineRoot,
        profile,
        managementPort,
        nodePort,
        username,
        minutes,
        evidenceDir
    };
}

function safeBase(raw: string): URL {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) die(`refusing non-loopback base '${url.origin}'`);
    if (url.protocol !== 'http:') die(`isolated harness requires http, got '${url.protocol}'`);
    if (!url.port) die('--base must include its isolated port');
    if (['8081', '9223', '8888', '8890'].includes(url.port)) die(`refusing shared/reserved port ${url.port}`);
    if (url.pathname !== '/' || url.search || url.hash) die('--base must be an origin without path/query/fragment');
    return url;
}

function envRecord(bytes: string): Record<string, string> {
    return Object.fromEntries(
        bytes
            .split('\0')
            .filter(Boolean)
            .map(entry => {
                const split = entry.indexOf('=');
                return split === -1 ? [entry, ''] : [entry.slice(0, split), entry.slice(split + 1)];
            })
    );
}

async function attestProcess(args: Args, base: URL): Promise<void> {
    const proc = `/proc/${args.pid}`;
    if (!(await exists(`${proc}/status`))) die(`PID ${args.pid} does not exist`);
    const cwd = resolve(await readlink(`${proc}/cwd`));
    const expectedRoot = resolve(args.engineRoot);
    if (cwd !== expectedRoot) die(`PID ${args.pid} cwd '${cwd}' != isolated engine root '${expectedRoot}'`);
    if (expectedRoot !== '/tmp/rs2b0t-desert-engine' && !expectedRoot.startsWith('/tmp/rs2b0t-desert-engine.')) {
        die(`engine root must be a dedicated /tmp/rs2b0t-desert-engine path (got '${expectedRoot}')`);
    }
    if (!/^desert_e2e_[a-zA-Z0-9_-]+$/.test(args.profile)) {
        die(`profile must start with desert_e2e_ (got '${args.profile}')`);
    }
    const env = envRecord(await readFile(`${proc}/environ`, 'utf8'));
    const expected: Record<string, string> = {
        WEB_PORT: base.port,
        WEB_MANAGEMENT_PORT: String(args.managementPort),
        NODE_PORT: String(args.nodePort),
        NODE_PROFILE: args.profile,
        LOGIN_SERVER: 'false',
        NODE_PRODUCTION: 'false',
        NODE_MEMBERS: 'true',
        NODE_WS_ONDEMAND: 'true'
    };
    for (const [key, value] of Object.entries(expected)) {
        if (env[key] !== value) die(`PID ${args.pid} ${key}='${env[key] ?? '<unset>'}', expected '${value}'`);
    }
    if (env.BOT_TEST_MODE === 'true') die('BOT_TEST_MODE=true disables normal browser login');
    const ports = [Number(base.port), args.managementPort, args.nodePort];
    if (new Set(ports).size !== ports.length) die(`web/management/node ports must be distinct (${ports.join(', ')})`);
    const save = `${expectedRoot}/data/players/${args.profile}/${args.username}.sav`;
    if (await exists(save)) die(`refusing existing account save '${save}'; choose a fresh --account`);
    console.log(`PROCESS ATTESTATION PASS: pid=${args.pid} cwd=${cwd} profile=${args.profile} ports=${ports.join('/')}`);
}

function sha256(bytes: ArrayBuffer | Uint8Array): string {
    return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

async function attestArtifacts(base: URL): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};
    for (const name of ['botclient.js', 'navworker.js', 'collision.lcnav.gz'] as const) {
        const localPath = `out/${name}`;
        if (!(await exists(localPath))) die(`out/${name} is missing; deploy this worktree first`);
        const response = await fetch(new URL(`/bot/${name}`, base));
        if (!response.ok) die(`served /bot/${name} returned HTTP ${response.status}`);
        const localHash = sha256(await readFile(localPath));
        const servedHash = sha256(await response.arrayBuffer());
        if (localHash !== servedHash) die(`served ${name} ${servedHash} != worktree ${localHash}`);
        hashes[name] = localHash;
    }
    console.log(`ARTIFACT ATTESTATION PASS: ${JSON.stringify(hashes)}`);
    return hashes;
}

async function command(surface: Surface, value: string, waitMs = 700): Promise<void> {
    const sent = await surface.evaluate(command => {
        const client = (globalThis as never as BrowserGlobal).rs2b0t.client;
        if (!client.ingame || !client.out) return false;
        client.out.p1Enc(224);
        client.out.p1(command.length + 1);
        client.out.pjstr(command);
        return true;
    }, value);
    if (!sent) die(`could not send ::${value}`);
    await surface.waitForTimeout(waitMs);
}

function count(items: readonly Item[], name: string): number {
    const wanted = name.toLowerCase();
    return items.filter(item => item.name?.toLowerCase() === wanted).reduce((sum, item) => sum + item.count, 0);
}

function foodCount(items: readonly Item[]): number {
    return CAKE_FORMS.reduce((sum, name) => sum + count(items, name), 0);
}

function foodSignature(items: readonly Item[]): string {
    return CAKE_FORMS.map(name => `${name}:${count(items, name)}`).join('|');
}

function hasWorn(sample: Sample, names: readonly string[]): boolean {
    return names.every(name => count(sample.equipment, name) > 0);
}

async function snap(surface: Surface): Promise<Sample> {
    return surface.evaluate(() => {
        const global = globalThis as never as BrowserGlobal;
        const abi = global.__rs2b0t;
        const item = (value: Item): Item => ({
            id: value.id,
            name: value.name,
            count: value.count,
            slot: value.slot,
            ops: []
        });
        return {
            at: Date.now(),
            tile: abi.reader.worldTile(),
            runner: global.rs2b0t.runner.state,
            crash: global.rs2b0t.runner.ctx?.crashError?.message ?? null,
            hp: abi.Skills.effective('hitpoints'),
            maxHp: abi.Skills.level('hitpoints'),
            miningXp: abi.Skills.xp('mining'),
            miningLevel: abi.Skills.level('mining'),
            inventory: abi.Inventory.items().map(item),
            equipment: abi.Equipment.items().map(item),
            bankOpen: abi.Bank.isOpen(),
            bankLoaded: abi.Bank.loaded(),
            bankSnapshotReady: abi.Bank.snapshotReady(),
            bank: abi.Bank.items().map(item),
            quest: abi.Quests.status('The Tourist Trap'),
            logs: (global.rs2b0t.runner.ctx?.log ?? []).slice(-500).map(line => ({ ...line }))
        };
    });
}

async function stopRunner(surface: Surface): Promise<void> {
    await surface.evaluate(() => {
        const runner = (globalThis as never as BrowserGlobal).rs2b0t.runner;
        if (['running', 'paused', 'stopping'].includes(runner.state)) runner.stop('desert miner harness fixture');
    });
    await surface.waitForTimeout(500);
}

async function bankProbe(surface: Surface, mode: 'deposit' | 'inspect' | 'open', expectedNames: readonly string[]): Promise<BankProbeResult> {
    await stopRunner(surface);
    const token = `DesertBankProbe_${mode}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await surface.evaluate(
        ([action, names, scriptName]) => {
            const global = globalThis as never as BrowserGlobal;
            const abi = global.__rs2b0t;
            global.__desertBankProbe = {
                done: false,
                ok: false,
                reason: '',
                inventoryUsed: -1,
                bankItemSlots: -1,
                snapshotReady: false,
                counts: {}
            };
            class Probe extends abi.LoopingBot {
                override async onStart(): Promise<void> {
                    const result = global.__desertBankProbe!;
                    try {
                        if (abi.Bank.isOpen() && !(await abi.Bank.close())) {
                            throw new Error('Shantay chest did not close before backpack capture');
                        }
                        result.reason = 'capturing the normal backpack before opening';
                        if (!(await abi.Execution.delayUntil(() => abi.Bank.normalBackpackSnapshot() !== null, 8000))) {
                            throw new Error('normal 28-slot backpack did not become readable');
                        }
                        const expectedBackpack = abi.Bank.normalBackpackSnapshot();
                        if (expectedBackpack === null) {
                            throw new Error('normal backpack disappeared before capture');
                        }
                        result.locs = abi.reader
                            .locs()
                            .filter(loc => loc.distance <= 12)
                            .map(loc => ({ ...loc, tile: { ...loc.tile }, ops: [...loc.ops] }));
                        result.reason = 'opening exact Shantay chest';
                        if (
                            !(await abi.Bank.openNearestAccess({ name: 'Shantay chest', op: 'Open' }, message => {
                                result.reason = message;
                            }))
                        ) {
                            throw new Error("could not open exact 'Shantay chest' with 'Open'");
                        }
                        result.reason = 'waiting for authoritative bank snapshots';
                        if (!(await abi.Execution.delayUntil(() => abi.Bank.snapshotReady(), 8000))) {
                            throw new Error('Shantay chest full item snapshot did not arrive');
                        }
                        if (!(await abi.Bank.backpackReady(expectedBackpack))) {
                            throw new Error('Shantay chest side backpack did not match its pre-open snapshot');
                        }
                        if (action === 'deposit') {
                            result.reason = 'depositing seeded inventory';
                            await abi.Bank.depositAllMatching(() => true);
                            result.reason = 'verifying the bank backpack is empty';
                            if (!(await abi.Bank.backpackReady([]))) {
                                throw new Error(`deposit did not produce an authoritative empty backpack (${abi.reader.bankSideItems().length} slot(s))`);
                            }
                        }
                        result.reason = 'waiting for bank item list';
                        if (names.length > 0 && !(await abi.Execution.delayUntil(() => abi.Bank.loaded(), 8000))) {
                            throw new Error('bank item list did not load within 8 seconds');
                        }
                        await abi.Execution.delayTicks(2);
                        result.counts = Object.fromEntries(names.map(name => [name, abi.Bank.count(name)]));
                        result.inventoryUsed = abi.Inventory.used();
                        result.bankItemSlots = abi.Bank.items().length;
                        result.snapshotReady = abi.Bank.snapshotReady();
                        if (action !== 'open' && abi.Bank.isOpen() && !(await abi.Bank.close())) {
                            throw new Error('Shantay chest did not close');
                        }
                        result.ok = true;
                        result.reason = 'complete';
                    } catch (error) {
                        result.reason = error instanceof Error ? error.message : String(error);
                    }
                    result.done = true;
                }

                override loop(): number {
                    return 5000;
                }
            }
            abi.registerScript({ name: scriptName, create: () => new Probe() });
            global.rs2b0t.runner.start(global.rs2b0t.registry.get(scriptName));
        },
        [mode, [...expectedNames], token] as const
    );
    try {
        await surface.waitForFunction(() => (globalThis as never as BrowserGlobal).__desertBankProbe?.done === true, undefined, { timeout: 100_000 });
    } catch (error) {
        const stalled = await surface.evaluate(() => (globalThis as never as BrowserGlobal).__desertBankProbe);
        die(`Shantay bank ${mode} probe stalled at '${stalled?.reason ?? 'probe initialization'}'; ` + `nearby locs=${JSON.stringify(stalled?.locs ?? [])}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = await surface.evaluate(() => (globalThis as never as BrowserGlobal).__desertBankProbe!);
    await stopRunner(surface);
    if (!result.ok) {
        die(`Shantay bank ${mode} probe failed: ${result.reason}; nearby locs=${JSON.stringify(result.locs ?? [])}`);
    }
    return result;
}

async function prepareAccount(page: Page, args: Args, base: URL): Promise<{ counts: Record<string, number>; emptyBankProof: BankProbeResult }> {
    await mainlandAccount(page, base.origin, args.username);
    for (const value of [
        `speed ${TICK_MS}`,
        '~clearinv inv',
        '~clearinv worn',
        '~clearbank',
        'setvar desertrescue 30',
        'setstat agility 1',
        'setstat mining 55',
        'setstat attack 70',
        'setstat strength 70',
        'setstat hitpoints 60',
        'setstat defence 70'
    ]) {
        if (!(await cheatQuiet(page, value))) die(`fixture command ::${value} was not sent`);
    }
    await relog(page, args.username);
    await clearChatDialogs(page, 'fixture dialog(s)');
    await clearMainModal(page);
    if ((await getServerVarQuiet(page, 'desertrescue')) !== 30) die('desertrescue varp did not persist as 30');
    if (!(await teleTo(page, SHANTAY_BANK_STAND, 0, 20_000))) die('fixture could not teleport to the west side of the Shantay chest');
    await page.waitForFunction(() => Boolean((globalThis as never as BrowserGlobal).__rs2b0t.Bank), undefined, { timeout: 10_000 });
    await page.waitForTimeout(TICK_MS * 4);

    const emptyBankProof = await bankProbe(page, 'inspect', []);
    if (emptyBankProof.inventoryUsed !== 0 || emptyBankProof.bankItemSlots !== 0 || !emptyBankProof.snapshotReady) {
        die(`empty-bank proof failed: ${JSON.stringify(emptyBankProof)}`);
    }

    for (const item of BANK_SEED) await command(page, `give ${item.debug} ${item.count}`);
    const held = await snap(page);
    for (const item of BANK_SEED) {
        if (count(held.inventory, item.name) !== item.count) {
            die(`inventory seed ${item.name}=${count(held.inventory, item.name)}, expected ${item.count}`);
        }
    }
    await bankProbe(
        page,
        'deposit',
        BANK_SEED.map(item => item.name)
    );
    await command(page, 'give coins 150');
    await bankProbe(page, 'deposit', [...BANK_SEED.map(item => item.name), 'Coins']);
    await command(page, 'give rune_pickaxe 1');
    const equipped = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rs2b0t.Equipment.equip('Rune pickaxe'));
    if (!equipped) die('fixture could not equip Rune pickaxe');

    const expected = [...BANK_SEED.map(item => item.name), 'Coins', 'Shantay pass', ...RECOVERED_KEYS];
    const bank = await bankProbe(page, 'inspect', expected);
    const wanted: Record<string, number> = Object.fromEntries(BANK_SEED.map(item => [item.name, item.count]));
    wanted.Coins = 150;
    wanted['Shantay pass'] = 0;
    for (const key of RECOVERED_KEYS) wanted[key] = 0;
    for (const [name, amount] of Object.entries(wanted)) {
        if (bank.counts[name] !== amount) die(`bank precondition ${name}=${bank.counts[name]}, expected ${amount}`);
    }
    const ready = await snap(page);
    if (ready.miningLevel !== 55) die(`Mining level ${ready.miningLevel}, expected 55`);
    if (ready.quest !== 'complete') die(`Tourist Trap status '${ready.quest}', expected complete`);
    if (RECOVERED_KEYS.some(key => count(ready.inventory, key) !== 0 || bank.counts[key] !== 0)) {
        die(`key-recovery fixture unexpectedly contains a key: inventory=${JSON.stringify(ready.inventory)} bank=${JSON.stringify(bank.counts)}`);
    }
    if (ready.inventory.length !== 0 || count(ready.equipment, 'Rune pickaxe') !== 1) {
        die(`fixture must wear Rune pickaxe with an empty pack: inventory=${JSON.stringify(ready.inventory)} equipment=${JSON.stringify(ready.equipment)}`);
    }
    if (!(await logout(page, 20_000))) die('clean fixture logout failed');
    await page.waitForTimeout(TICK_MS * 12);
    return { counts: bank.counts, emptyBankProof };
}

async function wallFrame(page: Page, args: Args, base: URL): Promise<Frame> {
    await page.goto(new URL('/multibox.html?nodeid=10', base).href);
    await page.waitForFunction(() => Boolean((globalThis as never as WallGlobal).multibox), undefined, { timeout: 30_000 });
    await page.evaluate(
        ([user, pass, foodTarget]) => {
            const settings: Record<string, string> = {
                selectedScript: 'Miner',
                'set:Miner:rocks': 'Mithril',
                'set:Miner:location': 'Desert Mining Camp',
                'set:Miner:food': 'Cake',
                'set:Miner:foodWithdraw': String(foodTarget),
                'set:Miner:tickManip': 'Off',
                'set:Miner:muleMode': 'Off',
                'set:Miner:mulePartner': '',
                'set:Miner:toolAcquire': 'Off',
                'set:Miner:forgetfulBank': 'false',
                'set:Miner:purgePackOnStart': 'true',
                'set:Miner:packJunk': 'Bank',
                'set:Miner:leashRadius': '40'
            };
            for (const [suffix, value] of Object.entries(settings)) {
                sessionStorage.setItem(`rs2b0t:${user}:${suffix}`, value);
            }
            (globalThis as never as WallGlobal).multibox.add({ username: user, password: pass });
        },
        [args.username, FIXTURE_PASSWORD, FOOD_TARGET] as const
    );
    await page.waitForFunction(
        user => {
            const iframe = Array.from(document.querySelectorAll('iframe')).find(candidate => candidate.title === user);
            return Boolean((iframe?.contentWindow as unknown as { rs2b0t?: unknown } | null)?.rs2b0t);
        },
        args.username,
        { timeout: 30_000 }
    );
    await page.evaluate(user => {
        const iframe = Array.from(document.querySelectorAll('iframe')).find(candidate => candidate.title === user);
        const runtime = (iframe?.contentWindow as unknown as { rs2b0t?: { setAutoLogin(on: boolean): void } } | null)?.rs2b0t;
        if (!runtime) throw new Error(`multibox iframe runtime for '${user}' is unavailable`);
        runtime.setAutoLogin(true);
    }, args.username);
    await page.waitForFunction(user => (globalThis as never as WallGlobal).multibox.slots().some(slot => slot.username === user && slot.ingame), args.username, { timeout: 180_000 });
    for (const frame of page.frames()) {
        const user = await frame.evaluate(() => (globalThis as never as Partial<BrowserGlobal>).rs2b0t?.client.loginUser ?? null).catch(() => null);
        if (user === args.username) {
            return frame;
        }
    }
    die(`multibox reports '${args.username}' ingame but its iframe was not found`);
}

async function startMiner(frame: Frame): Promise<void> {
    await frame.evaluate(() => {
        const global = globalThis as never as BrowserGlobal;
        const meta = global.rs2b0t.registry.get('Miner');
        if (!meta) throw new Error("registry has no 'Miner'");
        global.rs2b0t.runner.start(meta);
    });
    await frame.waitForFunction(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'running', undefined, { timeout: 10_000 });
}

async function waitForRoundTrip(frame: Frame, args: Args, samples: MilestoneSample[], events: EventLedger): Promise<{ injectedOre: number; final: Sample }> {
    const opened = await bankProbe(frame, 'open', [...BANK_SEED.map(item => item.name), 'Coins', 'Shantay pass', ...RECOVERED_KEYS]);
    if (opened.counts.Cake !== 20 || opened.counts['Shantay pass'] !== 0 || RECOVERED_KEYS.some(key => opened.counts[key] !== 0)) {
        die(`open-bank start precondition failed: ${JSON.stringify(opened.counts)}`);
    }
    const initial = await snap(frame);
    if (!initial.bankOpen || !initial.bankSnapshotReady) {
        die('Miner must start with an authoritative Shantay bank snapshot');
    }
    recordMilestone(samples, 'bank-open-start', initial);
    const xp0 = initial.miningXp;
    await startMiner(frame);

    const deadline = Date.now() + args.minutes * 60_000;
    let firstNaturalXp = -1;
    let injectedOre = 0;
    let secondEntryXp = -1;
    let sawDesertOutfit = false;
    let sawSlaveOutfit = false;
    let verifiedWornPickEntries = 0;
    let sawKeysAtMine = false;
    let sawPickAtMine = false;
    let sawBankCake13 = false;
    let sawExactFoodLoad = false;
    let sawMetalRecovery = false;
    let sawWroughtRecovery = false;
    let sawBankedOre = false;
    let passPurchases = 0;
    let exitMineBaseline = -1;
    let depositBaseline = -1;
    let forcedEat: {
        foodBefore: number;
        eatBaseline: number;
        enterBaseline: number;
    } | null = null;
    let provedBankTripEat = false;

    while (Date.now() < deadline) {
        const current = await snap(frame);
        events.ingest(current.logs);
        const fatal = events.find(FATAL_LOG);
        if (fatal) {
            recordMilestone(samples, 'fatal-log', current);
            die(`fatal Miner log: ${fatal.msg}`);
        }
        if (current.runner === 'crashed') die(`Miner crashed: ${current.crash ?? 'unknown error'}`);
        if (current.runner === 'stopped' || current.runner === 'idle') {
            recordMilestone(samples, 'premature-stop', current);
            const route = events.last(/^desert camp:/i)?.msg;
            die(`Miner stopped before proof completed${route ? `; last route log: ${route}` : ''}`);
        }
        if (current.hp <= 0) die('player reached 0 HP');
        if (current.tile && Math.max(Math.abs(current.tile.x - 3222), Math.abs(current.tile.z - 3218)) < 12) {
            die(`player returned to Lumbridge/respawn at ${JSON.stringify(current.tile)}`);
        }
        if (count(current.inventory, 'Rune pickaxe') > 0 || count(current.equipment, 'Rune pickaxe') !== 1) {
            die(`Rune pickaxe stopped being worn: inventory=${JSON.stringify(current.inventory)} equipment=${JSON.stringify(current.equipment)}`);
        }

        passPurchases = events.count(/desert camp: bought 1 Shantay pass for 5 Coins/i);
        if (!sawMetalRecovery && events.count(METAL_KEY_RECOVERY) > 0) {
            sawMetalRecovery = true;
            recordMilestone(samples, 'metal-key-recovered', current);
        }
        if (!sawWroughtRecovery && events.count(WROUGHT_KEY_RECOVERY) > 0) {
            sawWroughtRecovery = true;
            recordMilestone(samples, 'wrought-key-recovered', current);
        }
        if (current.tile && current.tile.level === 0 && current.tile.z < 3117 && current.tile.z > 3000) {
            sawDesertOutfit ||= hasWorn(current, DESERT_OUTFIT);
        }
        const outerGateEntries = events.count(/Desert Mining Camp outer gate in .*: crossed/i);
        if (outerGateEntries > verifiedWornPickEntries) {
            verifiedWornPickEntries = outerGateEntries;
            recordMilestone(samples, `outer-gate-${verifiedWornPickEntries}-pick-worn`, current);
        }
        if (current.tile && current.tile.z >= 9408) {
            sawSlaveOutfit ||= hasWorn(current, SLAVE_OUTFIT);
        }
        if (current.tile && Math.max(Math.abs(current.tile.x - MINE_ANCHOR.x), Math.abs(current.tile.z - MINE_ANCHOR.z)) <= 8) {
            sawKeysAtMine ||= count(current.inventory, 'Metal key') > 0 && count(current.inventory, 'Wrought iron key') > 0;
            sawPickAtMine ||= count(current.equipment, 'Rune pickaxe') === 1;
        }
        if (current.bankOpen && current.bankLoaded && count(current.bank, 'Cake') === 13) sawBankCake13 = true;
        if (injectedOre > 0 && current.bankOpen && current.bankLoaded && count(current.bank, 'Mithril ore') >= injectedOre + 1) {
            sawBankedOre = true;
        }

        const foodReady = events.count(/food: trip ready with 7 Cake/i) >= 1;
        const foodWithdraw = events.count(/food: withdraw 7 Cake/i) >= 1;
        sawExactFoodLoad ||= foodReady && foodWithdraw && foodCount(current.inventory) === FOOD_TARGET;
        const enteredOnce = ENTRY_CROSSINGS.every(pattern => events.count(pattern) >= 1);
        if (firstNaturalXp < 0 && enteredOnce && current.miningXp > xp0 && count(current.inventory, 'Mithril ore') > 0) {
            if (!sawExactFoodLoad) {
                die('natural ore arrived before observing the exact 7-Cake withdrawal and ready state');
            }
            if (!sawBankCake13) die('never observed the loaded Shantay bank with Cake reduced from 20 to 13');
            if (passPurchases < 1) die('reached mine without an observed 5-Coin Shantay pass purchase');
            if (!sawMetalRecovery || !sawWroughtRecovery) {
                die(`reached mine without proving both key recoveries metal=${sawMetalRecovery} wrought=${sawWroughtRecovery}`);
            }
            if (!sawDesertOutfit || !sawSlaveOutfit || !sawKeysAtMine || !sawPickAtMine || verifiedWornPickEntries < 1) {
                die(`route loadout proof incomplete desert=${sawDesertOutfit} slave=${sawSlaveOutfit} ` + `keys=${sawKeysAtMine} pick=${sawPickAtMine} outerGatePickWorn=${verifiedWornPickEntries}`);
            }
            firstNaturalXp = current.miningXp;
            recordMilestone(samples, 'first-natural-ore', current);
            const oreBefore = count(current.inventory, 'Mithril ore');
            exitMineBaseline = events.count(ROUTE_EXIT_MINE_DEEP);
            depositBaseline = events.count(BANKED_MITHRIL);
            await command(frame, 'give mithril_ore 28', 50);
            await frame.waitForFunction(() => (globalThis as never as BrowserGlobal).__rs2b0t.Inventory.used() === 28, undefined, { timeout: 5000 });
            const full = await snap(frame);
            if (full.inventory.length !== 28) die(`ore fill fixture did not make a full pack (${full.inventory.length}/28)`);
            injectedOre = count(full.inventory, 'Mithril ore') - oreBefore;
            if (injectedOre <= 0) die('ore fill fixture did not add any Mithril ore');
            events.ingest(full.logs);
            recordMilestone(samples, 'full-pack-injected', full);
        }

        if (firstNaturalXp >= 0 && !forcedEat && events.count(ROUTE_EXIT_MINE_DEEP) > exitMineBaseline) {
            const foodBefore = foodCount(current.inventory);
            if (foodBefore <= 0) die('full-pack exit began without Cake available for the latch proof');
            forcedEat = {
                foodBefore,
                eatBaseline: events.count(FULL_HEAL_EAT),
                enterBaseline: events.count(ROUTE_ENTER)
            };
            const damage = Math.max(0, 12 - (current.maxHp - current.hp));
            if (damage > 0) await command(frame, `~hit ${damage}`, TICK_MS);
            recordMilestone(samples, 'outbound-eat-damage-injected', await snap(frame));
        }

        if (forcedEat && !provedBankTripEat) {
            if (events.count(ROUTE_ENTER) > forcedEat.enterBaseline) {
                die('route flipped back to enter after Cake freed a slot during the outbound bank trip');
            }
            const foodDropped = foodCount(current.inventory) < forcedEat.foodBefore;
            const eatLogged = events.count(FULL_HEAL_EAT) > forcedEat.eatBaseline;
            if (foodDropped && eatLogged) {
                provedBankTripEat = true;
                recordMilestone(samples, 'outbound-cake-freed-slot', current);
            } else if (events.count(BANKED_MITHRIL) > depositBaseline) {
                die(`bank deposit happened before proving Cake freed a slot; food ${foodCount(current.inventory)}/${forcedEat.foodBefore}, eatLogged=${eatLogged}`);
            }
        }

        const exitedOnce = EXIT_CROSSINGS.every(pattern => events.count(pattern) >= 1);
        const enteredTwice = ENTRY_CROSSINGS.every(pattern => events.count(pattern) >= 2);

        if (firstNaturalXp >= 0 && exitedOnce && enteredTwice && secondEntryXp < 0) {
            if (!provedBankTripEat) die('completed the outbound route without proving the full-pack Cake latch');
            if (!sawBankedOre) die(`never observed at least ${injectedOre + 1} Mithril ore in the loaded Shantay bank`);
            if (passPurchases < 2) die(`second mine entry used only ${passPurchases} observed pass purchase(s)`);
            if (verifiedWornPickEntries < 2) {
                die(`second entry did not prove the pickaxe stayed worn at the outer gate (${verifiedWornPickEntries}/2)`);
            }
            secondEntryXp = current.miningXp;
        }
        if (secondEntryXp >= 0 && current.miningXp > secondEntryXp && count(current.inventory, 'Mithril ore') > 0) {
            if (events.count(CART_RETRY) === 0) {
                die('low-Agility fixture completed without exercising a source-authored mine-cart retry');
            }
            recordMilestone(samples, 'second-natural-ore', current);
            return { injectedOre, final: current };
        }
        await frame.waitForTimeout(150);
    }
    const missingEntry = ENTRY_CROSSINGS.filter(pattern => events.count(pattern) < 2).map(pattern => pattern.source);
    const missingExit = EXIT_CROSSINGS.filter(pattern => events.count(pattern) < 1).map(pattern => pattern.source);
    die(
        `timed out after ${args.minutes} minutes before a complete banked round trip and second natural ore; ` +
            `missing second-entry events=${JSON.stringify(missingEntry)}; missing exit events=${JSON.stringify(missingExit)}; ` +
            `key recovery metal=${events.count(METAL_KEY_RECOVERY)} wrought=${events.count(WROUGHT_KEY_RECOVERY)}`
    );
}

async function proveInclusiveCake(frame: Frame, samples: MilestoneSample[], events: EventLedger): Promise<void> {
    await command(frame, 'setstat hitpoints 20', TICK_MS * 2);
    const before = await snap(frame);
    events.ingest(before.logs);
    const logBefore = events.count(/food: eat .*full heal/i);
    const signature = foodSignature(before.inventory);
    if (foodCount(before.inventory) <= 0 || before.hp !== 20 || before.maxHp !== 20) {
        die(`Cake boundary setup invalid: hp=${before.hp}/${before.maxHp}, food=${foodCount(before.inventory)}`);
    }
    await command(frame, '~hit 4', TICK_MS);
    await frame.waitForFunction(
        oldSignature => {
            const global = globalThis as never as BrowserGlobal;
            const items = global.__rs2b0t.Inventory.items();
            const names = ['Cake', '2/3 cake', 'Slice of cake'];
            const sig = names
                .map(name => {
                    const count = items.filter(item => item.name?.toLowerCase() === name.toLowerCase()).reduce((sum, item) => sum + item.count, 0);
                    return `${name}:${count}`;
                })
                .join('|');
            return sig !== oldSignature && global.__rs2b0t.Skills.effective('hitpoints') === 20;
        },
        signature,
        { timeout: 15_000 }
    );
    const after = await snap(frame);
    events.ingest(after.logs);
    if (events.count(/food: eat .*full heal/i) <= logBefore) {
        die('Cake changed the pack and HP without an observed full-heal food log');
    }
    recordMilestone(samples, 'inclusive-cake-boundary', after);
}

function assertHealthy(sample: Sample, events: EventLedger, stage: string): void {
    const fatal = events.find(FATAL_LOG);
    if (fatal) die(`${stage}: fatal Miner log: ${fatal.msg}`);
    if (sample.runner === 'crashed') die(`${stage}: Miner crashed: ${sample.crash ?? 'unknown error'}`);
    if (sample.runner !== 'running') die(`${stage}: Miner runner is ${sample.runner}`);
}

const args = parseArgs(process.argv.slice(2));
const base = safeBase(args.base);
await attestProcess(args, base);
const artifactHashes = await attestArtifacts(base);
await mkdir(args.evidenceDir, { recursive: true });

const samples: MilestoneSample[] = [];
const events = new EventLedger();
let wall: Page | null = null;
let outcome: Record<string, unknown> = { ok: false };
const browser = await firefox.launch({ headless: true });
const browserEvidence = { name: browser.browserType().name(), version: browser.version() };
console.log(`BROWSER: ${browserEvidence.name} ${browserEvidence.version}`);
try {
    const context = await browser.newContext({ viewport: HARNESS_VIEWPORT });
    wall = await context.newPage();
    wall.on('crash', () => console.error('[browser crash] multibox renderer crashed'));
    wall.on('console', message => {
        if (message.type() === 'error' || /nav worker/i.test(message.text())) console.error(`[browser ${message.type()}] ${message.text()}`);
    });
    wall.on('requestfailed', request => console.error(`[browser requestfailed] ${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`));
    wall.on('pageerror', error => console.error(`[prep pageerror] ${error.message}`));
    const initialBank = await prepareAccount(wall, args, base);
    wall.on('pageerror', error => console.error(`[wall pageerror] ${error.message}`));
    const frame = await wallFrame(wall, args, base);
    const trip = await waitForRoundTrip(frame, args, samples, events);
    await proveInclusiveCake(frame, samples, events);
    const final = await snap(frame);
    events.ingest(final.logs);
    assertHealthy(final, events, 'final proof');
    const finalArtifactHashes = await attestArtifacts(base);
    if (JSON.stringify(finalArtifactHashes) !== JSON.stringify(artifactHashes)) {
        die('served artifacts changed during the E2E run');
    }
    recordMilestone(samples, 'success-running', final);

    outcome = {
        ok: true,
        account: args.username,
        profile: args.profile,
        base: base.origin,
        browser: browserEvidence,
        artifactHashes,
        initialBank,
        injectedOre: trip.injectedOre,
        final: { tile: final.tile, miningXp: final.miningXp, hp: `${final.hp}/${final.maxHp}` },
        events: events.lines,
        samples
    };
    await wall.evaluate(() => {
        const banner = document.createElement('div');
        banner.textContent = 'AFTER · Desert Mining Camp round trip passed';
        Object.assign(banner.style, {
            position: 'fixed',
            inset: '0 0 auto 0',
            zIndex: '2147483647',
            padding: '10px 16px',
            background: '#146b31',
            borderBottom: '4px solid #48dc78',
            color: '#fff',
            font: '700 18px monospace',
            textAlign: 'center'
        });
        document.body.append(banner);
        document.body.style.paddingTop = '44px';
    });
    await wall.screenshot({ path: `${args.evidenceDir}/success.png`, fullPage: true });
    await stopRunner(frame);
    console.log(
        'PASS: Desert Miner proved an authoritative empty bank, recovered both keys, withdrew Cake, bought/crossed two passes, ' +
            'kept the pickaxe equipped across both entries, shared-walked every camp crossing twice, stayed bank-bound after Cake ' +
            'freed a full-pack slot, mined naturally twice, banked the haul, ate Cake at hp+4=max, and recovered from a real cart Agility failure.'
    );
    console.log(`Evidence: ${args.evidenceDir}/success.png and ${args.evidenceDir}/evidence.json`);
} catch (error) {
    outcome = {
        ok: false,
        account: args.username,
        profile: args.profile,
        base: base.origin,
        browser: browserEvidence,
        artifactHashes,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        events: events.lines,
        samples
    };
    if (wall) await wall.screenshot({ path: `${args.evidenceDir}/failure.png`, fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await writeFile(`${args.evidenceDir}/evidence.json`, JSON.stringify(outcome, null, 2));
    await browser.close();
}
