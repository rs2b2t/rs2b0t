import assert from 'node:assert/strict';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import { siteFor } from '../src/bot/api/combat/hunting/sites.js';
import type JiveDragons from '../src/bot/scripts/JiveDragons/JiveDragons.js';
import { deployIsolatedClient, launchBrowser, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Inventory: typeof Inventory; Equipment: typeof Equipment; Skills: typeof Skills; Game: typeof Game; Npcs: typeof Npcs };
    rs2b0t: { runner: { bot: JiveDragons | null; state: string; ctx: { log: { msg: string }[] } | null } };
}

const base = process.env.BASE ?? positionalArgs(process.argv.slice(2), 'http://localhost:8890')[0];
const user = `jm${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
const guardian = process.argv.includes('--guardian');
const option = (name: string, fallback: string): string => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const site = siteFor(option('--site', 'taverley-blue'));
assert(['taverley-blue', 'heroes-blue', 'gutanoth-blue'].includes(site.key), 'unsupported blue dragon site');
const targets = option('--targets', 'both');
const food = site.food ?? 'Lobster';
const foodDebug = food.toLowerCase();
const caseName = `${site.key}-${targets}-${guardian ? 'guardian' : 'map'}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
const gear = [
    ['rune_scimitar', 'Rune scimitar'], ['antidragonbreathshield', 'Dragonfire shield'],
    ['rune_full_helm', 'Rune full helm'], ['rune_chainbody', 'Rune chainbody'], ['rune_platelegs', 'Rune platelegs']
];
const potions = ['Super attack', 'Super strength', 'Super defence'];
const logs = new Set<string>();
try {
    await mainlandAccount(page, base, user, client.page);
    await cheatQuiet(page, 'setvar zanaris 6');
    if (site.key === 'heroes-blue') await cheatQuiet(page, 'setvar heroquest 15');
    if (site.key === 'gutanoth-blue') await cheatQuiet(page, 'setvar itwatchtower 14');
    await relog(page, user);
    for (const [skill, level] of [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 90], ['prayer', 70], ['magic', 80], ['agility', 40]] as const) {
        await cheatQuiet(page, `setstat ${skill} ${level}`, 650);
    }
    await clearChatDialogs(page, 'combat levels');
    await seedItemsToBank(page, [
        { debugName: 'lobster', displayName: 'Lobster', qty: 200 },
        { debugName: 'shark', displayName: 'Shark', qty: 100 },
        { debugName: '3dose2attack', displayName: 'Super attack(3)', qty: 10 },
        { debugName: '3dose2strength', displayName: 'Super strength(3)', qty: 10 },
        { debugName: '3dose2defense', displayName: 'Super defence(3)', qty: 10 },
        { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 10 },
        { debugName: 'dragon_dagger_p', displayName: 'Dragon dagger(p)', qty: 1 },
        { debugName: 'dusty_key', displayName: 'Dusty key', qty: 1 },
        { debugName: 'spade', displayName: 'Spade', qty: 1 },
        { debugName: 'trail_sextant', displayName: 'Sextant', qty: 1 },
        { debugName: 'trail_watch', displayName: 'Watch', qty: 1 },
        { debugName: 'trail_chart', displayName: 'Chart', qty: 1 },
        { debugName: 'coins', displayName: 'Coins', qty: 10000 },
        ...['air', 'water', 'earth', 'fire', 'law'].map(rune => ({ debugName: `${rune}rune`, displayName: `${rune[0].toUpperCase()}${rune.slice(1)} rune`, qty: 500 }))
    ], { x: 2946, z: 3369, level: 0 });
    for (const [debug, name] of gear) {
        await cheatQuiet(page, `give ${debug} 1`, 650);
        assert(await page.evaluate(item => (globalThis as unknown as Api).__rs2b0t.Equipment.equip(item), name), `could not equip ${name}`);
    }
    for (const [item, qty] of [[foodDebug, 10], ['3dose2attack', 1], ['3dose2strength', 1], ['3dose2defense', 1], ['dusty_key', 1], ['airrune', 6], ['waterrune', 2], ['lawrune', 4], ['earthrune', 4]]) {
        await cheatQuiet(page, `give ${item} ${qty}`, 650);
    }
    assert(await teleTo(page, site.meleeAnchor, 2, 30000), 'could not reach the blue dragon camp');
    await setSettings(page, 'JiveDragons', {
        site: site.key, enclaveTargets: targets, combatStyle: 'melee', meleeStyle: 'strength', weapon: 'Rune scimitar',
        usePotions: true, solveClues: true, useSpecial: false, foodWithdraw: 10, buryBones: false,
        loot: 'Dragon bones, Dragonhide', leaveVia: 'teleport', logDetail: 'Verbose'
    });
    await startScript(page, 'JiveDragons');
    let seeded = false;
    let tripsAtSolve = 0;
    let killsAtSolve: number | null = null;
    let restocked = false;
    let complete = false;
    let lastPrint = 0;
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
            const g = globalThis as unknown as Api;
            const bot = g.rs2b0t.runner.bot;
            const a = g.__rs2b0t;
            return {
                state: g.rs2b0t.runner.state, status: bot?.status, parked: bot?.parked, died: bot?.died,
                hp: a.Skills.effective('hitpoints'), tile: a.Game.tile(), kills: bot?.killsTotal ?? 0,
                trips: bot?.bankTrips ?? 0, solved: bot?.cluesSolved ?? 0,
                clueStatus: bot?.solveClue?.clueStatus(), sharks: a.Inventory.count('Shark'),
                pack: a.Inventory.items().map(i => i.name ?? ''), worn: a.Equipment.items().map(i => i.name ?? ''),
                attackers: a.Npcs.all().filter(n => n.targetsMe()).map(n => ({ name: n.name, index: n.index, hp: n.health })),
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
            };
        });
        for (const line of s.logs) logs.add(line);
        assert(s.state === 'running' && !s.parked && !s.died && s.hp > 0, JSON.stringify(s));
        if (Date.now() - lastPrint > 15000) {
            console.log(JSON.stringify({ status: s.status, hp: s.hp, tile: s.tile, kills: s.kills, trips: s.trips, solved: s.solved, clueStatus: s.clueStatus, sharks: s.sharks, worn: s.worn, attackers: s.attackers, logs: s.logs.slice(-3) }));
            lastPrint = Date.now();
        }
        const drankSet = potions.every(name => [...logs].some(line => line.startsWith(`drank ${name}(`)));
        if (!seeded && s.kills > 0 && drankSet) {
            await cheatQuiet(page, 'setvar trail_status 6');
            await cheatQuiet(page, `give ${guardian ? 'trail_clue_hard_sextant025' : 'trail_clue_hard_map001'} 1`);
            seeded = true;
            console.log(`Seeded final hard-clue step (${guardian ? 'guardian' : 'map'}) after a melee kill and all three super potions`);
        }
        if (seeded && s.solved > 0 && killsAtSolve === null) {
            killsAtSolve = s.kills;
            tripsAtSolve = s.trips;
            console.log('Clue completed; waiting for dragon restock and resumed combat');
        }
        if (killsAtSolve !== null && s.trips > tripsAtSolve && potions.every(name => s.pack.some(item => item.startsWith(`${name}(`))) && s.worn.includes('Dragonfire shield')) restocked = true;
        if (restocked && killsAtSolve !== null && s.kills > killsAtSolve) {
            complete = true;
            break;
        }
        await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: `docs/e2e/jivedragons-${caseName}-live.png` });
    assert(complete, `cycle did not complete: ${[...logs].slice(-30).join('\n')}`);
    console.log(`PASS (${caseName}): melee kill, full super set, ${guardian ? 'guardian' : 'map'} clue completed, dragon restock and another kill; no deaths`);
} finally {
    console.log([...logs].filter(line => /super|guardian|wizard|clue|restock/i.test(line)).join('\n'));
    await stopScript(page).catch(() => {});
    await browser.close();
    client.cleanup();
}
