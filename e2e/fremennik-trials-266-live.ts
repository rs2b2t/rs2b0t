/** Live Fremennik Trials harness (#266): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` counts trials already won, because a vote without its `%viking_bits` range set sends the bot back through a trial it has already paid for.
 *  Why: stats are 70 across the board, which clears Woodcutting 40, Crafting 40 and Fletching 25 and still fights a level 69 Draugen. */

//   HEADED=1 bun e2e/fremennik-trials-266-live.ts --stage 0 --until 8 --minutes 180 --tick 200
//   HEADED=1 bun e2e/fremennik-trials-266-live.ts --stage 5 --until 8 --minutes 45 --tick 200
//   HEADED=1 bun e2e/fremennik-trials-266-live.ts --stage 1 --until 2 --minutes 60 --tick 200 --shark-shop
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    deploy: boolean;
    sharkShop: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ft${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 8,
        minutes: 180,
        tickMs: 200,
        food: 'Lobster',
        stats: 70,
        deploy: true,
        sharkShop: false
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--shark-shop') { out.sharkShop = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'The Fremennik Trials';
const SEERS_BANK = { x: 2725, z: 3491, level: 0 };
const PRIEST_PERIL_COMPLETE = 60;

/**
 * Coins, food and a melee kit. The axe and the knife have spawns in Rellekka,
 * the tinderbox is Arhein's and the vegetables grow at the town gate, so
 * banking any of them would hide whether the bot can find them.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_med_helm', displayName: 'Rune med helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** The one item with no source this side of Morytania. */
const SHARK_SEED: BankSeedItem = { debugName: 'raw_shark', displayName: 'Raw shark', qty: 1 };

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

// Why: `%viking` is one plus the vote count, and each trial keeps its own bit range in `%viking_bits`.
// Why: seeding the votes alone leaves every range at not-started, and the bot walks back into a trial the journal says it has already won.

/** The module's own trial order, with the bit range and finished value each one writes. */
const TRIALS: readonly { name: string; low: number; high: number; done: number }[] = [
    { name: 'reveller', low: 12, high: 13, done: 2 },
    { name: 'bard', low: 20, high: 22, done: 7 },
    { name: 'hunter', low: 14, high: 15, done: 3 },
    { name: 'navigator', low: 10, high: 11, done: 2 },
    { name: 'merchant', low: 23, high: 26, done: 15 },
    { name: 'seer', low: 18, high: 19, done: 3 },
    { name: 'warrior', low: 16, high: 17, done: 2 }
];

function bitsFor(trials: number): number {
    let bits = 0;
    for (const trial of TRIALS.slice(0, trials)) {
        bits |= trial.done << trial.low;
    }
    return bits;
}

function votesOf(viking: number): number {
    return viking >= 10 ? 7 : Math.max(0, viking - 1);
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

if (args.stage < 0 || args.stage > TRIALS.length) {
    fail(`--stage counts finished trials and runs 0 to ${TRIALS.length}`);
}

// Why: this run gets its own copy of the client, so a neighbouring harness deploying mid-boot cannot decide which branch this one exercises.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';
process.on('exit', () => client?.cleanup());

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user, clientPage);
    console.log(`mainland-ready as '${args.user}'`);

    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('viking');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no ${QUEST} — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    const seed = args.sharkShop ? BANK_SEED : [...BANK_SEED, SHARK_SEED];
    console.log(`seeding ${seed.length} item type(s) into the Seers' Village bank`);
    await seedItemsToBank(page, seed, SEERS_BANK);

    if (args.sharkShop) {
        // Why: Rufus is the only shop in the game that restocks a raw shark, and his door is Morytania's.
        await cheatQuiet(page, `setvar priestperil ${PRIEST_PERIL_COMPLETE}`);
        console.log('no shark banked — Priest in Peril set complete so the Canifis leg can run');
    }

    if (args.stage > 0) {
        const viking = 1 + args.stage;
        const bits = bitsFor(args.stage);
        await cheatQuiet(page, `setvar viking ${viking}`);
        await cheatQuiet(page, `setvar viking_bits ${bits}`);
        const readQuest = await getServerVarQuiet(page, 'viking');
        const readBits = await getServerVarQuiet(page, 'viking_bits');
        console.log(`viking=${readQuest} viking_bits=${readBits} (${args.stage} trial(s) won)`);
        if (readQuest !== viking || readBits !== bits) {
            fail(`setvar did not take (viking ${readQuest}/${viking}, viking_bits ${readBits}/${bits})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, SEERS_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, SEERS_BANK, 10, 25_000))) {
            fail(`tele to ${SEERS_BANK.x},${SEERS_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile → ${SEERS_BANK.x},${SEERS_BANK.z},${SEERS_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'viking'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 8 ? 'the journal to go green' : `${args.until} vote(s)`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const viking = (await getServerVarQuiet(page, 'viking')) ?? 0;
        const votes = votesOf(viking);
        reached = Math.max(reached, votes);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` votes=${votes}/7 journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        const done = args.until >= 8 ? last.status === 'complete' : votes >= args.until;
        if (done) {
            console.log(`PASS (votes=${votes}/7, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped with ${votes}/7 votes (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`votes reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
