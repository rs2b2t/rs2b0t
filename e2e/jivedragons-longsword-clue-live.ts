import assert from 'node:assert/strict';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import type { GroundItems } from '../src/bot/api/grounditems/GroundItems.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type JiveDragons from '../src/bot/scripts/JiveDragons/JiveDragons.js';
import { deployIsolatedClient, launchBrowser, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Equipment: typeof Equipment; Inventory: typeof Inventory; Skills: typeof Skills; Npcs: typeof Npcs; GroundItems: typeof GroundItems; Game: typeof Game };
    rs2b0t: { runner: { bot: JiveDragons | null; state: string; ctx: { log: { msg: string }[] } | null } };
}

const base = positionalArgs(process.argv.slice(2), 'http://localhost:8890')[0];
const guardian = process.argv.includes('--guardian');
const kind = guardian ? 'guardian' : 'puzzle';
const user = `jc${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
    await mainlandAccount(page, base, user, client.page);
    await cheatQuiet(page, 'setvar zanaris 6');
    await cheatQuiet(page, 'setvar itwatchtower 14');
    await relog(page, user);
    for (const [skill, level] of [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 90], ['prayer', 70], ['magic', 80]] as const) {
        await cheatQuiet(page, `setstat ${skill} ${level}`, 650);
    }
    await clearChatDialogs(page, 'combat levels');
    await seedItemsToBank(page, [
        { debugName: 'shark', displayName: 'Shark', qty: 100 },
        { debugName: 'lobster', displayName: 'Lobster', qty: 50 },
        { debugName: 'dusty_key', displayName: 'Dusty key', qty: 1 },
        { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 5 },
        { debugName: 'coins', displayName: 'Coins', qty: 10000 },
        { debugName: 'shantay_pass', displayName: 'Shantay pass', qty: 5 },
        ...[['spade', 'Spade'], ['trail_sextant', 'Sextant'], ['trail_watch', 'Watch'], ['trail_chart', 'Chart']]
            .map(([debugName, displayName]) => ({ debugName, displayName, qty: 1 })),
        ...['air', 'water', 'earth', 'fire', 'law'].map(rune => ({ debugName: `${rune}rune`, displayName: `${rune[0].toUpperCase()}${rune.slice(1)} rune`, qty: 500 }))
    ], { x: 2946, z: 3369, level: 0 });
    for (const [debug, name] of [
        ['dragon_longsword', 'Dragon longsword'], ['antidragonbreathshield', 'Dragonfire shield'],
        ['rune_full_helm', 'Rune full helm'], ['rune_chainbody', 'Rune chainbody'], ['rune_platelegs', 'Rune platelegs']
    ]) {
        await cheatQuiet(page, `give ${debug} 1`, 650);
        assert(await page.evaluate(item => (globalThis as unknown as Api).__rs2b0t.Equipment.equip(item), name));
    }
    await cheatQuiet(page, 'setvar trail_status 6');
    await cheatQuiet(page, `give ${guardian ? 'trail_clue_hard_sextant025' : 'trail_clue_hard_riddle017'} 1`);
    await cheatQuiet(page, 'give lobster 27');
    assert.equal(await page.evaluate(() => (globalThis as unknown as Api).__rs2b0t.Inventory.free()), 0);
    await setSettings(page, 'JiveDragons', {
        site: 'taverley-blue', combatStyle: 'melee', weapon: 'Dragon longsword',
        usePotions: false, useSpecial: false, solveClues: true, foodWithdraw: 20, leaveVia: 'walk'
    });
    await startScript(page, 'JiveDragons');
    const logs = new Set<string>();
    let sawEncounter = false;
    let preparedFree: number | null = null;
    let complete = false;
    let filledPuzzlePack = false;
    let completionBankTrips: number | null = null;
    let lastPrint = 0;
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
            const g = globalThis as unknown as Api;
            const bot = g.rs2b0t.runner.bot;
            const a = g.__rs2b0t;
            return {
                state: g.rs2b0t.runner.state, status: bot?.status, solved: bot?.cluesSolved ?? 0,
                bankTrips: bot?.bankTrips ?? 0,
                inventory: a.Inventory.items().map(i => ({ name: i.name, count: i.count, noted: i.noted })),
                died: bot?.died, parked: bot?.parked, hp: a.Skills.effective('hitpoints'),
                weapon: a.Equipment.items().find(i => i.slot === 3)?.name,
                free: a.Inventory.free(), sharks: a.Inventory.count('Shark'),
                puzzle: a.Inventory.countById(2800) > 0,
                remainingLoot: a.GroundItems.query().results().filter(g => {
                    const here = a.Game.tile();
                    const tile = g.tile();
                    return here && tile.x === here.x && tile.z === here.z && tile.level === here.level && g.id !== 385 && g.id !== 379;
                }).map(g => g.name),
                guardian: a.Npcs.all().some(n => n.name === 'Saradomin Wizard' && n.targetsMe()),
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
            };
        });
        assert(s.state === 'running' && !s.died && !s.parked && s.hp > 0, JSON.stringify(s));
        assert.equal(s.weapon, 'Dragon longsword');
        for (const line of s.logs) logs.add(line);
        if (preparedFree === null && s.logs.some(l => l.includes('trail pack:'))) {
            preparedFree = s.free;
            assert.equal(s.sharks, 15);
            if (!guardian) assert(preparedFree >= 1, JSON.stringify(s));
        }
        sawEncounter ||= guardian ? s.guardian : s.puzzle;
        if (!guardian && s.puzzle && !filledPuzzlePack) {
            if (s.free > 0) await cheatQuiet(page, `give lobster ${s.free}`);
            filledPuzzlePack = true;
        }
        if (s.solved > 0) {
            assert.deepEqual(s.remainingLoot, []);
            if (completionBankTrips === null) completionBankTrips = s.bankTrips;
            if (s.bankTrips > completionBankTrips) {
                const counts = new Map(s.inventory.map(i => [i.name, i.count]));
                assert.equal(s.inventory.filter(i => i.name === 'Lobster' && !i.noted).length, 20);
                assert.equal(counts.get('Air rune'), 9);
                assert.equal(counts.get('Water rune'), 3);
                assert.equal(counts.get('Law rune'), 3);
                assert(s.inventory.every(i => ['Lobster', 'Air rune', 'Water rune', 'Law rune', 'Dusty key'].includes(i.name ?? '')), JSON.stringify(s.inventory));
                complete = true;
                break;
            }
        }
        if (Date.now() - lastPrint > 15000) { console.log(JSON.stringify(s)); lastPrint = Date.now(); }
        await page.waitForTimeout(250);
    }
    assert(complete && sawEncounter && preparedFree !== null, JSON.stringify({ complete, sawEncounter, preparedFree, logs: [...logs] }));
    if (!guardian) assert([...logs].some(l => /puzzle (already solved|solved in)/.test(l)));
    await page.screenshot({ path: `docs/e2e/jivedragons-longsword-${kind}-live.png` });
    console.log(`PASS: full starting pack, no dagger supplied, Dragon longsword retained through ${kind} and completed clue plus full inventory bank reset; prepared free slots ${preparedFree}; collected ${[...logs].filter(l => l.includes('from the treasure trail')).length} spilled rewards`);
} finally {
    console.log(await page.evaluate(() => (globalThis as unknown as Api).rs2b0t?.runner.ctx?.log.map(l => l.msg)).catch(() => []));
    await stopScript(page).catch(() => {});
    await browser.close();
    client.cleanup();
}
