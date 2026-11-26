/** Live Plague City harness (#243): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` relogs since update_questlist only recolours the journal at login; the bank holds coins and food alone so the spade, buckets, berries, rope, picture and cure ingredients are sourced in the world; the quest is members-only. */

//   HEADED=1 bun e2e/plague-city-243-live.ts --stage 0 --until 29 --minutes 120
//   HEADED=1 bun e2e/plague-city-243-live.ts --stage 10 --until 23 --minutes 40
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, teleportToQuestStart } from './lib/questHarness.js';
import { deploySharedBundles, fail, launchBrowser, logBotConsole } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
    relog,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

const args = parseQuestArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890',
    user: `pc${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 29,
    minutes: 120,
    tickMs: 300,
    food: 'Lobster',
    deploy: true
});

const QUEST = 'Plague City';
const ARDOUGNE_BANK = { x: 2616, z: 3332, level: 0 };
const GARDEN = { x: 2566, z: 3330, level: 0 };

/**
 * Coins and food only. Every other item has a source in the world or a shop,
 * and banking one hides whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 20 }
];

/** Stage 9 leaves the bot in the sewer; every other stage starts at the Ardougne bank. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    9: { x: 2562, z: 9737, level: 0 }
};

// Why: a stage seeds only what that stage produced, the spade, buckets, rope and
// cure ingredients are tools, and handing one over hides whether the bot can find it.
const HANDED_OVER: Record<number, string[]> = {
    20: ['turnip_book'],
    27: ['warrant']
};

function stageItems(stage: number): string[] {
    return [...(stage >= 2 ? ['gasmask'] : []), ...(HANDED_OVER[stage] ?? [])];
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

    await maxmeAndClearDialogs(page);
    console.log('stats: maxed');

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar elenaquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'elenaquest');
        console.log(`elenaquest=${set}`);
        if (set !== args.stage) {
            fail(`setvar elenaquest ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
        for (const item of stageItems(args.stage)) {
            await cheatQuiet(page, `give ${item} 1`);
            console.log(`  gave ${item}`);
        }
    }

    const start = STAGE_START[args.stage] ?? (args.stage >= 3 && args.stage <= 8 ? GARDEN : ARDOUGNE_BANK);
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'elena'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for elenaquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        // Why: one engine serves every worktree, so a concurrent session's deploy silently
        // replaces this bundle and the queue line is the first place it shows.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the deployed bundle has no ${QUEST} — another worktree deployed over it; rerun this harness`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'elenaquest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` elenaquest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // A full run waits for the journal to go green: the quest-complete
        // recolour and the QP award land a tick behind %elenaquest.
        const done = args.until >= 29 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (elenaquest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at elenaquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`elenaquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
