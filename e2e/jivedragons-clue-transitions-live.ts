import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright-core';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Bank } from '../src/bot/api/bank/Bank.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type JiveDragons from '../src/bot/scripts/JiveDragons/JiveDragons.js';
import { deployIsolatedClient, launchBrowser, setSettings, stopScript } from './lib/harness.js';
import { clueSequenceEngine } from './lib/clueSequenceEngine.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Equipment: typeof Equipment; Inventory: typeof Inventory; Bank: typeof Bank; Skills: typeof Skills; Npcs: typeof Npcs; Game: typeof Game };
    rs2b0t: { runner: { bot: JiveDragons | null; state: string; ctx: { log: { msg: string }[] } | null } };
    clueFixture: { equipFailures: number; withdrawalFailures: number; bot: JiveDragons | null };
}

async function readClueState(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as unknown as Api;
        const a = g.__rs2b0t;
        const b = g.rs2b0t.runner.bot;
        return {
            state: g.rs2b0t.runner.state, sameBot: b === g.clueFixture.bot, status: b?.status, solved: b?.cluesSolved ?? 0,
            died: b?.died, parked: b?.parked, hp: a.Skills.effective('hitpoints'), tile: a.Game.tile(),
            inventory: a.Inventory.items().map(i => ({ id: i.id, name: i.name, count: i.count })),
            equipment: a.Equipment.items().map(i => ({ id: i.id, count: i.count })).sort((a, b) => a.id - b.id),
            guardian: a.Npcs.all().some(n => n.name === 'Saradomin Wizard' && n.targetsMe()),
            failures: { equip: g.clueFixture.equipFailures, withdrawal: g.clueFixture.withdrawalFailures },
            logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
        };
    });
}

const modes = process.argv.includes('--map-only') ? ['map'] : process.argv.includes('--entrana-only') ? ['entrana'] : ['entrana', 'map'];
const cases = modes.map(mode => ({ mode, user: `ct${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}` }));
const engine = await clueSequenceEngine(cases.map(c => c.user));
console.log(`engine log: ${engine.log}`);
try {
    for (const { mode, user } of cases) {
        const client = deployIsolatedClient(user);
        let browser: Browser | undefined;
        let page: Page | undefined;
        try {
            browser = await launchBrowser();
            page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
            await mainlandAccount(page, 'http://localhost:8890', user, client.page);
            for (const [name, value] of [['zanaris', 6], ['itwatchtower', 14], ['legendsquest', 75]] as const) await cheatQuiet(page, `setvar ${name} ${value}`);
            await relog(page, user);
            for (const [skill, level] of [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 90], ['prayer', 70], ['magic', 80], ['woodcutting', 60], ['agility', 60]] as const) {
                await cheatQuiet(page, `setstat ${skill} ${level}`, 650);
            }
            await clearChatDialogs(page, 'levels');
            await seedItemsToBank(page, [
                { debugName: 'shark', displayName: 'Shark', qty: 100 },
                { debugName: 'lobster', displayName: 'Lobster', qty: 50 },
                { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 5 },
                { debugName: 'coins', displayName: 'Coins', qty: 10000 },
                ...[['machette', 'Machete'], ['rune_axe', 'Rune axe'], ['dusty_key', 'Dusty key'], ['spade', 'Spade'], ['trail_sextant', 'Sextant'], ['trail_watch', 'Watch'], ['trail_chart', 'Chart']]
                    .map(([debugName, displayName]) => ({ debugName, displayName, qty: 1 })),
                ...['air', 'water', 'earth', 'fire', 'law'].map(rune => ({ debugName: `${rune}rune`, displayName: `${rune[0].toUpperCase()}${rune.slice(1)} rune`, qty: 500 }))
            ], { x: 2946, z: 3369, level: 0 });
            for (const [debug, name] of [
                ['dragon_longsword', 'Dragon longsword'], ['antidragonbreathshield', 'Dragonfire shield'], ['rune_full_helm', 'Rune full helm'],
                ['rune_chainbody', 'Rune chainbody'], ['rune_platelegs', 'Rune platelegs'], ['leather_boots', 'Leather boots'],
                ['gold_ring', 'Gold ring'], ['amulet_of_power', 'Amulet of power'], ['red_cape', 'Cape'], ['bronze_arrow', 'Bronze arrow']
            ]) {
                await cheatQuiet(page, `give ${debug} ${debug === 'bronze_arrow' ? 100 : 1}`, 650);
                assert(await page.evaluate(item => (globalThis as unknown as Api).__rs2b0t.Equipment.equip(item), name), `equip ${name}`);
            }
            const outfit = await page.evaluate(() => (globalThis as unknown as Api).__rs2b0t.Equipment.items().map(i => ({ id: i.id, count: i.count })).sort((a, b) => a.id - b.id));
            assert.equal(outfit.length, 10);
            assert.equal(outfit.find(i => i.id === 882)?.count, 100);
            await cheatQuiet(page, 'setvar trail_status 0');
            await cheatQuiet(page, `give ${mode === 'entrana' ? 'trail_clue_hard_riddle027' : 'trail_clue_hard_map001'} 1`);
            await cheatQuiet(page, 'give lobster 27');
            assert.equal(await page.evaluate(() => (globalThis as unknown as Api).__rs2b0t.Inventory.free()), 0);
            await setSettings(page, 'JiveDragons', { site: 'taverley-blue', combatStyle: 'melee', weapon: 'Dragon longsword', usePotions: false, useSpecial: false, solveClues: true, foodWithdraw: 20, leaveVia: 'walk' });
            await page.evaluate(entrana => {
                const g = globalThis as unknown as Api;
                const a = g.__rs2b0t;
                g.clueFixture = { equipFailures: 0, withdrawalFailures: 0, bot: null };
                const equip = a.Equipment.equip;
                a.Equipment.equip = async name => {
                    if (entrana && name === 'Rune chainbody' && a.Inventory.countById(3534) > 0 && g.clueFixture.equipFailures === 0) {
                        g.clueFixture.equipFailures++;
                        return false;
                    }
                    return equip(name);
                };
                const withdraw = a.Bank.withdraw;
                a.Bank.withdraw = (name, op) => {
                    if (name === 'Machete' && g.clueFixture.withdrawalFailures === 0) {
                        if (!a.Bank.isOpen() || a.Bank.count(name) < 1) throw new Error('Machete failure must occur with confirmed bank stock');
                        g.clueFixture.withdrawalFailures++;
                        return false;
                    }
                    return withdraw(name, op);
                };
            }, mode === 'entrana');
            await startScript(page, 'JiveDragons');
            await page.evaluate(() => { const g = globalThis as unknown as Api; g.clueFixture.bot = g.rs2b0t.runner.bot; });
            const deadline = Date.now() + 25 * 60_000;
            let sawEntrana = false;
            let sawSecondLeg = false;
            let sawGuardian = false;
            let complete = false;
            let lastPrint = 0;
            const logs = new Set<string>();
            while (Date.now() < deadline) {
                const s = await readClueState(page);
                assert(s.state === 'running' && s.sameBot && !s.died && !s.parked && s.hp > 0, JSON.stringify(s));
                for (const line of s.logs) logs.add(line);
                assert(!s.logs.some(l => /abandoning|\[clue\] abandoned/.test(l)), JSON.stringify(s));
                if (s.inventory.some(i => i.id === 3534)) sawSecondLeg = true;
                if (s.tile && s.tile.x >= 2802 && s.tile.x <= 2878 && s.tile.z >= 3329 && s.tile.z <= 3393) {
                    assert.deepEqual(s.equipment, []);
                    sawEntrana = true;
                }
                if (s.guardian) {
                    sawGuardian = true;
                    assert.deepEqual(s.equipment, outfit, 'guardian started before the full outfit was restored');
                    assert(s.inventory.some(i => i.name === 'Machete') && s.inventory.some(i => i.name === 'Rune axe'));
                }
                if (s.solved > 0) {
                    assert(sawSecondLeg && sawGuardian && (mode !== 'entrana' || sawEntrana));
                    assert.deepEqual(s.equipment, outfit);
                    assert.deepEqual(s.failures, { equip: mode === 'entrana' ? 1 : 0, withdrawal: 1 });
                    assert([...logs].some(l => l.includes("'Machete' withdrawal did not land")));
                    if (mode === 'map') assert([...logs].some(l => l.includes('Kharazi jungle needs')));
                    await page.screenshot({ path: `docs/e2e/jivedragons-${mode}-kharazi-transition-live.png` });
                    console.log(JSON.stringify({ result: 'PASS', mode, hp: s.hp, failures: s.failures, outfit: s.equipment, inventory: s.inventory }));
                    complete = true;
                    break;
                }
                if (Date.now() - lastPrint > 15_000) { console.log(JSON.stringify({ mode, ...s })); lastPrint = Date.now(); }
                await page.waitForTimeout(250);
            }
            assert(complete, JSON.stringify({ mode, sawEntrana, sawSecondLeg, sawGuardian, logs: [...logs] }));
        } finally {
            if (page) {
                console.log(await page.evaluate(() => (globalThis as unknown as Api).rs2b0t?.runner.ctx?.log.map(l => l.msg)).catch(() => []));
                await stopScript(page).catch(() => {});
            }
            await browser?.close();
            client.cleanup();
        }
    }
} finally {
    await engine.stop();
}
