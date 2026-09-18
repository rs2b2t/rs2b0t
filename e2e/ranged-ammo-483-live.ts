import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 3 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const loadouts = [
    { id: 'crossbow', weapon: 'Crossbow', weaponObj: 'crossbow', ammo: 'Bolts', ammoObj: 'bolt' },
    { id: 'knife', weapon: 'Rune knife', weaponObj: 'rune_knife', ammo: 'Rune knife', ammoObj: 'rune_knife' }
];
assert(rest.every(id => loadouts.some(item => item.id === id)), 'cases: crossbow knife');
const cases = rest.length ? loadouts.filter(item => rest.includes(item.id)) : loadouts;
type Api = Omit<Rs2b0t, 'rs2b0t'> & {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Skills: { level(name: string): number; xp(name: string): number };
        Quests: { status(name: string): string };
    };
    rs2b0t: Omit<Rs2b0t['rs2b0t'], 'reader'> & {
        reader: Omit<Rs2b0t['rs2b0t']['reader'], 'npcs'> & { npcs(): { index: number; name: string | null; inCombat: boolean; distance: number }[] };
    };
};

async function give(page: Page, obj: string, name: string, count: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        const held = await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);
        if (held >= count) return;
        assert(await cheatQuiet(page, `give ${obj} ${count - held}`), `give ${obj} not sent`);
    }
    assert(await page.evaluate(([n, qty]) => (globalThis as never as Api).__rs2b0t.Inventory.count(n) >= qty, [name, count] as const), `missing ${name}`);
}

function snapshot(page: Page, ammo: string) {
    return page.evaluate(name => {
        const g = globalThis as never as Api;
        const targetIdx = g.rs2b0t.runner.bot?.targetIdx;
        return {
            state: g.rs2b0t.runner.state,
            tile: g.rs2b0t.reader.worldTile(),
            xp: g.__rs2b0t.Skills.xp('ranged'),
            held: g.__rs2b0t.Inventory.count(name),
            worn: g.rs2b0t.reader.equipment().find(item => item.name === name)?.count ?? 0,
            equipment: g.rs2b0t.reader.equipment(),
            target: g.rs2b0t.reader.npcs().find(npc => npc.index === targetIdx)?.name ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-12)
        };
    }, ammo);
}

async function watch(page: Page, loadout: typeof loadouts[number], baseline: Awaited<ReturnType<typeof snapshot>>, minAmmo: number, phase: string): Promise<void> {
    const deadline = Date.now() + minutes * 60_000;
    let equipped = false;
    let target = false;
    let nextLog = 0;
    while (Date.now() < deadline) {
        const current = await snapshot(page, loadout.ammo);
        equipped ||= current.held === 0 && current.worn >= minAmmo && current.equipment.some(item => item.name === loadout.weapon);
        target ||= current.target === 'Fire giant';
        if (equipped && target && current.xp > baseline.xp) {
            await page.screenshot({ path: `docs/e2e/issue-483-${loadout.id}-${phase}.png` });
            console.log(`PASS ${loadout.id}/${phase} rangedXp=${current.xp - baseline.xp} ${JSON.stringify(current)}`);
            return;
        }
        assert.equal(current.state, 'running', JSON.stringify(current));
        assert(!current.logs.some(line => line.msg.includes('PARKED:')), JSON.stringify(current));
        if (Date.now() >= nextLog) {
            console.log(`WATCH ${loadout.id}/${phase} ${JSON.stringify(current)}`);
            nextLog = Date.now() + 10_000;
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`${loadout.id}/${phase}: equipped=${equipped} target=${target} ${JSON.stringify(await snapshot(page, loadout.ammo))}`);
}

assert((await fetch(`${base}/bot.html`, { signal: AbortSignal.timeout(5000) })).ok, 'local engine unavailable');
const tag = `ra483${Date.now().toString(36).slice(-6)}`;
const pagePath = process.env.CLIENT_PAGE;
if (process.argv.includes('--no-deploy')) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires CLIENT_PAGE=/bot-<isolated-tag>.html');
const client = process.argv.includes('--no-deploy')
    ? { page: pagePath!, cleanup: () => undefined }
    : deployIsolatedClient(tag, process.env.ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
try {
    for (const loadout of cases) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const user = `r4${loadout.id[0]}${Date.now().toString(36).slice(-8)}`;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        console.log(`CASE ${loadout.id} user=${user}`);
        try {
            await mainlandAccount(page, base, user, client.page);
            assert(await cheatQuiet(page, 'setvar waterfall_quest 10'));
            assert.equal(await getServerVarQuiet(page, 'waterfall_quest'), 10);
            await relog(page, user);
            assert.equal(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Quests.status('Waterfall Quest')), 'complete');
            for (const skill of ['ranged', 'defence', 'hitpoints']) {
                assert(await cheatQuiet(page, `setstat ${skill} 99`));
            }
            await clearChatDialogs(page);
            assert(await page.evaluate(() => ['ranged', 'defence', 'hitpoints'].every(name => (globalThis as never as Api).__rs2b0t.Skills.level(name) === 99)));
            assert(await cheatQuiet(page, '~clearinv'));
            if (loadout.weapon !== loadout.ammo) await give(page, loadout.weaponObj, loadout.weapon, 1);
            await give(page, loadout.ammoObj, loadout.ammo, 200);
            await give(page, 'lobster', 'Lobster', 20);
            await give(page, 'rope', 'Rope', 1);
            await give(page, 'glarials_amulet_waterfall_quest', "Glarial's amulet", 1);
            await setSettings(page, 'FireGiant', {
                combatStyle: 'range', bow: 'Other', customBow: loadout.weapon,
                ammo: 'Other', customAmmo: loadout.ammo, rangeStyle: 'rapid',
                food: 'Lobster', loot: '', bankCommonJunk: false, buryBones: false,
                safespotTile: '2568,9892,0', safespotFallbackTile: '2568,9893,0'
            });
            assert(await teleTo(page, { x: 2568, z: 9892, level: 0 }, 1));
            const initial = await snapshot(page, loadout.ammo);
            assert.equal(initial.worn, 0, 'bot must equip the initial projectile stack');
            assert(!initial.equipment.some(item => item.name === loadout.weapon), 'bot must equip its own weapon');
            assert.equal(initial.held, 200);
            console.log(`BEFORE ${loadout.id}/equip ${JSON.stringify(initial)}`);
            await startScript(page, 'FireGiant');
            await watch(page, loadout, initial, 195, 'equip');
            await stopScript(page);
            await give(page, loadout.ammoObj, loadout.ammo, 300);
            const refill = await snapshot(page, loadout.ammo);
            assert(refill.worn > 0 && refill.held === 300, 'refill must coexist with equipped ammunition');
            console.log(`BEFORE ${loadout.id}/merge ${JSON.stringify(refill)}`);
            await startScript(page, 'FireGiant');
            await watch(page, loadout, refill, refill.worn + 295, 'merge');
            assert.deepEqual(errors, [], 'browser errors');
        } finally {
            await stopScript(page).catch(() => undefined);
            await cheatQuiet(page, 'tele 0,50,50,20,20').catch(() => false);
            await logout(page).catch(() => false);
            await context.close();
        }
    }
    console.log('PASS #483 custom ranged equipment, projectile merge, and Fire giant XP');
} finally {
    await browser.close();
    client.cleanup();
}
