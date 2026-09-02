/** Live proof for JiveDragons at the Taverley Dungeon blue dragons: --style --minutes --dusty --clue --leave --tick --no-starve.
 *  Why: supply.ts and combat.ts carry no unit tests because every function in them drives a live client, so this run is the only proof either of them works. */

// Usage: HEADED=1 bun e2e/jivedragons-live.ts [--base url] [--style melee|mage|range] [--minutes n] [--tick ms] [--dusty] [--clue] [--leave teleport|walk] [--no-starve]
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

type Style = 'melee' | 'mage' | 'range';
const STYLES: Style[] = ['melee', 'mage', 'range'];

type Leave = 'teleport' | 'walk';
const LEAVES: Leave[] = ['teleport', 'walk'];

/** A hard map clue: the tier blue dragons drop, and one dig rather than a trail no run is long enough to finish. */
const CLUE = { debug: 'trail_clue_hard_map001', id: 2722 };

interface Args {
    base: string;
    user: string;
    style: Style;
    minutes: number;
    tickMs: number;
    dusty: boolean;
    starve: boolean;
    deploy: boolean;
    leave: Leave;
    clue: boolean;
}

function fail(msg: string): never {
    throw new Error(`FAIL: ${msg}`);
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `jd${Date.now().toString(36).slice(-6)}`,
        style: 'range',
        minutes: 20,
        tickMs: 0,
        dusty: false,
        starve: true,
        deploy: true,
        leave: 'teleport',
        clue: false
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-starve') { out.starve = false; continue; }
        if (flag === '--dusty') { out.dusty = true; continue; }
        if (flag === '--clue') { out.clue = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--style') { out.style = value as Style; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--leave') { out.leave = value as Leave; }
    }
    if (!LEAVES.includes(out.leave)) { fail(`--leave takes ${LEAVES.join(', ')}, got '${out.leave}'`); }
    if (!STYLES.includes(out.style)) { fail(`--style takes ${STYLES.join(', ')}, got '${out.style}'`); }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));

interface Point { x: number; z: number; level: number }

// Why: sites.ts is not on the harness ABI, so the lair box, the safespots and the anchor are mirrored here and a drift in either copy shows up as a failed milestone rather than a silent pass.
const LAIR = { minX: 2888, maxX: 2923, minZ: 9769, maxZ: 9816, level: 0 };
const SAFESPOTS: Point[] = [{ x: 2901, z: 9809, level: 0 }, { x: 2900, z: 9809, level: 0 }, { x: 2901, z: 9810, level: 0 }];
const MELEE_ANCHOR: Point = { x: 2900, z: 9808, level: 0 };
const BANK: Point = { x: 2946, z: 3369, level: 0 };

const DUSTY_ID = 1590;
const JAIL_KEY_ID = 1591;
const TARGET = 'Blue dragon';
const BABY = 'Baby blue dragon';
const FOOD = { debug: 'lobster', name: 'Lobster' };
const LOBSTER_HEAL = 12;
const PACK_FOOD = 20;
const PANIC_PCT = 30;

const LEVELS: [string, number][] = [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 99], ['ranged', 85], ['magic', 80]];

const POLL_MS = 750;
const KEY_MS = 900_000;
const GATE_MS = 480_000;
const SPOT_MS = 300_000;
const KILL_MS = 480_000;
const BANK_MS = 900_000;
const SOAK_MS = 120_000;
const STARVE_WAIT_MS = 180_000;
const STARVE_BANK_MS = 900_000;
/** How long after the harness sends its own ~hit a drop of that size is the harness rather than a breath. */
const HARNESS_HIT_GRACE_MS = 2500;
/** The substring acquireKey logs once it has read the bank and found no key there. */
const BANK_READ_LINE = 'in the bank or in the pack';

const PROOF_PATH = 'out/jivedragons-proof.json';
const SHOT_PATH = 'out/jivedragons-live.png';

interface Kit {
    pack: readonly (readonly [string, string, number])[];
    /** Armour to give and wear before the run, as [debug name, display name]. The script only ever equips a weapon, ammo and the melee shield, so anything else has to go on here or it never goes on at all. */
    worn: readonly (readonly [string, string])[];
    bank: readonly BankSeedItem[];
    settings: Record<string, string | number | boolean>;
}

// Why: LEVELS gives 85 Ranged, 80 Magic and 75 Defence, so black d'hide and the wizard set are what a character at those levels would be wearing. The engine has no mystic robes, checked against the content pack, so the wizard set is the top of what it can wear.
const RANGE_WORN: readonly (readonly [string, string])[] = [
    ['coif', 'Coif'],
    ['black_dragonhide_body', 'Dragonhide body'],
    ['black_dragonhide_chaps', 'Dragonhide chaps'],
    ['black_dragon_vambraces', 'Dragon vambraces'],
    ['leather_boots', 'Leather boots'],
    ['amulet_of_glory', 'Amulet of glory']
];

const MAGE_WORN: readonly (readonly [string, string])[] = [
    ['bluewizhat', 'Wizards hat'],
    ['wizards_robe', 'Wizards robe'],
    ['blue_skirt', 'Blue skirt'],
    ['leather_boots', 'Leather boots'],
    ['amulet_of_magic', 'Amulet of magic']
];

const LOOT = ['Dragon bones', 'Dragonhide', 'Uncut diamond', 'Uncut ruby', 'Uncut emerald', 'Uncut sapphire'];

const COMMON_BANK: BankSeedItem[] = [
    { debugName: FOOD.debug, displayName: FOOD.name, qty: 400 },
    { debugName: 'lawrune', displayName: 'Law rune', qty: 200 },
    { debugName: 'airrune', displayName: 'Air rune', qty: 20_000 },
    { debugName: 'waterrune', displayName: 'Water rune', qty: 200 }
];

// Why: the pack starts stocked so the first task is the key leg rather than a restock, which is what makes "one bank stop for a cold key" a number worth counting.
// Why: leaveVia and solveClues both follow the flags rather than sitting on a fixed value, because the script ships with teleport and clues ON and the harness used to pin both to the opposite, so the shipped defaults were the two settings no run ever exercised.
function kitFor(style: Style): Kit {
    const common = { foodWithdraw: PACK_FOOD, panicHp: PANIC_PCT, foodReserve: 4, healTo: 90, site: 'taverley-blue', teleStock: 2, buryBones: false, solveClues: args.clue, bankCommonJunk: false, loot: LOOT.join(', '), logDetail: 'Verbose', usePotions: false, leaveVia: args.leave };
    if (style === 'melee') {
        return {
            pack: [['antidragonbreathshield', 'Dragonfire shield', 1], [FOOD.debug, FOOD.name, PACK_FOOD]],
            worn: [],
            bank: [...COMMON_BANK, { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 }, { debugName: 'antidragonbreathshield', displayName: 'Dragonfire shield', qty: 1 }],
            settings: { ...common, combatStyle: 'melee', meleeStyle: 'strength', weapon: 'Rune scimitar', useSpecial: true }
        };
    }
    // Why: Fire Wave needs 75 Magic against the 80 the character has, and the Mystic fire staff pays the fire runes, so a cast costs one blood and five air rather than the four fire and three air a level 35 Fire Bolt was spending.
    if (style === 'mage') {
        return {
            pack: [['mystic_fire_staff', 'Mystic fire staff', 1], ['airrune', 'Air rune', 750], ['bloodrune', 'Blood rune', 150], [FOOD.debug, FOOD.name, PACK_FOOD]],
            worn: MAGE_WORN,
            bank: [...COMMON_BANK, { debugName: 'mystic_fire_staff', displayName: 'Mystic fire staff', qty: 1 }, { debugName: 'bloodrune', displayName: 'Blood rune', qty: 5000 }],
            settings: { ...common, combatStyle: 'mage', staff: 'Mystic fire staff', spell: 'Fire Wave', runesWithdraw: 150, runeBuffer: 300 }
        };
    }
    return {
        pack: [['magic_shortbow', 'Magic shortbow', 1], ['rune_arrow', 'Rune arrow', 500], [FOOD.debug, FOOD.name, PACK_FOOD]],
        worn: RANGE_WORN,
        bank: [...COMMON_BANK, { debugName: 'magic_shortbow', displayName: 'Magic shortbow', qty: 1 }, { debugName: 'rune_arrow', displayName: 'Rune arrow', qty: 5000 }],
        settings: { ...common, combatStyle: 'range', bow: 'Magic shortbow', ammo: 'Rune arrow', rangeStyle: 'rapid', ammoWithdraw: 500 }
    };
}

const kit = kitFor(args.style);
// Why: the melee weapon is seeded into the bank alone, so the run only ever holds it by withdrawing it, which is what the wielded assertion is there to catch.
const WIELDED = String(kit.settings['weapon'] ?? kit.settings['bow'] ?? kit.settings['staff'] ?? '');
const bankSeed: BankSeedItem[] = args.dusty
    ? [...kit.bank, { debugName: 'dusty_key', displayName: 'Dusty key', qty: 1 }]
    : [...kit.bank];

function inLair(t: Point | null): boolean {
    return t !== null && t.level === LAIR.level && t.x >= LAIR.minX && t.x <= LAIR.maxX && t.z >= LAIR.minZ && t.z <= LAIR.maxZ;
}

function samePoint(a: Point | null, b: Point): boolean {
    return a !== null && a.x === b.x && a.z === b.z && a.level === b.level;
}

function onSafespot(t: Point | null): boolean {
    return SAFESPOTS.some(spot => samePoint(t, spot));
}

function chebyshev(a: Point, b: Point): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

interface BabyView { index: number; dist: number; aims: boolean }

interface LogLine { time: number; level: string; msg: string }

interface Sample {
    at: number;
    tick: number;
    tile: Point | null;
    hp: number;
    maxHp: number;
    runner: string;
    status: string;
    parked: boolean;
    parkReason: string;
    died: boolean;
    kills: number;
    trips: number;
    looted: number;
    cluesSolved: number;
    keyState: string;
    spotIdx: number;
    bankOpen: boolean;
    dusty: number;
    jailKey: number;
    food: number;
    law: number;
    worn: string[];
    adults: number;
    babies: BabyView[];
    logs: LogLine[];
}

interface Probe { dustyId: number; jailKeyId: number; food: string; law: string; target: string; baby: string }

interface Api {
    __rs2b0t: {
        Bank: { isOpen(): boolean };
        Equipment: { items(): { name: string | null }[]; contains(name: string): boolean; equip(name: string): Promise<boolean> };
        Game: { tile(): Point | null };
        Inventory: { count(name: string): number; countById(id: number): number };
        Npcs: { all(): { name: string | null; index: number; distance(): number; targetsMe(): boolean }[] };
        Skills: { effective(name: string): number; level(name: string): number };
    };
    rs2b0t: {
        host: { tickCount: number };
        runner: { state: string; bot: Record<string, unknown> | null; ctx: { log: LogLine[] } | null };
    };
}

// Why: a page.evaluate callback is serialised into the browser, so every id and name it reads has to arrive through the argument list rather than off a module constant.
function sample(page: Page, probe: Probe): Promise<Sample> {
    return page.evaluate(p => {
        const g = globalThis as never as Api;
        const a = g.__rs2b0t;
        const bot = g.rs2b0t.runner.bot;
        const num = (key: string): number => Number(bot?.[key] ?? 0);
        const npcs = a.Npcs.all();
        return {
            at: Date.now(),
            tick: g.rs2b0t.host.tickCount,
            tile: a.Game.tile(),
            hp: a.Skills.effective('hitpoints'),
            maxHp: a.Skills.level('hitpoints'),
            runner: g.rs2b0t.runner.state,
            status: String(bot?.status ?? ''),
            parked: bot?.parked === true,
            parkReason: String(bot?.parkReason ?? ''),
            died: bot?.died === true,
            kills: num('killsTotal'),
            trips: num('bankTrips'),
            looted: num('looted'),
            cluesSolved: num('cluesSolved'),
            keyState: String(bot?.keyState ?? ''),
            spotIdx: num('safespotIdx'),
            bankOpen: a.Bank.isOpen(),
            dusty: a.Inventory.countById(p.dustyId),
            jailKey: a.Inventory.countById(p.jailKeyId),
            food: a.Inventory.count(p.food),
            law: a.Inventory.count(p.law),
            worn: a.Equipment.items().map(i => i.name ?? '?'),
            adults: npcs.filter(n => n.name === p.target).length,
            babies: npcs.filter(n => n.name === p.baby).map(n => ({ index: n.index, dist: n.distance(), aims: n.targetsMe() })),
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-500).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, probe);
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value, waitMs))) { fail(`could not send ::${value}`); }
}

async function heldCount(page: Page, name: string): Promise<number> {
    return page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);
}

async function seedPack(page: Page): Promise<void> {
    for (const [debug, display, qty] of kit.pack) {
        let held = 0;
        for (let attempt = 0; attempt < 5 && held < qty; attempt++) {
            await command(page, `give ${debug} ${qty}`);
            held = await heldCount(page, display);
        }
        if (held < qty) { fail(`could not seed ${qty} ${display} into the pack, got ${held}`); }
    }
    console.log(`pack seeded: ${kit.pack.map(([, display, qty]) => `${qty}x ${display}`).join(', ')}`);
}

// Why: this runs after setLevels, because black d'hide wants 70 Ranged and a character still at level 1 refuses it, which would read as a wrong item name rather than a wrong order.
async function seedWorn(page: Page): Promise<void> {
    for (const [debug, display] of kit.worn) {
        await command(page, `give ${debug} 1`);
        if ((await heldCount(page, display)) < 1) { fail(`could not give '${debug}', so the name is wrong for this engine`); }
        let on = false;
        for (let attempt = 0; attempt < 4 && !on; attempt++) {
            await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.equip(n), display);
            await page.waitForTimeout(600);
            on = await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Equipment.contains(n), display);
        }
        if (!on) { fail(`${display} was in the pack and would not go on`); }
    }
    if (kit.worn.length > 0) { console.log(`worn: ${kit.worn.map(([, display]) => display).join(', ')}`); }
}

// Why: a blue dragon drops a hard clue rarely enough that no run of this length can wait for one, so the run is handed one and asked to prove it does something with it.
async function seedClue(page: Page): Promise<void> {
    await command(page, `give ${CLUE.debug} 1`);
    const held = await page.evaluate(id => (globalThis as never as Api).__rs2b0t.Inventory.countById(id), CLUE.id);
    if (held < 1) { fail(`could not give '${CLUE.debug}', so the clue case cannot start`); }
    console.log(`clue seeded: ${CLUE.debug}`);
}

async function setLevels(page: Page): Promise<void> {
    for (const [skill, level] of LEVELS) {
        for (let attempt = 0; attempt < 4; attempt++) {
            await command(page, `setstat ${skill} ${level}`);
            const actual = await page.evaluate(s => (globalThis as never as Api).__rs2b0t.Skills.level(s), skill);
            if (actual === level) { break; }
            if (attempt === 3) { fail(`${skill} is ${actual}, expected ${level}`); }
        }
    }
    console.log(`stats: ${LEVELS.map(([skill, level]) => `${skill} ${level}`).join(', ')}`);
}

async function attestBundle(bundleUrl: string): Promise<string> {
    const local = Bun.file('out/botclient.js');
    if (!(await local.exists())) { fail('out/botclient.js is missing, build this worktree before the run'); }
    const response = await fetch(bundleUrl);
    if (!response.ok) { fail(`the served bundle at ${bundleUrl} returned HTTP ${response.status}`); }
    const digest = (data: ArrayBuffer): string => createHash('sha256').update(new Uint8Array(data)).digest('hex');
    const here = digest(await local.arrayBuffer());
    const served = digest(await response.arrayBuffer());
    if (here !== served) { fail(`the served bundle ${served} is not this worktree's ${here}`); }
    console.log(`bundle attested: sha256=${here}`);
    return here;
}

const tag = `jd${Date.now().toString(36).slice(-6)}`;
const client = args.deploy ? deployIsolatedClient(tag) : { page: '/bot.html', cleanup: (): void => {} };
const bundleUrl = `${args.base}${args.deploy ? `/bot/${tag}/botclient.js` : '/bot/botclient.js'}`;

interface HpDrop { at: number; from: number; to: number; adults: number; tile: Point | null; was: Point | null; bothEnds: boolean; eitherEnd: boolean; harness: boolean; explained: number; unexplained: number }
interface StarveRecord { at: number; hitAt: number | null; hp: number; maxHp: number; food: number; law: number; damage: number | null; hitTile: Point | null; tripsBefore: number }

await mkdir('out', { recursive: true });
const bundleSha256 = await attestBundle(bundleUrl).catch((error: unknown) => { client.cleanup(); throw error; });

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const pageErrors: string[] = [];
const met: Record<string, { atMs: number; note: string }> = {};
const hpDrops: HpDrop[] = [];
const violations: HpDrop[] = [];
const babyRoll = new Map<number, { seen: number; nearest: number; onAnchor: number }>();
const printed = new Set<string>();

let last: Sample | null = null;
let finalSample: Sample | null = null;
let bankOpens = 0;
let bankReads = 0;
let jailerFights = 0;
let jailKeyPickups = 0;
let deaths = 0;
let bothEndsDrops = 0;
let harnessCredit = 0;
let engagingLines = 0;
let coinLoots = 0;
let arrowLoots = 0;
let waitingPolls = 0;
let safespotMs = 0;
let lairMs = 0;
let maxAnchorDist = 0;
let anchorHeldPolls = 0;
let tripsAtKill = -1;
let tripsAtWalkOut = -1;
let walkOutTile: Point | null = null;
let walkOutSaid = false;
let outOfLairSaid = false;
let starve: StarveRecord | null = null;
let starveDue = 0;
let proofWritten = false;

const t0 = Date.now();
const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

// Why: everything this harness knows went to a console nobody watching the browser can see, so a deliberate step like the starve read as the bot being mugged. The overlay puts the checklist and the current act on the page, where both a HEADED watch and the screenshot pick it up.
let overlayNote = '';
const noteOverlay = (text: string): void => {
    overlayNote = text;
    console.log(`${stamp()} ${text}`);
};

const mark = (id: string, note: string): void => {
    if (met[id]) { return; }
    met[id] = { atMs: Date.now() - t0, note };
    console.log(`${stamp()} PASS(${id}) ${note}`);
};

async function installOverlay(page: Page): Promise<void> {
    await page.evaluate(() => {
        const box = document.createElement('div');
        box.id = 'jd-overlay';
        box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;font:12px/1.45 monospace;'
            + 'background:rgba(8,12,10,.86);color:#cfe8d8;padding:10px 12px;border:1px solid #2f6b4a;'
            + 'border-radius:6px;max-width:340px;pointer-events:none;white-space:pre-wrap';
        box.textContent = 'JiveDragons proof: starting';
        document.body.appendChild(box);
    });
}

async function drawOverlay(page: Page, required: readonly string[], elapsed: number, status: string): Promise<void> {
    const lines = required.map(id => `${met[id] ? '[x]' : '[ ]'} ${id}${met[id] ? ` ${Math.round(met[id]!.atMs / 1000)}s` : ''}`);
    const head = `JiveDragons proof, ${args.style}${args.dusty ? ' + banked key' : ''}  ${Math.round(elapsed / 1000)}s/${args.minutes * 60}s`;
    const body = `${head}\n${'-'.repeat(34)}\n${lines.join('\n')}\n${'-'.repeat(34)}\nbot: ${status}${overlayNote === '' ? '' : `\n>> ${overlayNote}`}`;
    await page.evaluate(text => {
        const box = document.getElementById('jd-overlay');
        if (box !== null) { box.textContent = text; }
    }, body).catch(() => {});
}

try {
    page.on('pageerror', error => {
        pageErrors.push(error.stack ?? error.message);
        console.error(`pageerror: ${error.stack ?? error.message}`);
    });

    await mainlandAccount(page, args.base, args.user, client.page);
    console.log(`mainland-ready as '${args.user}' for a ${args.style} run of ${args.minutes} minutes${args.dusty ? ' with a banked Dusty key' : ''}`);

    if (args.tickMs > 0) {
        await command(page, `speed ${args.tickMs}`);
        console.log(`world tick: ${args.tickMs}ms`);
    }

    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');
    await seedItemsToBank(page, bankSeed, BANK);
    await seedPack(page);
    await setLevels(page);
    await seedWorn(page);
    if (args.clue) { await seedClue(page); }
    await clearChatDialogs(page, 'seed dialog(s)');
    if (!(await teleTo(page, BANK, 6, 30_000))) { fail(`could not stand at the Falador bank (${BANK.x},${BANK.z})`); }

    await setSettings(page, 'JiveDragons', kit.settings);
    await startScript(page, 'JiveDragons');
    console.log(`JiveDragons started; watching the key, the gate, ${args.style === 'melee' ? 'the melee anchor' : `the safespot at ${SAFESPOTS[0].x},${SAFESPOTS[0].z}`}, a kill and a bank trip`);

    const probe: Probe = { dustyId: DUSTY_ID, jailKeyId: JAIL_KEY_ID, food: FOOD.name, law: 'Law rune', target: TARGET, baby: BABY };
    const guardsSafespot = args.style !== 'melee';
    const spotAssert = args.style === 'melee' ? 'meleeanchor' : 'safespot';
    const chain: [string, number][] = [['key', KEY_MS], ['gate', GATE_MS], [spotAssert, SPOT_MS], ['kill', KILL_MS], ['banktrip', BANK_MS]];
    // Why: melee passed a full run on 2 kills and 0 pickups, because a kill did not end the fight call and the drops rotted inside it, so every style now has to bring something home.
    const exitAssert = args.leave === 'walk' ? 'walkout' : 'teleport';
    const required = ['key', 'gate', spotAssert, 'kill', 'banktrip', exitAssert, 'wielded', 'loot', args.dusty ? 'bankedkey' : 'coldkey'];
    // Why: the trail is what the clue case is for, and a run that picks a scroll up and never starts it would otherwise pass on the pickup alone.
    if (args.clue) { required.push('clue', 'cluedone'); }
    if (args.style !== 'melee') { required.push('hpheld'); }
    if (args.style === 'melee') { required.push('meleekills'); }
    // Why: only the bow leaves anything of its own on the floor, so the arrows-come-home claim is a range claim.
    if (args.style === 'range') { required.push('arrows'); }
    if (args.starve) { required.push('starvebank'); }

    const deadline = t0 + args.minutes * 60_000;
    let lastState = 0;

    await installOverlay(page);

    while (Date.now() < deadline) {
        const s = await sample(page, probe);
        finalSample = s;
        const elapsed = Date.now() - t0;
        await drawOverlay(page, required, elapsed, s.status);

        for (const line of s.logs) {
            const key = `${line.time}|${line.msg}`;
            if (printed.has(key)) { continue; }
            printed.add(key);
            console.log(`${stamp()} [${line.level}] ${line.msg.slice(0, 300)}`);
            if (/^engaging blue dragon /i.test(line.msg)) { engagingLines++; }
            if (/^looted Coins$/i.test(line.msg)) { coinLoots++; }
            if (/^looted Rune arrow$/i.test(line.msg)) { arrowLoots++; mark('arrows', 'the arrows it fired came home'); }
            if (line.msg.includes(BANK_READ_LINE)) { bankReads++; }
            if (/Walking out through the gate instead/i.test(line.msg)) { walkOutSaid = true; }
            if (/^teleported out to /i.test(line.msg)) { mark('teleport', line.msg); }
            if (/^out of the dragon lair/i.test(line.msg)) { outOfLairSaid = true; }
        }

        if (s.runner === 'crashed') { fail(`the runner crashed: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.runner === 'stopped') { fail(`the runner stopped before the run finished: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.parked) { fail(`the bot parked: ${s.parkReason}`); }

        if (s.bankOpen && !(last?.bankOpen ?? false)) { bankOpens++; }
        if (/fighting the Jailer/i.test(s.status) && !/fighting the Jailer/i.test(last?.status ?? '')) { jailerFights++; }
        if (s.jailKey > 0 && (last?.jailKey ?? 0) === 0) { jailKeyPickups++; }
        if (s.died && !(last?.died ?? false)) { deaths++; fail(`the bot died at ${s.tile?.x},${s.tile?.z}, on ${last?.hp ?? s.hp}/${s.maxHp} hp the poll before`); }
        if (/waiting for blue dragon \d+ to close/i.test(s.status)) { waitingPolls++; }

        if (last !== null) {
            const step = s.at - last.at;
            if (inLair(s.tile)) { lairMs += step; }
            // Why: a safespot with nothing in the scene to breathe on it proves nothing, and a sample that moved was only partly on the tile, so the soak clock runs on the stretches that held one safespot with an adult up.
            const parked = last.tile !== null && onSafespot(s.tile) && samePoint(s.tile, last.tile);
            if (parked && s.adults > 0) { safespotMs += step; }
            if (s.hp < last.hp) {
                const fell = last.hp - s.hp;
                // Why: the ~hit takes off the damage it was given, one tick after the send, so it explains that many hp once and no more, and anything above it in the same poll is a breath the cheat cannot account for.
                const inGrace = starve !== null && starve.hitAt !== null && elapsed - starve.hitAt <= HARNESS_HIT_GRACE_MS;
                const explained = inGrace ? Math.min(fell, harnessCredit) : 0;
                harnessCredit -= explained;
                const drop: HpDrop = {
                    at: elapsed, from: last.hp, to: s.hp, adults: s.adults, tile: s.tile, was: last.tile,
                    bothEnds: onSafespot(s.tile) && onSafespot(last.tile),
                    eitherEnd: onSafespot(s.tile) || onSafespot(last.tile),
                    harness: explained > 0, explained, unexplained: fell - explained
                };
                hpDrops.push(drop);
                if (drop.bothEnds) { bothEndsDrops++; }
                // Why: only a safespot at both ends says the tile failed; either-end fires on every hit taken walking off to loot or to bank, which the run has to do, and nothing in the sample tells that apart from a breath that landed on the tile.
                if (guardsSafespot && drop.unexplained > 0 && drop.bothEnds) {
                    violations.push(drop);
                    console.log(`${stamp()} HP FELL ON A SAFESPOT: ${last.hp} to ${s.hp} at ${last.tile?.x},${last.tile?.z} then ${s.tile?.x},${s.tile?.z} with ${s.adults} adult(s) up (${drop.unexplained} hp the harness cannot account for)`);
                }
                if (drop.harness) { console.log(`${stamp()} the harness's own ~hit accounts for ${explained} of the ${fell} hp drop at ${s.tile?.x},${s.tile?.z}, leaving ${drop.unexplained}`); }
            }
        }

        if (inLair(s.tile) && s.tile !== null) {
            maxAnchorDist = Math.max(maxAnchorDist, chebyshev(s.tile, MELEE_ANCHOR));
        }
        if (samePoint(s.tile, MELEE_ANCHOR)) { anchorHeldPolls++; }
        for (const baby of s.babies.filter(b => b.aims)) {
            const roll = babyRoll.get(baby.index) ?? { seen: 0, nearest: 99, onAnchor: 0 };
            roll.seen++;
            roll.nearest = Math.min(roll.nearest, baby.dist);
            if (samePoint(s.tile, MELEE_ANCHOR)) {
                roll.onAnchor++;
                if (roll.onAnchor === 1) { console.log(`${stamp()} WARNING: ${BABY} ${baby.index} is facing us at d=${baby.dist} while we stand on the anchor`); }
            }
            babyRoll.set(baby.index, roll);
        }

        // Why: killJailer is skipped whenever the Jail key is already held, so a Jail key arriving twice is what a per-retry re-kill looks like from out here, and the status transition alone would miss a retry that never changed it.
        // Why: Bank.isOpen() is sampled every 750ms and the booth the harness starts on opens and shuts inside one interval, so the bank stop is proved by the line acquireKey logs rather than by a counted transition.
        if (s.dusty > 0 && !met['key']) {
            const cost = `${jailerFights} Jailer fight(s), ${jailKeyPickups} Jail key pickup(s), ${bankReads} bank read line(s), ${bankOpens} sampled bank open(s)`;
            mark('key', `holding the Dusty key after ${cost}, keyState=${s.keyState}`);
            if (args.dusty && jailerFights === 0 && jailKeyPickups === 0) { mark('bankedkey', 'the banked key cost no Jailer kill'); }
            if (args.dusty && (jailerFights > 0 || jailKeyPickups > 0)) { fail(`a banked Dusty key still cost ${cost}`); }
            if (!args.dusty) {
                const wrong: string[] = [];
                if (jailerFights !== 1) { wrong.push(`${jailerFights} Jailer fight(s), expected 1`); }
                if (jailKeyPickups !== 1) { wrong.push(`${jailKeyPickups} Jail key pickup(s), expected 1`); }
                if (bankReads < 1) { wrong.push(`no log line containing '${BANK_READ_LINE}', expected the bank read that comes before the fetch`); }
                if (wrong.length > 0) { fail(`a cold key run went wrong on ${wrong.length} clause(s): ${wrong.join('; ')}. Observed ${cost}`); }
                mark('coldkey', `the cold key cost one Jailer fight and one Jail key pickup, after ${bankReads} bank read(s) that found no key`);
            }
        }
        if (inLair(s.tile)) { mark('gate', `inside the lair at ${s.tile?.x},${s.tile?.z}`); }
        if (samePoint(s.tile, SAFESPOTS[0])) { mark('safespot', `standing exactly on safespot 0 at ${SAFESPOTS[0].x},${SAFESPOTS[0].z}`); }
        if (samePoint(s.tile, MELEE_ANCHOR)) { mark('meleeanchor', `standing exactly on the melee anchor at ${MELEE_ANCHOR.x},${MELEE_ANCHOR.z}`); }
        if (WIELDED !== '' && s.worn.includes(WIELDED)) { mark('wielded', `${WIELDED} is worn`); }
        if (s.kills > 0 && met['wielded'] === undefined) { fail(`a kill landed with no ${WIELDED} worn, only ${s.worn.filter(w => w !== '?').join('/') || 'nothing'}`); }
        if (s.looted > 0) { mark('loot', `${s.looted} pickup(s) reached the pack after ${s.kills} kill(s)`); }
        if (args.clue && /clue/i.test(s.status)) { mark('clue', `the trail started, status '${s.status}'`); }
        if (args.clue && s.cluesSolved > 0) { mark('cluedone', `${s.cluesSolved} clue(s) solved`); }
        if (s.kills > 0) {
            if (tripsAtKill < 0) { tripsAtKill = s.trips; }
            mark('kill', `${s.kills} blue dragon(s) down`);
            if (engagingLines > 0) { mark('meleekills', `${s.kills} kill(s) with ${engagingLines} engage line(s) against ${waitingPolls} leash poll(s)`); }
        }
        if (tripsAtKill >= 0 && s.trips > tripsAtKill) { mark('banktrip', `bank trip ${s.trips} finished after the first kill`); }
        // Why: countBankTrip fires at the end of bankRoutine and leaveLair gates its start, so a trip that lands after the gate walk-out is the only proof from out here that leaveLair returned true.
        if (walkOutSaid && outOfLairSaid && tripsAtWalkOut < 0 && !inLair(s.tile) && s.tile !== null) {
            tripsAtWalkOut = s.trips;
            walkOutTile = s.tile;
        }
        if (tripsAtWalkOut >= 0 && s.trips > tripsAtWalkOut) {
            mark('walkout', `the gate walk-out landed outside the lair at ${walkOutTile?.x},${walkOutTile?.z} with no teleport, and trip ${s.trips} completed`);
        }
        if (guardsSafespot && violations.length === 0 && safespotMs >= SOAK_MS) {
            mark('hpheld', `no hp lost across ${Math.round(safespotMs / 1000)}s standing on a safespot with an adult up`);
        }

        if (args.starve && starve === null && met['kill'] && lairMs >= SOAK_MS) {
            if (starveDue === 0) { starveDue = Date.now(); }
            const clean = args.style === 'melee' || (!onSafespot(s.tile) && !onSafespot(last?.tile ?? null));
            if (inLair(s.tile) && !s.bankOpen && (clean || Date.now() - starveDue > STARVE_WAIT_MS)) {
                starve = { at: elapsed, hitAt: null, hp: s.hp, maxHp: s.maxHp, food: s.food, law: s.law, damage: null, hitTile: s.tile, tripsBefore: s.trips };
                noteOverlay(`STARVE TEST, on purpose: taking all ${s.food} food and hitting for ${LOBSTER_HEAL * 3}. The bot should bank, not die.`);
                await command(page, '~clearinv inv', 0);
                await command(page, 'give dusty_key 1', 0);
                const want = Math.round(s.maxHp * 0.55);
                const damage = s.hp - want;
                if (clean && damage >= LOBSTER_HEAL + 1 && want > Math.ceil((s.maxHp * PANIC_PCT) / 100)) {
                    await command(page, `~hit ${damage}`, 0);
                    starve.damage = damage;
                    starve.hitAt = Date.now() - t0;
                    harnessCredit = damage;
                }
            }
        }
        if (starve !== null && s.trips > starve.tripsBefore) {
            mark('starvebank', `the emptied pack reached the bank, trip ${s.trips} from ${starve.hp}/${starve.maxHp} hp`);
        }
        if (starve !== null && !met['starvebank'] && elapsed - starve.at > STARVE_BANK_MS) {
            fail(`the emptied pack never reached the bank within ${STARVE_BANK_MS / 1000}s, status '${s.status}'`);
        }

        let from = 0;
        for (const [id, budget] of chain) {
            const hit = met[id];
            if (hit) { from = hit.atMs; continue; }
            if (elapsed > from + budget) { fail(`milestone '${id}' missed its ${Math.round(budget / 1000)}s budget, status '${s.status}' at ${s.tile?.x},${s.tile?.z}`); }
            break;
        }

        if (Date.now() - lastState >= 15_000) {
            lastState = Date.now();
            const aims = [...babyRoll.entries()].map(([index, roll]) => `${index}@${roll.nearest}x${roll.seen}`).join(' ') || 'none';
            console.log(`${stamp()} STATE ${JSON.stringify({ tile: s.tile, hp: `${s.hp}/${s.maxHp}`, status: s.status, kills: s.kills, trips: s.trips, food: s.food, law: s.law, spot: s.spotIdx, adults: s.adults, worn: s.worn.filter(w => w !== '?').join('/'), anchorMax: maxAnchorDist, babies: aims })}`);
        }

        if (required.every(id => met[id] !== undefined)) { break; }
        last = s;
        await page.waitForTimeout(POLL_MS);
    }

    const final = finalSample ?? (await sample(page, probe));
    const missing = required.filter(id => met[id] === undefined);
    const babyLine = [...babyRoll.entries()].map(([index, roll]) => `${index} nearest ${roll.nearest} over ${roll.seen} poll(s), ${roll.onAnchor} of them on the anchor`).join('; ') || 'none';
    console.log(`ANCHOR: furthest ${maxAnchorDist} tile(s) from ${MELEE_ANCHOR.x},${MELEE_ANCHOR.z} inside the lair, stood on it for ${anchorHeldPolls} poll(s)`);
    console.log(`BABIES facing us: ${babyLine}`);
    const oneEndDrops = hpDrops.filter(d => d.eitherEnd && !d.bothEnds).length;
    console.log(`HP: ${hpDrops.length} drop(s), ${bothEndsDrops} with a safespot at both ends, ${oneEndDrops} taken walking on or off one, ${violations.length} counted as violations, ${Math.round(safespotMs / 1000)}s parked on a safespot with an adult up of ${Math.round(lairMs / 1000)}s in the lair`);
    console.log(`LOOT: ${final.looted} pickup(s), ${arrowLoots} of them Rune arrow, ${coinLoots} of them Coins`);
    if (violations.length > 0) { fail(`hp fell ${violations.length} time(s) while standing on a safespot: ${JSON.stringify(violations)}`); }
    if (coinLoots > 0) { fail(`it picked up Coins ${coinLoots} time(s) off a loot list that does not name them`); }
    if (missing.length > 0) { fail(`the budget ran out with these unproven: ${missing.join(', ')} (status '${final.status}' at ${final.tile?.x},${final.tile?.z})`); }
    if (pageErrors.length > 0) { fail(`${pageErrors.length} browser page error(s): ${pageErrors.join('\n')}`); }

    const proof = {
        generatedAt: new Date().toISOString(),
        result: 'PASS',
        base: args.base,
        username: args.user,
        style: args.style,
        dusty: args.dusty,
        tickMs: args.tickMs,
        minutes: args.minutes,
        bundleSha256,
        elapsedMs: Date.now() - t0,
        fixture: { levels: LEVELS, pack: kit.pack, bank: bankSeed, settings: kit.settings, start: BANK },
        assertions: met,
        required,
        counters: { kills: final.kills, bankTrips: final.trips, bankReads, bankOpens, jailerFights, jailKeyPickups, deaths, engagingLines, waitingPolls, looted: final.looted, arrowLoots, coinLoots },
        safespot: { spots: SAFESPOTS, heldMs: safespotMs, lairMs, drops: hpDrops.length, bothEndsDrops, oneEndDrops, violations: violations.length, hpDrops: hpDrops.slice(-300), violationDrops: violations },
        melee: { anchor: MELEE_ANCHOR, maxAnchorDist, anchorHeldPolls, babyTargets: [...babyRoll.entries()].map(([index, roll]) => ({ index, ...roll })) },
        walkOut: { sawTeleportRefused: walkOutSaid, sawGateExit: outOfLairSaid, endedOutside: walkOutTile, tripsAtWalkOut },
        starve,
        final: { tick: final.tick, tile: final.tile, hp: final.hp, maxHp: final.maxHp, worn: final.worn, status: final.status, logs: final.logs.slice(-40) }
    };
    await Bun.write(PROOF_PATH, JSON.stringify(proof, null, 2));
    proofWritten = true;
    await page.screenshot({ path: SHOT_PATH, fullPage: true });
    console.log(`PASS: ${required.length} assertion(s) in ${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(`  proof: ${PROOF_PATH}`);
    console.log(`  screenshot: ${SHOT_PATH}`);
} catch (error) {
    console.error(String(error));
    try {
        await page.screenshot({ path: SHOT_PATH, fullPage: true });
    } catch {
        /* the page may already be gone */
    }
    if (!proofWritten) {
        await Bun.write(PROOF_PATH, JSON.stringify({
            generatedAt: new Date().toISOString(),
            result: 'FAIL',
            base: args.base,
            username: args.user,
            style: args.style,
            error: String(error),
            elapsedMs: Date.now() - t0,
            assertions: met,
            counters: { bankReads, bankOpens, jailerFights, jailKeyPickups, deaths, engagingLines, waitingPolls, arrowLoots, coinLoots },
            safespot: { heldMs: safespotMs, lairMs, drops: hpDrops.length, bothEndsDrops, violations: violations.length, hpDrops: hpDrops.slice(-300), violationDrops: violations },
            melee: { maxAnchorDist, anchorHeldPolls, babyTargets: [...babyRoll.entries()].map(([index, roll]) => ({ index, ...roll })) },
            walkOut: { sawTeleportRefused: walkOutSaid, sawGateExit: outOfLairSaid, endedOutside: walkOutTile, tripsAtWalkOut },
            starve,
            final: finalSample
        }, null, 2));
    }
    process.exitCode = 1;
} finally {
    // Why: dropping the socket leaves the engine holding the player online for its disconnect grace period, which costs the next run a minute of "already logged in".
    try {
        await stopScript(page);
        await logout(page);
    } catch {
        /* the page may already be gone */
    }
    client.cleanup();
    await browser.close();
}
