// Live smoke for FireGiant. Mainland account -> start the Waterfall Quest ->
// bank Glarial's amulet, a rope, food and teleport runes -> run FireGiant ->
// watch it walk to Almera's raft, board, rope the rock, rope the dead tree,
// open the ledge door, and fight. PASS when it reaches the dungeon (z > 9000)
// and lands a kill (combat XP gained).
//
// Seeding notes, all learned the hard way:
//   - `~completequests` is useless here: complete_all_quests opens two blocking
//     p_choice2 dialogs and waits, so nothing completes and the pending modal
//     swallows the cheats that follow. Set the varp directly instead.
//   - the client never receives varp 65, and the quest journal colour (what
//     Quests.status reads) is only pushed at login — so the setvar MUST be
//     followed by a relog or the bot correctly reports "quest not started".
//   - `~item`/`~bankitem` guard on p_finduid and return SILENTLY when the player
//     is busy. `~maxme` locks the player through a flood of level-ups, so any seed
//     sent after it is dropped at random. Seed first, max last, verify.
//
// Usage: bun tools/firegiant-test.ts [base] [user] [budget-min] [style]

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `fg${Date.now().toString(36).slice(-6)}`;
const budgetMin = Number(process.argv[4]) || 40;
const style = process.argv[5] || 'melee';
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    __rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        Skills: { xp(n: string): number; level(n: string): number };
        Inventory: { count(n: string): number };
        Quests: { status(n: string): string };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { level: string; msg: string }[] } } };
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    if (!(await cheatQuiet(page, 'setvar waterfall_quest 10'))) { fail('setvar waterfall_quest was not sent'); }
    await page.waitForTimeout(1500);
    const wf = await getServerVarQuiet(page, 'waterfall_quest');
    if (wf !== 10) { fail(`waterfall_quest is ${wf} server-side, expected 10`); }

    // the journal colour only refreshes at login, and Quests.status reads the journal
    await relog(page, username);
    await page.waitForTimeout(2000);
    const qs = await page.evaluate(() => (globalThis as never as R).__rs2b0t.Quests.status('Waterfall Quest'));
    if (qs === 'notStarted') { fail('quest journal still reports notStarted after setvar + relog'); }
    console.log(`waterfall quest seeded (server=10, journal=${qs})`);

    // Seed only after the final relog — a pre-relog seed is rolled back. Order
    // matters: ~item/~bankitem both guard on p_finduid and SILENTLY return when the
    // player is busy, and ~maxme's 23 stat_advance calls keep them locked through a
    // flood of level-ups. Seed everything first, max the account last.
    const held = (n: string) => page.evaluate(x => (globalThis as never as R).__rs2b0t.Inventory.count(x), n);

    // Everything that fits in a stack goes to the inventory, where the count is
    // readable and the seed can be retried until it sticks. ~bankitem drops are
    // silent AND unverifiable from outside a script context, so only bulk food
    // (200 slots) relies on it.
    for (const [cmd, item] of [
        ['~item glarials_amulet_waterfall_quest 1', "Glarial's amulet"],
        ['~item rope 1', 'Rope'],
        ['~item airrune 1000', 'Air rune'],
        ['~item lawrune 200', 'Law rune'],
        ...(style === 'range'
            ? [['~item maple_shortbow 1', 'Maple shortbow'], ['~item iron_arrow 2000', 'Iron arrow']] as const
            : [['~item rune_scimitar 1', 'Rune scimitar']] as const)
    ] as readonly (readonly [string, string])[]) {
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) {
            await cheatQuiet(page, cmd);
            ok = (await held(item)) > 0;
        }
        if (!ok) { fail(`could not seed ${item} into the inventory after 5 attempts`); }
    }
    console.log('seeded (verified, held): amulet, rope, Camelot runes, and gear');

    for (let i = 0; i < 3; i++) {
        await cheatQuiet(page, '~bankitem lobster 200');
    }

    await cheatQuiet(page, '~maxme');
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => (globalThis as never as R).__rs2b0t.Skills.level('ranged') >= 99, undefined, { timeout: 30_000 })
        .catch(() => console.log('WARNING: ranged did not reach 99 — maxme may not have applied'));
    console.log(`seeded: bulk food banked, ${style} kit held, stats maxed`);

    await page.evaluate(s => {
        sessionStorage.setItem('rs2b0t:set:FireGiant:combatStyle', s);
        sessionStorage.setItem('rs2b0t:set:FireGiant:escapeTele', 'Camelot');
        sessionStorage.setItem('rs2b0t:set:FireGiant:food', 'Lobster');
        if (s === 'range') {
            sessionStorage.setItem('rs2b0t:set:FireGiant:bow', 'Maple shortbow');
            sessionStorage.setItem('rs2b0t:set:FireGiant:ammo', 'Iron arrow');
        }
    }, style);
    await startScript(page, 'FireGiant');
    console.log(`started FireGiant (${style}) — watching for the dungeon and a kill`);

    // the runner binds a log sink, so bot logs land in ctx.log and never reach
    // the console — poll them or the smoke is blind to every failure
    const snap = () => page.evaluate(() => {
        const g = globalThis as never as R;
        return {
            state: g.rs2b0t.runner.state,
            tile: g.__rs2b0t.reader.worldTile(),
            xp: ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0),
            log: (g.rs2b0t.runner.ctx?.log ?? []).map(l => `${l.level}: ${l.msg}`)
        };
    });

    const start = await snap();
    let seen = start.log.length;
    let reachedDungeon = false;
    let parked = false;

    while (Date.now() - t0 < BUDGET_MS) {
        await page.waitForTimeout(10_000);
        const s = await snap();
        for (const line of s.log.slice(seen)) {
            console.log(`  ${stamp()} ${line.slice(0, 260)}`);
            if (line.includes('PARKED:')) { parked = true; }
        }
        seen = s.log.length;

        if (!reachedDungeon && s.tile !== null && s.tile.z > 9000) {
            reachedDungeon = true;
            console.log(`PASS(entry): reached the dungeon at ${s.tile.x},${s.tile.z} after ${Math.round((Date.now() - t0) / 1000)}s`);
        }
        if (reachedDungeon && s.xp > start.xp + 500) {
            console.log(`PASS(combat): gained ${s.xp - start.xp} combat xp`);
            console.log('PASS');
            process.exit(0);
        }
        if (parked) { fail('bot parked — see the log lines above'); }
        if (s.state === 'crashed' || s.state === 'stopped') { fail(`runner state is '${s.state}'`); }
    }

    if (!reachedDungeon) { fail('never reached the Waterfall Dungeon (z > 9000)'); }
    fail('reached the dungeon but never gained combat xp');
} finally {
    await browser.close();
}
