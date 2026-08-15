/** Live Horror from the Deep harness (#216): --stage N --until N --minutes N --barcrawl 0 --bits <names> --teleports --stocked. Members-only, so base :8890 — the :8888 sim has no `node` block and every members gate refuses.
 *  Why: `--stage` relogs since update_questlist only recolours the journal entry at login; every `deephorror` sub-bit is seeded to match, since the bridge, the key and the three lamp repairs are separate bits of one varp and a stage jump leaving them clear describes a state the quest cannot reach; the bank holds coins and food alone, since a stage-1 run handed eight nails passes while the quest cannot smith them. */

//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 0 --until 10 --minutes 240
//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 4 --until 10 --minutes 60
//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 1 --barcrawl 0 --minutes 90
//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 1 --bits horrorbridgeleft,horrorbridgeright
//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 0 --until 10 --teleports
//   HEADED=1 bun e2e/horror-deep-216-live.ts --stage 0 --until 2 --stocked --teleports
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    clearMainModal,
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
    /** -1 leaves `%barcrawl` alone; 0/1/2 seeds it. */
    barcrawl: number;
    /** Hand the bot the dungeon load instead of making it shop for it. */
    seedKit: boolean;
    /** Extra `deephorror` varbits to seed, on top of the stage's own. */
    bits: string[];
    /** Turn Global `navTeleports` on and bank the law runes the hops need. */
    teleports: boolean;
    /** Bank the bridge kit, as an established account would already have it. */
    stocked: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `hd${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 10,
        minutes: 240,
        tickMs: 300,
        food: 'Shark',
        barcrawl: -1,
        seedKit: false,
        bits: [],
        teleports: false,
        stocked: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--seedkit') { out.seedKit = true; continue; }
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
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--barcrawl') { out.barcrawl = Number(value); }
        else if (flag === '--bits') { out.bits = value.split(',').filter(Boolean); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Horror from the Deep';
const CAMELOT_BANK = { x: 2725, z: 3491, level: 0 };
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

/** Coins and food only — everything else has a source in the world, and banking one would hide whether the bot can find it.
 *  Why: the food follows `--food`, or the quest withdraws a name the bank has never heard of. */
function bankSeed(): BankSeedItem[] {
    const seed: BankSeedItem[] = [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: args.food.toLowerCase().replace(/ /g, '_'), displayName: args.food, qty: 60 },
        // Why: nothing in the game sells a rune scimitar, so without it the melee form of the mother is prayed through and the branch never runs.
        { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 }
    ];
    // Why: law is the one rune the module will not shop for — only the Magic Guild and the Mage Arena stock it — so `--teleports` has to bank it or the toggle changes nothing.
    if (args.teleports) {
        seed.push({ debugName: 'lawrune', displayName: 'Law rune', qty: 500 });
    }
    // Why: an account that has owned a hammer and a pile of nails for years is the common case a from-scratch run never exercises, and every bridge-kit step reads the bank first.
    if (args.stocked) {
        seed.push(
            { debugName: 'hammer', displayName: 'Hammer', qty: 1 },
            { debugName: 'nails', displayName: 'Nails', qty: 50 },
            { debugName: 'woodplank', displayName: 'Plank', qty: 10 }
        );
    }
    return seed;
}

/** Debug shortcut for `--seedkit`: engine debugnames and counts. */
const DUNGEON_SEED: readonly [string, number][] = [
    ['tinderbox', 1], ['swamp_tar', 1], ['molten_glass', 1],
    ['bronze_dagger', 1], ['bronze_arrow', 5], ['rune_scimitar', 1],
    ['airrune', 300], ['waterrune', 200], ['earthrune', 200],
    ['firerune', 250], ['deathrune', 150], ['chaosrune', 150]
];

/** `deephorror` sub-bits that must be true at each stage, by varbit debugname.
 *  Why: `~update_questlist` and every branch in quest_horror.rs2 read these, not the stage alone. */
const STAGE_BITS: Record<number, string[]> = {
    0: [],
    1: [],
    2: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance'],
    4: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance',
        'horrortar', 'horrorglass', 'horrorlight'],
    5: ['horrorbridgeleft', 'horrorbridgeright', 'horroragilitykey', 'horrorlighthouseentrance',
        'horrortar', 'horrorglass', 'horrorlight',
        'horrorfire', 'horrorwater', 'horrorearth', 'horrorair', 'horrorsword', 'horrorarrow']
};

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: CAMELOT_BANK,
    1: VARROCK_EAST_BANK,          // the hammer, the nails and the Varrock shops
    2: { x: 2508, z: 3634, level: 0 },   // beside Larrissa on the causeway
    4: { x: 2508, z: 3634, level: 0 },
    5: { x: 2508, z: 3634, level: 0 }
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
            // Why: a main modal nobody closed refuses every talk in silence, so the poll reports it rather than leaving a stall looking like a bad decide().
            modal: g.__rs2b0t.reader.modals(),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: the transport graph — the basalt causeway, the bridge and the outpost pipe — compiles into navworker.js, a separate entrypoint, so deploying only the client leaves the navigator on the old edges and every route reports "unreachable". */
const DEPLOYED = ['botclient.js', 'botclient.js.map', 'navworker.js', 'navworker.js.map'];

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
    const files = DEPLOYED.map(f => `out/${f}`).join(' ');
    const copy = Bun.spawnSync(['sh', '-c', `cp ${files} "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundles into ${botDir}`);
    }
    console.log(`deploy: fresh ${DEPLOYED.join(', ')} -> ${botDir}`);
}

if (args.deploy) {
    deployBundle();
}

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

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    if (args.teleports) {
        await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:Global:navTeleports', 'true'));
        console.log('nav teleports: on');
    }

    await maxmeAndClearDialogs(page);

    const seed = bankSeed();
    console.log(`seeding ${seed.length} item type(s) into the Camelot bank`);
    await seedItemsToBank(page, seed, CAMELOT_BANK);

    if (args.barcrawl >= 0) {
        await cheatQuiet(page, `setvar barcrawl ${args.barcrawl}`);
        console.log(`barcrawl=${await getServerVarQuiet(page, 'barcrawl')}`);
    }

    if (args.seedKit) {
        // Why: --seedkit hands the bot the dungeon load so a run can iterate on the wall and the fight without the twenty-minute Varrock round trip; a "the quest works" run leaves it off and exercises the sourcing.
        console.log('seeding the dungeon load into the pack (--seedkit)');
        for (const [name, qty] of DUNGEON_SEED) {
            await cheatQuiet(page, `give ${name} ${qty}`);
        }
    }

    if (args.stage > 0) {
        for (const bit of [...(STAGE_BITS[args.stage] ?? []), ...args.bits]) {
            await cheatQuiet(page, `setvar ${bit} 1`);
        }
        await cheatQuiet(page, `setvar horrorquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'horrorquest');
        console.log(`horrorquest=${set}, bits=[${[...(STAGE_BITS[args.stage] ?? []), ...args.bits].join(', ')}]`);
        if (set !== args.stage) {
            fail(`setvar horrorquest ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = STAGE_START[args.stage] ?? CAMELOT_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'horror'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    // A scroll left in the main slot silently refuses every talk the quest
    // issues, and the run reads as a broken decide() instead.
    await clearMainModal(page);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for horrorquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'horrorquest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` horrorquest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
            + (last.modal.main === -1 ? '' : ` MAIN-MODAL=${last.modal.main}`)
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green, not the varp: the
        // completion recolour and the QP award land a tick behind %horrorquest.
        const done = args.until >= 10 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (horrorquest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at horrorquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`horrorquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
