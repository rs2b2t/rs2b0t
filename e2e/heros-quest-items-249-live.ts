/** Live Hero's Quest solo-item harness (#249): one account, the armband already earned, driving the
 *  two chains a bot does alone — the lava eel and the Entranan firebird feather — and the hand-in.
 *  Why: the armband is the only half of this quest that needs two accounts, so proving the rest costs
 *  one browser and no rendezvous.
 *  Why: the ice gloves are seeded. Every ladder into the Ice Queen's lair stands on a White Wolf
 *  Mountain plateau the map flags seal, and she is the only source — see quest-pitfalls-35. */

//   HEADED=1 bun e2e/heros-quest-items-249-live.ts --tick 300 --minutes 60
//   HEADED=1 bun e2e/heros-quest-items-249-live.ts --skip-eel --minutes 30
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
    minutes: number;
    tickMs: number;
    stats: number;
    skipEel: boolean;
    skipFeather: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const stamp = Date.now().toString(36).slice(-6);
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: process.env.HERO_NAME || `hqi${stamp}`,
        minutes: 60,
        tickMs: 300,
        stats: 70,
        skipEel: false,
        skipFeather: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--skip-eel') { out.skipEel = true; continue; }
        if (flag === '--skip-feather') { out.skipFeather = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
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

const QUEST = "Hero's Quest";
const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

function bankSeed(): BankSeedItem[] {
    const seed: BankSeedItem[] = [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: 'lobster', displayName: 'Lobster', qty: 60 },
        { debugName: 'ice_gloves', displayName: 'Ice gloves', qty: 1 },
        // Why: the armband is the two-account half, and this harness is the one-account half.
        { debugName: 'master_thief_armband', displayName: "Thieves' armband", qty: 1 }
    ];
    if (args.skipEel) {
        seed.push({ debugName: 'lava_eel', displayName: 'Lava eel', qty: 1 });
    }
    if (args.skipFeather) {
        seed.push({ debugName: 'hot_feather', displayName: 'Fire feather', qty: 1 });
    }
    return seed;
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
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-40).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

const tag = `hi${Date.now().toString(36).slice(-6)}`;
const client = args.deploy ? deployIsolatedClient(tag) : { page: '/bot.html', cleanup: () => {} };

console.log(
    `heros-quest-items base=${args.base} user=${args.user} stats=${args.stats}`
    + ` skipEel=${args.skipEel} skipFeather=${args.skipFeather} budget=${args.minutes}min`
);

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user, client.page);
    await cheatQuiet(page, `speed ${args.tickMs}`);
    await setStats(page, args.stats);
    // Why: the values `quest.constant` calls complete — `~send_quest_progress` colours the list
    // green only on `current >= complete`.
    for (const [name, value] of [['zanaris', 6], ['dragonquest', 10], ['arthur', 7], ['blackarmgang', 4]] as const) {
        await cheatQuiet(page, `setvar ${name} ${value}`);
    }
    // Why: 13 is `hero_blackarm_obtained_armband` — the armband earned, the two solo items still owed.
    await cheatQuiet(page, 'setvar heroquest 13');
    // Why: the quest list is coloured by `~send_quest_progress` at login, so a varp set mid-session
    // leaves the prerequisites reading red and the eligibility gate blocks the quest before it starts.
    await relog(page, args.user);
    // Why: `%qp` is summed from the quest varps by the login proc in `general/scripts/quests.rs2`, so a
    // value set before the relog is thrown away and one set after it survives the session.
    await cheatQuiet(page, 'setvar qp 55');
    await seedItemsToBank(page, bankSeed(), VARROCK_WEST_BANK);
    if (!(await teleTo(page, VARROCK_WEST_BANK, 10, 25_000))) {
        fail('tele to the Varrock West bank failed');
    }
    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:AIOQuester:${k}`, v);
        }
    }, { quests: 'hero', arravGang: 'blackarm', heroPartner: 'nobody', food: 'Lobster' });

    await startScript(page, 'AIOQuester');
    console.log('AIOQuester started — watching for the eel, the feather and the hand-in');

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        const [snap, hero] = await Promise.all([snapshot(page), getServerVarQuiet(page, 'heroquest')]);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(`  t=${t}s heroquest=${hero} journal=${snap.status} at ${snap.pos?.x},${snap.pos?.z},${snap.pos?.level} ${snap.runner}`);
        for (const l of snap.logs) {
            if (l.time > lastLogTime) { console.log(`      . [${l.level}] ${l.msg}`); }
        }
        if (snap.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...snap.logs.map(l => l.time));
        }
        if (snap.status === 'complete') {
            console.log(`PASS (${args.user} heroquest=${hero}, journal green, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (snap.runner === 'stopped') { fail(`the bot stopped (journal=${snap.status}, heroquest=${hero})`); }
        await page.waitForTimeout(10_000);
    }
    fail(`the quest did not finish within ${args.minutes}min`);
} finally {
    await browser.close();
    client.cleanup();
}
