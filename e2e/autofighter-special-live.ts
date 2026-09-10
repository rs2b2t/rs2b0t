/** Live proof, AutoFighter arms the dragon dagger's special and the toggle turns it off.
 *  Why: the spec bar component is looked up from whatever combat interface the wielded weapon shows, and
 *  %sa_energy only moves when the armed flag survives to the hit, so both varps are read off the wire. */

//   bun e2e/autofighter-special-live.ts [http://localhost:8890]
import type { Page } from 'playwright-core';

import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const stamp = Date.now().toString(36).slice(-5);

/** Quiet enough that the only Attack targets in leash are the spawned ones. */
const ARENA = { x: 3288, z: 3370, level: 0 };
const WEAPON = 'Dragon dagger';
/** specwep.rs2 varps: %sa_energy and %sa_attack. */
const SA_ENERGY_VARP = 300;
const SA_ARMED_VARP = 301;
const SA_MAX = 1000;
/** param=sa_energy on the dragon dagger. */
const SPEC_COST = 250;
const LEASH = 6;
const SPAWNS = ['chicken', 'chicken', 'chicken', 'chicken'];
const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;
const ARM_LINE = /special armed with Dragon dagger/i;
/** Long enough for four chickens to die with a full bar untouched. */
const OFF_WINDOW_MS = 90_000;
const ON_WINDOW_MS = 240_000;

interface Api {
    __rs2b0t: {
        Equipment: { contains(name: string): boolean; equip(name: string): Promise<boolean> };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: {
            varp(index: number): number;
            npcs(): Array<{ name: string | null; distance: number }>;
        };
    };
}

interface Snap {
    energy: number;
    armed: number;
    state: string;
    chickens: number;
    logs: string[];
}

const snapshot = (page: Page): Promise<Snap> =>
    page.evaluate(([energyVarp, armedVarp, leash]) => {
        const g = globalThis as never as Api;
        return {
            energy: g.rs2b0t.reader.varp(energyVarp),
            armed: g.rs2b0t.reader.varp(armedVarp),
            state: g.rs2b0t.runner.state,
            chickens: g.rs2b0t.reader.npcs().filter(n => n.distance <= leash && n.name === 'Chicken').length,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
        };
    }, [SA_ENERGY_VARP, SA_ARMED_VARP, LEASH]);

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

/** Chickens in leash after a fresh batch, so a later shortfall means the bot killed one. */
async function restock(page: Page): Promise<number> {
    for (const npc of SPAWNS) {
        await cheatQuiet(page, `npcadd ${npc}`, 900);
    }
    const standing = (await snapshot(page)).chickens;
    if (standing < 2) {
        fail(`npcadd stood up only ${standing} Chicken in leash`);
    }
    return standing;
}

async function configure(page: Page, useSpecial: boolean): Promise<void> {
    await setSettings(page, 'AutoFighter', {
        target: 'Chicken',
        spot: 'Start position',
        leashRadius: LEASH,
        combatStyle: 'melee',
        meleeStyle: 'strength',
        useSpecial,
        food: 'Trout',
        foodWithdraw: 0,
        loot: 'clue scroll',
        avoidHerbs: '',
        banking: 'None',
        buryBones: false,
        solveClues: false
    });
}

const client = deployIsolatedClient(`afs${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();

try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, `afs${stamp}`, client.page);
    for (const stat of COMBAT_SKILLS) {
        await cheatQuiet(page, `setstat ${stat} 70`, 700);
    }
    await clearChatDialogs(page, 'combat level-ups');
    if (!(await teleTo(page, ARENA, 6, 30_000))) {
        fail(`could not reach the arena tile (${ARENA.x},${ARENA.z})`);
    }

    // Why: the engine gates dragon weapons behind Lost City (levelrequire_zanaris_quest), so the wield is refused without it.
    await cheatQuiet(page, 'setvar zanaris 6', 900);
    await cheatQuiet(page, 'give dragon_dagger 1', 1200);
    if (!(await page.evaluate(w => (globalThis as never as Api).__rs2b0t.Equipment.equip(w), WEAPON))) {
        fail(`could not wield the ${WEAPON}`);
    }
    if (!(await page.evaluate(w => (globalThis as never as Api).__rs2b0t.Equipment.contains(w), WEAPON))) {
        fail(`${WEAPON} is not in the weapon slot after equipping`);
    }
    await cheatQuiet(page, `setvar sa_energy ${SA_MAX}`, 900);
    const opening = await snapshot(page);
    if (opening.energy !== SA_MAX || opening.armed !== 0) {
        fail(`the bar did not fill: energy ${opening.energy}/${SA_MAX}, armed=${opening.armed}`);
    }

    // Off first, so the on run cannot inherit a spec that was armed and never spent.
    let standing = await restock(page);
    await configure(page, false);
    await startScript(page);
    console.log(`AutoFighter started on Chicken wielding a ${WEAPON} at ${SA_MAX} energy, specials OFF`);

    const quietUntil = Date.now() + OFF_WINDOW_MS;
    let offLogs: string[] = [];
    let offKilled = false;
    while (Date.now() < quietUntil) {
        const snap = await snapshot(page);
        offLogs = snap.logs;
        if (snap.state !== 'running') {
            fail(`script stopped early with specials off: ${offLogs.slice(-6).join(' | ')}`);
        }
        if (snap.energy !== SA_MAX || snap.armed !== 0) {
            fail(`specials are off but the bar moved: energy ${snap.energy}/${SA_MAX}, armed=${snap.armed}`);
        }
        offKilled = offKilled || snap.chickens < standing;
        if (snap.chickens === 0) {
            standing = await restock(page);
        }
        await page.waitForTimeout(2000);
    }

    dump('specials off', offLogs);
    await stopScript(page);

    if (offLogs.some(m => ARM_LINE.test(m))) {
        fail('armed a special with the setting turned off');
    }
    if (!offKilled) {
        fail('the specials-off run never killed a chicken, so an untouched bar proves nothing');
    }
    console.log(`specials off: chickens died and %sa_energy stayed at ${SA_MAX}`);

    // On: energy has to leave the bar, which only happens when the armed flag survives to the hit.
    standing = await restock(page);
    await configure(page, true);
    await startScript(page);
    console.log('AutoFighter restarted with specials ON');

    const deadline = Date.now() + ON_WINDOW_MS;
    let spent: Snap | null = null;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await snapshot(page);
        logs = snap.logs;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        if (snap.energy <= SA_MAX - SPEC_COST && logs.some(m => ARM_LINE.test(m))) {
            spent = snap;
            break;
        }
        if (snap.chickens === 0) {
            standing = await restock(page);
        }
        await page.waitForTimeout(2000);
    }

    dump('specials on', logs);
    await page.screenshot({ path: 'docs/e2e/autofighter-special-live.png' });
    await stopScript(page);

    if (!spent) {
        const last = await snapshot(page);
        fail(`no special landed: energy ${last.energy}/${SA_MAX}, armed=${last.armed}, standing ${standing}, no arm line in the log`);
    }
    const armCount = logs.filter(m => ARM_LINE.test(m)).length;
    console.log(`PASS, the special was armed ${armCount}x and %sa_energy fell ${SA_MAX} -> ${spent.energy} with the setting on, and stayed at ${SA_MAX} with it off`);
} finally {
    await page.close();
    client.cleanup();
    await browser.close();
}
