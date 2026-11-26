/** Live Digsite harness (#251), using the members world at :8890. */
// Why: stage jumps clear companion varps and relog so the world and journal agree.
// Only coins and food are banked; every quest item must be sourced in-world.

//   HEADED=1 bun e2e/digsite-251-live.ts --stage 0 --until 9 --minutes 150 --tick 150
//   HEADED=1 bun e2e/digsite-251-live.ts --stage 6 --until 9 --minutes 45 --tick 150
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';
import { deployIsolatedClient, fail, launchBrowser, logBotConsole } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

const args = parseQuestArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890',
    user: `ds${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 9,
    minutes: 150,
    tickMs: 150,
    food: 'Lobster',
    stats: 70,
    deploy: true
});

const QUEST = 'Digsite Quest';
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

/** Coins and food only. Every quest item has a source in the world. */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

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
    logBotConsole(page, t0);

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

    await setQuestStats(page, args.stats);
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
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'itexam'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for itexamlevel >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const stage = (await getServerVarQuiet(page, 'itexamlevel')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` itexamlevel=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

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
