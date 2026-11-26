/** Live Tribal Totem harness (#262), using the members world at :8890. */
// `%totemquest` directly tracks stages 0-5; stage jumps relog to refresh the journal.
// `--combo` skips the KURT lock but leaves the stair trap active.
// Skills start at 70 and only coins and lobsters are banked.

//   HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 0 --until 5 --minutes 60 --tick 200
//   HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --until 5 --minutes 20 --tick 200
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
    user: `tt${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 5,
    minutes: 60,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    combo: false,
    deploy: true
}, {
    switches: { '--combo': { combo: true } }
});

const QUEST = 'Tribal Totem';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
/** Cromperty's block lands here once the R.P.D.T. have delivered the crate. */
const MANSION_LANDING = { x: 2638, z: 3321, level: 0 };

/**
 * Coins and food only. The address label comes off a crate the bot has to find,
 * and the ferry fare comes out of the engine's own coin float.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

if (args.stage < 0 || args.stage > 4) {
    fail('--stage is %totemquest and runs 0 to 4');
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

    if (args.stage > 0 || args.combo) {
        const traps = args.combo ? 1 : 0;
        await cheatQuiet(page, `setvar totemquest ${args.stage}`);
        await cheatQuiet(page, `setvar handelmort_traps_disabled ${traps}`);
        const readQuest = await getServerVarQuiet(page, 'totemquest');
        const readTraps = await getServerVarQuiet(page, 'handelmort_traps_disabled');
        console.log(`totemquest=${readQuest} handelmort_traps_disabled=${readTraps}`);
        if (readQuest !== args.stage || readTraps !== traps) {
            fail(`setvar did not take (totemquest ${readQuest}/${args.stage}, traps ${readTraps}/${traps})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    // Why: nothing walks into the mansion, so a stage-4 resume has to start inside it, every earlier stage starts at the bank the module provisions from.
    const start = args.stage >= 4 ? MANSION_LANDING : ARDOUGNE_BANK;
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'totem'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 5 ? 'the journal to go green' : `%totemquest ${args.until}`}`);

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
        const totemquest = (await getServerVarQuiet(page, 'totemquest')) ?? 0;
        const traps = (await getServerVarQuiet(page, 'handelmort_traps_disabled')) ?? 0;
        reached = Math.max(reached, totemquest);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` totemquest=${totemquest}/5 door=${(traps & 1) !== 0 ? 'open' : 'locked'}`
            + ` trap=${(traps & (1 << 21)) !== 0 ? 'noted' : 'live'}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %totemquest.
        const done = args.until >= 5 ? last.status === 'complete' : totemquest >= args.until;
        if (done) {
            console.log(`PASS (totemquest=${totemquest}/5, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at %totemquest ${totemquest} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`%totemquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
