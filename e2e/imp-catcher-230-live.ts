/** Live Imp Catcher harness (#230), using the content world at :8890. */
// Why: stage jumps relog; partial bead seeds isolate hand-in paths from the roughly 53-kill farm.

//   HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 1 --beads 3 --start ardougne --minutes 30
//   HEADED=1 bun e2e/imp-catcher-230-live.ts --stage 0 --beads 0 --minutes 120
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';

import type { Page } from 'playwright-core';

import { deploySharedBundles, fail, launchBrowser, logBotConsole } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

const args = parseQuestArgs(process.argv.slice(2), {
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
}, {
    values: {
        '--beads': value => ({ beads: Number(value) }),
        '--start': value => ({ start: value })
    }
});

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

if (args.deploy) {
    deploySharedBundles(args.base);
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    logBotConsole(page, t0);

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setQuestStats(page, args.stats);
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
    await teleportToQuestStart(page, start);
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
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

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
