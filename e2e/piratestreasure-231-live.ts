/** Live Pirate's Treasure harness (#231): --stage/--employed/--crate-rum/--crate-bananas, base :8890.
 *  Why: the smuggle state lives in three varps the client cannot read, so a stage number alone reaches only a third of the quest; every seed relogs because update_questlist recolours the journal at login only; the bank holds coins and food alone so the rum, apron and spade are sourced in the world. */

//   HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 0 --until 4 --minutes 120
//   HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 2 --until 2
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';

import type { Page } from 'playwright-core';

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
    user: `pt${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    employed: 0,
    crateRum: 0,
    crateBananas: 0,
    until: 4,
    minutes: 120,
    tickMs: 300,
    food: 'Lobster',
    stats: 99,
    deploy: true
}, {
    values: {
        '--employed': value => ({ employed: Number(value) }),
        '--crate-rum': value => ({ crateRum: Number(value) }),
        '--crate-bananas': value => ({ crateBananas: Number(value) })
    }
});

const QUEST = "Pirate's Treasure";
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };

/**
 * Coins and food only. The rum, the white apron and the spade all have sources in
 * the world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

/** Every seeded state starts at Draynor bank, the nearest booth to Port Sarim. */
const START = DRAYNOR_BANK;

async function seedVar(page: Page, name: string, want: number): Promise<void> {
    await cheatQuiet(page, `setvar ${name} ${want}`);
    const set = await getServerVarQuiet(page, name);
    console.log(`${name}=${set}`);
    if (set !== want) {
        fail(`setvar ${name} ${want} did not take (read back ${set})`);
    }
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

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Draynor bank`);
    await seedItemsToBank(page, BANK_SEED, DRAYNOR_BANK);

    // Why: the smuggle sub-state is three varps, and a stage jump that leaves them at zero seeds a state the server can never reach, %crate_rum = 2 with %hunt = 1 is the shipped crate, and nothing else says so.
    if (args.stage > 0 || args.employed > 0 || args.crateRum > 0 || args.crateBananas > 0) {
        await seedVar(page, 'hunt', args.stage);
        await seedVar(page, 'hunt_store_employed', args.employed);
        await seedVar(page, 'crate_rum', args.crateRum);
        await seedVar(page, 'crate_bananas', args.crateBananas);
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, START);
    console.log(`start tile → ${START.x},${START.z},${START.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'hunt'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for hunt >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const stage = (await getServerVarQuiet(page, 'hunt')) ?? -1;
        const employed = (await getServerVarQuiet(page, 'hunt_store_employed')) ?? -1;
        const crateRum = (await getServerVarQuiet(page, 'crate_rum')) ?? -1;
        const bananas = (await getServerVarQuiet(page, 'crate_bananas')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` hunt=${stage} employed=${employed} rum=${crateRum} bananas=${bananas}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind %hunt.
        const done = args.until >= 4 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (hunt=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at hunt=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`hunt reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
