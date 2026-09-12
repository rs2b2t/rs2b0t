/** Live Witch's House harness (#226), using the members world at :8890. */
// Why: stage jumps relog; only coins, food, and melee gear are seeded.

//   HEADED=1 bun e2e/witchs-house-226-live.ts --stage 0 --minutes 60
//   HEADED=1 bun e2e/witchs-house-226-live.ts --stage 2 --until 3 --stocked --minutes 20   # the mouse and the magnet
//   HEADED=1 bun e2e/witchs-house-226-live.ts --stage 5 --until 6 --at 2901,3466,0 --stocked --minutes 25   # the fountain and the fight
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

interface Tile {
    x: number;
    z: number;
    level: number;
}

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    skills: number;
    at: Tile | null;
    stocked: boolean;
    deploy: boolean;
}

function parseTile(s: string): Tile {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => !Number.isFinite(n))) {
        throw new Error(`bad tile '${s}', want x,z,level`);
    }
    return { x: x!, z: z!, level: level! };
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `wh${Date.now().toString(36).slice(-6)}`,
        stage: 0,
        until: 7,
        minutes: 60,
        tickMs: 300,
        skills: 50,
        at: null,
        stocked: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--stocked') { out.stocked = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--skills') { out.skills = Number(value); }
        else if (flag === '--at') { out.at = parseTile(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = "Witch's House";
const FALADOR_BANK: Tile = { x: 2946, z: 3369, level: 0 };

const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'agility', 'thieving', 'herblore', 'crafting', 'mining', 'smithing',
    'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'
];

/**
 * Coins, food and a melee kit. Nothing the quest itself supplies: the cheese and the gloves are what
 * `gather` has to buy, and every quest item is behind a step the run has to take.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 500_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 60 },
    { debugName: '4doseprayerrestore', displayName: 'Prayer potion(4)', qty: 4 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** What `gather` buys. Handed over only with `--stocked`, so a full run has to do the shopping. */
const SHOPPED: BankSeedItem[] = [
    { debugName: 'cheese', displayName: 'Cheese', qty: 1 },
    { debugName: 'leather_gloves', displayName: 'Leather gloves', qty: 1 }
];

interface Snapshot {
    pos: Tile | null;
    status: string;
    qp: number;
    runner: string;
    pack: string;
    logs: { time: number; level: string; msg: string }[];
}

/** Quest obj ids from `quest_ball.obj`, so a shared display name cannot be mistaken for one. */
const WATCHED: [number, string][] = [
    [2409, 'doorkey'], [2410, 'magnet'], [1985, 'cheese'], [2408, 'diary'],
    [2411, 'shedkey'], [2407, 'ball'], [1059, 'gloves']
];

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(([quest, watched]) => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
                Inventory: { items(): { id: number; count: number }[] };
                Equipment: { items(): { id: number }[] };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const inv = g.__rs2b0t.Inventory.items();
        const worn = g.__rs2b0t.Equipment.items();
        const held = (id: number): number =>
            inv.filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0)
            + (worn.some(i => i.id === id) ? 1 : 0);
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            // Why: one line, since the harness surfaces a bounded number of lines per poll.
            pack: watched.filter(([id]) => held(id) > 0).map(([, name]) => name).join(',') || 'empty',
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, [QUEST, WATCHED] as const);
}

// Why: this run gets its own copy of the client and its own navworker, so a neighbouring harness
// deploying into the shared `public/bot` mid-boot cannot decide which branch this one exercises.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';
// Why: a PASS leaves through `process.exit`, which skips `finally`, so the sweep hangs off the exit.
process.on('exit', () => client?.cleanup());

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

    await mainlandAccount(page, args.base, args.user, clientPage);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms (${(600 / args.tickMs).toFixed(1)}x)`);

    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${args.skills}`);
    }
    await clearChatDialogs(page, 'post-setstat dialog(s)');
    console.log(`skills → ${args.skills}`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Falador bank`);
    await seedItemsToBank(page, BANK_SEED, FALADOR_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar ballquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'ballquest');
        if (set !== args.stage) {
            fail(`setvar ballquest ${args.stage} did not take (read back ${set})`);
        }
    }
    // The journal colour is only recomputed at login, and the module reads the tab, not the varp.
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');
    console.log(`ballquest=${await getServerVarQuiet(page, 'ballquest')}, watching for >= ${args.until}`);

    // Why: provisioning plans against the last bank read, which is empty on a fresh account, so a
    // seeded bank still sends the run to Port Sarim and Varrock, and the pack is the only shortcut.
    if (args.stocked) {
        for (const item of SHOPPED) {
            await cheatQuiet(page, `give ${item.debugName} ${item.qty}`);
        }
        console.log(`packed: ${SHOPPED.map(i => i.displayName).join(', ')}`);
    }

    const start = args.at ?? FALADOR_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    // Gear is declared, never inferred. The quest wears whatever this says.
    await page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { Loadouts: { save(l: unknown[]): void } } };
        g.__rs2b0t.Loadouts.save([{
            name: 'quest',
            worn: {
                righthand: 'Rune scimitar',
                torso: 'Rune chainbody',
                legs: 'Rune platelegs',
                hat: 'Rune full helm',
                lefthand: 'Rune kiteshield'
            },
            carry: [{ item: 'Lobster', qty: 12 }]
        }]);
    });
    console.log('seeded the quest loadout');

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'ball'));
    await startScript(page, 'AIOQuester');

    // Why: `public/bot` is shared across sessions, so another deploy can land inside this page's boot
    // window and the run then silently exercises a bundle that has never heard of this quest.
    let queueLine = '';
    for (let i = 0; i < 20 && !queueLine; i++) {
        await page.waitForTimeout(1000);
        queueLine = (await snapshot(page)).logs.find(l => l.msg.includes('AIOQuester — queue:'))?.msg ?? '';
    }
    if (!queueLine.includes(QUEST)) {
        fail(`the loaded bundle does not know ${QUEST}, so another session's deploy won the race. Queue: ${queueLine || '(none)'}`);
    }
    console.log(`started AIOQuester, watching for ballquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'ballquest')) ?? -1;
        // Why: `witch.rs2` rewinds the varp when she catches you, so the peak is what a partial run proved.
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` ballquest=${stage} peak=${reached} journal=${last.status} qp=${last.qp}`
            + ` pack=${last.pack} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                const at = ((l.time - t0) / 1000).toFixed(1).padStart(6);
                console.log(`      ·${at}s [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the recolour and the QP award land a tick
        // behind `%ballquest = ^ball_complete`.
        const done = args.until >= 7 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (ballquest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at ballquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`ballquest peaked at ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
