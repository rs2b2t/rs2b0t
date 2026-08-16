/** Live Tai Bwo Wannai Trio harness (#261): --stage N --lubufu N --tiadeche N --tinsay N --tamayu N --flags N --at x,z,level --skills N --until N --minutes N --tick ms, base :8890.
 *  Why: members-only, so the :8888 sim refuses every gate; `--stage` and the four brother varps are set together and followed by a relog, since update_questlist only recolours the journal at login.
 *  Why: the bank holds coins, food, the ranged kit and the four items no Karamjan shop stocks — the knife, pestle and tinderbox stay out, because buying those at Jiminua's is part of what the run proves. */

//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 0 --minutes 180 --tick 300
//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --until 4 --minutes 45           # the Lubufu bait leg
//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --at 2912,3118,0     # Tiadeche's catch
//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --at 2844,3042,0   # Tamayu
//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 3 --flags 480   # the killing hunt
//   HEADED=1 bun e2e/tbwt-261-live.ts --stage 3 --lubufu 31 --tiadeche 4 --tamayu 4 --at 2764,2976,0   # Tinsay
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    clearMainModal,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Tile {
    x: number;
    z: number;
    level: number;
}

interface Args {
    base: string;
    user: string;
    stage: number;
    lubufu: number;
    tiadeche: number;
    tinsay: number;
    tamayu: number;
    flags: number;
    until: number;
    minutes: number;
    tickMs: number;
    skills: number;
    food: string;
    at: Tile | null;
    /** Hand the kit straight to the pack, so a leg test skips the ferry round trip to the bank. */
    packed: boolean;
    deploy: boolean;
}

function parseTile(s: string): Tile {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => !Number.isFinite(n))) {
        throw new Error(`bad tile '${s}' — want x,z,level`);
    }
    return { x: x!, z: z!, level: level! };
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `tbwt${Date.now().toString(36).slice(-6)}`,
        stage: 0,
        lubufu: 0,
        tiadeche: 0,
        tinsay: 0,
        tamayu: 0,
        flags: 0,
        until: 6,
        minutes: 180,
        tickMs: 300,
        skills: 70,
        food: 'Lobster',
        at: null,
        packed: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--packed') { out.packed = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--lubufu') { out.lubufu = Number(value); }
        else if (flag === '--tiadeche') { out.tiadeche = Number(value); }
        else if (flag === '--tinsay') { out.tinsay = Number(value); }
        else if (flag === '--tamayu') { out.tamayu = Number(value); }
        else if (flag === '--flags') { out.flags = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--skills') { out.skills = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--at') { out.at = parseTile(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Tai Bwo Wannai Trio';
const ARDOUGNE_WEST_BANK: Tile = { x: 2616, z: 3332, level: 0 };
const TAI_BWO_WANNAI: Tile = { x: 2780, z: 3087, level: 0 };
/** quest.constant `^junglepotion_complete` — the one prerequisite. */
const JUNGLE_POTION_COMPLETE = 12;
/** `^tbwt_complete`, the value the quest ends on. */
const TBWT_COMPLETE = 6;

/** `::setstat` writes the level directly, so unlike `::advancestat` it pops no level-up dialog to swallow the next command. */
const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic',
    'agility', 'thieving', 'herblore', 'crafting', 'mining', 'smithing',
    'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'
];

/**
 * Coins, food, the ranged kit, and the four items no shop on Karamja sells.
 * The knife, pestle and tinderbox stay out: Jiminua stocks all three inside the
 * village, and seeding them would hide whether the bot can buy them.
 */
function bankSeed(): BankSeedItem[] {
    return [
        { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
        { debugName: args.food.toLowerCase().replace(/ /g, '_'), displayName: args.food, qty: 60 },
        { debugName: 'maple_shortbow', displayName: 'Maple shortbow', qty: 1 },
        { debugName: 'adamant_arrow', displayName: 'Adamant arrow', qty: 500 },
        { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
        { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
        { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
        { debugName: 'net', displayName: 'Small fishing net', qty: 1 },
        { debugName: 'seaweed', displayName: 'Seaweed', qty: 2 },
        { debugName: 'iron_spear', displayName: 'Iron spear', qty: 1 },
        { debugName: '4dose1agility', displayName: 'Agility potion(4)', qty: 1 }
    ];
}

/** `--packed`: the kit in the pack, so a leg test spends its budget on the leg rather than the ferry. */
const PACK_SEED = [
    'give net 1',
    'give knife 1',
    'give pestle_and_mortar 1',
    'give tinderbox 1',
    'give seaweed 1',
    'give iron_spear 1',
    'give 4dose1agility 1',
    'give lobster 6',
    'give maple_shortbow 1',
    'give adamant_arrow 200',
    'give rune_chainbody 1',
    'give rune_platelegs 1',
    'give rune_full_helm 1'
];

/** Where each leg's first action is, so the walk under test is the short one. */
function startTile(): Tile {
    if (args.at) {
        return args.at;
    }
    return args.stage === 0 ? ARDOUGNE_WEST_BANK : TAI_BWO_WANNAI;
}

interface Snapshot {
    pos: Tile | null;
    status: string;
    qp: number;
    runner: string;
    modal: { main: number; chat: number };
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: {
                    worldTile(): { x: number; z: number; level: number } | null;
                    modals(): { main: number; chat: number };
                };
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
            // A main modal nobody closed refuses every talk in silence and blanks every journal read.
            modal: g.__rs2b0t.reader.modals(),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: navworker.js is a second entrypoint holding the transport graph, so a client-only deploy leaves the navigator on the old edges. */
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
    console.log(`tick rate: ${args.tickMs}ms (${(600 / args.tickMs).toFixed(1)}x)`);

    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${args.skills}`);
    }
    await clearChatDialogs(page, 'post-setstat dialog(s)');
    console.log(`skills → ${args.skills}`);

    const seed = bankSeed();
    console.log(`seeding ${seed.length} item type(s) into the Ardougne west bank`);
    await seedItemsToBank(page, seed, ARDOUGNE_WEST_BANK);

    await cheatQuiet(page, `setvar junglepotion ${JUNGLE_POTION_COMPLETE}`);
    const jungle = await getServerVarQuiet(page, 'junglepotion');
    if (jungle !== JUNGLE_POTION_COMPLETE) {
        fail(`setvar junglepotion did not take (read back ${jungle})`);
    }
    console.log('prerequisite: Jungle Potion set complete');

    const varps: [string, number][] = [
        ['tbwt_main', args.stage],
        ['tbwt_lubufu', args.lubufu],
        ['tbwt_tiadeche', args.tiadeche],
        ['tbwt_tinsay', args.tinsay],
        ['tbwt_tamayu', args.tamayu],
        ['tbwt_flags', args.flags]
    ];
    for (const [name, value] of varps) {
        if (value > 0) {
            await cheatQuiet(page, `setvar ${name} ${value}`);
        }
    }
    if (args.stage > 0) {
        const set = await getServerVarQuiet(page, 'tbwt_main');
        if (set !== args.stage) {
            fail(`setvar tbwt_main ${args.stage} did not take (read back ${set})`);
        }
    }
    console.log(`varps → ${varps.map(([n, v]) => `${n}=${v}`).join(' ')}`);

    // Why: both Brimhaven ferries charge 30gp, so a leg seeded onto Karamja with an empty
    // purse has no route to the bank at all — an account that got there would have coin.
    if (args.stage > 0) {
        await cheatQuiet(page, 'give coins 1000');
        console.log('packed 1000 coins (mid-quest start, the ferry charges both ways)');
    }
    // Why: only for iterating on one leg — the end-to-end run has to source all of this itself.
    if (args.packed) {
        for (const cmd of PACK_SEED) {
            await cheatQuiet(page, cmd);
        }
        console.log(`packed the kit: ${PACK_SEED.join(', ')}`);
    }

    // The journal colour is only recomputed at login, and the module reads the tab.
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = startTile();
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'tbwt'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    // A scroll left on main refuses every talk the quest issues and blanks every journal read.
    await clearMainModal(page);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for tbwt_main >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: one engine serves every worktree, so a concurrent session's deploy replaces this
        // bundle inside the boot window, and the queue line is the first place it shows.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the deployed bundle has no ${QUEST} — another worktree deployed over it; rerun this harness`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'tbwt_main')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` tbwt=${stage} tiadeche=${await getServerVarQuiet(page, 'tbwt_tiadeche')}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
            + (last.modal.main === -1 ? '' : ` MAIN-MODAL=${last.modal.main}`)
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                const at = ((l.time - t0) / 1000).toFixed(1).padStart(6);
                console.log(`      ·${at}s [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the completion recolour and the
        // QP award land a tick behind %tbwt_main.
        const done = args.until >= TBWT_COMPLETE ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (tbwt_main=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at tbwt_main=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`tbwt_main reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
