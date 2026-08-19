/** Live Digsite harness (#251): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` writes `%itexamlevel` and relogs, since update_questlist only recolours the journal entry at login; the errand and bit varps are cleared with it so a jumped stage matches what an uncheated run would have reached.
 *  Why: the bank holds coins and food alone — the trowel, the jar, the brush, the ropes, the tray, the opal, the charcoal and every chemical have a source in the world, and banking one would hide whether the bot can find it. */

//   HEADED=1 bun e2e/digsite-251-live.ts --stage 0 --until 9 --minutes 150 --tick 150
//   HEADED=1 bun e2e/digsite-251-live.ts --stage 6 --until 9 --minutes 45 --tick 150
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
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ds${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 9,
        minutes: 150,
        tickMs: 150,
        food: 'Lobster',
        stats: 70,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
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

const QUEST = 'Digsite Quest';
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

/** Coins and food only. Every quest item has a source in the world. */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

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

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: VARROCK_EAST_BANK,
    1: VARROCK_EAST_BANK,
    2: { x: 3358, z: 3410, level: 0 },   // the student camp
    3: { x: 3358, z: 3410, level: 0 },
    4: { x: 3358, z: 3410, level: 0 },
    5: { x: 3353, z: 3408, level: 0 },   // the level 3 dig site
    6: { x: 3357, z: 3407, level: 0 },   // the workmen, for the ropes
    7: { x: 3352, z: 3418, level: 0 },   // the main winch
    8: { x: 3352, z: 3418, level: 0 }
};

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

if (args.stage < 0 || args.stage > 8) {
    fail('--stage is %itexamlevel and runs 0 to 8');
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

    // Why: this should not fire now that the client is per-run, so if it ever does the isolation broke rather than a neighbour winning a race.
    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('itexam');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no Digsite Quest — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Varrock East bank`);
    await seedItemsToBank(page, BANK_SEED, VARROCK_EAST_BANK);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar itexamlevel ${args.stage}`);
        // Why: the errand and bit varps are per-exam and per-action, so a jumped stage that kept them would skip work an honest run does.
        await cheatQuiet(page, 'setvar itexam_errands 0');
        await cheatQuiet(page, 'setvar itexam_bits 0');
        const set = await getServerVarQuiet(page, 'itexamlevel');
        console.log(`itexamlevel=${set}`);
        if (set !== args.stage) {
            fail(`setvar itexamlevel ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = STAGE_START[args.stage] ?? VARROCK_EAST_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'itexam'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for itexamlevel >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'itexamlevel')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` itexamlevel=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the recolour and the QP award land a tick behind %itexamlevel.
        const done = args.until >= 9 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (itexamlevel=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at itexamlevel=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`timed out after ${args.minutes}min at itexamlevel=${reached}`);
} finally {
    await browser.close();
}
