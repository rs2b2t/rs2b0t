/** Live Nature Spirit harness (#239): --stage N --until N --minutes N --tick ms --teleports --stocked. Members-only, so base :8890 — the :8888 sim has no `node` block and every members gate refuses.
 *  Why: `--stage` relogs, since update_questlist only recolours the journal entry at login; `%druidspirit_bits` is seeded alongside the stage, since the two ritual stones are bits of a second varp and a stage past the ritual with the bits clear describes a state the quest cannot reach; the bank holds coins and food alone, since a run handed a sickle passes while the quest cannot source one. */

//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 110 --minutes 180 --tick 200
//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 40 --minutes 45 --tick 200
//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 40 --until 65 --minutes 30 --tick 200
//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 65 --until 80 --minutes 45 --tick 200
//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 80 --until 110 --minutes 45 --tick 200
//   HEADED=1 bun e2e/naturespirit-239-live.ts --stage 0 --until 110 --teleports --stocked
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
    /** Turn Global `navTeleports` on. */
    teleports: boolean;
    /** Bank the amulet, mould and bar an established account would already own. */
    stocked: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ns${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 110,
        minutes: 180,
        tickMs: 300,
        food: 'Shark',
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
        else if (flag === '--food') { out.food = value; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Nature Spirit';
const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };
const ALKHARID_BANK = { x: 3269, z: 3167, level: 0 };
const GATE_NORTH = { x: 3443, z: 3461, level: 0 };
const CAMP = { x: 3440, z: 3337, level: 0 };

/** Coins and food only by default — every other item has a source in the world, and banking one hides whether the bot can find it. */
function bankSeed(): BankSeedItem[] {
    const seed: BankSeedItem[] = [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: args.food.toLowerCase().replace(/ /g, '_'), displayName: args.food, qty: 40 }
    ];
    // Why: a mould and a silver bar are ordinary bank clutter on an established account — the common case a from-scratch run never exercises.
    if (args.stocked) {
        seed.push(
            { debugName: 'sickle_mould', displayName: 'Sickle mould', qty: 1 },
            { debugName: 'silver_bar', displayName: 'Silver bar', qty: 1 }
        );
    }
    return seed;
}

// Why: the two ritual stones are bits of `%druidspirit_bits`, and every stage from the ritual on is only reachable with both set.
function bitsFor(stage: number): number {
    return stage >= 60 ? 3 : 0;
}

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: VARROCK_EAST_BANK,
    5: GATE_NORTH,
    10: CAMP,
    15: CAMP,
    20: CAMP,
    25: CAMP,
    30: CAMP,
    35: CAMP,
    40: CAMP,
    45: CAMP,
    50: CAMP,
    55: CAMP,
    60: CAMP,
    65: CAMP,
    70: ALKHARID_BANK,
    75: CAMP,
    80: CAMP,
    85: CAMP,
    90: CAMP,
    95: CAMP,
    100: CAMP,
    105: CAMP
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
            // Why: a main modal nobody closed refuses every talk in silence and blanks every journal read, so the poll reports it rather than leaving a stall looking like a bad decide().
            modal: g.__rs2b0t.reader.modals(),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: the transport graph — the temple crossing and the swamp gate — compiles into navworker.js, a separate entrypoint, so deploying only the client leaves the navigator on the old edges and every route reports "unreachable". */
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
    console.log(`seeding ${seed.length} item type(s) into the Varrock east bank`);
    await seedItemsToBank(page, seed, VARROCK_EAST_BANK);

    // Why: Nature Spirit is gated on both prerequisites, and the eligibility check reads the quest list rather than the module.
    for (const [varp, value] of [['prieststart', 60], ['priestperil', 61]] as const) {
        await cheatQuiet(page, `setvar ${varp} ${value}`);
    }
    console.log('prerequisites: The Restless Ghost + Priest in Peril set complete');

    // Why: a mid-quest stage starts inside Mort Myre, and making it walk to Lumbridge for the amulet first would spend the run's budget on a leg the stage-0 run already proves.
    if (args.stage > 0) {
        await cheatQuiet(page, 'give amulet_of_ghostspeak 1');
        console.log('gave the pack a Ghostspeak amulet (mid-quest start)');
        // Why: Filliman hands the blessed sickle and the empty pouch over at stage 75, so a run seeded past it describes a state the quest cannot otherwise reach.
        if (args.stage >= 75) {
            await cheatQuiet(page, 'give silver_sickle_blessed 1');
            await cheatQuiet(page, args.stage >= 90 ? 'give druid_pouch 6' : 'give druid_pouch_empty 1');
            console.log('gave the pack the blessed sickle and a druid pouch');
        }
        await cheatQuiet(page, `setvar druidspirit_bits ${bitsFor(args.stage)}`);
        await cheatQuiet(page, `setvar druidspirit ${args.stage}`);
        const set = await getServerVarQuiet(page, 'druidspirit');
        console.log(`druidspirit=${set}, druidspirit_bits=${await getServerVarQuiet(page, 'druidspirit_bits')}`);
        if (set !== args.stage) {
            fail(`setvar druidspirit ${args.stage} did not take (read back ${set})`);
        }
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_START[args.stage] ?? VARROCK_EAST_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'druidspirit'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    // A scroll left in the main slot silently refuses every talk the quest
    // issues, and blanks every journal read behind it.
    await clearMainModal(page);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for druidspirit >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'druidspirit')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` druidspirit=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
            + (last.modal.main === -1 ? '' : ` MAIN-MODAL=${last.modal.main}`)
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green rather than the varp: the
        // completion recolour and the QP award land a tick behind %druidspirit.
        const done = args.until >= 110 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (druidspirit=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at druidspirit=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`druidspirit reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
