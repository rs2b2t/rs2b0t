/** Live Imp Catcher harness (#230): --stage N --until N --beads N --minutes N, base :8890.
 *  Why: `--stage` relogs since update_questlist only recolours the journal at login; `--beads` seeds part of the bead set so the withdraw and hand-in legs are testable without the ~53-kill farm; stats are 70 rather than `~maxme` so reach and damage problems stay visible; the :8888 sim answers neither `givebank` nor `~bankitem`. */

//   HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 3 --start ardougne --minutes 30
//   HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 0 --minutes 120
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
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
    user: string;
    stage: number;
    until: number;
    beads: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    start: string;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ic${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 2,
        beads: 0,
        minutes: 90,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        start: 'draynor',
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
        else if (flag === '--beads') { out.beads = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
        else if (flag === '--start') { out.start = value; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Imp Catcher';
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };
/** `--start ardougne` drops the bot beside the imps; `draynor` walks the full 512 first. */
const START_TILES: Record<string, { x: number; z: number; level: number }> = {
    draynor: DRAYNOR_BANK,
    ardougne: { x: 2655, z: 3283, level: 0 }
};
const AMULET_OF_ACCURACY = 1478;

/** Engine debug name, display name and object id, in the order `--beads N` seeds them. */
const BEADS = [
    { debugName: 'black_bead', displayName: 'Black bead', id: 1474 },
    { debugName: 'red_bead', displayName: 'Red bead', id: 1470 },
    { debugName: 'white_bead', displayName: 'White bead', id: 1476 },
    { debugName: 'yellow_bead', displayName: 'Yellow bead', id: 1472 }
];

if (args.beads < 0 || args.beads > BEADS.length) {
    fail(`--beads ${args.beads} is outside 0..${BEADS.length}`);
}

/**
 * Coins and food, plus whatever beads the run is told to skip farming. Every
 * unseeded bead has an imp to be killed for, and seeding one hides that.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    ...BEADS.slice(0, args.beads).map(bead => ({ debugName: bead.debugName, displayName: bead.displayName, qty: 1 }))
];

/** Worn for the farm: an imp has 8 hitpoints, so this is kill speed, never survival. */
const GEAR = [
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar' },
    { debugName: 'amulet_of_glory', displayName: 'Amulet of glory' }
];

async function equipGear(page: Page): Promise<void> {
    for (const item of GEAR) {
        await cheatQuiet(page, `give ${item.debugName} 1`);
    }
    for (const item of GEAR) {
        const worn = await page.evaluate(async name => {
            const api = (globalThis as never as { __rs2b0t: { Equipment: { contains(n: string): boolean; equip(n: string): Promise<boolean> } } }).__rs2b0t;
            return api.Equipment.contains(name) || (await api.Equipment.equip(name));
        }, item.displayName);
        if (!worn) {
            fail(`could not equip ${item.displayName} — check the obj debug name '${item.debugName}'`);
        }
        console.log(`  equipped ${item.displayName}`);
    }
}

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

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    held: number[];
    amulet: number;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(([quest, beadIds, amuletId]) => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
                Inventory: { countById(id: number): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest as string),
            qp: g.__rs2b0t.Quests.points(),
            held: (beadIds as number[]).map(id => g.__rs2b0t.Inventory.countById(id)),
            amulet: g.__rs2b0t.Inventory.countById(amuletId as number),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, [QUEST, BEADS.map(bead => bead.id), AMULET_OF_ACCURACY] as [string, number[], number]);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: the transport graph compiles into navworker.js, a separate entrypoint — deploying only botclient.js leaves the navigator on the old edges and every route reports "unreachable". */
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

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    await equipGear(page);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Draynor bank`);
    await seedItemsToBank(page, BANK_SEED, DRAYNOR_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar imp ${args.stage}`);
        const set = await getServerVarQuiet(page, 'imp');
        console.log(`imp=${set}`);
        if (set !== args.stage) {
            fail(`setvar imp ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = START_TILES[args.start];
    if (!start) {
        fail(`--start ${args.start} is not one of ${Object.keys(START_TILES).join(', ')}`);
    }
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${args.start} (${start.x},${start.z},${start.level})`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'imp'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for imp >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'imp')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        const beads = BEADS.map((bead, i) => `${bead.displayName.split(' ')[0].toLowerCase()}=${last.held[i]}`).join(' ');
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` imp=${stage} journal=${last.status} qp=${last.qp} ${beads} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind %imp.
        const done = args.until >= 2 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            if (args.until >= 2 && last.amulet < 1) {
                fail(`journal complete but no Amulet of accuracy in the pack (imp=${stage})`);
            }
            console.log(`PASS (imp=${stage}, journal=${last.status}, QP=${last.qp}, amulet=${last.amulet}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at imp=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`imp reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
