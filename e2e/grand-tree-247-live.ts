/** Live Grand Tree harness (#247): --stage N --until N --minutes N, base :8890.
 *  Why: `%grandtree` is the state machine and nothing else is, so `--stage` writes it and relogs — `update_questlist` only recolours the list at login, and the module reads that colour before it reads the journal.
 *  Why: stats are 70 across the board rather than max, because the quest ends on a level-172 Black Demon and the point is to prove a 70 account can hold Protect from Melee through it.
 *  Why: the bank holds coins, lobsters and a rune melee kit — every quest item has a source in the world, and seeding one would hide whether the bot can find it. */

//   HEADED=1 bun e2e/grand-tree-247-live.ts --stage 0 --until 160 --minutes 90 --tick 300
//   HEADED=1 bun e2e/grand-tree-247-live.ts --stage 130 --until 140 --minutes 25 --tick 300
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
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
    deploy: boolean;
    tele: boolean;
    root: number;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `gt${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 160,
        minutes: 90,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        deploy: true,
        tele: true,
        root: 15
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
        else if (flag === '--root') { out.root = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'The Grand Tree';
const QUEST_ID = 'grandtree';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const STRONGHOLD_BANK = { x: 2449, z: 3482, level: 1 };
const KARAMJA_CRASH = { x: 2917, z: 3058, level: 0 };

/** `%grandtree` values the module branches on, and the only ones `--stage` accepts. */
const STAGES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

// Why: past the glider the quest is in the Karamja jungle, and past the trapdoor it is under the tree — starting a leg on the wrong continent spends its budget walking.
function startTile(stage: number): { x: number; z: number; level: number } {
    if (stage === 80 || stage === 90) {
        return stage === 80 ? STRONGHOLD_BANK : KARAMJA_CRASH;
    }
    return stage >= 100 ? STRONGHOLD_BANK : ARDOUGNE_BANK;
}

// Why: no bank on Karamja answers a path without the 30gp ferry fare, so a `--stage 90` jump
// lands with an empty pack, cannot provision, and walks the jungle on no food until it dies.
// Why: a run that reached stage 90 by playing arrives carrying both, so the jump hands them over.
// Why: this is the engine's float, not a quest item — nothing the quest has to find is seeded.
const KARAMJA_PACK = ['give coins 2000', 'give lobster 10'];

/**
 * Coins, lobsters and a rune melee kit. Every quest item — the bark sample, the
 * scroll, the journal, the lumber order, Anita's key, the twigs and the rock —
 * is handed over or found in the world, so none of them is seeded.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** `::setstat` writes the level directly, so it pops no level-up dialog to swallow the next command. */
const SKILLS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    hp: number;
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
                Skills: { effective(n: string): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            hp: g.__rs2b0t.Skills.effective('hitpoints'),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: the transport graph compiles into navworker.js, a separate entrypoint — deploying only botclient.js leaves the navigator on the old edges and every route reports "unreachable". */
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

if (!STAGES.includes(args.stage)) {
    fail(`--stage must be one of ${STAGES.join(', ')}`);
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
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar ${QUEST_ID} ${args.stage}`);
        const read = await getServerVarQuiet(page, QUEST_ID);
        if (read !== args.stage) {
            fail(`setvar did not take (${QUEST_ID} ${read}/${args.stage})`);
        }
        console.log(`${QUEST_ID}=${read}`);
        // Why: `%daconia_rock_root` is rolled by the King's stage-140 dialogue, so a jump straight
        // to 150 leaves it 0 — which no root in `daconia_coords` answers, and the sweep never ends.
        if (args.stage === 150) {
            await cheatQuiet(page, `setvar daconia_rock_root ${args.root}`);
            const rolled = await getServerVarQuiet(page, 'daconia_rock_root');
            if (rolled !== args.root) {
                fail(`setvar did not take (daconia_rock_root ${rolled}/${args.root})`);
            }
            console.log(`daconia_rock_root=${rolled} (root ${args.root} of 15 holds the rock)`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    // Gear is declared, never inferred — the demon fight wears whatever this says.
    await page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { Loadouts: { save(l: unknown[]): void } } };
        g.__rs2b0t.Loadouts.save([{
            name: 'quest',
            worn: {
                righthand: 'Rune scimitar',
                torso: 'Rune chainbody',
                legs: 'Rune platelegs',
                hat: 'Rune full helm',
                lefthand: 'Rune kiteshield'
            },
            carry: [{ item: 'Lobster', qty: 10 }]
        }]);
    });
    console.log('seeded the quest loadout');

    if (args.tele) {
        const start = startTile(args.stage);
        if (!(await teleTo(page, start, 10, 25_000))) {
            await clearChatDialogs(page, 'pre-tele dialog(s)');
            if (!(await teleTo(page, start, 10, 25_000))) {
                fail(`tele to ${start.x},${start.z},${start.level} did not arrive`);
            }
        }
        console.log(`start tile → ${start.x},${start.z},${start.level}`);
        if (start === KARAMJA_CRASH) {
            for (const cmd of KARAMJA_PACK) {
                await cheatQuiet(page, cmd);
            }
            console.log(`Karamja start: ${KARAMJA_PACK.join(', ')} — no bank there answers a path without the fare`);
        }
    }

    await page.evaluate(id => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', id), QUEST_ID);
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${QUEST_ID} >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without this quest in it spends the budget on somebody else's.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, QUEST_ID)) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` ${QUEST_ID}=${stage} hp=${last.hp} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) {
                const at = ((l.time - t0) / 1000).toFixed(1).padStart(6);
                console.log(`      ·${at}s [${l.level}] ${l.msg}`);
            }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green as well, since the recolour and the QP award land a tick behind %grandtree.
        const done = args.until >= 160 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (${QUEST_ID}=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at ${QUEST_ID}=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`${QUEST_ID} reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
