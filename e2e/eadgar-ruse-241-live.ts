/** Live Eadgar's Ruse harness (#241): --stage N --until N --at x,z,level --pack --paint --unfreed --minutes N, base :8890.
 *  Why: `--stage` sets `%eadgar_quest` and relogs, since update_questlist only recolours the journal at login; the bank holds coins, food, a melee kit and a ranarr weed, and nothing else — the boots, the knife, the pineapple, the vodka, the pestle, the tinderbox, the axe, the logs, the chickens and the grain are all things the run has to source for itself. */

//   HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 0 --minutes 150
//   HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 30 --until 50 --minutes 45   # the Ardougne parrot leg
//   HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 90 --until 110 --at 2844,10057,1 --pack --minutes 30
//   HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 10 --until 15 --unfreed --minutes 40  # the free-Eadgar recovery
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import { applyNavPaintSettings } from './lib/navLiveHarness.js';
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
    pack: boolean;
    paint: boolean;
    unfreed: boolean;
    deploy: boolean;
}

function parseTile(s: string): Tile {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => !Number.isFinite(n))) {
        throw new Error(`bad tile '${s}' — want x,z,level`);
    }
    return { x: x!, z: z!, level: level! };
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `eadgar${Date.now().toString(36).slice(-6)}`,
        stage: 0,
        until: 110,
        minutes: 180,
        tickMs: 300,
        skills: 70,
        at: null,
        pack: false,
        paint: false,
        unfreed: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--pack') { out.pack = true; continue; }
        if (flag === '--paint') { out.paint = true; continue; }
        if (flag === '--unfreed') { out.unfreed = true; continue; }
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

const QUEST = "Eadgar's Ruse";
const FALADOR_BANK: Tile = { x: 2946, z: 3369, level: 0 };

/** quest.constant: the prerequisite chain Sanfew reads before he offers the quest. */
const PREREQ = {
    /** ^death_complete */
    death_equiproom: 80,
    /** %death_map bits 0-3 — Tenzing's front door reads these, not the stage varp. */
    death_map: 8,
    /** ^troll_complete */
    troll_quest: 50,
    /** ^druid_complete */
    druidquest: 4
} as const;

const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'agility', 'thieving', 'herblore', 'crafting', 'mining', 'smithing',
    'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'
];

/**
 * Coins, food, a melee kit and one ranarr weed. Nothing else: no 2004 shop sells a ranarr,
 * and everything the quest can buy or gather is left out so the run has to do it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 60 },
    { debugName: 'ranarr_weed', displayName: 'Ranarr weed', qty: 2 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** `--pack`: hand the travelling kit straight to the inventory for a fast inner-leg run. */
const PACK_SEED = [
    'give death_climbingboots 1',
    'give lobster 12',
    'give rune_scimitar 1',
    'give coins 1000'
];

interface Snapshot {
    pos: Tile | null;
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

// Why: this run gets its own copy of the client and its own navworker, so a neighbouring harness
// deploying into the shared `public/bot` mid-boot cannot decide which branch this one exercises —
// and this quest adds three transport edges, so a stale navworker plans Eadgar's cave as unreachable.
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

    for (const [varp, value] of Object.entries(PREREQ)) {
        await cheatQuiet(page, `setvar ${varp} ${value}`);
    }
    // Why: Troll Stronghold completes on Godric alone, and Eadgar's cave is empty until his cell is
    // opened — `--unfreed` leaves the varbit clear so the recovery leg is what gets exercised.
    if (!args.unfreed) {
        await cheatQuiet(page, 'setvar troll_freed_eadgar 1');
    }
    if (args.stage > 0) {
        await cheatQuiet(page, `setvar eadgar_quest ${args.stage}`);
    }
    for (const [varp, value] of Object.entries(PREREQ)) {
        const read = await getServerVarQuiet(page, varp);
        if (read !== value) {
            fail(`setvar ${varp} ${value} did not take (read back ${read})`);
        }
    }
    if (args.stage > 0) {
        const set = await getServerVarQuiet(page, 'eadgar_quest');
        if (set !== args.stage) {
            fail(`setvar eadgar_quest ${args.stage} did not take (read back ${set})`);
        }
    }
    // The journal colour is only recomputed at login, and the module reads the tab, not the varp.
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');
    console.log(`prereqs set${args.unfreed ? ' (Mad Eadgar left in his cell)' : ''}; eadgar_quest=${args.stage}`);

    if (args.pack) {
        for (const cmd of PACK_SEED) {
            await cheatQuiet(page, cmd);
        }
        console.log(`packed: ${PACK_SEED.join(', ')}`);
    }

    const start = args.at ?? FALADOR_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    if (args.paint) {
        await applyNavPaintSettings(page, {
            paint: true,
            cameraFollow: true,
            sceneExpand: true,
            clientSeg: true,
            clientColor: 'cyan',
            pathColor: 'red',
            teleports: false
        });
        console.log('nav path paint: on');
    }

    // Gear is declared, never inferred — the quest wears whatever this says.
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

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'eadgar'));
    await startScript(page, 'AIOQuester');

    // Why: `public/bot` is shared across sessions, so another deploy can land inside this page's
    // boot window and the run then silently exercises a bundle that has never heard of this quest.
    // Why: the queue line is the cheapest proof of which bundle booted — an unknown id falls back
    // to every quest, so a queue naming anything else is a lost race, not a bad setting.
    let queueLine = '';
    for (let i = 0; i < 20 && !queueLine; i++) {
        await page.waitForTimeout(1000);
        queueLine = (await snapshot(page)).logs.find(l => l.msg.includes('AIOQuester — queue:'))?.msg ?? '';
    }
    if (!queueLine.includes(QUEST)) {
        fail(`the loaded bundle does not know ${QUEST} — another session's deploy won the race. Queue: ${queueLine || '(none)'}`);
    }
    console.log(`started AIOQuester — watching for eadgar_quest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'eadgar_quest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` eadgar=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                const at = ((l.time - t0) / 1000).toFixed(1).padStart(6);
                console.log(`      ·${at}s [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green, not the varp: the quest-complete
        // recolour and the QP award land a tick behind it.
        const done = args.until >= 110 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (eadgar_quest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at eadgar_quest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`eadgar_quest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
