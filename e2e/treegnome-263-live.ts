/** Live Tree Gnome Village harness (#263): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` sets `%treequest` and relogs, since update_questlist only recolours the journal entry at login; stages 6 and 8 also hand over the orb that stage assumes was already won, and `--lost-orb` withholds it to drive the recovery path instead. */

//   HEADED=1 bun e2e/treegnome-263-live.ts --stage 0 --until 9 --minutes 120 --tick 200
//   HEADED=1 bun e2e/treegnome-263-live.ts --stage 4 --until 6 --minutes 30 --tick 200
//   HEADED=1 bun e2e/treegnome-263-live.ts --stage 7 --until 9 --minutes 45 --tick 200
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
    user: `tg${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 9,
    minutes: 120,
    tickMs: 200,
    food: 'Lobster',
    stats: 70,
    lostOrb: false,
    deploy: true
}, {
    switches: { '--lost-orb': { lostOrb: true } }
});

const QUEST = 'Tree Gnome Village';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const COMPLETE = 9;

/**
 * Coins, food and a melee kit. The axe, the six logs and both orbs have a
 * source in the world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    // Why: rune platebody wants Dragon Slayer complete, and the refusal is a bare false.
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** The orb each stage assumes is already in hand: one at stage 6, the pair at stage 8. */
const STAGE_ORB: Record<number, string> = { 6: 'orb_of_protection', 8: 'orbs_of_protection' };

if (args.stage < 0 || args.stage > 8) {
    fail('--stage sets %treequest and runs 0 to 8');
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

    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('tree');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no ${QUEST} — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setQuestStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar treequest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'treequest');
        console.log(`treequest=${set}`);
        if (set !== args.stage) {
            fail(`setvar treequest ${args.stage} did not take (read back ${set})`);
        }
        const orb = STAGE_ORB[args.stage];
        if (orb && !args.lostOrb) {
            await cheatQuiet(page, `give ${orb} 1`);
            console.log(`handed over ${orb} — the stage assumes it was already won`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, ARDOUGNE_BANK);
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'tree'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= COMPLETE ? 'the journal to go green' : `treequest >= ${args.until}`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const stage = (await getServerVarQuiet(page, 'treequest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` treequest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %treequest.
        const done = args.until >= COMPLETE ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (treequest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at treequest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`treequest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
