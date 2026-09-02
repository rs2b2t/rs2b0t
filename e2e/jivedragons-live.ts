/** Live proof for JiveDragons at the Taverley Dungeon blue dragons: --style --minutes --dusty --tick --no-starve.
 *  Why: supply.ts and combat.ts carry no unit tests because every function in them drives a live client, so this run is the only proof either of them works. */

// Usage: HEADED=1 bun e2e/jivedragons-live.ts [--base url] [--style melee|mage|range] [--minutes n] [--tick ms] [--dusty] [--no-starve]
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

type Style = 'melee' | 'mage' | 'range';
const STYLES: Style[] = ['melee', 'mage', 'range'];

interface Args {
    base: string;
    user: string;
    style: Style;
    minutes: number;
    tickMs: number;
    dusty: boolean;
    starve: boolean;
    deploy: boolean;
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
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-starve') { out.starve = false; continue; }
        if (flag === '--dusty') { out.dusty = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--style') { out.style = value as Style; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
    }
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

const PROOF_PATH = 'out/jivedragons-proof.json';
const SHOT_PATH = 'out/jivedragons-live.png';

interface Kit {
    pack: readonly (readonly [string, string, number])[];
    bank: readonly BankSeedItem[];
    settings: Record<string, string | number | boolean>;
}

const LOOT = ['Dragon bones', 'Dragonhide', 'Uncut diamond', 'Uncut ruby', 'Uncut emerald', 'Uncut sapphire', 'Coins'];

const COMMON_BANK: BankSeedItem[] = [
    { debugName: FOOD.debug, displayName: FOOD.name, qty: 400 },
    { debugName: 'lawrune', displayName: 'Law rune', qty: 200 },
    { debugName: 'airrune', displayName: 'Air rune', qty: 20_000 },
    { debugName: 'waterrune', displayName: 'Water rune', qty: 200 }
];

// Why: the pack starts stocked so the first task is the key leg rather than a restock, which is what makes "one bank stop for a cold key" a number worth counting.
// Why: it starts with no escape runes and the loot list names no rune, so the first exit out of the lair is the gate walk-out assertion 9 is about rather than a teleport paid for with a looted Law rune.
function kitFor(style: Style): Kit {
    const common = { foodWithdraw: PACK_FOOD, panicHp: PANIC_PCT, foodReserve: 4, healTo: 90, site: 'taverley-blue', teleStock: 2, buryBones: false, solveClues: false, bankCommonJunk: false, loot: LOOT.join(', '), logDetail: 'Verbose', usePotions: false };
    if (style === 'melee') {
        return {
            pack: [['rune_scimitar', 'Rune scimitar', 1], ['antidragonbreathshield', 'Dragonfire shield', 1], [FOOD.debug, FOOD.name, PACK_FOOD]],
            bank: [...COMMON_BANK, { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 }, { debugName: 'antidragonbreathshield', displayName: 'Dragonfire shield', qty: 1 }],
            settings: { ...common, combatStyle: 'melee', meleeStyle: 'strength', weapon: 'Rune scimitar', useSpecial: true }
        };
    }
    if (style === 'mage') {
        return {
            pack: [['staff_of_fire', 'Staff of fire', 1], ['airrune', 'Air rune', 600], ['chaosrune', 'Chaos rune', 300], [FOOD.debug, FOOD.name, PACK_FOOD]],
            bank: [...COMMON_BANK, { debugName: 'staff_of_fire', displayName: 'Staff of fire', qty: 1 }, { debugName: 'chaosrune', displayName: 'Chaos rune', qty: 5000 }],
            settings: { ...common, combatStyle: 'mage', staff: 'Staff of fire', spell: 'Fire Bolt', runesWithdraw: 150, runeBuffer: 300 }
        };
    }
    return {
        pack: [['magic_shortbow', 'Magic shortbow', 1], ['rune_arrow', 'Rune arrow', 500], [FOOD.debug, FOOD.name, PACK_FOOD]],
        bank: [...COMMON_BANK, { debugName: 'magic_shortbow', displayName: 'Magic shortbow', qty: 1 }, { debugName: 'rune_arrow', displayName: 'Rune arrow', qty: 5000 }],
        settings: { ...common, combatStyle: 'range', bow: 'Magic shortbow', ammo: 'Rune arrow', rangeStyle: 'rapid', ammoWithdraw: 500 }
    };
}

const kit = kitFor(args.style);
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
        Equipment: { items(): { name: string | null }[] };
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

interface HpDrop { at: number; from: number; to: number; adults: number; tile: Point | null; was: Point | null; bothEnds: boolean; eitherEnd: boolean; harness: boolean }
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
let jailerFights = 0;
let jailKeyPickups = 0;
let deaths = 0;
let bothEndsDrops = 0;
const guardsSafespot = args.style !== 'melee';
let engagingLines = 0;
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
const mark = (id: string, note: string): void => {
    if (met[id]) { return; }
    met[id] = { atMs: Date.now() - t0, note };
    console.log(`${stamp()} PASS(${id}) ${note}`);
};

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
    await clearChatDialogs(page, 'seed dialog(s)');
    if (!(await teleTo(page, BANK, 6, 30_000))) { fail(`could not stand at the Falador bank (${BANK.x},${BANK.z})`); }

    await setSettings(page, 'JiveDragons', kit.settings);
    await startScript(page, 'JiveDragons');
    console.log(`JiveDragons started; watching the key, the gate, ${args.style === 'melee' ? 'the melee anchor' : `the safespot at ${SAFESPOTS[0].x},${SAFESPOTS[0].z}`}, a kill and a bank trip`);

    const probe: Probe = { dustyId: DUSTY_ID, jailKeyId: JAIL_KEY_ID, food: FOOD.name, law: 'Law rune', target: TARGET, baby: BABY };
    const spotAssert = args.style === 'melee' ? 'meleeanchor' : 'safespot';
    const chain: [string, number][] = [['key', KEY_MS], ['gate', GATE_MS], [spotAssert, SPOT_MS], ['kill', KILL_MS], ['banktrip', BANK_MS]];
    const required = ['key', 'gate', spotAssert, 'kill', 'banktrip', 'walkout', args.dusty ? 'bankedkey' : 'coldkey'];
    if (args.style !== 'melee') { required.push('hpheld'); }
    if (args.style === 'melee') { required.push('meleekills'); }
    if (args.starve) { required.push('starvebank'); }

    const deadline = t0 + args.minutes * 60_000;
    let lastState = 0;

    while (Date.now() < deadline) {
        const s = await sample(page, probe);
        finalSample = s;
        const elapsed = Date.now() - t0;

        for (const line of s.logs) {
            const key = `${line.time}|${line.msg}`;
            if (printed.has(key)) { continue; }
            printed.add(key);
            console.log(`${stamp()} [${line.level}] ${line.msg.slice(0, 300)}`);
            if (/^engaging blue dragon /i.test(line.msg)) { engagingLines++; }
            if (/Walking out through the gate instead/i.test(line.msg)) { walkOutSaid = true; }
            if (/^out of the dragon lair/i.test(line.msg)) { outOfLairSaid = true; }
        }

        if (s.runner === 'crashed') { fail(`the runner crashed: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.runner === 'stopped') { fail(`the runner stopped before the run finished: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.parked) { fail(`the bot parked: ${s.parkReason}`); }

        if (s.bankOpen && !(last?.bankOpen ?? false)) { bankOpens++; }
        if (/fighting the Jailer/i.test(s.status) && !/fighting the Jailer/i.test(last?.status ?? '')) { jailerFights++; }
        if (s.jailKey > 0 && (last?.jailKey ?? 0) === 0) { jailKeyPickups++; }
        if (s.died && !(last?.died ?? false)) { deaths++; console.log(`${stamp()} DIED at ${s.tile?.x},${s.tile?.z} with ${s.hp}/${s.maxHp} hp`); }
        if (/waiting for blue dragon \d+ to close/i.test(s.status)) { waitingPolls++; }

        if (last !== null) {
            const step = s.at - last.at;
            if (inLair(s.tile)) { lairMs += step; }
            // Why: a safespot with nothing in the scene to breathe on it proves nothing, so the soak clock only runs with an adult up.
            if (onSafespot(s.tile) && s.adults > 0) { safespotMs += step; }
            if (s.hp < last.hp) {
                const fell = last.hp - s.hp;
                const grace = starve !== null && starve.hitAt !== null && starve.damage !== null
                    && elapsed - starve.hitAt <= HARNESS_HIT_GRACE_MS && fell >= starve.damage;
                const drop: HpDrop = {
                    at: elapsed, from: last.hp, to: s.hp, adults: s.adults, tile: s.tile, was: last.tile,
                    bothEnds: onSafespot(s.tile) && onSafespot(last.tile),
                    eitherEnd: onSafespot(s.tile) || onSafespot(last.tile),
                    harness: grace
                };
                hpDrops.push(drop);
                if (drop.bothEnds) { bothEndsDrops++; }
                // Why: an either-end drop with an adult in the scene is a breath that landed on the tile and was walked off before the next poll, which the both-ends rule alone would file as ordinary movement.
                // Why: melee is exempt because its anchor borders safespot 1, so a hit taken in transit would fail a run for a tile melee never stands on by design.
                if (guardsSafespot && !drop.harness && (drop.bothEnds || (drop.eitherEnd && s.adults > 0))) {
                    violations.push(drop);
                    console.log(`${stamp()} HP FELL ON A SAFESPOT: ${last.hp} to ${s.hp} at ${last.tile?.x},${last.tile?.z} then ${s.tile?.x},${s.tile?.z} with ${s.adults} adult(s) up (${drop.bothEnds ? 'both ends' : 'one end'})`);
                }
                if (drop.harness) { console.log(`${stamp()} the ${fell} hp drop at ${s.tile?.x},${s.tile?.z} is the harness's own ~hit, not a breath`); }
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
        if (s.dusty > 0 && !met['key']) {
            const cost = `${jailerFights} Jailer fight(s), ${jailKeyPickups} Jail key pickup(s), ${bankOpens} bank stop(s)`;
            mark('key', `holding the Dusty key after ${cost}, keyState=${s.keyState}`);
            if (args.dusty && jailerFights === 0 && jailKeyPickups === 0) { mark('bankedkey', 'the banked key cost no Jailer kill'); }
            if (args.dusty && (jailerFights > 0 || jailKeyPickups > 0)) { fail(`a banked Dusty key still cost ${cost}`); }
            if (!args.dusty && jailerFights === 1 && jailKeyPickups === 1 && bankOpens === 1) {
                mark('coldkey', 'the cold key cost one Jailer fight and one bank stop');
            }
            if (!args.dusty && (jailerFights !== 1 || jailKeyPickups !== 1 || bankOpens !== 1)) {
                fail(`a cold key cost ${cost}, expected one of each`);
            }
        }
        if (inLair(s.tile)) { mark('gate', `inside the lair at ${s.tile?.x},${s.tile?.z}`); }
        if (samePoint(s.tile, SAFESPOTS[0])) { mark('safespot', `standing exactly on safespot 0 at ${SAFESPOTS[0].x},${SAFESPOTS[0].z}`); }
        if (samePoint(s.tile, MELEE_ANCHOR)) { mark('meleeanchor', `standing exactly on the melee anchor at ${MELEE_ANCHOR.x},${MELEE_ANCHOR.z}`); }
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
                console.log(`${stamp()} STARVE: emptying the pack (food ${s.food}, Law rune ${s.law}) at ${s.tile?.x},${s.tile?.z}`);
                await command(page, '~clearinv inv', 0);
                await command(page, 'give dusty_key 1', 0);
                const want = Math.round(s.maxHp * 0.55);
                const damage = s.hp - want;
                if (clean && damage >= LOBSTER_HEAL + 1 && want > Math.ceil((s.maxHp * PANIC_PCT) / 100)) {
                    await command(page, `~hit ${damage}`, 0);
                    starve.damage = damage;
                    starve.hitAt = Date.now() - t0;
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
    console.log(`HP: ${hpDrops.length} drop(s), ${bothEndsDrops} with a safespot at both ends, ${violations.length} counted as violations, ${Math.round(safespotMs / 1000)}s on a safespot with an adult up of ${Math.round(lairMs / 1000)}s in the lair`);
    if (violations.length > 0) { fail(`hp fell ${violations.length} time(s) while standing on a safespot: ${JSON.stringify(violations)}`); }
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
        counters: { kills: final.kills, bankTrips: final.trips, bankOpens, jailerFights, jailKeyPickups, deaths, engagingLines, waitingPolls, looted: final.looted },
        safespot: { spots: SAFESPOTS, heldMs: safespotMs, lairMs, drops: hpDrops.length, bothEndsDrops, violations: violations.length, hpDrops: hpDrops.slice(-300), violationDrops: violations },
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
            counters: { bankOpens, jailerFights, jailKeyPickups, deaths, engagingLines, waitingPolls },
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
