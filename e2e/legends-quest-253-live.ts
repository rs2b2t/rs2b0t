/** Live Legends Quest harness (#253), using the members world at :8890. */
// Why: stage jumps relog because the module reads the quest tab.
// Prerequisite varps are seeded because Heroes' Quest and Underground Pass have no module yet.

//   HEADED=1 bun e2e/legends-quest-253-live.ts --stage 0 --minutes 180          # full run
//   HEADED=1 bun e2e/legends-quest-253-live.ts --stage 8 --until 12 --kit       # one leg, pre-kitted
//   HEADED=1 bun e2e/legends-quest-253-live.ts --stage 7 --until 8 --nobits      # the recovery a resume needs
//   HEADED=1 bun e2e/legends-quest-253-live.ts --stage 8 --until 10 --prayer 99  # the trance at its worst odds
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

/** The quest's own requirements, as `legends_journal.rs2` renders them, at the level under test. */
const STAT_LEVEL = 70;

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    /** Seed the gems, gold bars and papyrus the module would otherwise mine and buy. */
    kit: boolean;
// Why: stage 7 omits `asked_ungadulu_who` when testing the missing-topic recovery.

    /** Prayer to seed, apart from the rest. Gujuo's trance is hardest on a devout account. */
    prayer: number;

    /** Leave `%legends_bits` clear, to test the recovery a resume needs. */
    noBits: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `lq${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 75,
        minutes: 180,
        tickMs: 300,
        kit: false,
        prayer: STAT_LEVEL,
        noBits: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        // Why: these two take no value, so reading one first eats the next flag and drops both when they come last.
        if (flag === '--kit') { out.kit = true; continue; }
        if (flag === '--nobits') { out.noBits = true; continue; }
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--prayer') { out.prayer = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Legends Quest';
// Why: Karamja has no bank in this content, so the quest's own float sits in Ardougne West.
const ARDOUGNE_BANK = { x: 2616, z: 3332, level: 0 };

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

// Why: the Legends guard reads five quest varps and the quest-point total before he will open the gate, and two of those quests have no module yet.
const PREREQ_QUESTS: readonly [string, number][] = [
    ['crestquest', 11],
    ['heroquest', 15],
    ['zombiequeen', 15],
    ['upass', 10],
    ['waterfall_quest', 10],
    ['junglepotion', 12],
    ['druidquest', 4]
];

/** Nothing in the game sells any of these, plus the float, the food and the melee kit.
 *  Why: the seven gems have no counter and the rocks that drop them sit behind Vigroy's cart, so they are bank items like the other four. */
// Why: a death drops everything but three items, and the descent consumables are the ones a resumed run cannot buy, so the bank holds enough of them to survive one.
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'rune_axe', displayName: 'Rune axe', qty: 3 },
    { debugName: 'lockpick', displayName: 'Lockpick', qty: 4 },
    { debugName: 'stafforb', displayName: 'Unpowered orb', qty: 6 },
    { debugName: 'cosmicrune', displayName: 'Cosmic rune', qty: 30 },
    { debugName: 'opal', displayName: 'Opal', qty: 1 },
    { debugName: 'jade', displayName: 'Jade', qty: 1 },
    { debugName: 'red_topaz', displayName: 'Red topaz', qty: 1 },
    { debugName: 'sapphire', displayName: 'Sapphire', qty: 1 },
    { debugName: 'emerald', displayName: 'Emerald', qty: 1 },
    { debugName: 'ruby', displayName: 'Ruby', qty: 1 },
    { debugName: 'diamond', displayName: 'Diamond', qty: 1 },
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'shark', displayName: 'Shark', qty: 200 },
    { debugName: '4doseprayerrestore', displayName: 'Prayer potion(4)', qty: 8 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 },
    { debugName: 'amulet_of_glory', displayName: 'Amulet of glory', qty: 1 },
    { debugName: 'rune_pickaxe', displayName: 'Rune pickaxe', qty: 3 }
];

/** `--kit`: what the module mines and buys for itself, skipped so a stage leg is the thing under test. */
const KIT_SEED: BankSeedItem[] = [
    { debugName: 'gold_bar', displayName: 'Gold bar', qty: 4 },
    { debugName: 'papyrus', displayName: 'Papyrus', qty: 10 },
    { debugName: 'charcoal', displayName: 'Charcoal', qty: 10 },
    { debugName: 'machette', displayName: 'Machete', qty: 3 },
    { debugName: 'knife', displayName: 'Knife', qty: 2 },
    { debugName: 'rope', displayName: 'Rope', qty: 5 },
    { debugName: 'hammer', displayName: 'Hammer', qty: 2 },
    { debugName: 'chisel', displayName: 'Chisel', qty: 2 },
    { debugName: 'vial_water', displayName: 'Vial of water', qty: 2 },
    { debugName: 'soulrune', displayName: 'Soul rune', qty: 2 },
    { debugName: 'mindrune', displayName: 'Mind rune', qty: 2 },
    { debugName: 'earthrune', displayName: 'Earth rune', qty: 2 },
    { debugName: 'lawrune', displayName: 'Law rune', qty: 6 },
    { debugName: 'waterrune', displayName: 'Water rune', qty: 300 }
];

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: ARDOUGNE_BANK,
    50: ARDOUGNE_BANK,
    55: ARDOUGNE_BANK,
    60: ARDOUGNE_BANK,
    65: ARDOUGNE_BANK,
    70: ARDOUGNE_BANK
};

// Why: a stage jump describes a state the quest reached, and half that state is in the pack, the notes, the bowl, the seeds, the totem.
// Why: seeding past a hand-over without the item it produced describes a state the quest can never be in, and the module then repeats a leg it cannot finish.

/** What the pack must hold for a `--stage` jump to describe a reachable state. */
const STAGE_GIVE: readonly { from: number; to: number; items: readonly [string, number][] }[] = [
    { from: 1, to: 1, items: [['thkaramjamap', 1], ['machette', 1], ['rune_axe', 1], ['papyrus', 6], ['charcoal', 6]] },
    { from: 2, to: 2, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1]] },
    { from: 3, to: 7, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1]] },
    { from: 8, to: 8, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlpic', 1]] },
    // Why: `jungle_tree` boils the bowl dry on every chop, so a jump that starts off the island can only ever be handed the empty one.
    { from: 10, to: 11, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1]] },
    { from: 12, to: 12, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1]] },
    { from: 13, to: 15, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1], ['yommiseeds_germ', 3]] },
    { from: 16, to: 19, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1], ['yommiseeds_germ', 3]] },
    // Why: stage 20 is the varp Echned moves when he hands the dagger over, so a jump to it without one describes a state the quest cannot be in.
    { from: 20, to: 22, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1], ['yommiseeds_germ', 3], ['deathdagger', 1]] },
    { from: 25, to: 25, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['goldbowlbless_empty', 1], ['yommiseeds_germ', 3]] },
    { from: 30, to: 32, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['thtotempole', 1]] },
    { from: 35, to: 40, items: [['thkaramjamapcomp', 1], ['machette', 1], ['rune_axe', 1], ['bullroarer', 1], ['thtotempole', 1]] },
    { from: 45, to: 45, items: [['thkaramjamapcomp', 1], ['thtotempolegift', 1]] }
];

// Why: half of what a stage means lives in `%legends_bits` rather than in items, which questions Ungadulu answered, whether the potion was drunk, whether the rope is on the winch.
// Why: a jump that leaves them clear describes a state the quest can never be in, and the module then asks Gujuo for a topic he will never offer.
const BIT_ENTERED_CAVERN = 1 << 3;
const BIT_ASKED_WHERE = 1 << 4;
const BIT_ASKED_WHO = 1 << 5;
const BIT_CALLED_VACU = 1 << 6;
// Why: the five marked-wall bits stay set for the rest of the quest, which is what lets a second descent cross the wall with a plain Use rather than five more runes.
const BIT_WALL_RUNES = (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11);
const BIT_TIED_ROPE = 1 << 24;
const BIT_DRANK_BRAVERY = 1 << 25;

function bitsFor(stage: number): number {
    let bits = 0;
    if (stage >= 7) {
        bits |= BIT_ENTERED_CAVERN | BIT_ASKED_WHERE | BIT_ASKED_WHO | BIT_CALLED_VACU;
    }
    if (stage >= 12) {
        bits |= BIT_WALL_RUNES;
    }
    if (stage >= 16) {
        bits |= BIT_TIED_ROPE | BIT_DRANK_BRAVERY;
    }
    return bits;
}

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    step: string | null;
    logs: { time: number; level: string; msg: string }[];
};

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: {
                runner: {
                    state: string;
                    bot: { stepDesc?: string } | null;
                    ctx?: { log?: { time: number; level: string; msg: string }[] };
                };
            };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            step: g.rs2b0t.runner.bot?.stepDesc ?? null,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

// Why: this run gets its own copy of the client, so a neighbouring harness deploying mid-boot cannot decide which branch this one exercises.
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

    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('legends');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no Legends Quest — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    // Why: `setstat` is a built-in branch with no level-up cascade, so unlike ~maxme it leaves the player undelayed and the next command lands.
    for (const stat of STATS) {
        await cheatQuiet(page, `setstat ${stat} ${stat === 'prayer' ? args.prayer : STAT_LEVEL}`);
    }
    await clearChatDialogs(page, 'level dialog(s)');
    // Why: Gujuo's trance climbs about 1.73 for every point of prayer and true is the miss, so the blessing is hardest on a devout account, a fixed seventy tests neither the forty-two the quest asks for nor the ninety-nine that misses ninety-eight times in a hundred.
    console.log(`stats: every skill at ${STAT_LEVEL}, prayer at ${args.prayer}`);

    const seed = args.kit ? [...BANK_SEED, ...KIT_SEED] : BANK_SEED;
    console.log(`seeding ${seed.length} item type(s) into the Ardougne bank`);
    await seedItemsToBank(page, seed, ARDOUGNE_BANK);

    for (const [varp, value] of PREREQ_QUESTS) {
        await cheatQuiet(page, `setvar ${varp} ${value}`);
    }
    if (args.stage > 0) {
        await cheatQuiet(page, `setvar legendsquest ${args.stage}`);
        const bits = args.noBits ? 0 : bitsFor(args.stage);
        if (args.noBits) {
            console.log('  legends_bits left clear (--nobits) — the module has to recover them itself');
        }
        if (bits > 0) {
            await cheatQuiet(page, `setvar legends_bits ${bits}`);
        }
        const give = STAGE_GIVE.find(row => args.stage >= row.from && args.stage <= row.to);
        for (const [debugName, qty] of give?.items ?? []) {
            await cheatQuiet(page, `give ${debugName} ${qty}`);
            console.log(`  gave ${debugName}:${qty}`);
        }
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    // Why: `update_questlist` runs at login and recomputes `%qp` from the quest varps, so a total set before the relog is thrown away, the seven cheated quests are worth eleven points between them.
    await cheatQuiet(page, 'setvar qp 107');

    const qp = await getServerVarQuiet(page, 'qp');
    const stage = await getServerVarQuiet(page, 'legendsquest');
    console.log(`prereqs set — qp=${qp} legendsquest=${stage}`);

    // Why: eligibility reads the quest tab, not the varps, so a varp that took and a row that stayed red look identical from the server side.
    const tab = await page.evaluate(names => {
        const g = globalThis as never as { __rs2b0t: { Quests: { status(n: string): string } } };
        return names.map(n => `${n}=${g.__rs2b0t.Quests.status(n)}`).join(' ');
    }, ["Hero's Quest", 'Underground Pass', 'Family Crest', 'Shilo Village', 'Waterfall Quest']);
    console.log(`quest tab — ${tab}`);
    for (const [varp] of PREREQ_QUESTS) {
        const value = await getServerVarQuiet(page, varp);
        console.log(`  ${varp}=${value}`);
    }
    if ((qp ?? 0) < 107) {
        fail(`qp read back ${qp}, the Legends guard wants 107`);
    }
    if (args.stage > 0 && stage !== args.stage) {
        fail(`setvar legendsquest ${args.stage} did not take (read back ${stage})`);
    }

    const start = STAGE_START[args.stage] ?? ARDOUGNE_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'legends'));
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', 'Shark'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for legendsquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let stepFails = 0;
    let reached = args.stage;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const now = (await getServerVarQuiet(page, 'legendsquest')) ?? -1;
        reached = Math.max(reached, now);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` legendsquest=${now} journal=${last.status} qp=${last.qp} runner=${last.runner} step=${last.step ?? '-'}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                // Why: a leg watches `%legendsquest`, and a stage can move on a step that failed, `gujuo_pure_water` sets stage 8 before the branch that hands over the sketch, so a run printed PASS having failed the same step four times and come away without the item the next stage needs. The tally is not a verdict; it is the number that made that run look green.
                if (l.msg.includes('→ FAILED in ')) {
                    stepFails += 1;
                }
                console.log(`      · [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: `update_questlist` recomputes `%qp` from the quest varps whenever the client rebuilds the tab, and this account has fifteen quests' worth rather than the hundred and seven the guard wants.
        // Why: the module only reads it when it parks and re-checks eligibility, which is when a drifted value blocks the quest for good.
        if (last.qp < 107) { await cheatQuiet(page, 'setvar qp 107'); }

        // Why: the quest-complete recolour and the QP award land a tick behind `%legendsquest`, so a full run waits on the journal.
        const done = args.until >= 75 ? last.status === 'complete' : now >= args.until;
        if (done) {
            const fails = stepFails > 0 ? `, ${stepFails} step failure${stepFails === 1 ? '' : 's'}` : '';
            console.log(`PASS (legendsquest=${now}, journal=${last.status}, QP=${last.qp}${fails})`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at legendsquest=${now} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`legendsquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
