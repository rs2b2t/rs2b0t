/** Live Regicide harness (#257): --stage N --until N --minutes N, base :8890.
 *  Why: `%regicide_quest` and `%regicide_bits` are both `scope=perm` with no `transmit`, so the bot reads its
 *  own stage off the journal — the harness seeds the varp and relogs, because `~update_questlist` only
 *  recolours the list at login.
 *  Why: Underground Pass is seeded complete varp AND bits. The bits matter as much as the stage: `cave_well`
 *  only descends with all four orb bits set and the temple doors only open with the three badges and the
 *  horn thrown, and this quest walks back through both of them to reach the Well of Voyage.
 *  Why: stats are 70 across the board and the bank holds coins, Sharks and armour alone — the wool, the
 *  pickaxe and the pestle are bought by the module, and every quest item is sourced in the world. */

//   HEADED=1 bun e2e/regicide-257-live.ts --stage 0 --until 2 --minutes 25 --tick 150
//   HEADED=1 bun e2e/regicide-257-live.ts --stage 3 --until 8 --minutes 30 --tick 150
//   HEADED=1 bun e2e/regicide-257-live.ts --stage 11 --until 12 --minutes 60 --tick 150
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
    /** `--give obj:qty,obj:qty` — extra pack items, for starting a leg mid-chain. */
    give: { debugName: string; qty: number }[];
    /** `--start x,z,level` — overrides the stage's own start tile. */
    start: { x: number; z: number; level: number } | null;
    // Why: the bomb is a dozen steps that move no varp at all — the stage only advances when the catapult
    // fires. An obj id is what a leg in the middle of the chain can be judged on.

    /** `--until-obj <id>` — pass as soon as this obj id is in the pack. */
    untilObj: number | null;
    /** `--no-pack` — skip the standing kit, for a leg that brings its own with `--give`. */
    pack: boolean;
}

function parseGive(value: string): { debugName: string; qty: number }[] {
    return value
        .split(',')
        .filter(entry => entry.length > 0)
        .map(entry => {
            const [debugName, qty] = entry.split(':');
            return { debugName: debugName!, qty: Number(qty ?? 1) };
        });
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `rg${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 15,
        minutes: 60,
        tickMs: 300,
        food: 'Shark',
        stats: 70,
        tele: true,
        deploy: true,
        give: [],
        start: null,
        untilObj: null,
        pack: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-tele') { out.tele = false; continue; }
        if (flag === '--no-pack') { out.pack = false; continue; }
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
        else if (flag === '--give') { out.give = parseGive(value); }
        else if (flag === '--until-obj') { out.untilObj = Number(value); }
        else if (flag === '--start') {
            const [x, z, level] = value.split(',').map(Number);
            out.start = { x: x!, z: z!, level: level ?? 0 };
        }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Regicide';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const ISAFDAR_ENTRY = { x: 2312, z: 3216, level: 0 };
const BIOHAZARD_COMPLETE = 16;
const PLAGUE_CITY_COMPLETE = 29;
const UPASS_COMPLETE = 10;
// Why: bits 0-21 of `%ibanmulti`, which is every orb burned, every badge and the horn thrown into the blood
// well, and the doll finished. The pass is walked again on the way in, and those bits are what keep its two
// hard gates — `cave_well` and the temple doors — open for an account that has already finished it.
const IBANMULTI_ALL = (1 << 22) - 1;

const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'shark', displayName: 'Shark', qty: 40 },
    // Why: rune chain and med helm rather than plate and full helm — those two want Dragon Slayer, which
    // this account has not done, and `Equipment.equip` refuses them silently.
    // Why: no shop this side of the map stocks a spade, and the pass has one way out of the slave cages.
    { debugName: 'spade', displayName: 'Spade', qty: 1 },
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
 *  Why: keyed by the `%regicide_quest` value itself. Stage 2 starts on the mainland because that is the leg
 *  that walks the pass; everything from the scouts to the catapult starts on the Isafdar forest floor. */
const STAGE_TELE: Record<number, { x: number; z: number; level: number }> = {
    0: ARDOUGNE_BANK,
    1: ARDOUGNE_BANK,
    2: ARDOUGNE_BANK,
    3: ISAFDAR_ENTRY,
    4: { x: 2205, z: 3252, level: 0 },
    5: { x: 2257, z: 3149, level: 0 },
    6: { x: 2257, z: 3149, level: 0 },
    7: { x: 2240, z: 3151, level: 0 },
    8: { x: 2257, z: 3149, level: 0 },
    9: { x: 2231, z: 3149, level: 0 },
    10: { x: 2188, z: 3162, level: 0 },
    11: { x: 2205, z: 3252, level: 0 },
    12: { x: 2183, z: 3185, level: 0 },
    13: { x: 2205, z: 3252, level: 0 },
    14: ARDOUGNE_BANK,
    15: ARDOUGNE_BANK
};

// Why: Tirannwn has one shop and no bank, and the way back out is the Arandar palisade — a stage seeded
// inside the forest cannot walk back for the kit the module would otherwise buy in Ardougne.
// Why: armour first, and the seed sized to the pack. `give` into a full pack is silent, so the old
// order — food before armour, thirty slots into twenty-eight — dropped the med helm and the kiteshield on
// every seeded run from stage 3 to 13, and the level-110 halberdier was fought two pieces down with nothing
// in the log to say so.
const PACK_SEED: { debugName: string; qty: number; slots: number }[] = [
    { debugName: 'rune_scimitar', qty: 1, slots: 1 },
    { debugName: 'rune_chainbody', qty: 1, slots: 1 },
    { debugName: 'rune_platelegs', qty: 1, slots: 1 },
    { debugName: 'rune_med_helm', qty: 1, slots: 1 },
    { debugName: 'rune_kiteshield', qty: 1, slots: 1 },
    { debugName: 'ball_of_wool', qty: 4, slots: 4 },
    { debugName: 'pestle_and_mortar', qty: 1, slots: 1 },
    { debugName: 'bronze_pickaxe', qty: 1, slots: 1 },
    // Why: the rope swing onto the grid shelf is the pass's one item-use seam, and a stage seeded inside
    // Tirannwn still needs them for the walk back in with the bomb.
    { debugName: 'rope', qty: 3, slots: 3 },
    // Why: the chasm before it is shot down with a fire arrow, and `upass_bridge` keeps no state — a seeded
    // start still builds the arrow on every westbound walk.
    { debugName: 'shortbow', qty: 1, slots: 1 },
    { debugName: 'bronze_arrow', qty: 50, slots: 1 },
    { debugName: 'tinderbox', qty: 1, slots: 1 },
    { debugName: 'spade', qty: 1, slots: 1 },
    // Why: ten rather than the module's float of twelve, because five worn pieces have to fit alongside the
    // kit before the bot has had a tick to put any of them on.
    { debugName: 'shark', qty: 10, slots: 10 }
];

// Why: stages 13 and 14 carry Iorwerth's letter and nothing else does. `[zone,0_40_51_24_32]` only queues
// Arianwyn while `inv_total(inv, regicide_iorwerth_message) > 0`, and stage 14 hands that same scroll to King
// Lathas — so a seeded leg without it walks the Ardougne road forever and parks. One shark pays for the slot.
const LETTER_FROM_STAGE = 13;

function packSeedFor(stage: number): { debugName: string; qty: number; slots: number }[] {
    if (stage < LETTER_FROM_STAGE) {
        return [...PACK_SEED];
    }
    return [
        ...PACK_SEED.map(item => (item.debugName === 'shark' ? { ...item, qty: item.qty - 1, slots: item.slots - 1 } : item)),
        { debugName: 'regicide_iorwerth_message', qty: 1, slots: 1 }
    ];
}

async function seedPack(page: Page, stage: number): Promise<void> {
    const seed = packSeedFor(stage);
    const slots = seed.reduce((n, item) => n + item.slots, 0);
    if (slots > 28) {
        fail(`pack seed wants ${slots} slots and the pack holds 28 — trim it rather than letting give drop the tail`);
    }
    for (const { debugName, qty } of seed) {
        await cheatQuiet(page, `give ${debugName} ${qty}`);
    }
    await clearChatDialogs(page, 'pack-seed dialog(s)');
    const held = (await snapshot(page)).packIds.length;
    if (held !== slots) {
        fail(`pack seed wanted ${slots} slots and the pack holds ${held} — a give was refused, so the run would start short of its kit`);
    }
    console.log(`pack seeded with ${seed.length} item type(s) in ${slots} slots for a start inside Tirannwn`);
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
    packIds: number[];
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
                Inventory: { items(): { id: number }[] };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            packIds: g.__rs2b0t.Inventory.items().map(item => item.id),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

if (args.stage < 0 || args.stage > 15) {
    fail('--stage is the %regicide_quest value and runs 0 to 15');
}

// Why: `public/bot` is shared, so another session's deploy landing inside this run's boot window would hand
// it their branch. The isolated client also refuses to start without the collision pack, which is what a
// fresh worktree is missing — and this quest derives its route table from that pack.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';
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

    await cheatQuiet(page, `setvar elenaquest ${PLAGUE_CITY_COMPLETE}`);
    await cheatQuiet(page, `setvar biohazard ${BIOHAZARD_COMPLETE}`);
    await cheatQuiet(page, `setvar upass ${UPASS_COMPLETE}`);
    await cheatQuiet(page, `setvar ibanmulti ${IBANMULTI_ALL}`);
    const upass = await getServerVarQuiet(page, 'upass');
    if (upass !== UPASS_COMPLETE) {
        fail(`setvar upass ${UPASS_COMPLETE} did not take (read back ${upass})`);
    }

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar regicide_quest ${args.stage}`);
        const read = await getServerVarQuiet(page, 'regicide_quest');
        if (read !== args.stage) {
            fail(`setvar regicide_quest ${args.stage} did not take (read back ${read})`);
        }
        console.log(`regicide_quest=${read}`);
    }
    // Why: the King's messenger is armed by `start_king_messenger_timer` at LOGIN, and a stage seeded past
    // him needs the quest list recoloured — so the relog serves both.
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = args.start ?? STAGE_TELE[args.stage] ?? ARDOUGNE_BANK;
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
            upass: g.__rs2b0t.Quests.status('Underground Pass'),
            regicide: g.__rs2b0t.Quests.status('Regicide')
        };
    });
    console.log(`journal gates → Plague City ${gates.plague}, Biohazard ${gates.biohazard}, Underground Pass ${gates.upass}, Regicide ${gates.regicide}`);
    if (gates.upass !== 'complete') {
        fail(`Underground Pass reads ${gates.upass} after the seed — Regicide will report BLOCKED`);
    }

    // Why: from stage 2, not stage 3. Stage 2 is the walk through the Underground Pass, and its leg starts at
    // the Ardougne bank where `outfit` would otherwise buy the kit first — seven minutes of Taverley and
    // Catherby before the leg reaches the thing it is testing. Stages 0 and 1 already prove the shopping.
    // Why: 14 is the last that still needs a pack — it walks to King Lathas with Iorwerth's letter.
    if (args.pack && args.stage >= 2 && args.stage <= 14) {
        await seedPack(page, args.stage);
    }
    // Why: the bomb is a dozen steps in three regions, so a leg part-way along it has to be handed the
    // pack that leg starts from — there is no varp that records how far the chemistry has got.
    if (args.give.length > 0) {
        for (const { debugName, qty } of args.give) {
            await cheatQuiet(page, `give ${debugName} ${qty}`);
        }
        await clearChatDialogs(page, 'give dialog(s)');
        console.log(`gave ${args.give.map(g => `${g.debugName} x${g.qty}`).join(', ')}`);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'regicide'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for %regicide_quest to reach ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    // Why: keyed on the line, not on its timestamp. The ring stamps milliseconds, and `time > lastLogTime`
    // drops every line after the first whenever a step logs a burst inside one tick — which is what a
    // diagnostic is. The quest module's own `observe` writes three lines and only the first ever reached this
    // log, so a parked leg looked like it had one thing to say when it had three.
    const printed = new Set<string>();
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
            console.log(`queue confirmed: ${queue.msg}`);
        }
        for (const line of last.logs) {
            const key = `${line.time}|${line.msg}`;
            if (printed.has(key)) {
                continue;
            }
            printed.add(key);
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.level}: ${line.msg}`);
        }
        // Why: the ring the snapshot reads is the last eighty lines, so anything older cannot come back.
        if (printed.size > 4_000) {
            printed.clear();
        }
        const stage = (await getServerVarQuiet(page, 'regicide_quest')) ?? reached;
        if (stage > reached) {
            reached = stage;
            console.log(`  >> %regicide_quest reached ${reached}`);
        }
        if (args.untilObj !== null && last.packIds.includes(args.untilObj)) {
            console.log(`PASS (obj ${args.untilObj} in the pack, %regicide_quest ${reached}, ${Math.round((Date.now() - t0) / 1000)}s)`);
            process.exit(0);
        }
        if (reached >= args.until || last.status === 'complete') {
            console.log(`PASS (%regicide_quest ${reached}, journal ${last.status}, ${Math.round((Date.now() - t0) / 1000)}s)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`the runner stopped at %regicide_quest ${reached} — see the log above`);
        }
        await page.waitForTimeout(4_000);
    }
    fail(`timed out at %regicide_quest ${reached} after ${args.minutes} minute(s)`);
} finally {
    await browser.close();
}
