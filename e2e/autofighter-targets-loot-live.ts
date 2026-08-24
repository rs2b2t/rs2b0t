/** Live proof, AutoFighter fights every name in its target list and steps over the herbs it was told to skip.
 *  Why: one target string used to mean one NPC name, and grimy herbs all read as "Herb", so a loot list
 *  cannot tell guam from marrentill. Both are checked against what dies and what ends up in the pack. */

//   bun e2e/autofighter-targets-loot-live.ts [http://localhost:8890]
import type { Page } from 'playwright-core';

import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const stamp = Date.now().toString(36).slice(-5);

/** Quiet enough that the only Attack targets in leash are the spawned ones, with a resident Giant rat as a name-filter distractor. */
const ARENA = { x: 3288, z: 3370, level: 0 };
const ARDOUGNE_EAST_BANK = { x: 2655, z: 3283, level: 0 };
const GUARD_SPOT = { x: 2661, z: 3306, level: 0 };
const SPAWNS = ['chicken', 'rat', 'chicken', 'rat'];
const GUAM_UNID = 199;
const MARRENTILL_UNID = 201;
const CAKE_WITHDRAW = 3;
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number; interact(op: string): unknown }> };
        Skills: { xp(name: string): number };
        Bank: { isOpen(): boolean };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: {
            npcs(): Array<{ name: string | null; distance: number }>;
            inventory(): Array<{ id: number; name: string | null; count: number }>;
        };
    };
}

const invIds = (page: Page): Promise<number[]> =>
    page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.inventory().map(i => i.id));

const npcNamesInLeash = (page: Page, leash: number): Promise<string[]> =>
    page.evaluate(r => (globalThis as never as Api).rs2b0t.reader.npcs()
        .filter(n => n.distance <= r)
        .map(n => (n.name ?? '?')), leash);

async function startScript(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('AutoFighter');
        if (!meta) {
            throw new Error('AutoFighter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
}

async function stopScript(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    await page.waitForTimeout(600);
}

function dump(label: string, logs: string[]): void {
    console.log(`--- ${label} ---`);
    for (const m of logs.slice(-14)) {
        console.log(`  ${m}`);
    }
}

const client = deployIsolatedClient(`aft${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();

/** Two targets in one list, two spawns each, a resident Giant rat that shares no exact name, and one avoided herb on the floor. */
async function targetsAndHerbs(): Promise<void> {
    const page = await browser.newPage();
    const leash = 6;
    try {
        page.on('pageerror', err => console.log(`pageerror: ${err}`));
        await mainlandAccount(page, base, `aft${stamp}`, client.page);
        for (const stat of COMBAT_SKILLS) {
            await cheatQuiet(page, `setstat ${stat} 50`, 700);
        }
        await clearChatDialogs(page, 'combat level-ups');
        if (!(await teleTo(page, ARENA, 6, 30_000))) {
            fail(`could not reach the arena tile (${ARENA.x},${ARENA.z})`);
        }

        await cheatQuiet(page, 'give unidentified_guam 1', 900);
        await cheatQuiet(page, 'give unidentified_marentill 1', 900);
        for (const id of [GUAM_UNID, MARRENTILL_UNID]) {
            await page.evaluate(objId => {
                const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => i.id === objId);
                it?.interact('Drop');
            }, id);
            await page.waitForTimeout(900);
        }
        const afterDrop = await invIds(page);
        if (afterDrop.includes(GUAM_UNID) || afterDrop.includes(MARRENTILL_UNID)) {
            fail(`the herbs did not reach the floor, pack still holds ${afterDrop.join(',')}`);
        }

        for (const npc of SPAWNS) {
            await cheatQuiet(page, `npcadd ${npc}`, 900);
        }
        const spawned = await npcNamesInLeash(page, leash);
        const chickens = spawned.filter(n => n === 'Chicken').length;
        const rats = spawned.filter(n => n === 'Rat').length;
        if (chickens < 2 || rats < 2) {
            fail(`npcadd did not stand up two of each, saw [${spawned.join(', ')}]`);
        }
        const distractors = spawned.filter(n => n !== 'Chicken' && n !== 'Rat');
        console.log(`arena holds ${chickens} Chicken, ${rats} Rat, distractors [${distractors.join(', ') || 'none'}]`);

        await setSettings(page, 'AutoFighter', {
            target: 'Chicken, Rat',
            spot: 'Start position',
            leashRadius: leash,
            combatStyle: 'melee',
            meleeStyle: 'strength',
            food: 'Trout',
            foodWithdraw: 0,
            loot: 'herb',
            avoidHerbs: 'Guam leaf',
            banking: 'None',
            buryBones: false,
            solveClues: false
        });
        await startScript(page);
        console.log("AutoFighter started on 'Chicken, Rat' with Guam leaf on the avoid list");

        const deadline = Date.now() + 300_000;
        let killedChickens = false;
        let killedRats = false;
        let logs: string[] = [];
        while (Date.now() < deadline) {
            const snap = await page.evaluate(r => {
                const g = globalThis as never as Api;
                return {
                    names: g.rs2b0t.reader.npcs().filter(n => n.distance <= r).map(n => n.name ?? '?'),
                    ids: g.rs2b0t.reader.inventory().map(i => i.id),
                    state: g.rs2b0t.runner.state,
                    logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
                };
            }, leash);
            logs = snap.logs;
            killedChickens = killedChickens || !snap.names.includes('Chicken');
            killedRats = killedRats || !snap.names.includes('Rat');
            if (snap.state !== 'running') {
                fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
            }
            if (snap.ids.includes(GUAM_UNID)) {
                fail('picked up the guam it was told to avoid');
            }
            if (killedChickens && killedRats && snap.ids.includes(MARRENTILL_UNID)) {
                break;
            }
            await page.waitForTimeout(2000);
        }

        dump('targets + herbs', logs);
        await page.screenshot({ path: 'docs/e2e/autofighter-targets-loot-live.png' });
        const finalIds = await invIds(page);
        await stopScript(page);

        if (!killedChickens || !killedRats) {
            fail(`only one name was fought (chickens cleared=${killedChickens}, rats cleared=${killedRats})`);
        }
        if (!finalIds.includes(MARRENTILL_UNID)) {
            fail('never looted the marrentill, so the herb filter took everything rather than the avoided one');
        }
        if (finalIds.includes(GUAM_UNID)) {
            fail('ended holding the avoided guam');
        }
        console.log('PASS (targets + herbs), both names cleared, marrentill looted, guam left on the floor');
    } finally {
        await page.close();
    }
}

/** An explicit food name has to beat what the pack already holds, so trout is junk when the setting says Cake. */
async function foodOverride(): Promise<void> {
    const page = await browser.newPage();
    try {
        page.on('pageerror', err => console.log(`pageerror: ${err}`));
        await mainlandAccount(page, base, `afd${stamp}`, client.page);
        for (const stat of COMBAT_SKILLS) {
            await cheatQuiet(page, `setstat ${stat} 50`, 700);
        }
        await clearChatDialogs(page, 'combat level-ups');
        await seedItemsToBank(page, [{ debugName: 'cake', displayName: 'Cake', qty: 20 }], ARDOUGNE_EAST_BANK);
        await cheatQuiet(page, 'give trout 5', 1200);
        if (!(await teleTo(page, GUARD_SPOT, 8, 30_000))) {
            fail(`could not reach the guard spot (${GUARD_SPOT.x},${GUARD_SPOT.z})`);
        }

        await setSettings(page, 'AutoFighter', {
            target: 'Guard',
            spot: 'Start position',
            leashRadius: 14,
            combatStyle: 'melee',
            meleeStyle: 'strength',
            food: 'Cake',
            foodWithdraw: CAKE_WITHDRAW,
            loot: 'clue scroll',
            avoidHerbs: '',
            banking: 'Auto',
            buryBones: false,
            solveClues: false
        });
        await startScript(page);
        console.log(`AutoFighter started holding 5 Trout with food set to Cake and ${CAKE_WITHDRAW} to carry`);

        const deadline = Date.now() + 420_000;
        let cake = 0;
        let trout = 5;
        let logs: string[] = [];
        while (Date.now() < deadline) {
            const snap = await page.evaluate(() => {
                const g = globalThis as never as Api;
                const inv = g.rs2b0t.reader.inventory();
                const named = (n: string): number => inv.filter(i => (i.name ?? '').toLowerCase() === n).length;
                return {
                    cake: named('cake'),
                    trout: named('trout'),
                    state: g.rs2b0t.runner.state,
                    logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
                };
            });
            logs = snap.logs;
            cake = snap.cake;
            trout = snap.trout;
            if (snap.state !== 'running') {
                fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
            }
            if (cake >= CAKE_WITHDRAW) {
                break;
            }
            await page.waitForTimeout(2000);
        }

        dump('food override', logs);
        await stopScript(page);

        if (!logs.some(m => /BankRun triggered: out of food/i.test(m))) {
            fail('a pack of trout counted as food, so the Cake setting was ignored');
        }
        if (cake < CAKE_WITHDRAW) {
            fail(`only ${cake} Cake after the trip`);
        }
        console.log(`PASS (food override), fetched ${cake} Cake past a pack that already held trout (${trout} left)`);
    } finally {
        await page.close();
    }
}

try {
    await targetsAndHerbs();
    await foodOverride();
    console.log('PASS, multi-name targets, the herb avoid list and the explicit food name all hold live');
} finally {
    client.cleanup();
    await browser.close();
}
