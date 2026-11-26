/** Live Hazeel Cult harness (#248): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` is the raw `%hazeelcultquest`, pinned to the Carnillean side by `%hazeelcult_side`, and it relogs because the quest list only recolours at login.
 *  Why: the bank holds coins and lobsters alone. The armour is a quest drop and the five sewer valves are world state, so nothing else can be seeded without hiding the leg under test. */

//   HEADED=1 bun e2e/hazeel-cult-248-live.ts --stage 0 --until 9 --minutes 60 --tick 200
//   HEADED=1 bun e2e/hazeel-cult-248-live.ts --stage 4 --until 6 --minutes 30 --tick 200
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
    user: `hc${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 9,
    minutes: 60,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    deploy: true
});

const QUEST = 'Hazeel Cult';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };

/** `%hazeelcultquest`; 5 is the cult side's poison, and 8 is unused. */
const STAGES = [0, 2, 3, 4, 6, 7, 9];

const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

if (!STAGES.includes(args.stage)) {
    fail(`--stage is %hazeelcultquest and must be one of ${STAGES.join(', ')}`);
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
        // Why: `%hazeelcult_side` is what every branch past Clivet reads, and 0 is the Carnillean side the module runs.
        await cheatQuiet(page, `setvar hazeelcultquest ${args.stage}`);
        await cheatQuiet(page, 'setvar hazeelcult_side 0');
        const read = await getServerVarQuiet(page, 'hazeelcultquest');
        const side = await getServerVarQuiet(page, 'hazeelcult_side');
        console.log(`hazeelcultquest=${read} hazeelcult_side=${side}`);
        if (read !== args.stage || side !== 0) {
            fail(`setvar did not take (hazeelcultquest ${read}/${args.stage}, hazeelcult_side ${side}/0)`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, ARDOUGNE_BANK);
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'hazeelcult'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 9 ? 'the journal to go green' : `stage ${args.until}`}`);

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
        const stage = (await getServerVarQuiet(page, 'hazeelcultquest')) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` stage=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %hazeelcultquest.
        const done = args.until >= 9 ? last.status === 'complete' : stage >= args.until;
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
