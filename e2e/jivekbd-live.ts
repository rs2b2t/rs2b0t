/** Live proof for JiveKBD at the King Black Dragon lair: --minutes --kill-min --tick --spell --walkout --no-starve.
 *  Why: entry.ts, combat.ts and supply.ts carry no unit tests because every function in them drives a live client, so this run is the only proof the ladder, the lever, the alcove and the teleport home hold together. */

// Usage: HEADED=1 bun e2e/jivekbd-live.ts [--base url] [--minutes n] [--kill-min n] [--tick ms] [--spell name] [--walkout] [--no-starve]
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    killMin: number;
    tickMs: number;
    spell: string;
    walkout: boolean;
    starve: boolean;
    deploy: boolean;
}

function fail(msg: string): never {
    throw new Error(`FAIL: ${msg}`);
}

function parse(argv: readonly string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `jk${Date.now().toString(36).slice(-6)}`,
        minutes: 45,
        killMin: 12,
        tickMs: 0,
        spell: 'Fire Blast',
        walkout: false,
        starve: true,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-starve') { out.starve = false; continue; }
        if (flag === '--walkout') { out.walkout = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--kill-min') { out.killMin = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--spell') { out.spell = value; }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));

interface Point { x: number; z: number; level: number }
interface Box { minX: number; maxX: number; minZ: number; maxZ: number; level: number }

// Why: sites.ts is not on the harness ABI, so the two boxes and the alcove tiles are mirrored here and a drift in either copy shows up as a failed milestone rather than a silent pass.
const LAIR: Box = { minX: 2688, maxX: 2751, minZ: 9792, maxZ: 9855, level: 0 };
const DUNGEON: Box = { minX: 3008, maxX: 3071, minZ: 10240, maxZ: 10303, level: 0 };
const SAFESPOTS: Point[] = [{ x: 2717, z: 9801, level: 0 }, { x: 2716, z: 9801, level: 0 }];
const BANK: Point = { x: 3094, z: 3493, level: 0 };

const TARGET = 'King black dragon';
const STAFF = 'Staff of fire';
const SHIELD = 'Dragonfire shield';
const FOOD = { debug: 'lobster', name: 'Lobster' };
const LOBSTER_HEAL = 12;
const PACK_FOOD = 20;
const PANIC_PCT = 30;
const DOSE_FORMS = ['Superantipoison(4)', 'Superantipoison(3)', 'Superantipoison(2)', 'Superantipoison(1)'];
/** The far fire through the shield. Anything above it on the alcove is a melee hit or a special breath, which the tile is meant to rule out. */
const FIRE_CAP = 15;

const LEVELS: [string, number][] = [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 99], ['magic', 80]];

const POLL_MS = 750;
const DOSE_MS = 1_200_000;
const DUNGEON_MS = 180_000;
const LAIR_MS = 240_000;
const SPOT_MS = 120_000;
/** The dragon's magic-based defence roll is 35856 against a magic-80 fire staff's 6586, so a kill is a few hundred casts. */
const KILL_MS = args.killMin * 60_000;
const LOOT_MS = 180_000;
const BANK_MS = 900_000;
const SOAK_MS = 120_000;
const STARVE_WAIT_MS = 180_000;
const STARVE_BANK_MS = 900_000;
/** How long after the harness sends its own ~hit a drop of that size is the harness rather than the dragon. */
const HARNESS_HIT_GRACE_MS = 2500;

const DOSE_LINE = /^drank a Superantipoison before the lever spiders/i;
const CURED_LINE = /^poisoned\. Drank a Superantipoison/i;
const UNCURED_LINE = /^WARNING: poisoned with no Superantipoison/i;
const TELEPORT_LINE = /^teleported out to Varrock teleport/i;
const WALKOUT_LINE = /^out of the Lava Maze dungeon on foot/i;
const POISON_CHAT = /you have been poisoned/i;

const PROOF_PATH = 'out/jivekbd-proof.json';
const SHOT_PATH = 'out/jivekbd-live.png';

const LOOT = ['Dragon bones', 'Dragonhide', 'Coins', 'Rune longsword', 'Adamant platebody', 'Dragon med helm', 'Adamant axe', 'Rune axe', 'Mithril battleaxe', 'Amulet of strength', 'Bronze arrow', 'Iron arrow', 'Air rune', 'Fire rune', 'Blood rune', 'Law rune', 'Death rune', 'Adamantite bar', 'Runite bar', 'Coal', 'Iron ore', 'Yew logs', 'Shark', 'Lobster', 'Oyster pearls', 'Uncut diamond', 'Uncut ruby', 'Uncut emerald', 'Uncut sapphire'];

// Why: the staff supplies the fire runes for the spell, but the Varrock teleport's fire rune is counted in the pack, so a few ride along.
// Why: --walkout seeds no law runes anywhere, so the first exit is the lever-and-ladder walk rather than the teleport.
const PACK: readonly (readonly [string, string, number])[] = [
    ['staff_of_fire', STAFF, 1], ['antidragonbreathshield', SHIELD, 1],
    ['airrune', 'Air rune', 1200], ['deathrune', 'Death rune', 300], ['chaosrune', 'Chaos rune', 300], ['firerune', 'Fire rune', 20],
    ['4dose2antipoison', 'Superantipoison(4)', 1], [FOOD.debug, FOOD.name, PACK_FOOD],
    ...(args.walkout ? [] : [['lawrune', 'Law rune', 6] as const])
];

const BANK_SEED: BankSeedItem[] = [
    { debugName: FOOD.debug, displayName: FOOD.name, qty: 400 },
    { debugName: 'airrune', displayName: 'Air rune', qty: 20_000 },
    { debugName: 'deathrune', displayName: 'Death rune', qty: 5000 },
    { debugName: 'chaosrune', displayName: 'Chaos rune', qty: 5000 },
    { debugName: 'firerune', displayName: 'Fire rune', qty: 500 },
    { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 20 },
    { debugName: 'staff_of_fire', displayName: STAFF, qty: 1 },
    { debugName: 'antidragonbreathshield', displayName: SHIELD, qty: 1 },
    ...(args.walkout ? [] : [{ debugName: 'lawrune', displayName: 'Law rune', qty: 200 }])
];

const SETTINGS: Record<string, string | number | boolean> = {
    staff: STAFF, spell: args.spell, runesWithdraw: 150, runeBuffer: 300,
    foodWithdraw: PACK_FOOD, dosesWithdraw: 1, panicHp: PANIC_PCT, foodReserve: 4, healTo: 90,
    site: 'kbd-lair', teleStock: 2, bankCommonJunk: false, loot: LOOT.join(', '), logDetail: 'Verbose'
};

function inBox(t: Point | null, b: Box): boolean {
    return t !== null && t.level === b.level && t.x >= b.minX && t.x <= b.maxX && t.z >= b.minZ && t.z <= b.maxZ;
}

function samePoint(a: Point | null, b: Point): boolean {
    return a !== null && a.x === b.x && a.z === b.z && a.level === b.level;
}

function onSafespot(t: Point | null): boolean {
    return SAFESPOTS.some(spot => samePoint(t, spot));
}

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
    dosesDrunk: number;
    spotIdx: number;
    bankOpen: boolean;
    food: number;
    law: number;
    doses: number;
    worn: string[];
    dragons: number;
    dragonDist: number;
    dragonHealth: number;
    dragonTotal: number;
    magicXp: number;
    players: number;
    poisonChat: number;
    logs: LogLine[];
}

interface Probe { food: string; law: string; doses: string[]; target: string; poison: string }

interface Api {
    __rs2b0t: {
        Bank: { isOpen(): boolean };
        Equipment: { items(): { name: string | null }[] };
        Game: { tile(): Point | null };
        Inventory: { count(name: string): number };
        Npcs: { all(): { name: string | null; index: number; distance(): number; health: number; totalHealth: number }[] };
        Players: { query(): { results(): { distance(): number }[] } };
        Skills: { effective(name: string): number; level(name: string): number; xp(name: string): number };
        reader: { chat(n: number): { text: string }[] };
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
        const dragons = npcs.filter(n => n.name === p.target);
        const poison = new RegExp(p.poison, 'i');
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
            dosesDrunk: num('dosesDrunk'),
            spotIdx: num('safespotIdx'),
            bankOpen: a.Bank.isOpen(),
            food: a.Inventory.count(p.food),
            law: a.Inventory.count(p.law),
            doses: p.doses.reduce((n, name) => n + a.Inventory.count(name), 0),
            worn: a.Equipment.items().map(i => i.name ?? '?'),
            dragons: dragons.length,
            dragonDist: dragons.length === 0 ? -1 : Math.min(...dragons.map(d => d.distance())),
            dragonHealth: dragons[0]?.health ?? -1,
            dragonTotal: dragons[0]?.totalHealth ?? -1,
            magicXp: a.Skills.xp('magic'),
            players: a.Players.query().results().filter(pl => pl.distance() > 0 && pl.distance() <= 15).length,
            poisonChat: a.reader.chat(40).filter(l => poison.test(l.text)).length,
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
    for (const [debug, display, qty] of PACK) {
        let held = 0;
        for (let attempt = 0; attempt < 5 && held < qty; attempt++) {
            await command(page, `give ${debug} ${qty}`);
            held = await heldCount(page, display);
        }
        if (held < qty) { fail(`could not seed ${qty} ${display} into the pack, got ${held}`); }
    }
    console.log(`pack seeded: ${PACK.map(([, display, qty]) => `${qty}x ${display}`).join(', ')}`);
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

const tag = `jk${Date.now().toString(36).slice(-6)}`;
const client = args.deploy ? deployIsolatedClient(tag) : { page: '/bot.html', cleanup: (): void => {} };
const bundleUrl = `${args.base}${args.deploy ? `/bot/${tag}/botclient.js` : '/bot/botclient.js'}`;

interface HpDrop { at: number; from: number; to: number; dragons: number; dragonDist: number; tile: Point | null; was: Point | null; bothEnds: boolean; harness: boolean; explained: number; unexplained: number }
interface StarveRecord { at: number; hitAt: number | null; hp: number; maxHp: number; food: number; law: number; damage: number | null; hitTile: Point | null; tripsBefore: number }

await mkdir('out', { recursive: true });
const bundleSha256 = await attestBundle(bundleUrl).catch((error: unknown) => { client.cleanup(); throw error; });

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const pageErrors: string[] = [];
const met: Record<string, { atMs: number; note: string }> = {};
const hpDrops: HpDrop[] = [];
const breaths: HpDrop[] = [];
const violations: HpDrop[] = [];
const printed = new Set<string>();

let last: Sample | null = null;
let finalSample: Sample | null = null;
let deaths = 0;
let harnessCredit = 0;
let engagingLines = 0;
let doseLines = 0;
let curedLines = 0;
let uncuredLines = 0;
let poisonChatSeen = 0;
let teleportSaid = false;
let walkoutSaid = false;
let playerPolls = 0;
let maxPlayers = 0;
let safespotMs = 0;
let lairMs = 0;
let tripsAtKill = -1;
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
    console.log(`mainland-ready as '${args.user}' for a ${args.minutes} minute run with ${args.spell}, ${args.killMin} minutes for the first kill${args.walkout ? ', no law runes so the first exit is the walk-out' : ''}`);

    if (args.tickMs > 0) {
        await command(page, `speed ${args.tickMs}`);
        console.log(`world tick: ${args.tickMs}ms`);
    }

    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');
    await seedItemsToBank(page, BANK_SEED, BANK);
    await seedPack(page);
    await setLevels(page);
    await clearChatDialogs(page, 'seed dialog(s)');
    if (!(await teleTo(page, BANK, 6, 30_000))) { fail(`could not stand at the Edgeville bank (${BANK.x},${BANK.z})`); }

    await setSettings(page, 'JiveKBD', SETTINGS);
    await startScript(page, 'JiveKBD');
    console.log(`JiveKBD started; watching the dose, the ladder, the lever, the alcove at ${SAFESPOTS[0].x},${SAFESPOTS[0].z}, a kill, a pickup and the trip home`);

    const probe: Probe = { food: FOOD.name, law: 'Law rune', doses: DOSE_FORMS, target: TARGET, poison: POISON_CHAT.source };
    const chain: [string, number][] = [['dose', DOSE_MS], ['dungeon', DUNGEON_MS], ['lair', LAIR_MS], ['safespot', SPOT_MS], ['kill', KILL_MS], ['loot', LOOT_MS], ['banktrip', BANK_MS]];
    const required = ['dose', 'dungeon', 'lair', 'safespot', 'wielded', 'kill', 'loot', 'banktrip', args.walkout ? 'walkout' : 'teleport', 'fireheld', 'poisonfree'];
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
            if (/^engaging king black dragon /i.test(line.msg)) { engagingLines++; }
            if (DOSE_LINE.test(line.msg)) { doseLines++; }
            if (CURED_LINE.test(line.msg)) { curedLines++; }
            if (UNCURED_LINE.test(line.msg)) { uncuredLines++; }
            if (TELEPORT_LINE.test(line.msg)) { teleportSaid = true; }
            if (WALKOUT_LINE.test(line.msg)) { walkoutSaid = true; }
        }

        if (s.runner === 'crashed') { fail(`the runner crashed: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.runner === 'stopped') { fail(`the runner stopped before the run finished: ${s.logs.slice(-8).map(l => l.msg).join(' | ')}`); }
        if (s.parked) { fail(`the bot parked: ${s.parkReason}`); }
        if (s.died && !(last?.died ?? false)) { deaths++; fail(`the bot died at ${s.tile?.x},${s.tile?.z}, on ${last?.hp ?? s.hp}/${s.maxHp} hp the poll before`); }
        if (s.players > 0) { playerPolls++; maxPlayers = Math.max(maxPlayers, s.players); }
        if (s.poisonChat > (last?.poisonChat ?? 0)) { poisonChatSeen += s.poisonChat - (last?.poisonChat ?? 0); console.log(`${stamp()} CHAT: the poison line printed (${poisonChatSeen} so far) at ${s.tile?.x},${s.tile?.z}`); }

        if (last !== null) {
            const step = s.at - last.at;
            if (inBox(s.tile, LAIR)) { lairMs += step; }
            // Why: an alcove with no dragon up proves nothing, and a sample that moved was only partly on the tile, so the soak clock runs on the stretches that held one alcove tile with the dragon up.
            const parked = last.tile !== null && onSafespot(s.tile) && samePoint(s.tile, last.tile);
            if (parked && s.dragons > 0) { safespotMs += step; }
            if (s.hp < last.hp) {
                const fell = last.hp - s.hp;
                const inGrace = starve !== null && starve.hitAt !== null && elapsed - starve.hitAt <= HARNESS_HIT_GRACE_MS;
                const explained = inGrace ? Math.min(fell, harnessCredit) : 0;
                harnessCredit -= explained;
                const drop: HpDrop = {
                    at: elapsed, from: last.hp, to: s.hp, dragons: s.dragons, dragonDist: s.dragonDist, tile: s.tile, was: last.tile,
                    bothEnds: onSafespot(s.tile) && onSafespot(last.tile),
                    harness: explained > 0, explained, unexplained: fell - explained
                };
                hpDrops.push(drop);
                // Why: the far fire is the one hit the alcove is expected to take and the shield caps it at 15, so a drop under the cap with the alcove at both ends is a breath and anything above it is the tile failing.
                if (drop.unexplained > 0 && drop.bothEnds) {
                    if (drop.unexplained <= FIRE_CAP) {
                        breaths.push(drop);
                    } else {
                        violations.push(drop);
                        console.log(`${stamp()} HP FELL PAST THE FIRE CAP ON THE ALCOVE: ${last.hp} to ${s.hp} at ${last.tile?.x},${last.tile?.z} with the dragon ${s.dragonDist} away (${drop.unexplained} hp)`);
                    }
                }
                if (drop.harness) { console.log(`${stamp()} the harness's own ~hit accounts for ${explained} of the ${fell} hp drop at ${s.tile?.x},${s.tile?.z}, leaving ${drop.unexplained}`); }
            }
        }

        if (doseLines > 0 && !inBox(s.tile, DUNGEON) && !inBox(s.tile, LAIR)) { mark('dose', `drank the Superantipoison on the surface, ${s.doses} dose(s) left`); }
        if (inBox(s.tile, DUNGEON)) {
            if (!met['dose']) { fail(`reached the dungeon at ${s.tile?.x},${s.tile?.z} without the surface dose`); }
            mark('dungeon', `down the ladder at ${s.tile?.x},${s.tile?.z}`);
        }
        if (inBox(s.tile, LAIR)) { mark('lair', `inside the lair at ${s.tile?.x},${s.tile?.z}`); }
        if (onSafespot(s.tile)) { mark('safespot', `standing in the alcove at ${s.tile?.x},${s.tile?.z}`); }
        if (s.worn.includes(STAFF) && s.worn.includes(SHIELD)) { mark('wielded', `${STAFF} and ${SHIELD} are worn`); }
        if (s.kills > 0 && met['wielded'] === undefined) { fail(`a kill landed without both the ${STAFF} and the ${SHIELD} worn, only ${s.worn.filter(w => w !== '?').join('/') || 'nothing'}`); }
        if (s.looted > 0) { mark('loot', `${s.looted} pickup(s) reached the pack after ${s.kills} kill(s)`); }
        if (s.kills > 0) {
            if (tripsAtKill < 0) { tripsAtKill = s.trips; }
            mark('kill', `${s.kills} King black dragon(s) down after ${engagingLines} engage line(s), ${breaths.length} breath(s) taken on the alcove`);
        }
        if (tripsAtKill >= 0 && s.trips > tripsAtKill) { mark('banktrip', `bank trip ${s.trips} finished after the first kill`); }
        if (teleportSaid) { mark('teleport', 'the Varrock teleport fired from inside the lair'); }
        if (walkoutSaid) { mark('walkout', 'the exit lever and the ladder took the run out on foot'); }
        if (violations.length === 0 && safespotMs >= SOAK_MS) {
            mark('fireheld', `${breaths.length} breath(s) of ${FIRE_CAP} or less and nothing past the cap across ${Math.round(safespotMs / 1000)}s in the alcove with the dragon up`);
        }
        if (uncuredLines > 0) { fail(`poisoned with no dose to answer it: ${uncuredLines} uncured line(s)`); }

        if (args.starve && starve === null && met['kill'] && lairMs >= SOAK_MS) {
            if (starveDue === 0) { starveDue = Date.now(); }
            const clean = !onSafespot(s.tile) && !onSafespot(last?.tile ?? null);
            if (inBox(s.tile, LAIR) && !s.bankOpen && (clean || Date.now() - starveDue > STARVE_WAIT_MS)) {
                starve = { at: elapsed, hitAt: null, hp: s.hp, maxHp: s.maxHp, food: s.food, law: s.law, damage: null, hitTile: s.tile, tripsBefore: s.trips };
                console.log(`${stamp()} STARVE: emptying the pack (food ${s.food}, Law rune ${s.law}) at ${s.tile?.x},${s.tile?.z}`);
                await command(page, '~clearinv inv', 0);
                // Why: the emptied pack is meant to prove the trip home, so the one Varrock cast goes back in; --walkout keeps it out and the fallback carries the run.
                if (!args.walkout) {
                    await command(page, 'give lawrune 1', 0);
                    await command(page, 'give airrune 3', 0);
                    await command(page, 'give firerune 1', 0);
                }
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
            console.log(`${stamp()} STATE ${JSON.stringify({ tile: s.tile, hp: `${s.hp}/${s.maxHp}`, status: s.status, kills: s.kills, trips: s.trips, food: s.food, law: s.law, doses: s.doses, spot: s.spotIdx, breaths: breaths.length, dragon: s.dragons > 0 ? `${s.dragonDist} (${s.dragonHealth}/${s.dragonTotal})` : 'none', magicXp: s.magicXp, players: s.players, worn: s.worn.filter(w => w !== '?').join('/') })}`);
        }

        const pending = required.filter(id => id !== 'poisonfree' && met[id] === undefined);
        if (pending.length === 0) {
            mark('poisonfree', `${poisonChatSeen} poison line(s) in the chat, ${curedLines} answered with a dose, ${doseLines} surface dose(s), none uncured`);
            break;
        }
        last = s;
        await page.waitForTimeout(POLL_MS);
    }

    const final = finalSample ?? (await sample(page, probe));
    const missing = required.filter(id => met[id] === undefined);
    console.log(`HP: ${hpDrops.length} drop(s), ${breaths.length} breath(s) on the alcove within the ${FIRE_CAP} cap, ${violations.length} past it, ${Math.round(safespotMs / 1000)}s parked in the alcove with the dragon up of ${Math.round(lairMs / 1000)}s in the lair`);
    console.log(`POISON: ${poisonChatSeen} chat line(s), ${doseLines} surface dose(s), ${curedLines} cure(s), ${uncuredLines} uncured; players within 15 tiles on ${playerPolls} poll(s), at most ${maxPlayers}`);
    console.log(`LOOT: ${final.looted} pickup(s) over ${final.kills} kill(s)`);
    if (violations.length > 0) { fail(`hp fell past the fire cap ${violations.length} time(s) in the alcove: ${JSON.stringify(violations)}`); }
    if (missing.length > 0) { fail(`the budget ran out with these unproven: ${missing.join(', ')} (status '${final.status}' at ${final.tile?.x},${final.tile?.z})`); }
    if (pageErrors.length > 0) { fail(`${pageErrors.length} browser page error(s): ${pageErrors.join('\n')}`); }

    const proof = {
        generatedAt: new Date().toISOString(),
        result: 'PASS',
        base: args.base,
        username: args.user,
        spell: args.spell,
        walkout: args.walkout,
        tickMs: args.tickMs,
        minutes: args.minutes,
        bundleSha256,
        elapsedMs: Date.now() - t0,
        fixture: { levels: LEVELS, pack: PACK, bank: BANK_SEED, settings: SETTINGS, start: BANK, lair: LAIR, dungeon: DUNGEON },
        assertions: met,
        required,
        counters: { kills: final.kills, bankTrips: final.trips, deaths, engagingLines, looted: final.looted, doseLines, curedLines, uncuredLines, poisonChatSeen, playerPolls, maxPlayers },
        safespot: { spots: SAFESPOTS, fireCap: FIRE_CAP, heldMs: safespotMs, lairMs, drops: hpDrops.length, breaths: breaths.length, violations: violations.length, hpDrops: hpDrops.slice(-300), breathDrops: breaths.slice(-100), violationDrops: violations },
        exit: { teleportSaid, walkoutSaid },
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
            spell: args.spell,
            walkout: args.walkout,
            error: String(error),
            elapsedMs: Date.now() - t0,
            assertions: met,
            counters: { deaths, engagingLines, doseLines, curedLines, uncuredLines, poisonChatSeen, playerPolls, maxPlayers },
            safespot: { heldMs: safespotMs, lairMs, drops: hpDrops.length, breaths: breaths.length, violations: violations.length, hpDrops: hpDrops.slice(-300), violationDrops: violations },
            exit: { teleportSaid, walkoutSaid },
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
