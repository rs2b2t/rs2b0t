/** Live Shades of Mort'ton harness (#255): --stage N --until N --minutes N --tick ms --levels N, base :8890.
 *  Why: Morytania is members-only, so the :8888 sim refuses every gate this quest needs.
 *  Why: `--stage` sets `%morttonquest` and relogs, since update_questlist only recolours the journal entry at login, and the prerequisite varps go in alongside it because the eligibility check reads the quest list rather than the module.
 *  Why: levels are set with `~addxp` rather than `~maxme`, so the temple's crafting rolls and the shade fights run at the level the module claims to be proven at. */

//   HEADED=1 bun e2e/mortton-255-live.ts --stage 0 --until 85 --minutes 180 --tick 200
//   HEADED=1 bun e2e/mortton-255-live.ts --stage 0 --until 15 --minutes 45 --tick 200
//   HEADED=1 bun e2e/mortton-255-live.ts --stage 15 --until 47 --minutes 45 --tick 200
//   HEADED=1 bun e2e/mortton-255-live.ts --stage 47 --until 65 --minutes 60 --tick 200
//   HEADED=1 bun e2e/mortton-255-live.ts --stage 65 --until 85 --minutes 45 --tick 200
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
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

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    /** Level every skill is raised to before the run. */
    levels: number;
    /** Give a mid-quest start the approach pack instead of walking to Varrock for it. */
    stocked: boolean;
    /** Turn Global `navTeleports` on. */
    teleports: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `sm${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 85,
        minutes: 180,
        tickMs: 200,
        food: 'Lobster',
        levels: 70,
        stocked: false,
        teleports: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--stocked') { out.stocked = true; continue; }
        if (flag === '--teleports') { out.teleports = true; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--levels') { out.levels = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Shades of Mortton';
const COMPLETE = 85;
const VARROCK_BANK = { x: 3253, z: 3420, level: 0 };
const MORTTON = { x: 3490, z: 3290, level: 0 };
const TEMPLE = { x: 3506, z: 3313, level: 0 };
const PYRES = { x: 3506, z: 3276, level: 0 };

/**
 * Coins and food only. Every other item the quest needs — the diary, the herbs,
 * the vials, the logs, the tinderbox and every building material — has a source
 * in the world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 100 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    // Why: rune platebody wants Dragon Slayer complete, and the refusal is a bare false.
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 },
    { debugName: 'leather_boots', displayName: 'Leather boots', qty: 1 },
    { debugName: 'leather_gloves', displayName: 'Leather gloves', qty: 1 }
];

/** What the Varrock leg of a stage-0 run assembles, for `--stocked` mid-quest starts. */
const APPROACH_PACK = [
    'coins 30000', 'lobster 6', 'tinderbox 1', 'ashes 2', 'logs 1',
    'rune_scimitar 1', 'rune_full_helm 1', 'rune_chainbody 1',
    'rune_platelegs 1', 'rune_kiteshield 1'
];

const SKILLS = [
    'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
] as const;

/** XP for a level, from the classic table. */
function xpFor(level: number): number {
    let points = 0;
    for (let l = 1; l < level; l++) {
        points += Math.floor(l + 300 * Math.pow(2, l / 7));
    }
    return Math.floor(points / 4);
}

/** Where each stage's first action is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: VARROCK_BANK,
    5: MORTTON,
    10: MORTTON,
    15: MORTTON,
    20: MORTTON,
    25: MORTTON,
    30: MORTTON,
    35: MORTTON,
    40: MORTTON,
    45: MORTTON,
    47: MORTTON,
    50: TEMPLE,
    55: TEMPLE,
    60: TEMPLE,
    65: TEMPLE,
    70: PYRES,
    75: PYRES,
    80: MORTTON
};

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    modal: { main: number; chat: number };
    temple: { repaired: number; resources: number; sanctity: number };
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: {
                    worldTile(): { x: number; z: number; level: number } | null;
                    modals(): { main: number; chat: number };
                    varp(i: number): number;
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
            // Why: a main modal nobody closed refuses every talk in silence and blanks every journal read.
            modal: g.__rs2b0t.reader.modals(),
            // The three transmitted flamtaer meters, which is how the temple leg sees itself.
            temple: {
                repaired: g.__rs2b0t.reader.varp(343),
                resources: g.__rs2b0t.reader.varp(344),
                sanctity: g.__rs2b0t.reader.varp(345)
            },
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

// Why: this run gets its own copy of the client, so a neighbouring harness deploying mid-boot cannot decide which branch this one exercises.
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

    const registered = await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): { settingsSchema?: { quests?: { options?: string[] } } } | undefined } };
        };
        return (g.rs2b0t.registry.get('AIOQuester')?.settingsSchema?.quests?.options ?? []).includes('mortton');
    });
    if (!registered) {
        fail(`the client at ${clientPage} has no Shades of Mort'ton — this run's deploy did not land`);
    }

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    if (args.teleports) {
        await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:Global:navTeleports', 'true'));
        console.log('nav teleports: on');
    }

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Varrock east bank`);
    await seedItemsToBank(page, BANK_SEED, VARROCK_BANK);

    // Why: Priest in Peril walls Morytania off, and Nature Spirit is what Ulizius wants started before the swamp gate opens.
    for (const [varp, value] of [['prieststart', 60], ['priestperil', 61], ['druidspirit', 110]] as const) {
        await cheatQuiet(page, `setvar ${varp} ${value}`);
    }
    console.log('prerequisites: The Restless Ghost + Priest in Peril + Nature Spirit set complete');

    // Why: `~addxp` takes plain xp — it multiplies by ten to reach the engine's internal tenths — and the level-up cascade leaves the player delayed, so the levels go in before the relog rather than before a typed command that would be swallowed.
    const xp = xpFor(args.levels) + 100;
    for (const skill of SKILLS) {
        await cheatQuiet(page, `~addxp ${skill} ${xp}`, 250);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    const reachedLevels = await page.evaluate(() => {
        const s = (globalThis as never as { __rs2b0t: { Skills: { level(n: string): number } } }).__rs2b0t.Skills;
        return { crafting: s.level('crafting'), herblore: s.level('herblore'), attack: s.level('attack') };
    });
    console.log(`levels → crafting ${reachedLevels.crafting}, herblore ${reachedLevels.herblore}, attack ${reachedLevels.attack}`);
    if (reachedLevels.crafting < args.levels) {
        fail(`levels did not land (crafting ${reachedLevels.crafting}, wanted ${args.levels})`);
    }

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar morttonquest ${args.stage}`);
        const set = await getServerVarQuiet(page, 'morttonquest');
        console.log(`morttonquest=${set}`);
        if (set !== args.stage) {
            fail(`setvar morttonquest ${args.stage} did not take (read back ${set})`);
        }
        // Why: five shades are killed before the handover, and a stage seeded past it describes a pack the quest cannot otherwise reach.
        // Why: Razmire takes two and Ulsquire one, so a stage past them holds the two the pyre and its retry want, not five.
        if (args.stage >= 40) {
            await cheatQuiet(page, `give shade_bones1 ${args.stage >= 45 ? 2 : 5}`);
        }
        // Why: the approach pack is a Varrock errand, so a leg that only wants to test Mort'ton can skip the round trip.
        if (args.stocked) {
            for (const give of APPROACH_PACK) {
                await cheatQuiet(page, `give ${give}`);
            }
            console.log(`stocked the approach pack: ${APPROACH_PACK.join(', ')}`);
        }
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_START[args.stage] ?? VARROCK_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'mortton'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    // A scroll left in the main slot silently refuses every talk the quest issues.
    await clearMainModal(page);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for morttonquest >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'morttonquest')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` morttonquest=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
            + ` temple=${last.temple.repaired}%/${last.temple.resources}%/${last.temple.sanctity}%`
            + (last.modal.main === -1 ? '' : ` MAIN-MODAL=${last.modal.main}`)
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green: the recolour and the QP award land a tick behind %morttonquest.
        const done = args.until >= COMPLETE ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (morttonquest=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at morttonquest=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`morttonquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
