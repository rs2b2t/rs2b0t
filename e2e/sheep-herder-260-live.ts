/** Live Sheep Herder harness (#260): --stage N --done N --until N --minutes N, base :8890.
 *  Why: `--done` seeds `%sheepherdervar` rather than the quest varp, because the journal reads its per-sheep state out of that bitfield and the two have to move together; it relogs since update_questlist only recolours the list at login.
 *  Why: the bank holds coins and food alone — the suit is bought from Doctor Orbon, the prod is taken off the barn floor and the feed comes from Halgrive, so seeding any of them would hide whether the bot can source it. */

//   HEADED=1 bun e2e/sheep-herder-260-live.ts --stage 0 --until 4 --minutes 90 --tick 300
//   HEADED=1 bun e2e/sheep-herder-260-live.ts --stage 2 --done 3 --until 4 --minutes 25 --tick 300
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
    done: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `sh${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        done: 0,
        until: 4,
        minutes: 90,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
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
        else if (flag === '--done') { out.done = Number(value); }
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

const QUEST = 'Sheep Herder';
const ARDOUGNE_WEST_BANK = { x: 2616, z: 3332, level: 0 };

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

/** `sheepherder_sheep_data.dbrow`: each sheep owns a 3-bit field, and 6 means incinerated. */
const START_BIT = [1, 4, 7, 10];

function sheepVarFor(done: number): number {
    let bits = 0;
    for (const bit of START_BIT.slice(0, done)) {
        bits |= 6 << bit;
    }
    return bits;
}

function burntCount(sheepVar: number): number {
    return START_BIT.filter(bit => ((sheepVar >> bit) & 7) === 6).length;
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

if (args.stage < 0 || args.stage > 2) {
    fail('--stage is the quest varp and runs 0 (not started) to 2 (disposing)');
}
if (args.done < 0 || args.done > 4) {
    fail('--done counts sheep already incinerated and runs 0 to 4');
}
if (args.done > 0 && args.stage !== 2) {
    fail('--done only means anything at --stage 2');
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

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne West bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_WEST_BANK);

    if (args.stage > 0) {
        const sheepVar = sheepVarFor(args.done);
        await cheatQuiet(page, `setvar sheepherderquest ${args.stage}`);
        await cheatQuiet(page, `setvar sheepherdervar ${sheepVar}`);
        // Why: at stage 2 the suit is already bought, so the seed has to hand it over or the bot walks back to Orbon for one it paid for off-camera.
        if (args.stage === 2) {
            await cheatQuiet(page, 'give plague_jacket 1');
            await cheatQuiet(page, 'give plague_trousers 1');
            await cheatQuiet(page, 'give poisoned_feed 1');
        }
        const readQuest = await getServerVarQuiet(page, 'sheepherderquest');
        const readVar = await getServerVarQuiet(page, 'sheepherdervar');
        console.log(`sheepherderquest=${readQuest} sheepherdervar=${readVar} (${args.done} sheep incinerated)`);
        if (readQuest !== args.stage || readVar !== sheepVar) {
            fail(`setvar did not take (quest ${readQuest}/${args.stage}, var ${readVar}/${sheepVar})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, ARDOUGNE_WEST_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, ARDOUGNE_WEST_BANK, 10, 25_000))) {
            fail(`tele to ${ARDOUGNE_WEST_BANK.x},${ARDOUGNE_WEST_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile → ${ARDOUGNE_WEST_BANK.x},${ARDOUGNE_WEST_BANK.z},${ARDOUGNE_WEST_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'sheepherder'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 4 ? 'the journal to go green' : `${args.until} sheep incinerated`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without Sheep Herder in it spends the budget on somebody else's quest.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const sheepVar = (await getServerVarQuiet(page, 'sheepherdervar')) ?? 0;
        const burnt = burntCount(sheepVar);
        reached = Math.max(reached, burnt);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` burnt=${burnt}/4 var=${sheepVar}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        const done = args.until >= 4 ? last.status === 'complete' : burnt >= args.until;
        if (done) {
            console.log(`PASS (burnt=${burnt}/4, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped with ${burnt}/4 incinerated (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`incinerated reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
