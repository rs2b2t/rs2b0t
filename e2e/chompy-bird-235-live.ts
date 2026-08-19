/** Live Big Chompy Bird Hunting harness (#235): --stage N --until N --stats N --minutes N --tick ms --teleports.
 *  Why: members-only, so base :8890 — the :8888 sim has no `node` block and every members gate refuses.
 *  Why: `--stage` relogs, since update_questlist only recolours the journal entry at login.
 *  Why: a stage-0 run banks coins, food and a melee kit alone — the axe, the feathers, the knife, the chisel, the bellows,
 *  the arrows, the bait and all six seasonings have sources in the world, and banking one hides whether the bot finds it.
 *  Why: a mid-quest start also banks a knife and a chisel, because Bugs only sells the pair while the quest sits at stage 5. */

//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 0 --until 65 --tick 200 --minutes 180
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 0 --until 10 --tick 200 --minutes 60
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 10 --until 40 --tick 200 --minutes 45
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 40 --until 55 --tick 200 --minutes 45
//   HEADED=1 bun e2e/chompy-bird-235-live.ts --stage 55 --until 65 --tick 200 --minutes 45
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    clearMainModal,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    stats: number;
    food: string;
    /** Turn Global `navTeleports` on. */
    teleports: boolean;
    /** Bank the axe and feathers an established account would already own. */
    stocked: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
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
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--teleports') { out.teleports = true; continue; }
        if (flag === '--stocked') { out.stocked = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--stats') { out.stats = Number(value); }
        else if (flag === '--food') { out.food = value; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Big Chompy Bird Hunting';
const YANILLE_BANK = { x: 2612, z: 3092, level: 0 };
const RANTZ = { x: 2630, z: 2981, level: 0 };
const BAIT = { x: 2636, z: 2966, level: 0 };

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

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
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user, client.page);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    if (args.teleports) {
        await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:Global:navTeleports', 'true'));
        console.log('nav teleports: on');
    }

    await setStats(page, args.stats);
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
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
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
