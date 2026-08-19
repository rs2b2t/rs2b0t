/** Live Observatory Quest harness (#252): --stage N --until N --minutes N --tick ms --stocked, base :8890.
 *  Why: members-only, so the :8888 sim refuses every glass and seaweed gate; `--stage` relogs, since update_questlist only recolours the journal entry at login.
 *  Why: stats are 70 across the board rather than max — the only fight is the level-42 goblin guard on the keep gate — and the bank holds coins and food alone, so the planks, the ore, the seaweed, the sand and the mould are all sourced in the world. */

//   HEADED=1 bun e2e/observatory-252-live.ts --stage 0 --until 7 --minutes 120 --tick 200
//   HEADED=1 bun e2e/observatory-252-live.ts --stage 0 --until 2 --minutes 45 --tick 200
//   HEADED=1 bun e2e/observatory-252-live.ts --stage 4 --until 6 --minutes 30 --tick 200 --stocked
//   HEADED=1 bun e2e/observatory-252-live.ts --stage 6 --until 7 --minutes 20 --tick 200
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
    /** Bank the planks, bar and glass an established account would already own. */
    stocked: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ob${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 7,
        minutes: 120,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        stocked: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--stocked') { out.stocked = true; continue; }
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

const QUEST = 'Observatory Quest';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };

/** Coins and food only by default — every other item has a source in the world, and banking one hides whether the bot can find it. */
function bankSeed(): BankSeedItem[] {
    const seed: BankSeedItem[] = [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: args.food.toLowerCase().replace(/ /g, '_'), displayName: args.food, qty: 40 }
    ];
    // Why: planks, a bronze bar and molten glass are ordinary bank clutter on an established account — the common case a from-scratch run never exercises.
    if (args.stocked) {
        seed.push(
            { debugName: 'woodplank', displayName: 'Plank', qty: 3 },
            { debugName: 'bronze_bar', displayName: 'Bronze bar', qty: 1 },
            { debugName: 'molten_glass', displayName: 'Molten glass', qty: 1 }
        );
    }
    return seed;
}

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

// Why: `setstat` is a built-in cheat branch with no level-up cascade, so it leaves the player undelayed where `~maxme` does not.
async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
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

if (args.stage < 0 || args.stage > 6) {
    fail('--stage is the %itgronigen value and runs 0 to 6');
}

// Why: this run gets its own copy of the client, so a neighbouring harness deploying mid-boot cannot decide which branch this one exercises.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';
// Why: a PASS leaves through `process.exit`, which skips `finally`, so the sweep hangs off the exit itself.
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
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('itgronigen');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no ${QUEST} — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    const seed = bankSeed();
    console.log(`seeding ${seed.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, seed, ARDOUGNE_BANK);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar itgronigen ${args.stage}`);
        const set = await getServerVarQuiet(page, 'itgronigen');
        console.log(`itgronigen=${set}`);
        if (set !== args.stage) {
            fail(`setvar itgronigen ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
            fail(`tele to ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'itgronigen'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for itgronigen >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'itgronigen')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` itgronigen=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green rather than the varp — the recolour and the QP award land a tick behind %itgronigen.
        const done = args.until >= 7 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (itgronigen=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at itgronigen=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`timed out after ${args.minutes}min at itgronigen=${reached}, wanted ${args.until}`);
} finally {
    await browser.close();
}
