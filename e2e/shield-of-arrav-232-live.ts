/** Live single-gang Shield of Arrav harness (#232), using the content world at :8890. */
// Why: Phoenix and Black Arm use independent varps; only coins and food are seeded.
// A solo account cannot redeem both halves. Use the pair harness for completion.

//   HEADED=1 bun e2e/shield-of-arrav-232-live.ts --gang phoenix --phoenix 0 --until 9 --tick 300 --minutes 45
//   HEADED=1 bun e2e/shield-of-arrav-232-live.ts --gang blackarm --blackarm 2 --until 3 --tick 300 --minutes 30
//   HEADED=1 bun e2e/shield-of-arrav-232-live.ts --gang phoenix --phoenix 9 --keep-half --tick 300 --minutes 12
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
    gang: 'phoenix' | 'blackarm';
    phoenix: number;
    blackarm: number;
    until: number;
    /** Assert the gang's shield half lands in the pack, rather than a varp reaching `until`. */
    wantHalf: boolean;
    /** Seed the half and the store key into the pack, then prove the run never banks them. */
    keepHalf: boolean;
    minutes: number;
    tickMs: number;
    stats: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `soa${Date.now().toString(36).slice(-7)}`,
        gang: 'phoenix',
        phoenix: 0,
        blackarm: 0,
        until: 9,
        wantHalf: false,
        keepHalf: false,
        minutes: 45,
        tickMs: 300,
        stats: 99,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--want-half') { out.wantHalf = true; continue; }
        if (flag === '--keep-half') { out.keepHalf = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--gang') { out.gang = value === 'blackarm' ? 'blackarm' : 'phoenix'; }
        else if (flag === '--phoenix') { out.phoenix = Number(value); }
        else if (flag === '--blackarm') { out.blackarm = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Shield of Arrav';
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };

/**
 * Coins and food only. The book, the 20gp bribe, the report, the crossbows and
 * both shield halves all have sources in the world, and banking one would hide
 * whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
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

/** Object ids: Broken shield names both halves, so the pack is read by id. */
const SHIELD_PHOENIX = 763;
const SHIELD_BLACKARM = 765;

/** phoenixkey2, the weapon-store key Straven issues once and never re-issues while a copy sits in the bank. */
const STORE_KEY = 759;

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    halves: number;
    keys: number;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page, halfId: number): Promise<Snapshot> {
    return page.evaluate(([quest, wanted, keyId]) => {
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
            halves: g.__rs2b0t.Inventory.countById(wanted as number),
            keys: g.__rs2b0t.Inventory.countById(keyId as number),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, [QUEST, halfId, STORE_KEY] as const);
}

/** Debug names of the items the server hands out once and never re-issues while a copy sits in the bank. */
const PACK_SEED: Record<'phoenix' | 'blackarm', { debugName: string; id: number }[]> = {
    phoenix: [{ debugName: 'arravshield1', id: SHIELD_PHOENIX }, { debugName: 'phoenixkey2', id: STORE_KEY }],
    blackarm: [{ debugName: 'arravshield2', id: SHIELD_BLACKARM }]
};

/** Put the irreplaceable items in the pack, which is the state a resumed session starts in. */
async function seedPack(page: Page, items: readonly { debugName: string; id: number }[]): Promise<void> {
    for (const it of items) {
        for (const cmd of [`give ${it.debugName} 1`, `~item ${it.debugName} 1`]) {
            await cheatQuiet(page, cmd);
            const held = await page.evaluate(
                id => (globalThis as never as { __rs2b0t: { Inventory: { countById(i: number): number } } })
                    .__rs2b0t.Inventory.countById(id),
                it.id
            );
            if (held > 0) {
                console.log(`  pack ${it.debugName} (${it.id}) x${held} via '${cmd.split(' ')[0]}'`);
                break;
            }
        }
    }
}

async function seedVar(page: Page, name: string, want: number): Promise<void> {
    await cheatQuiet(page, `setvar ${name} ${want}`);
    const set = await getServerVarQuiet(page, name);
    console.log(`${name}=${set}`);
    if (set !== want) {
        fail(`setvar ${name} ${want} did not take (read back ${set})`);
    }
}

// Why: `public/bot` is shared by every worktree, so a concurrent deploy landing in the boot window
// replaces navworker.js too, and this run then routes on somebody else's transport graph while still
// printing this quest's queue. An isolated copy removes the race rather than detecting it.
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
    console.log(`mainland-ready as '${args.user}' on ${clientPage}`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    // Why: a Black Arm account needs a weapon-store key it has no way to obtain alone, only Straven issues one, and joining Phoenix makes Katrine refuse you.
    // Why: it goes through seedItemsToBank rather than a bare `givebank`, because this engine answers only `~bankitem` and a bare cheat fails silently.
    const seed = args.gang === 'blackarm'
        ? [...BANK_SEED, { debugName: 'phoenixkey2', displayName: 'Key', qty: 1 }]
        : BANK_SEED;
    if (args.gang === 'blackarm') {
        console.log('SEEDING phoenixkey2, a lone Black Arm account cannot source one, so this run is not self-sufficient');
    }
    console.log(`seeding ${seed.length} item type(s) into the Varrock West bank`);
    await seedItemsToBank(page, seed, VARROCK_WEST_BANK);

    // Why: `~completequests` opens a gang-choice dialog nothing here answers and completes nothing (see e2e/dragonslayer-solo-test.ts), so both varps are set one at a time.
    if (args.phoenix > 0 || args.blackarm > 0) {
        await seedVar(page, 'phoenixgang', args.phoenix);
        await seedVar(page, 'blackarmgang', args.blackarm);
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
            fail(`tele to ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile -> ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z},${VARROCK_WEST_BANK.level}`);

    // Why: the reported wedge is a resumed session, so the pack has to hold the half and the key before the script starts.
    if (args.keepHalf) {
        await seedPack(page, PACK_SEED[args.gang]);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'blackarmgang'));
    await page.evaluate(g => sessionStorage.setItem('rs2b0t:set:AIOQuester:arravGang', g), args.gang);
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:arravPartner', ''));
    await startScript(page, 'AIOQuester');

    const varp = args.gang === 'phoenix' ? 'phoenixgang' : 'blackarmgang';
    const halfId = args.gang === 'phoenix' ? SHIELD_PHOENIX : SHIELD_BLACKARM;
    const watching = args.keepHalf
        ? `an honest park with the Broken shield (${halfId}) still in the pack`
        : args.wantHalf ? `a Broken shield (${halfId}) in the pack` : `${varp} >= ${args.until}`;
    console.log(`started AIOQuester as ${args.gang}, watching for ${watching}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let sawOurBuild = false;
    let parked = '';
    while (Date.now() < deadline) {
        const last = await snapshot(page, halfId);
        const phoenix = (await getServerVarQuiet(page, 'phoenixgang')) ?? -1;
        const blackarm = (await getServerVarQuiet(page, 'blackarmgang')) ?? -1;
        const stage = args.gang === 'phoenix' ? phoenix : blackarm;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` phoenixgang=${phoenix} blackarmgang=${blackarm} halves=${last.halves} keys=${last.keys}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                console.log(`      . [${l.level}] ${l.msg}`);
                // Why: public/bot is shared, so another session's deploy can land inside the boot window and the run silently exercises their branch.
                if (l.msg.includes('Shield of Arrav')) { sawOurBuild = true; }
                if (l.msg.includes('waiting on') && l.msg.includes(QUEST)) { parked = l.msg; }
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        if (t > 90 && !sawOurBuild) {
            fail('the queue never named Shield of Arrav in 90s, the deployed bundle is not this branch');
        }
        // Why: the chest reads `inv_total(bank, arravshield1)`, so a half that leaves the pack for a booth is gone for the run.
        if (args.keepHalf && last.halves === 0) {
            fail(`the seeded Broken shield (${halfId}) left the pack at ${varp}=${stage}, the fresh-pack sweep banked it`);
        }
        const done = args.keepHalf
            ? parked.length > 0
            : args.wantHalf ? last.halves > 0 : stage >= args.until;
        if (done) {
            console.log(
                `PASS (${varp}=${stage}, halves=${last.halves}, keys=${last.keys}, journal=${last.status},`
                + ` QP=${last.qp}, ${Math.round(t / 60)}min)`
            );
            if (parked.length > 0) {
                console.log(`  parked on: ${parked}`);
            }
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at ${varp}=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(
        args.keepHalf
            ? `no park inside ${args.minutes}min (${varp}=${reached}), the leg is still retrying instead of saying why`
            : args.wantHalf
                ? `no Broken shield (${halfId}) in the pack within ${args.minutes}min (${varp}=${reached})`
                : `${varp} reached ${reached}, wanted ${args.until}, within ${args.minutes}min`
    );
} finally {
    await browser.close();
}
