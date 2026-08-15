/** Live Family Crest harness (#210): --stage N --until N --minutes N --teleports. Members-only, so the :8890 world, not the :8888 sim.
 *  Why: `--stage` sets `%crestquest` and relogs — update_questlist only recolours the journal entry at login, and the module reads the tab rather than the varp. */

//   HEADED=1 bun e2e/family-crest-210-live.ts --stage 7 --minutes 25
//   HEADED=1 bun e2e/family-crest-210-live.ts --stage 0 --minutes 90     # full run
//   HEADED=1 bun e2e/family-crest-210-live.ts --stage 0 --teleports       # + tele kit
import type { Page } from 'playwright-core';
import { launchBrowser } from './lib/harness.js';
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
    /** Turn on Global `navTeleports` and seed a law-rune + duel-ring kit. */
    teleports: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `fc${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 11,
        minutes: 45,
        tickMs: 300,
        teleports: false
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--teleports') { out.teleports = value !== 'false'; i--; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const VARROCK_EAST_BANK = { x: 3253, z: 3420, level: 0 };

/** Everything the quest needs that no shop sells, plus a comfortable float.
 *  Why: nothing in the game stocks cooked bass or shrimp for Caleb's five fish, and the Ardougne gem merchant carries one ruby. */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'swordfish', displayName: 'Swordfish', qty: 2 },
    { debugName: 'bass', displayName: 'Bass', qty: 2 },
    { debugName: 'tuna', displayName: 'Tuna', qty: 2 },
    { debugName: 'salmon', displayName: 'Salmon', qty: 2 },
    { debugName: 'shrimp', displayName: 'Shrimps', qty: 2 },
    { debugName: 'ruby', displayName: 'Ruby', qty: 2 },
    // Why: Jiminua's Jungle Store is the only shop that sells this and Tai Bwo Wannai is a long round trip; the bot still walks it when the bank is empty.
    { debugName: '3doseantipoison', displayName: 'Antipoison(3)', qty: 2 },
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'shark', displayName: 'Shark', qty: 60 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'steel_pickaxe', displayName: 'Steel pickaxe', qty: 1 }
];

/** Only added with `--teleports`.
 *  Why: law runes are Magic Guild / Mage Arena stock and nothing sells a ring of dueling, so both are bank items — which is all the navigator needs, since it rubs jewellery from the inventory and never withdraws it. */
const TELEPORT_SEED: BankSeedItem[] = [
    { debugName: 'lawrune', displayName: 'Law rune', qty: 200 },
    { debugName: 'ring_of_dueling_8', displayName: 'Ring of dueling(8)', qty: 2 }
];

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: VARROCK_EAST_BANK,
    1: { x: 2809, z: 3441, level: 0 },   // Catherby bank → Caleb
    2: { x: 2809, z: 3441, level: 0 },
    3: { x: 2809, z: 3441, level: 0 },
    4: { x: 3269, z: 3167, level: 0 },   // Al Kharid bank → gem trader
    5: { x: 3269, z: 3167, level: 0 },
    6: { x: 3013, z: 3355, level: 0 },   // Falador East → Dwarven Mine → Boot
    7: { x: 2655, z: 3283, level: 0 },   // Ardougne East → Witchaven mine
    8: { x: 3253, z: 3420, level: 0 },   // Varrock East → Jolly Boar Inn
    9: { x: 3253, z: 3420, level: 0 },
    10: { x: 3094, z: 3493, level: 0 }   // Edgeville → Chronozon
};

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
};

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
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
            status: g.__rs2b0t.Quests.status('Family Crest'),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    });
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

    await maxmeAndClearDialogs(page);

    const seed = args.teleports ? [...BANK_SEED, ...TELEPORT_SEED] : BANK_SEED;
    console.log(`seeding ${seed.length} item type(s) into the Varrock East bank`);
    await seedItemsToBank(page, seed, VARROCK_EAST_BANK);

    if (args.teleports) {
        await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:Global:navTeleports', 'true'));
        console.log('Global navTeleports = true (spell + jewellery hops allowed in A*)');
    }

    if (args.stage > 0) {
        // The lever bits and the spells-cast bits share one varp; a stage jump has
        // to clear it or Chronozon starts the fight already weakened.
        await cheatQuiet(page, 'setvar crest_spells_levers_gauntlets 0');
        await cheatQuiet(page, `setvar crestquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'crestquest');
        console.log(`crestquest=${set}`);
        if (set !== args.stage) {
            fail(`setvar crestquest ${args.stage} did not take (read back ${set})`);
        }
        // update_questlist only runs at login, and Quests.status reads the tab.
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    const start = STAGE_START[args.stage] ?? VARROCK_EAST_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'crest'));
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Shark'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for crestquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let last: Snapshot | null = null;
    let reached = 0;
    while (Date.now() < deadline) {
        last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'crestquest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` crestquest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: the quest-complete recolour and the QP award land a tick behind `%crestquest`, so a full run waits on the journal; a stage-scoped run has no journal transition and passes on the stage.
        const done = args.until >= 11 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (crestquest=${stage}, journal=${last.status}, QP=${last.qp})`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at crestquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`crestquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
