/** Live Clock Tower harness (#236), using cog count as the stage. */
// Why: `%cogquest` and `%cog_bits` must move together; relog to refresh the journal.
// Max stats avoid red-cog ogre aggression. Quest items stay unseeded.

//   HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 5 --minutes 60 --tick 200
//   HEADED=1 bun e2e/clock-tower-236-live.ts --stage 3 --until 4 --minutes 25 --tick 200
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
    user: `ct${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 5,
    minutes: 60,
    tickMs: 300,
    food: 'Lobster',
    stats: 99,
    deploy: true
});

const QUEST = 'Clock Tower';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };

/**
 * Coins and food only. The bucket, its water and the rat poison all have a
 * source in the world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

/** `%cog_bits`: bit 0 is the black cog cooled, bits 1-4 are blue, black, white, red. */
const COG_BIT: Record<string, number> = { blue: 1, black: 2, white: 3, red: 4 };
/** The module's own fetch order, so a jumped stage matches what an uncheated run would have done by then. */
const PLACED_ORDER = ['black', 'red', 'blue', 'white'];

function cogBitsFor(placed: number): number {
    // Why: seeding black as placed implies the cog was cooled, and a bot that finds the bit clear pours a second bucket.
    let bits = placed > 0 ? 1 : 0;
    for (const colour of PLACED_ORDER.slice(0, placed)) {
        bits |= 1 << COG_BIT[colour];
    }
    return bits;
}

function placedCount(cogquest: number): number {
    const step = cogquest & 0xf;
    return step <= 1 ? 0 : Math.min(step - 1, 4);
}

if (args.stage < 0 || args.stage > 4) {
    fail('--stage counts placed cogs and runs 0 to 4');
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
        const cogquest = 1 + args.stage;
        const bits = cogBitsFor(args.stage);
        await cheatQuiet(page, `setvar cogquest ${cogquest}`);
        await cheatQuiet(page, `setvar cog_bits ${bits}`);
        const readQuest = await getServerVarQuiet(page, 'cogquest');
        const readBits = await getServerVarQuiet(page, 'cog_bits');
        console.log(`cogquest=${readQuest} cog_bits=${readBits} (${args.stage} cog(s) placed)`);
        if (readQuest !== cogquest || readBits !== bits) {
            fail(`setvar did not take (cogquest ${readQuest}/${cogquest}, cog_bits ${readBits}/${bits})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, ARDOUGNE_BANK);
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'cog'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 5 ? 'the journal to go green' : `${args.until} cog(s) placed`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
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
        const cogquest = (await getServerVarQuiet(page, 'cogquest')) ?? 0;
        const placed = placedCount(cogquest);
        reached = Math.max(reached, placed);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` placed=${placed}/4 rats=${(cogquest & 0x10) !== 0 ? 'dead' : 'alive'}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %cogquest.
        const done = args.until >= 5 ? last.status === 'complete' : placed >= args.until;
        if (done) {
            console.log(`PASS (placed=${placed}/4, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped with ${placed}/4 placed (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`placed reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
