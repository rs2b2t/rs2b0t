/** Live Murder Mystery harness (#256): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` writes `%murderquest`, `%murdersus`, `%murder_evidence` and `%murder_poisonproof_progress` together — the guilty sibling is rolled by the guard's own dialogue, so a seeded stage has to name one or every later check reads a quest with no murderer.
 *  Why: the bank holds coins and food alone; the empty pot comes from Arhein in Catherby and every other item from the mansion, and seeding one hides whether the bot can find it. */

//   HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 0 --until 5 --minutes 90 --tick 200
//   HEADED=1 bun e2e/murder-mystery-256-live.ts --stage 2 --until 3 --minutes 40 --tick 200
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
    sus: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `mm${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 5,
        minutes: 90,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        sus: 0,
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
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
        else if (flag === '--sus') { out.sus = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Murder Mystery';
const SEERS_BANK = { x: 2725, z: 3491, level: 0 };
const MANSION_GUARD = { x: 2741, z: 3562, level: 0 };

/**
 * Coins and food only. The pot is Arhein's, the flour, the flypaper, the
 * keepsakes and the dagger are all at the mansion, and banking one would hide
 * whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 20 }
];

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

/** `%murdersus` 1-6, in the order the content's own constants name them. */
const SUSPECTS = ['Anna', 'Bob', 'Carol', 'David', 'Elizabeth', 'Frank'];

/** The thread cut from each suspect's clothes; the window hands out whichever the murderer wears. */
const THREAD = ['murderthreadg', 'murderthreadr', 'murderthreadr', 'murderthreadg', 'murderthreadb', 'murderthreadb'];

/** The keepsake in each suspect's barrel. Holding the murderer's is how the module names them again after a restart. */
const KEEPSAKE = ['murdernecklace', 'murdercup', 'murderbottle', 'murderbook', 'murderneedle', 'murderpot'];

/** `^murder_found_thread` and `^murder_found_fingerprints` are bit indexes, so the values are 2 and 4. */
const EVIDENCE_THREAD = 2;
const EVIDENCE_PRINTS = 4;

/**
 * Legs, not the raw varp: `%murderquest` only knows started and complete, and
 * the three pieces of evidence live in two other variables.
 */
const LEG = { NOT_STARTED: 0, STARTED: 1, THREAD: 2, PRINTS: 3, POISON: 4, COMPLETE: 5 } as const;

function evidenceFor(stage: number): number {
    if (stage >= LEG.PRINTS) { return EVIDENCE_THREAD | EVIDENCE_PRINTS; }
    return stage >= LEG.THREAD ? EVIDENCE_THREAD : 0;
}

function itemsFor(stage: number, sus: number): string[] {
    const thread = THREAD[sus - 1];
    if (stage >= LEG.PRINTS) { return [thread, 'murderfingerprint', KEEPSAKE[sus - 1]]; }
    return stage >= LEG.THREAD ? [thread] : [];
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

async function readLeg(page: Page): Promise<number> {
    const quest = (await getServerVarQuiet(page, 'murderquest')) ?? 0;
    if (quest >= 2) { return LEG.COMPLETE; }
    if (quest === 0) { return LEG.NOT_STARTED; }
    const poison = (await getServerVarQuiet(page, 'murder_poisonproof_progress')) ?? 0;
    if (poison >= 3) { return LEG.POISON; }
    const evidence = (await getServerVarQuiet(page, 'murder_evidence')) ?? 0;
    if (evidence & EVIDENCE_PRINTS) { return LEG.PRINTS; }
    return evidence & EVIDENCE_THREAD ? LEG.THREAD : LEG.STARTED;
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

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Seers' Village bank`);
    await seedItemsToBank(page, BANK_SEED, SEERS_BANK);

    if (args.stage > 0) {
        const sus = args.sus > 0 ? args.sus : 1 + Math.floor(Math.random() * SUSPECTS.length);
        const evidence = evidenceFor(args.stage);
        const poison = args.stage >= LEG.POISON ? 3 : 0;
        await cheatQuiet(page, 'setvar murderquest 1');
        await cheatQuiet(page, `setvar murdersus ${sus}`);
        await cheatQuiet(page, `setvar murder_evidence ${evidence}`);
        await cheatQuiet(page, `setvar murder_poisonproof_progress ${poison}`);
        const readQuest = await getServerVarQuiet(page, 'murderquest');
        const readSus = await getServerVarQuiet(page, 'murdersus');
        const readEvidence = await getServerVarQuiet(page, 'murder_evidence');
        const readPoison = await getServerVarQuiet(page, 'murder_poisonproof_progress');
        console.log(`murderquest=${readQuest} murdersus=${readSus} (${SUSPECTS[sus - 1]})`
            + ` murder_evidence=${readEvidence} murder_poisonproof_progress=${readPoison}`);
        if (readQuest !== 1 || readSus !== sus || readEvidence !== evidence || readPoison !== poison) {
            fail('setvar did not take — the seeded stage and the world disagree');
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
        for (const item of itemsFor(args.stage, sus)) {
            await cheatQuiet(page, `give ${item} 1`);
            console.log(`  gave ${item}`);
        }
    }

    const start = args.stage >= LEG.PRINTS ? MANSION_GUARD : SEERS_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'murder'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for leg >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the isolated client removes the race, so a queue line without this quest is
        // this run's own deploy failing rather than a neighbour's landing on top of it.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the client at ${clientPage} has no ${QUEST} — this run's deploy did not land`);
            }
        }
        const leg = await readLeg(page);
        reached = Math.max(reached, leg);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` leg=${leg} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the quest-complete
        // recolour and the QP award land a tick behind %murderquest.
        const done = args.until >= LEG.COMPLETE ? last.status === 'complete' : leg >= args.until;
        if (done) {
            console.log(`PASS (leg=${leg}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at leg=${leg} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`leg reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
