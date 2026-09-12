/** Live full-queue soak with only the seven `mustHave` items banked. */
// Why: omitted `acquirable` items expose broken gather, shop, and mining legs.
// Skill level 70 clears every record gate; Magic 59 is the highest.

//   HEADED=1 bun e2e/aio-full-queue-live.ts --minutes 480
//   HEADED=1 bun e2e/aio-full-queue-live.ts --quests cooksassistant,sheepshearer --minutes 30
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';
import { QUESTS } from '../src/bot/api/ai/quests/data/quests.js';

interface Args {
    base: string;
    user: string;
    minutes: number;
    stats: number;
    quests: string[];
    food: string;
    foodQty: number;
    coins: number;
    tickMs: number;
    content: string;
    deploy: boolean;
}

function parseArgs(argv: string[]): Args {
    const out: Args = {
        base: 'http://127.0.0.1:8890',
        user: `fq${Date.now().toString(36).slice(-7)}`,
        minutes: 480,
        stats: 70,
        quests: [],
        food: 'Lobster',
        foodQty: 500,
        coins: 2_000_000,
        tickMs: 300,
        content: process.env.CONTENT_DIR ?? `${homedir()}/code/rs2b2t-content`,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--stats') { out.stats = Number(value); }
        else if (flag === '--quests') { out.quests = value.split(',').map(s => s.trim()).filter(Boolean); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--food-qty') { out.foodQty = Number(value); }
        else if (flag === '--coins') { out.coins = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--content') { out.content = value; }
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'agility', 'thieving', 'herblore', 'crafting', 'mining', 'smithing',
    'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'
];

/** Doses per quest that declares `pray`, with headroom for the ten that do. */
const PRAYER_POTIONS = 40;

/** Worn for the queue's fights; Protect from Melee carries the rest at 70 Prayer. */
const MELEE_KIT = [
    'Rune scimitar', 'Rune chainbody', 'Rune platelegs', 'Rune full helm', 'Rune kiteshield', 'Amulet of strength'
];

/** Provisioned from Varrock west, the engine's `PROVISION_BANK`. */
const PROVISION_BANK = { x: 3093, z: 3243, level: 0 };

function objConfigs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { objConfigs(path, out); }
        else if (path.endsWith('.obj')) { out.push(path); }
    }
    return out;
}

/** Display name (lowercased) to engine debug name, read from the content configs the sim serves. */
function objNames(contentDir: string): Map<string, string> {
    const scripts = join(contentDir, 'scripts');
    let files: string[];
    try {
        files = objConfigs(scripts);
    } catch {
        return fail(`content: ${scripts} not readable, set CONTENT_DIR or --content to the content the sim serves`);
    }
    const byName = new Map<string, string>();
    for (const file of files) {
        let debugName = '';
        for (const raw of readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                debugName = line.slice(1, -1);
                continue;
            }
            if (!line.startsWith('name=') || debugName === '' || debugName.startsWith('cert_')) {
                continue;
            }
            const display = line.slice('name='.length).trim().toLowerCase();
            // Why: `Coins` names both `coins` and the Zombie Queen's `fake_coins`, so the slug of the
            // display name wins over whichever file the walk reached first.
            const canonical = display.replace(/[^a-z0-9]+/g, '_');
            if (!byName.has(display) || debugName === canonical) {
                byName.set(display, debugName);
            }
        }
    }
    return byName;
}

/** Everything the engine cannot obtain for itself, and nothing it can. */
function bankSeed(picked: ReadonlySet<string>): BankSeedItem[] {
    const names = objNames(args.content);
    const resolve = (display: string, qty: number): BankSeedItem => {
        const debugName = names.get(display.toLowerCase());
        if (!debugName) {
            fail(`seed: no obj config names '${display}' under ${args.content}, has it been renamed?`);
        }
        return { debugName, displayName: display, qty };
    };

    // Why: two quests each wanting one Gold bar want two, so the queue's needs sum rather than max.
    const mustHave = new Map<string, number>();
    for (const quest of QUESTS) {
        if (!picked.has(quest.id)) {
            continue;
        }
        for (const item of quest.items) {
            if (item.kind === 'mustHave' && item.name.toLowerCase() !== 'coins') {
                mustHave.set(item.name, (mustHave.get(item.name) ?? 0) + item.qty);
            }
        }
    }

    return [
        resolve('Coins', args.coins),
        resolve(args.food, args.foodQty),
        resolve('Prayer potion(4)', PRAYER_POTIONS),
        ...MELEE_KIT.map(name => resolve(name, 1)),
        // Why: doubled, as a quest that consumes one and then dies to a random event needs the spare.
        ...[...mustHave].sort().map(([name, qty]) => resolve(name, qty * 2))
    ];
}

type LogLine = { time: number; level: string; msg: string };

interface Row { id: string; name: string; status: string; reasons: string[] }

interface Snap {
    runner: string;
    qp: number;
    protectActive: boolean;
    rows: Row[];
    runningId: string | null;
    status: string | null;
    logs: LogLine[];
}

interface Abi {
    rs2b0t: {
        runner: {
            state: string;
            bot: { status?: string; runningId?: string | null; rows?: Row[] } | null;
            ctx?: { log?: LogLine[] } | null;
        };
    };
    __rs2b0t: {
        Quests: { points(): number };
        Prayer: { active(name: string): boolean };
    };
}

async function snapshot(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const bot = g.rs2b0t.runner.bot;
        return {
            runner: g.rs2b0t.runner.state,
            qp: g.__rs2b0t.Quests.points(),
            protectActive: ['Protect from Melee', 'Protect from Magic', 'Protect from Missiles']
                .some(name => g.__rs2b0t.Prayer.active(name)),
            rows: bot?.rows ?? [],
            runningId: bot?.runningId ?? null,
            status: bot?.status ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-200)
        };
    });
}

function fmt(ms: number): string {
    const mins = Math.floor(ms / 60_000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

const ALL_IDS = QUESTS.map(q => q.id);
const unknown = args.quests.filter(id => !ALL_IDS.includes(id));
if (unknown.length > 0) {
    fail(`unknown quest id(s): ${unknown.join(', ')}`);
}
const picked = new Set(args.quests.length > 0 ? args.quests : ALL_IDS);

const SEED = bankSeed(picked);
console.log(`queue: ${picked.size} quest(s); bank seed: ${SEED.length} item type(s)`);
for (const item of SEED) {
    console.log(`  ${item.displayName} (${item.debugName}) x${item.qty}`);
}

const client = args.deploy ? deployIsolatedClient(`fullqueue-${args.user}`) : { page: '/bot.html', cleanup: () => undefined };

const browser = await launchBrowser({ swiftshader: true });
/** Wall-clock spent on each quest, opened when its row first reads RUNNING. */
const startedAt = new Map<string, number>();
const tookMs = new Map<string, number>();
let final: Snap | null = null;

try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, args.base, args.user, client.page);
    console.log(`mainland-ready as '${args.user}'`);
    await cheatQuiet(page, `speed ${args.tickMs}`);

    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${args.stats}`);
    }
    await clearChatDialogs(page, 'post-setstat dialog(s)');
    console.log(`skills → ${args.stats} across ${SKILLS.length} skill(s)`);

    await seedItemsToBank(page, SEED, PROVISION_BANK);

    await page.evaluate(([csv, food]) => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', csv);
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', food);
    }, [args.quests.join(','), args.food] as const);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester, ${picked.size} quest(s), food ${args.food}, budget ${args.minutes}m`);

    // Why: the queue setting is filtered against the engine's implemented modules, and an id that
    // has a record but no module drops out silently, leaving an empty setting, which means "all".
    await page.waitForFunction(
        () => ((globalThis as never as Abi).rs2b0t.runner.bot?.rows ?? []).length > 0,
        undefined,
        { timeout: 60_000 }
    ).catch(() => undefined);
    const opening = await snapshot(page);
    const queued = new Set(opening.rows.map(r => r.id));
    const dropped = [...picked].filter(id => !queued.has(id));
    if (opening.rows.length === 0) {
        fail('the engine reported no queue rows, AIOQuester did not start');
    }
    if (dropped.length > 0) {
        fail(`the engine has no module for: ${dropped.join(', ')}, they have a record but are not implemented`);
    }

    const t0 = Date.now();
    const budgetMs = args.minutes * 60_000;
    let lastLog = 0;
    let sawProtection = false;

    while (Date.now() - t0 < budgetMs) {
        const snap = await snapshot(page);
        final = snap;
        for (const line of snap.logs) {
            if (line.time > lastLog) {
                console.log(`  [${fmt(Date.now() - t0)}] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
        }
        for (const row of snap.rows) {
            if (row.status === 'RUNNING' && !startedAt.has(row.id)) {
                startedAt.set(row.id, Date.now());
            }
            if (row.status === 'DONE' && !tookMs.has(row.id)) {
                tookMs.set(row.id, Date.now() - (startedAt.get(row.id) ?? t0));
            }
        }
        if (snap.protectActive && !sawProtection) {
            sawProtection = true;
            console.log(`  [${fmt(Date.now() - t0)}] a protection prayer is lit`);
        }
        if (snap.runner === 'crashed') {
            fail(`script crashed: ${JSON.stringify(snap.logs.slice(-20))}`);
        }
        if (snap.runner === 'stopped') {
            console.log('runner stopped, queue drained');
            break;
        }
        await page.waitForTimeout(1000);
    }

    const elapsed = Date.now() - t0;
    if (!final) {
        fail('no snapshot was ever taken');
    }

    console.log('');
    console.log(`queue after ${fmt(elapsed)}, QP ${final.qp}`);
    for (const row of final.rows) {
        const took = tookMs.has(row.id) ? fmt(tookMs.get(row.id)!) : '';
        const why = row.reasons.length > 0 ? `, ${row.reasons.join('; ')}` : '';
        console.log(`  ${row.status.padEnd(8)} ${row.name.padEnd(28)} ${took.padStart(7)}${why}`);
    }

    const done = final.rows.filter(r => r.status === 'DONE');
    const stuck = final.rows.filter(r => r.status !== 'DONE');
    console.log('');
    if (stuck.length > 0) {
        fail(`${done.length}/${final.rows.length} done in ${fmt(elapsed)}; ${stuck.length} not done: ${stuck.map(r => `${r.name} (${r.status})`).join(', ')}`);
    }
    console.log(`PASS full queue: ${done.length}/${final.rows.length} done in ${fmt(elapsed)}, QP ${final.qp}, protection ${sawProtection ? 'lit' : 'never needed'}`);
} finally {
    await browser.close();
    client.cleanup();
}
