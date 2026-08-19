/** Live Underground Pass harness (#265): --stage N --until N --minutes N, base :8890.
 *  Why: `%upass` and `%ibanmulti` are both `scope=perm` with no `transmit`, so the bot reads its own stage
 *  off the journal — the harness seeds the varps and relogs, because `~update_questlist` only recolours the
 *  list at login. Biohazard is seeded complete: it gates the cave mouth and King Lathas, and has no module yet.
 *  Why: stats are 70 across the board and the bank holds coins and Lobsters alone, so the bow, arrows,
 *  tinderbox and bucket are all sourced by the module rather than handed to it. */

//   HEADED=1 bun e2e/upass-265-live.ts --stage 0 --until 2 --minutes 30 --tick 200
//   HEADED=1 bun e2e/upass-265-live.ts --stage 2 --until 3 --minutes 25 --tick 200
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
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    tele: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `up${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 11,
        minutes: 45,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        tele: true,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-tele') { out.tele = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Underground Pass';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const BIOHAZARD_COMPLETE = 16;
/** Plague City — its sewer is the only way through the Ardougne wall, and it gates Biohazard anyway. */
const PLAGUE_CITY_COMPLETE = 29;
/** Bit 11 of `%ibanmulti` — King Lathas has sent the player to Koftik. */
const UPASS_STARTED_BIT = 1 << 11;
/** Bit 9 — the cat is at Kardia's door and she is busy with it, which is what unlocks her door. */
const UPASS_DROPPED_CAT_BIT = 1 << 9;

// Why: `%ibanmulti` carries sub-progress the stage number cannot, and a seeded stage that skips a bit is
// not the state the quest would ever be in. Reaching stage 7 means the cat was delivered — without that bit
// her door answers "Get away... Far away from here!" and takes a quarter of the character's hitpoints
// instead of opening, and the doll is on the wrong side of it.
function ibanmultiFor(stage: number): number {
    return stage >= 7 ? UPASS_STARTED_BIT | UPASS_DROPPED_CAT_BIT : UPASS_STARTED_BIT;
}

/**
 * Coins, food, and the kit the module draws from the bank.
 * Why: the bow, arrows, tinderbox, spade, bucket and rope are shop stock the module does not yet buy for
 * itself, and the melee kit is whatever an established account would already own — seeded here, and called out as a
 * gap rather than hidden. A pack short of any of them stops at the cave mouth and says which.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'shortbow', displayName: 'Shortbow', qty: 1 },
    { debugName: 'bronze_arrow', displayName: 'Bronze arrow', qty: 50 },
    { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 },
    { debugName: 'spade', displayName: 'Spade', qty: 1 },
    { debugName: 'bucket_empty', displayName: 'Bucket', qty: 1 },
    { debugName: 'rope', displayName: 'Rope', qty: 3 },
    // Why: the pass is fought through — three paladins at level 62, three demons and Kalrag — and the module
    // wears the best tier the bank holds. Rune is what a 70-defence account would take, in chain and med helm
    // rather than plate and full helm, because those two want Dragon Slayer and this account has not done it.
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_med_helm', displayName: 'Rune med helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

/** Where each seeded stage drops the account, so a leg starts at its own obstacle.
 *  Why: keyed by the `%upass` value itself, and every one of these is the tile that stage's own script
 *  leaves the player on — the pass is sealed pockets, so a tele to the wrong side of a seam is unrecoverable. */
const STAGE_TELE: Record<number, { x: number; z: number; level: number }> = {
    0: ARDOUGNE_BANK,
    1: { x: 2436, z: 3315, level: 0 },
    2: { x: 2442, z: 9716, level: 0 },
    3: { x: 2423, z: 9660, level: 0 },
    // Why: the crushed cage is a 4x3 loc and (2371,9603) is its own origin, so a tele there lands inside the
    // footprint — this is the walkable tile the boulder's telejump leaves the player able to reach.
    4: { x: 2375, z: 9604, level: 0 },
    5: { x: 2173, z: 4725, level: 1 },
    6: { x: 2315, z: 9806, level: 0 },
    // Why: (2157,4564) is the chest's own tile and the pack calls it blocked. This is where leg four
    // ends — shut in Kardia's house, which is the state stage seven has to start from.
    7: { x: 2156, z: 4566, level: 1 },
    8: { x: 2144, z: 4647, level: 1 },
    9: { x: 2482, z: 9607, level: 0 },
    10: ARDOUGNE_BANK
};

// Why: the pass is one-way and has no bank in it, so a leg seeded past the cave mouth cannot go back for
// the kit the module would otherwise withdraw — an inside-the-pass stage is handed its pack directly.
const PACK_SEED: { debugName: string; qty: number }[] = [
    { debugName: 'shortbow', qty: 1 },
    { debugName: 'bronze_arrow', qty: 50 },
    { debugName: 'tinderbox', qty: 1 },
    { debugName: 'spade', qty: 1 },
    { debugName: 'bucket_empty', qty: 1 },
    { debugName: 'rope', qty: 3 },
    { debugName: 'lobster', qty: 14 },
    { debugName: 'rune_scimitar', qty: 1 },
    { debugName: 'rune_chainbody', qty: 1 },
    { debugName: 'rune_platelegs', qty: 1 },
    { debugName: 'rune_med_helm', qty: 1 },
    { debugName: 'rune_kiteshield', qty: 1 }
];

// Why: some things in the pass are handed over by a script that only runs once, so a leg seeded past it
// starts without them. The doll comes out of Kardia's chest and nothing else gives another.
// Why: and stage four needs the horn. `%upass` 3 and 4 print the same journal page, so the module reads
// the pass by what it is carrying — with no horn and no badge it cannot tell "unicorn still alive" from
// "unicorn killed and the horn already spent", and a stage-four start goes back for a railing it used.
const STAGE_PACK: Record<number, string[]> = {
    4: ['cave_unicorn_horn'],
    7: ['ibandoll'],
    8: ['ibandoll'],
    9: ['ibanstaff']
};

async function seedPack(page: Page, stage: number): Promise<void> {
    const extra = STAGE_PACK[stage] ?? [];
    for (const { debugName, qty } of PACK_SEED) {
        await cheatQuiet(page, `give ${debugName} ${qty}`);
    }
    for (const debugName of extra) {
        await cheatQuiet(page, `give ${debugName} 1`);
    }
    await clearChatDialogs(page, 'pack-seed dialog(s)');
    const note = extra.length > 0 ? ` plus ${extra.join(', ')} for stage ${stage}` : '';
    console.log(`pack seeded with ${PACK_SEED.length} item type(s) for an inside-the-pass start${note}`);
}

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

if (args.stage < 0 || args.stage > 10) {
    fail('--stage is the %upass value and runs 0 to 10');
}

// Why: `public/bot` is shared, so another session's deploy landing inside this run's boot window would
// hand it their branch. The isolated client also refuses to start without the collision pack, which is
// what a fresh worktree is missing — the navigator dies on boot and every walk degrades in silence to the
// scene stepper, presenting as a per-destination "unreachable" rather than a missing artefact.
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

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    // Why: Biohazard gates both King Lathas's Underground Pass branch and the cave mouth itself, and it has
    // no module yet — seeding it complete is what makes this quest reachable at all.
    // Why: Plague City is seeded with it. Its dug tunnel is the only way through the Ardougne wall, and the
    // live chain reaches this quest through it, so an unfinished garden is a harness artefact, not a case.
    await cheatQuiet(page, `setvar elenaquest ${PLAGUE_CITY_COMPLETE}`);
    await cheatQuiet(page, `setvar biohazard ${BIOHAZARD_COMPLETE}`);
    const bio = await getServerVarQuiet(page, 'biohazard');
    if (bio !== BIOHAZARD_COMPLETE) {
        fail(`setvar biohazard ${BIOHAZARD_COMPLETE} did not take (read back ${bio})`);
    }

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar upass ${args.stage}`);
        // Why: the started bit is what the journal and the cave mouth read, and a seeded stage without it
        // leaves Koftik refusing entry to a quest the journal says is under way.
        await cheatQuiet(page, `setvar ibanmulti ${ibanmultiFor(args.stage)}`);
        const read = await getServerVarQuiet(page, 'upass');
        if (read !== args.stage) {
            fail(`setvar upass ${args.stage} did not take (read back ${read})`);
        }
        console.log(`upass=${read} ibanmulti=${ibanmultiFor(args.stage)}`);
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_TELE[args.stage] ?? ARDOUGNE_BANK;
    if (args.tele) {
        if (!(await teleTo(page, start, 10, 25_000))) {
            await clearChatDialogs(page, 'pre-tele dialog(s)');
            if (!(await teleTo(page, start, 10, 25_000))) {
                fail(`tele to ${start.x},${start.z} did not arrive`);
            }
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-tele dialog(s)');
        console.log(`start tile → ${start.x},${start.z},${start.level}`);
    }

    const gates = await page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { Quests: { status(n: string): string } } };
        return {
            plague: g.__rs2b0t.Quests.status('Plague City'),
            biohazard: g.__rs2b0t.Quests.status('Biohazard'),
            upass: g.__rs2b0t.Quests.status('Underground Pass')
        };
    });
    console.log(`journal gates → Plague City ${gates.plague}, Biohazard ${gates.biohazard}, Underground Pass ${gates.upass}`);
    if (gates.plague !== 'complete') {
        fail(`Plague City reads ${gates.plague} after the seed — the wall crossing needs its dug tunnel`);
    }
    if (gates.biohazard !== 'complete') {
        fail(`Biohazard reads ${gates.biohazard} after the seed — the prerequisite gate will block the queue`);
    }

    // Why: stage ONE, not two. `STAGE_TELE[1]` is the cave mouth at (2436,3315), which is inside West
    // Ardougne and already past the bank — so a stage-1 start cannot draw the kit and `readyToDescend`
    // parks the queue on an empty pack, which reads as a broken leg rather than a fixture that never
    // handed it anything. Only stage 0 begins where a bank is reachable.
    if (args.stage >= 1) {
        await seedPack(page, args.stage);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'upass'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for %upass to reach ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that redeploys inside this run's boot
        // window hands it their branch — and a queue without this quest spends the budget on somebody else's.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
            console.log(`queue confirmed: ${queue.msg}`);
        }
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                lastLogTime = line.time;
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.level}: ${line.msg}`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'upass')) ?? reached;
        if (stage > reached) {
            reached = stage;
            console.log(`  >> %upass reached ${reached}`);
        }
        if (reached >= args.until || last.status === 'complete') {
            console.log(`PASS (%upass ${reached}, journal ${last.status}, ${Math.round((Date.now() - t0) / 1000)}s)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`the runner stopped at %upass ${reached} — see the log above`);
        }
        await page.waitForTimeout(4_000);
    }
    fail(`timed out at %upass ${reached} after ${args.minutes} minute(s)`);
} finally {
    await browser.close();
}
