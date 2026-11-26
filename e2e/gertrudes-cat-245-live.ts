/** Live Gertrude's Cat harness (#245), using the members world at :8890. */
// Why: stage jumps relog; stage 4 seeds the hidden crate to the last searched position.
// Only coins and food are banked, so quest supplies must be sourced in-world.

//   HEADED=1 bun e2e/gertrudes-cat-245-live.ts --stage 0 --until 6 --minutes 60 --tick 200
//   HEADED=1 bun e2e/gertrudes-cat-245-live.ts --stage 4 --until 5 --minutes 20 --tick 200
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { deployIsolatedClient, fail, launchBrowser, logBotConsole, type IsolatedClient } from './lib/harness.js';
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
    user: `gc${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 6,
    minutes: 60,
    tickMs: 300,
    food: 'Lobster',
    stats: 99,
    deploy: true
});

const QUEST = "Gertrude's Cat";
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };

/** The last crate `searchCratesForKitten` walks to, so a seeded stage 4 searches all six. */
const LAST_CRATE = { x: 3298, z: 3514, level: 0 };

/** `CoordGrid.packCoord`. */
function packCoord(level: number, x: number, z: number): number {
    return (z & 0x3fff) | ((x & 0x3fff) << 14) | ((level & 0x3) << 28);
}

/**
 * Coins and food only. The bucket, the cow, the doogle leaves and Gerrant's
 * sardine all have a source in the world, and banking one would hide whether
 * the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

const STAGE_NAME = ['not started', 'started', 'paid the boy', 'gave the milk', 'gave the sardine', 'rescued', 'complete'];

const ENGINE_DIR = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;

// Why: `build:bot` does not bake the collision pack, and `deployIsolatedClient` refuses without it, building it here keeps the run a single command.
function bakeCollision(): void {
    if (existsSync('out/collision.lcnav.gz')) {
        return;
    }
    console.log('deploy: baking out/collision.lcnav.gz');
    const baked = Bun.spawnSync(['bun', 'tools/nav/build-collision.ts', '--engine', ENGINE_DIR, '--no-verify'], { stdout: 'pipe', stderr: 'pipe' });
    if (baked.exitCode !== 0) {
        fail(`deploy: build-collision failed\n${baked.stderr.toString()}`);
    }
}

if (args.stage < 0 || args.stage > 5) {
    fail('--stage writes %fluffs and runs 0 (not started) to 5 (rescued)');
}

// Why: `bot.html` hardcodes one bundle path, so a concurrent session's deploy decides what this run executes, a copy per run removes the race instead of detecting it.
let isolated: IsolatedClient | null = null;
if (args.deploy) {
    bakeCollision();
    isolated = deployIsolatedClient(args.user, ENGINE_DIR);
}
const clientPage = isolated?.page ?? '/bot.html';

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    logBotConsole(page, t0);

    await mainlandAccount(page, args.base, args.user, clientPage);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setQuestStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Varrock West bank`);
    await seedItemsToBank(page, BANK_SEED, VARROCK_WEST_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar fluffs ${args.stage}`);
        const read = await getServerVarQuiet(page, 'fluffs');
        if (read !== args.stage) {
            fail(`setvar did not take (fluffs ${read}/${args.stage})`);
        }
        console.log(`fluffs=${read} (${STAGE_NAME[args.stage]})`);
        if (args.stage >= 4) {
            const packed = packCoord(LAST_CRATE.level, LAST_CRATE.x, LAST_CRATE.z);
            await cheatQuiet(page, `setvar fluffs_crate ${packed}`);
            const crate = await getServerVarQuiet(page, 'fluffs_crate');
            if (crate !== packed) {
                fail(`setvar did not take (fluffs_crate ${crate}/${packed})`);
            }
            console.log(`fluffs_crate=${packed} → (${LAST_CRATE.x},${LAST_CRATE.z}), the last crate the module searches`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    await teleportToQuestStart(page, VARROCK_WEST_BANK);
    console.log(`start tile → ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z},${VARROCK_WEST_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'fluffs'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 6 ? 'the journal to go green' : `%fluffs ${args.until} (${STAGE_NAME[args.until]})`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        // Why: `--no-deploy` runs on the shared bundle, where another session's deploy decides what this run executes.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — it is somebody else's (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'fluffs')) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` fluffs=${stage}/6 (${STAGE_NAME[stage] ?? '?'})`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green rather than the varp, the recolour and the QP award land a tick behind %fluffs.
        const done = args.until >= 6 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (fluffs=${stage}/6, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at %fluffs ${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`%fluffs reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
    isolated?.cleanup();
}
