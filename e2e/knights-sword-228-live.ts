/** Live Knight's Sword harness (#228), using the content world at :8890. */
// Why: stage jumps relog; only coins and food are banked so mining remains covered.

//   HEADED=1 bun e2e/knights-sword-228-live.ts --stage 0 --until 7 --minutes 120
//   HEADED=1 bun e2e/knights-sword-228-live.ts --stage 6 --until 7 --minutes 45
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, teleportToQuestStart } from './lib/questHarness.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { fail, launchBrowser, logBotConsole } from './lib/harness.js';
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
    user: `ks${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 7,
    minutes: 120,
    tickMs: 300,
    food: 'Lobster',
    deploy: true
});

const QUEST = "The Knight's Sword";
const FALADOR_BANK = { x: 2946, z: 3369, level: 0 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };

/**
 * Coins and food only. Every other item this quest needs has a source in the
 * world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: FALADOR_BANK,        // Squire, in the courtyard
    1: VARROCK_EAST_BANK,   // Reldo + the pie-dish spawn
    2: DRAYNOR_BANK,        // the bake, then Thurgo
    3: DRAYNOR_BANK,        // Thurgo again
    4: FALADOR_BANK,        // Squire, for the portrait lead
    5: FALADOR_BANK,        // Sir Vyvin's room
    6: FALADOR_BANK         // iron bars, then the ice dungeon
};

/** A live run loads the deployed bundle, never the working tree. */
function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${args.base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp out/botclient.js out/botclient.js.map "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundle into ${botDir}`);
    }
    console.log(`deploy: fresh botclient.js -> ${botDir}`);
}

if (args.deploy) {
    deployBundle();
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

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Falador bank`);
    await seedItemsToBank(page, BANK_SEED, FALADOR_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar squire ${args.stage}`);
        const set = await getServerVarQuiet(page, 'squire');
        console.log(`squire=${set}`);
        if (set !== args.stage) {
            fail(`setvar squire ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = STAGE_START[args.stage] ?? FALADOR_BANK;
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'squire'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for squire >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const stage = (await getServerVarQuiet(page, 'squire')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` squire=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind %squire.
        const done = args.until >= 7 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (squire=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at squire=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`squire reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
