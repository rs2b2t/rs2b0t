//   HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 12 --minutes 45 --tick 200
//   HEADED=1 bun e2e/sea-slug-259-live.ts --stage 6 --until 7 --minutes 20 --tick 200
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
    user: `ss${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 12,
    minutes: 45,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    deploy: true
});

const QUEST = 'Sea Slug Quest';
const VARP = 'seaslugquest';
const COMPLETE = 12;
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };

const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

if (args.stage < 0 || args.stage > 11) {
    fail('--stage writes %seaslugquest and runs 0 to 11');
}
if (args.until <= args.stage || args.until > COMPLETE) {
    fail(`--until must be above --stage and at most ${COMPLETE}`);
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
        await cheatQuiet(page, `setvar ${VARP} ${args.stage}`);
        const read = await getServerVarQuiet(page, VARP);
        if (read !== args.stage) {
            fail(`setvar did not take (${VARP} ${read}/${args.stage})`);
        }
        if (args.stage >= 7 && args.stage <= 10) {
            await cheatQuiet(page, 'give torch_unlit 1');
            console.log('seeded an unlit Torch — the deck chain relights it');
        }
        console.log(`${VARP}=${read}`);
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, ARDOUGNE_BANK);
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'seaslug'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= COMPLETE ? 'the journal to go green' : `stage ${args.until}`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, VARP)) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` stage=${stage}/${COMPLETE} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        const done = args.until >= COMPLETE ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (stage=${stage}/${COMPLETE}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
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
