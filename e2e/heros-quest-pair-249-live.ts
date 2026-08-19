/** Live Hero's Quest pair harness (#249): two accounts on opposite gangs, cooperating to a completion.
 *  Why: the master thief armband cannot be earned alone — `grip_attack` refuses everyone but a Phoenix
 *  member, `pete_treasuredoor` and the candlestick chest answer only to a Black Arm member with Grip's
 *  papers given, and `open_and_close_door` teleports the actor rather than opening, so the Phoenix bot
 *  crosses the side door only on the spare key its rival trades over.
 *  Why: one browser context per account, because settings live in sessionStorage keyed
 *  `rs2b0t:set:<Script>:<key>` and a shared context would cross-contaminate the two bots. */

//   HEADED=1 bun e2e/heros-quest-pair-249-live.ts --tick 300 --minutes 150
//   HEADED=1 bun e2e/heros-quest-pair-249-live.ts --stage armband --minutes 75
//   HEADED=1 bun e2e/heros-quest-pair-249-live.ts --stage grip --minutes 20
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
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
    phoenixUser: string;
    blackarmUser: string;
    minutes: number;
    tickMs: number;
    stats: number;
    stage: 'grip' | 'armband' | 'full';
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const stamp = Date.now().toString(36).slice(-6);
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        phoenixUser: process.env.PHOENIX_NAME || `hqp${stamp}`,
        blackarmUser: process.env.BLACKARM_NAME || `hqb${stamp}`,
        minutes: 150,
        tickMs: 300,
        stats: 70,
        stage: 'full',
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--stats') { out.stats = Number(value); }
        else if (flag === '--stage') {
            out.stage = value === 'armband' || value === 'grip' ? value : 'full';
        }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = "Hero's Quest";
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
// Why: the walk-and-shop half of this quest takes ten minutes a side and is proven on its own, so
// `--stage grip` starts at the stage the two-bot dance begins with the kit already banked — the
// crossing to Brimhaven is still walked.
const GRIP_STAGE: Record<'phoenix' | 'blackarm', number> = { phoenix: 4, blackarm: 11 };
const GRIP_SEED: Record<'phoenix' | 'blackarm', BankSeedItem[]> = {
    phoenix: [
        { debugName: 'oak_longbow', displayName: 'Oak longbow', qty: 1 },
        { debugName: 'steel_arrow', displayName: 'Steel arrow', qty: 150 }
    ],
    // Why: at stage 11 Garv's door is already unlocked, so the disguise has done its job and Grip
    // re-issues the spare key to anyone who asks.
    blackarm: []
};

// Why: coins and food only — every other quest item has a source the module walks to.
// Why: the ice gloves are the one exception, and they are seeded because the Ice Queen's lair has no
// entrance on this content: all eight ladders down sit on a plateau (x 2800-2861, z 3500-3521) whose
// every boundary tile carries the map's BLOCK_MAP_SQUARE flag, and the three ladders back up are
// one-way. The bot still implements the fight; nothing can walk to it.
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 60 },
    { debugName: 'ice_gloves', displayName: 'Ice gloves', qty: 1 }
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

// Why: the four prerequisites are another six hours of running quests that are not the one under test,
// so they are set rather than earned — at the values `quest.constant` calls complete, because
// `~send_quest_progress` colours the list green only on `current >= complete`.
const PREREQS: [string, number][] = [
    ['zanaris', 6],
    ['dragonquest', 10],
    ['arthur', 7]
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

async function setPrereqs(page: Page, gang: 'phoenix' | 'blackarm'): Promise<void> {
    for (const [name, value] of PREREQS) {
        await cheatQuiet(page, `setvar ${name} ${value}`);
    }
    // Why: `has_hero_quest_requirements` accepts either gang complete, and every later branch reads
    // the one that is — a bot with both set would be offered both sides of the quest.
    await cheatQuiet(page, `setvar phoenixgang ${gang === 'phoenix' ? 10 : 0}`);
    await cheatQuiet(page, `setvar blackarmgang ${gang === 'blackarm' ? 4 : 0}`);
    // Why: the quest list is coloured by `~send_quest_progress` at login, and `readHeroQuestProgress`
    // reads that colour first — a stage set after the relog leaves the journal reading notStarted.
    if (args.stage === 'grip') {
        await cheatQuiet(page, `setvar heroquest ${GRIP_STAGE[gang]}`);
    }
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
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
            logs: ring.slice(-40).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

async function setHero(page: Page, gang: string, partner: string): Promise<void> {
    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:AIOQuester:${k}`, v);
        }
    }, { quests: 'hero', arravGang: gang, heroPartner: partner, food: 'Lobster' });
}

async function bringUp(page: Page, user: string, gang: 'phoenix' | 'blackarm', partner: string, clientPage: string): Promise<void> {
    await mainlandAccount(page, args.base, user, clientPage);
    console.log(`mainland-ready as '${user}' (${gang})`);
    await cheatQuiet(page, `speed ${args.tickMs}`);
    await setStats(page, args.stats);
    await setPrereqs(page, gang);
    // Why: the quest list is coloured by `~send_quest_progress` calls that `general/scripts/quests.rs2`
    // runs at login, so a varp set mid-session leaves every prerequisite reading red to the client and
    // the eligibility gate blocks the quest before it starts.
    await relog(page, user);
    // Why: `%qp` is summed from the quest varps by the login proc in `general/scripts/quests.rs2`, so a
    // value set before the relog is thrown away and one set after it survives the session.
    await cheatQuiet(page, 'setvar qp 55');
    const seed = args.stage === 'grip' ? [...BANK_SEED, ...GRIP_SEED[gang]] : BANK_SEED;
    await seedItemsToBank(page, seed, VARROCK_WEST_BANK);
    // Why: every stage starts at a booth, because `ownsInventory` makes the first step a bank read and
    // Karamja has none — a bot dropped in Brimhaven waits out its budget on a booth that is not there.
    if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
            fail(`tele to the Varrock West bank failed for '${user}'`);
        }
    }
    await setHero(page, gang, partner);
}

const tag = `hq${Date.now().toString(36).slice(-6)}`;
const client = args.deploy ? deployIsolatedClient(tag) : { page: '/bot.html', cleanup: () => {} };

console.log(
    `heros-quest-pair base=${args.base} phoenix=${args.phoenixUser} blackarm=${args.blackarmUser}`
    + ` stage=${args.stage} stats=${args.stats} budget=${args.minutes}min`
);

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
try {
    const pageP = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    for (const [label, page] of [['P', pageP], ['B', pageB]] as const) {
        page.on('pageerror', e => console.log(`[${label}] pageerror: ${e}`));
        page.on('console', m => {
            const txt = m.text();
            if (txt.startsWith('[bot]')) {
                console.log(`  [${label} ${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
            }
        });
    }

    await bringUp(pageP, args.phoenixUser, 'phoenix', args.blackarmUser, client.page);
    await bringUp(pageB, args.blackarmUser, 'blackarm', args.phoenixUser, client.page);

    await startScript(pageP, 'AIOQuester');
    await startScript(pageB, 'AIOQuester');
    console.log('both AIOQuester scripts started — watching for two completions');

    const deadline = Date.now() + args.minutes * 60_000;
    const lastLogTime = { P: 0, B: 0 };
    // `%heroquest`: 6 is the Phoenix armband, 13 the Black Arm one, 14+ the completed quest.
    const ARMBAND = { P: 6, B: 13 };
    while (Date.now() < deadline) {
        const [p, b, pHero, bHero] = await Promise.all([
            snapshot(pageP),
            snapshot(pageB),
            getServerVarQuiet(pageP, 'heroquest'),
            getServerVarQuiet(pageB, 'heroquest')
        ]);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s P[heroquest=${pHero} journal=${p.status} qp=${p.qp} ${p.runner}]`
            + ` B[heroquest=${bHero} journal=${b.status} qp=${b.qp} ${b.runner}]`
        );
        for (const [label, snap] of [['P', p], ['B', b]] as const) {
            for (const l of snap.logs) {
                if (l.time > lastLogTime[label]) { console.log(`      ${label} . [${l.level}] ${l.msg}`); }
            }
            if (snap.logs.length > 0) {
                lastLogTime[label] = Math.max(lastLogTime[label], ...snap.logs.map(l => l.time));
            }
        }

        if (args.stage === 'armband' || args.stage === 'grip') {
            if ((pHero ?? 0) >= ARMBAND.P && (bHero ?? 0) >= ARMBAND.B) {
                console.log(`PASS (armband: phoenix heroquest=${pHero}, blackarm heroquest=${bHero}, ${Math.round(t / 60)}min)`);
                process.exit(0);
            }
        } else if (p.status === 'complete' && b.status === 'complete') {
            // Why: the varp and the journal recolour a tick apart, so both are asserted.
            console.log(
                `PASS (phoenix ${args.phoenixUser} heroquest=${pHero} qp=${p.qp},`
                + ` blackarm ${args.blackarmUser} heroquest=${bHero} qp=${b.qp}, ${Math.round(t / 60)}min)`
            );
            process.exit(0);
        }
        // Why: the AIO Quester drains its queue and stops the moment its own journal turns green, so the
        // first bot home is always 'stopped' while the second is still walking. Only a stop with an
        // unfinished journal is a failure.
        if (p.runner === 'stopped' && p.status !== 'complete') {
            fail(`phoenix bot stopped (journal=${p.status}, heroquest=${pHero})`);
        }
        if (b.runner === 'stopped' && b.status !== 'complete') {
            fail(`black arm bot stopped (journal=${b.status}, heroquest=${bHero})`);
        }
        await pageP.waitForTimeout(10_000);
    }
    fail(`the pair did not finish within ${args.minutes}min`);
} finally {
    await browser.close();
    client.cleanup();
}
