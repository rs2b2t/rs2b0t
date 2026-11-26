/** Live Big Chompy Bird Hunting harness (#235), using the members world at :8890. */
// Why: stage jumps need a relog; stage 0 leaves sourceable quest items out of the bank.
// Mid-quest starts bank a knife and chisel because Bugs sells them only at stage 5.

//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 0 --until 65 --tick 200 --minutes 180
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 0 --until 10 --tick 200 --minutes 60
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 10 --until 40 --tick 200 --minutes 45
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 40 --until 55 --tick 200 --minutes 45
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 55 --until 65 --tick 200 --minutes 45
import { parseQuestArgs, type QuestArgs } from './lib/questArgs.js';
import { setQuestStats, teleportToQuestStart } from './lib/questHarness.js';
import type { Page } from 'playwright-core';

import { deployIsolatedClient, fail, launchBrowser, logBotConsole } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    clearMainModal,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args extends QuestArgs {
    stats: number;
    food: string;
    /** Enable the global `navTeleports` setting. */
    teleports: boolean;
    /** Bank the axe and feathers expected on an established account. */
    stocked: boolean;
}

const args = parseQuestArgs<Args>(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890',
    user: `cb${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 65,
    minutes: 180,
    tickMs: 300,
    stats: 70,
    food: 'Lobster',
    teleports: false,
    stocked: false,
    deploy: true
}, {
    switches: {
        '--teleports': { teleports: true },
        '--stocked': { stocked: true }
    }
});

const QUEST = 'Big Chompy Bird Hunting';
const YANILLE_BANK = { x: 2612, z: 3092, level: 0 };
const RANTZ = { x: 2630, z: 2981, level: 0 };
const BAIT = { x: 2636, z: 2966, level: 0 };

/** Coins, food and a melee kit; the wolves that carry the arrow tips are level 64. */
function bankSeed(): BankSeedItem[] {
    const seed: BankSeedItem[] = [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: args.food.toLowerCase().replace(/ /g, '_'), displayName: args.food, qty: 40 },
        { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
        { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
        // Why: rune platebody wants Dragon Slayer complete, and the refusal is a bare false.
        { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
        { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
        { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
    ];
    // Why: Bugs sells the knife and chisel at stage 5 alone, and past that the quest can only fletch with an account's own pair.
    if (args.stage > 0) {
        seed.push(
            { debugName: 'knife', displayName: 'Knife', qty: 1 },
            { debugName: 'chisel', displayName: 'Chisel', qty: 1 }
        );
    }
    // Why: an axe and a stack of feathers are ordinary bank clutter, and banking them skips the Lumbridge and Port Sarim legs a from-scratch run has to walk.
    if (args.stocked) {
        seed.push(
            { debugName: 'bronze_axe', displayName: 'Bronze axe', qty: 1 },
            { debugName: 'feather', displayName: 'Feather', qty: 500 }
        );
    }
    return seed;
}

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: YANILLE_BANK,
    5: RANTZ,
    10: RANTZ,
    15: RANTZ,
    20: RANTZ,
    25: RANTZ,
    30: BAIT,
    35: BAIT,
    40: RANTZ,
    45: RANTZ,
    50: RANTZ,
    55: RANTZ,
    60: RANTZ
};

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    modal: { main: number; chat: number };
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: {
                    worldTile(): { x: number; z: number; level: number } | null;
                    modals(): { main: number; chat: number };
                };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            // Why: a main modal nobody closed refuses every talk in silence and blanks every journal read.
            modal: g.__rs2b0t.reader.modals(),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

const client = args.deploy
    ? deployIsolatedClient(`cb${Date.now().toString(36).slice(-6)}`)
    : { page: '/bot.html', cleanup: (): void => {} };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    logBotConsole(page, t0);

    await mainlandAccount(page, args.base, args.user, client.page);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    if (args.teleports) {
        await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:Global:navTeleports', 'true'));
        console.log('nav teleports: on');
    }

    await setQuestStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    const seed = bankSeed();
    console.log(`seeding ${seed.length} item type(s) into the Yanille bank`);
    await seedItemsToBank(page, seed, YANILLE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar chompybird ${args.stage}`);
        // Why: the "did you make these yourself" bit is set by the fletching script, and Rantz refuses arrows without it.
        await cheatQuiet(page, 'setvar chompybird_kills 1');
        const set = await getServerVarQuiet(page, 'chompybird');
        console.log(`chompybird=${set}, chompybird_kills=${await getServerVarQuiet(page, 'chompybird_kills')}`);
        if (set !== args.stage) {
            fail(`setvar chompybird ${args.stage} did not take (read back ${set})`);
        }
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_START[args.stage] ?? YANILLE_BANK;
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'chompybird'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await clearMainModal(page);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for chompybird >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let sawOurBuild = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'chompybird')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` chompybird=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
            + (last.modal.main === -1 ? '' : ` MAIN-MODAL=${last.modal.main}`)
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                console.log(`      · [${l.level}] ${l.msg}`);
                if (l.msg.includes('Big Chompy Bird Hunting')) { sawOurBuild = true; }
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        if (t > 120 && !sawOurBuild) {
            fail('the queue never named Big Chompy Bird Hunting in 120s — the deployed bundle is not this branch');
        }
        // A full run waits for the journal to go green rather than the varp: the
        // completion recolour and the QP award land a tick behind %chompybird.
        const done = args.until >= 65 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (chompybird=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at chompybird=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`chompybird reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
    client.cleanup();
}
