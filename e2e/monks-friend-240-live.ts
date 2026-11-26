/** Live Monk's Friend harness (#240): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` is the raw `%drunkmonkquest` value and relogs after seeding it, because `update_questlist` only recolours the list at login, and the same login script re-arms the `blanket_ladder` timer, which is what puts the hidden ladder back inside the ring of stones.
 *  Why: stats are 70 and the bank holds coins and food alone, so the jug, the sink, the axe and the logs are all sourced in the world. */

//   HEADED=1 bun e2e/monks-friend-240-live.ts --stage 0 --until 80 --minutes 45 --tick 200
//   HEADED=1 bun e2e/monks-friend-240-live.ts --stage 40 --until 70 --minutes 20 --tick 200
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';
import { deploySharedBundles, fail, launchBrowser, logBotConsole } from './lib/harness.js';
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
    user: `mf${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 80,
    minutes: 45,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    deploy: true
});

const QUEST = "Monk's Friend";
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
/** `%drunkmonkquest` values from quest_drunkmonk.constant, plus complete. */
const STAGES = [0, 10, 20, 30, 40, 50, 60, 70, 80];

/**
 * Coins and food only. The jug comes from Port Khazard's general store, the water
 * from the guardhouse sink, the axe from Aemad's and the logs from a forest tree,
 * banking any of them would hide whether the bot can find its own.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

if (!STAGES.includes(args.stage) || args.stage === 80) {
    fail(`--stage is a %drunkmonkquest value: ${STAGES.filter(s => s !== 80).join(', ')}`);
}
if (!STAGES.includes(args.until) || args.until <= args.stage) {
    fail(`--until is a %drunkmonkquest value above --stage: ${STAGES.join(', ')}`);
}

if (args.deploy) {
    deploySharedBundles(args.base);
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    logBotConsole(page, t0);

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setQuestStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar drunkmonkquest ${args.stage}`);
        const read = await getServerVarQuiet(page, 'drunkmonkquest');
        if (read !== args.stage) {
            fail(`setvar did not take (drunkmonkquest ${read}/${args.stage})`);
        }
        console.log(`drunkmonkquest=${read}`);
        // Why: the login script recolours the quest list AND re-arms `blanket_ladder`, so a seeded stage 10 has no hidden ladder until the relog.
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
        await cheatQuiet(page, `speed ${args.tickMs}`);
    }

    await teleportToQuestStart(page, ARDOUGNE_BANK);
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    // The setting is the record id; an unknown entry is filtered out and the queue silently becomes every quest.
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'drunkmonk'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 80 ? 'the journal to go green' : `stage ${args.until}`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        // Why: reject a shared bundle replaced by another session during boot.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'drunkmonkquest')) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` stage=${stage}/${args.until} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %drunkmonkquest.
        const done = args.until >= 80 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (stage=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at stage ${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`stage reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
