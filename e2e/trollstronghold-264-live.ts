/** Live Troll Stronghold harness (#264): --stage N --until N --at x,z,level --pack --paint --minutes N, base :8890.
 *  Why: `--stage` sets `%troll_quest` and relogs since update_questlist only recolours the journal at login; the bank holds coins, food and a melee kit but no climbing boots, since sourcing those from Tenzing for 12gp is part of what the run has to prove, and `~bankitem` exists only in rs2b2t-content so the :8888 sim seeds nothing. */

//   HEADED=1 bun e2e/trollstronghold-264-live.ts --stage 0 --minutes 90
//   HEADED=1 bun e2e/trollstronghold-264-live.ts --stage 0 --paint    # draw the route
//   HEADED=1 bun e2e/trollstronghold-264-live.ts --stage 20 --until 30 --minutes 45
//   HEADED=1 bun e2e/trollstronghold-264-live.ts --stage 30 --at 2852,10105,0 --pack --minutes 25
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
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
    food: string;
    at: Tile | null;
    pack: boolean;
    paint: boolean;
    lowPrayer: boolean;
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
        user: `troll${Date.now().toString(36).slice(-6)}`,
        stage: 0,
        until: 50,
        minutes: 120,
        tickMs: 300,
        skills: 70,
        food: 'Lobster',
        at: null,
        pack: false,
        paint: false,
        lowPrayer: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--pack') { out.pack = true; continue; }
        if (flag === '--paint') { out.paint = true; continue; }
        if (flag === '--lowprayer') { out.lowPrayer = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--skills') { out.skills = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--at') { out.at = parseTile(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Troll Stronghold';
const FALADOR_BANK: Tile = { x: 2946, z: 3369, level: 0 };
/** quest.constant ^death_complete — Troll Stronghold's only quest prerequisite. */
const DEATH_PLATEAU_COMPLETE = 80;
/** %death_map bits 0-3 (^death_scouted_area), which completing Death Plateau leaves set.
 *  Why: Tenzing's front door reads these rather than the stage varp — with the stage complete and the map bits clear, `death_sherpa_door` only ever knocks and the boots are unreachable. */
const DEATH_PLATEAU_MAP = 8;

/** Every skill the quest or the fights touch.
 *  Why: `::setstat` writes the level directly, so unlike `::advancestat` it pops no level-up dialog to swallow the next typed command. */
const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'agility', 'thieving', 'herblore', 'crafting', 'mining', 'smithing',
    'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'
];

/**
 * Coins, food and a melee kit. Climbing boots stay out: the bot has to buy them
 * from Tenzing, and seeding a pair would hide whether it can.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 60 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: '4doseprayerrestore', displayName: 'Prayer potion(4)', qty: 4 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** `--pack`: hand the loadout straight to the inventory for a fast inner-leg run. */
const PACK_SEED = [
    'give death_climbingboots 1',
    'give lobster 16',
    'give rune_scimitar 1',
    'give coins 500'
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

/** A live run loads the deployed bundle, never the working tree.
 *  Why: navworker is a second artifact embedding the transport graph, so a nav-data change is invisible to pathfinding until it is copied across too. */
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
    const copy = Bun.spawnSync(['sh', '-c', `cp out/botclient.js out/botclient.js.map out/navworker.js "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundle into ${botDir}`);
    }
    console.log(`deploy: fresh botclient.js + navworker.js -> ${botDir}`);
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
    console.log(`tick rate: ${args.tickMs}ms (${(600 / args.tickMs).toFixed(1)}x)`);

    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${args.skills}`);
    }
    await clearChatDialogs(page, 'post-setstat dialog(s)');
    console.log(`skills → ${args.skills}`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Falador bank`);
    await seedItemsToBank(page, BANK_SEED, FALADOR_BANK);

    await cheatQuiet(page, `setvar death_equiproom ${DEATH_PLATEAU_COMPLETE}`);
    await cheatQuiet(page, `setvar death_map ${DEATH_PLATEAU_MAP}`);
    if (args.stage > 0) {
        await cheatQuiet(page, `setvar troll_quest ${args.stage}`);
    }
    const death = await getServerVarQuiet(page, 'death_equiproom');
    if (death !== DEATH_PLATEAU_COMPLETE) {
        fail(`setvar death_equiproom did not take (read back ${death})`);
    }
    const map = await getServerVarQuiet(page, 'death_map');
    if (map !== DEATH_PLATEAU_MAP) {
        fail(`setvar death_map did not take (read back ${map})`);
    }
    if (args.stage > 0) {
        const set = await getServerVarQuiet(page, 'troll_quest');
        if (set !== args.stage) {
            fail(`setvar troll_quest ${args.stage} did not take (read back ${set})`);
        }
    }
    // The journal colour is only recomputed at login, and the module reads the
    // tab rather than the varp.
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');
    console.log(`death_equiproom=${death} death_map=${map} troll_quest=${args.stage}`);

    if (args.pack) {
        for (const cmd of PACK_SEED) {
            await cheatQuiet(page, cmd);
        }
        console.log(`packed: ${PACK_SEED.join(', ')}`);
    }

    if (args.lowPrayer) {
        // Empties the prayer bar so the sip path is exercised rather than
        // skipped — a 70-prayer character never dips under half in one fight.
        await cheatQuiet(page, '~1pray');
        console.log('prayer drained to 1 (--lowprayer)');
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
        // Global settings bag: the planned route in red, the client's own leg in
        // cyan, with hop labels. Worth having on for any headed watch.
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
            carry: [{ item: 'Lobster', qty: 16 }]
        }]);
    });
    console.log('seeded the quest loadout');

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'troll'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for troll_quest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'troll_quest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` troll=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            // Relative stamps: the gaps are where the run spends time.
            if (l.time > lastLogTime) {
                const at = ((l.time - t0) / 1000).toFixed(1).padStart(6);
                console.log(`      ·${at}s [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind the varp.
        const done = args.until >= 50 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (troll_quest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at troll_quest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`troll_quest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
