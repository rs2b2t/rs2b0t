/** Live Temple of Ikov harness (#250): --stage N, --until N, --kit none|dungeon|warrior|roots, base :8890.
 *  Why: the quest is members-only, so the :8888 sim has neither the temple content nor a `~bankitem` to seed with.
 *  Why: the default kit is coins, lobsters, a set of studded leather and a rune scimitar — the candle, the tinderbox, the knife,
 *  the yew shortbow, the ice arrows, the boots of lightness and the twenty limpwurt roots all have sources the bot
 *  has to find, and seeding any of them hides whether it can. The armour is the exception because the quest sources
 *  none: the module wears whatever the bank already holds, so an unseeded bank proves only that it copes bare.
 *  The richer kits exist to isolate one leg, never to claim a pass. */

//   HEADED=1 bun e2e/temple-of-ikov-250-live.ts --until 100 --tick 200 --minutes 180
//   HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 40 --kit warrior --until 60 --tick 200 --minutes 60
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

type Kit = 'none' | 'dungeon' | 'warrior' | 'roots' | 'guardian';

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    kit: Kit;
    lever: boolean;
    minutes: number;
    tickMs: number;
    stats: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `ikov${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 100,
        kit: 'none',
        lever: false,
        minutes: 180,
        tickMs: 200,
        stats: 70,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--lever') { out.lever = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--kit') { out.kit = value as Kit; }
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

const QUEST = 'Temple of Ikov';
const ARDOUGNE_WEST_BANK = { x: 2616, z: 3332, level: 0 };

/** Coins, food and a wardrobe. Everything else in this quest has a source in the world. */
const BASE_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    // Why: the hobgoblin camp is a crowd and the ice cavern is nine level-61 spiders, and both cost about three lobsters a kill — sixty ran the bank dry at nineteen roots.
    { debugName: 'lobster', displayName: 'Lobster', qty: 300 },
    // Why: the module wears the best ranged armour the bank already holds rather than sourcing any, so an unseeded bank is a bot in boots — which is what the first runs died in.
    { debugName: 'studded_body', displayName: 'Studded body', qty: 1 },
    { debugName: 'studded_chaps', displayName: 'Studded chaps', qty: 1 },
    { debugName: 'coif', displayName: 'Coif', qty: 1 },
    { debugName: 'leather_vambraces', displayName: 'Leather vambraces', qty: 1 },
    // Why: the farm wields the best melee weapon banked and falls back to the yew axe, so a bank with no weapon in it proves only the fallback.
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 }
];

/** Per-leg shortcuts: each entry is a source the bot would otherwise have to walk to. */
const KITS: Record<Kit, BankSeedItem[]> = {
    none: [],
    dungeon: [
        { debugName: 'ikov_pendantoflucien', displayName: 'Pendant of lucien', qty: 1 },
        { debugName: 'unlit_candle', displayName: 'Candle', qty: 1 },
        { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 },
        { debugName: 'knife', displayName: 'Knife', qty: 1 }
    ],
    warrior: [],
    roots: [],
    guardian: []
};
KITS.warrior = [
    ...KITS.dungeon,
    { debugName: 'yew_shortbow', displayName: 'Yew shortbow', qty: 1 },
    { debugName: 'ice_arrow', displayName: 'Ice arrows', qty: 40 },
    { debugName: 'ikov_bootsoflightness', displayName: 'Boots of lightness', qty: 1 }
];
KITS.roots = [...KITS.warrior, { debugName: 'limpwurt_root', displayName: 'Limpwurt root', qty: 20 }];
// Why: past Winelda's ferry the shiny key is the only way out, and the McGrubor door is what walks a seeded stage-60 run back in.
KITS.guardian = [...KITS.roots, { debugName: 'ikov_shinykey', displayName: 'Shiny key', qty: 1 }];

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
    arrows: number;
    roots: number;
    logs: { time: number; level: string; msg: string }[];
}

const ICE_ARROW_IDS = [78, 79, 80, 81, 82];
const LIMPWURT_ROOT = 225;

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(([quest, arrowIds, rootId]) => {
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
            runner: g.rs2b0t.runner.state,
            arrows: (arrowIds as number[]).reduce((sum, id) => sum + g.__rs2b0t.Inventory.countById(id), 0),
            roots: g.__rs2b0t.Inventory.countById(rootId as number),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, [QUEST, ICE_ARROW_IDS, LIMPWURT_ROOT] as const);
}

async function seedVar(page: Page, name: string, want: number): Promise<void> {
    await cheatQuiet(page, `setvar ${name} ${want}`);
    const set = await getServerVarQuiet(page, name);
    console.log(`${name}=${set}`);
    if (set !== want) {
        fail(`setvar ${name} ${want} did not take (read back ${set})`);
    }
}

// Why: `bot.html` hardcodes one bundle path and `public/bot` is shared, so a neighbouring harness deploying mid-boot decides which branch this run exercises.
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

    const seed = [...BASE_SEED, ...KITS[args.kit]];
    if (args.kit !== 'none') {
        console.log(`SEEDING the '${args.kit}' kit — this run does not prove the bot can source those items`);
    }
    console.log(`seeding ${seed.length} item type(s) into the Ardougne West bank`);
    await seedItemsToBank(page, seed, ARDOUGNE_WEST_BANK);

    if (args.stage > 0) {
        await seedVar(page, 'ikov', args.stage);
    }
    if (args.lever) {
        // Bit 0 of %ikov_dungeon is ^ikov_lever: the south gate's permanent unlock.
        await seedVar(page, 'ikov_dungeon', 1);
    }
    if (args.stage > 0 || args.lever) {
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, ARDOUGNE_WEST_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, ARDOUGNE_WEST_BANK, 10, 25_000))) {
            fail(`tele to ${ARDOUGNE_WEST_BANK.x},${ARDOUGNE_WEST_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile -> ${ARDOUGNE_WEST_BANK.x},${ARDOUGNE_WEST_BANK.z},${ARDOUGNE_WEST_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'ikov'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ikov >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let sawOurBuild = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'ikov')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` ikov=${stage} arrows=${last.arrows} roots=${last.roots}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                console.log(`      . [${l.level}] ${l.msg}`);
                // Why: public/bot is shared, so another session's deploy can land inside the boot window and the run silently exercises their branch.
                if (l.msg.includes(QUEST)) { sawOurBuild = true; }
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        if (t > 90 && !sawOurBuild) {
            fail(`the queue never named ${QUEST} in 90s — the deployed bundle is not this branch`);
        }
        const done = args.until >= 100 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (ikov=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at ikov=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`ikov reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
