/** Live Fight Arena harness (#233): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` sets `%arenaquest` and relogs, since update_questlist only recolours the journal entry at login; both bundles are deployed because refusing the arena's doors changed the transport graph. */

//   HEADED=1 bun e2e/fight-arena-233-live.ts --stage 0 --until 14 --minutes 120 --tick 150
//   HEADED=1 bun e2e/fight-arena-233-live.ts --stage 9 --until 12 --minutes 45 --tick 150
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
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
    food: string;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `fa${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 14,
        minutes: 120,
        tickMs: 150,
        food: 'Lobster',
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Fight Arena';
const YANILLE_BANK = { x: 2612, z: 3092, level: 0 };

/**
 * Coins, food and a melee kit. Every quest item has a source in the world, and
 * banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    // Why: rune platebody wants Dragon Slayer complete, and the refusal is a bare false.
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 },
    { debugName: 'leather_boots', displayName: 'Leather boots', qty: 1 },
    { debugName: 'leather_gloves', displayName: 'Leather gloves', qty: 1 }
];

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: YANILLE_BANK,
    1: { x: 2613, z: 3190, level: 0 },   // the guards' chest
    2: { x: 2613, z: 3190, level: 0 },
    3: { x: 2617, z: 3172, level: 0 },   // outside the guard door
    5: { x: 2617, z: 3172, level: 0 },
    6: { x: 2597, z: 3160, level: 0 },   // the arena floor
    8: { x: 2597, z: 3160, level: 0 },
    9: { x: 2600, z: 3142, level: 0 },   // the prison cell
    10: { x: 2597, z: 3160, level: 0 },
    11: { x: 2597, z: 3160, level: 0 },
    12: { x: 2597, z: 3160, level: 0 }
};

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
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
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
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user, clientPage);
    console.log(`mainland-ready as '${args.user}'`);

    // Why: this should not fire now that the client is per-run, so if it ever does the isolation broke rather than a neighbour winning a race.
    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('arena');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no Fight Arena — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Yanille bank`);
    await seedItemsToBank(page, BANK_SEED, YANILLE_BANK);

    // Why: ~maxme leaves the player delayed through its level-up cascade, which swallows the next typed command.
    await maxmeAndClearDialogs(page);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar arenaquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'arenaquest');
        console.log(`arenaquest=${set}`);
        if (set !== args.stage) {
            fail(`setvar arenaquest ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = STAGE_START[args.stage] ?? YANILLE_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'arena'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for arenaquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'arenaquest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` arenaquest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the recolour and the QP award land a tick behind %arenaquest.
        const done = args.until >= 14 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (arenaquest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at arenaquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`timed out after ${args.minutes}min at arenaquest=${reached}`);
} finally {
    await browser.close();
}
