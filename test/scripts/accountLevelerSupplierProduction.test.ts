import { expect, spyOn, test } from 'bun:test';
import { supplierProduction } from '#/bot/scripts/AccountLeveler/economyProduction.js';
import type { LevelerSnapshot, SessionMemory } from '#/bot/scripts/AccountLeveler/types.js';
import GemCutter from '#/bot/scripts/GemCutter/GemCutter.js';
import VialFiller from '#/bot/scripts/VialFiller/VialFiller.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';

function snapshot(stock: Record<string, number> = {}): LevelerSnapshot {
    return { levels: Object.fromEntries(['attack', 'defence', 'strength', 'hitpoints', 'prayer', 'mining', 'woodcutting', 'crafting', 'smithing', 'runecraft', 'herblore', 'fishing', 'cooking', 'magic', 'ranged'].map(skill => [skill, 70])),
        bankReady: true, quests: {}, target: 70, wilderness: false, stock, now: 1 };
}
const memory: SessionMemory = { objective: null, recent: [], attempted: {}, cooldowns: {}, deaths: 0 };
const plans = (s: LevelerSnapshot) => supplierProduction(s, memory, () => 0);

test('a supplier without tools, supplies or cash can bank feathers from chickens', () => {
    const s = snapshot();
    s.levels = { attack: 1, strength: 1, defence: 1, hitpoints: 10 };
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'AutoFighter', needs: [], output: { item: 'Feather', count: 1000 },
        settings: expect.objectContaining({ target: 'Chicken', banking: 'Auto', foodWithdraw: 0, loot: expect.arrayContaining(['Feather']) }) }));
    expect(plans(s).some(p => ['Miner', 'Woodcutter', 'JiveDragons', 'GreenDragon', 'RuneCrafter'].includes(p.script))).toBe(false);
});

test.each([
    [30, ['Raw shrimps']],
    [40, ['Raw lobster']],
    [75, ['Raw lobster']],
    [76, ['Raw lobster', 'Raw shark']]
] satisfies [number, string[]][])('selects market catches at Fishing %i independently of Cooking', (level, expected) => {
    const s = snapshot({ coins: 200, 'small fishing net': 1, 'fly fishing rod': 1, feather: 1000, 'lobster pot': 1, harpoon: 1 });
    s.levels.fishing = level;
    s.levels.cooking = 1;
    expect(plans(s).filter(plan => plan.script === 'Fisher').map(plan => plan.output?.item)).toEqual(expected);
});

test('gatherers bank toward the next full lot, using the tools they already own', () => {
    const s = snapshot({ coins: 100000, 'bronze pickaxe': 1, 'bronze axe': 1, coal: 1650 });
    s.marketItem = () => 1359;
    expect(plans(s).map(plan => plan.output?.item)).not.toContain('Feather');
    expect(plans(s).map(plan => plan.output?.item)).not.toContain('Copper ore');
    expect(plans(s).map(plan => plan.output?.item)).not.toContain('Tin ore');
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'Miner', output: { item: 'Coal', count: 2000 },
        needs: expect.arrayContaining([expect.objectContaining({ item: 'Bronze pickaxe' })]), settings: expect.objectContaining({ bank: true }) }));
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'Woodcutter', output: { item: 'Yew logs', count: 1000 } }));
    expect(plans(s).some(p => p.script === 'EssMiner')).toBe(false);
    s.quests['Rune Mysteries Quest'] = true;
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'EssMiner' }));
    expect(plans(s).some(p => p.script === 'RuneCrafter')).toBe(false);
    Object.assign(s.stock, { 'air talisman': 1, 'rune essence': 28 });
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'RuneCrafter', output: { item: 'Air rune', count: 2001 } }));
});

test('equipped suppliers keep dragon hides, bones, individual herbs, gems, and equipment drops', () => {
    const s = snapshot({ coins: 200, 'rune scimitar': 1, 'iron chainbody': 1, 'iron platelegs': 1, 'dragonfire shield': 1, lobster: 70 });
    const choices = plans(s);
    expect(choices).toContainEqual(expect.objectContaining({ script: 'JiveDragons', settings: expect.objectContaining({ buryBones: false, loot: expect.arrayContaining(['Dragon bones', 'Dragonhide', 'Uncut ruby', 'Rune dagger']) }) }));
    expect(choices).toContainEqual(expect.objectContaining({ script: 'AutoFighter', output: { item: 'Big bones', count: 1000 },
        settings: expect.objectContaining({ target: 'Giant', buryBones: false, buryBigBones: false, loot: expect.arrayContaining(['Big bones', 'Iron full helm']) }) }));
    expect(choices).toContainEqual(expect.objectContaining({ script: 'AutoFighter', output: expect.objectContaining({ item: 'Herb', id: 199 }),
        settings: expect.objectContaining({ target: 'Chaos druid', loot: expect.arrayContaining(['Herb', 'Vial of water']) }) }));
    expect(choices.some(plan => plan.wilderness)).toBe(false);
    delete s.stock['dragonfire shield'];
    expect(plans(s).some(p => p.script === 'JiveDragons')).toBe(false);
});

test('banked materials unlock gem cutting, smithing, vial filling and brewing at their requirements', () => {
    const s = snapshot({ chisel: 1, 'uncut sapphire': 3, vial: 5, hammer: 1, 'steel bar': 5, 'irit leaf': 5, 'eye of newt': 8, 'vial of water': 4 });
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'GemCutter', settings: { gems: ['Sapphire'] } }));
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'VialFiller', output: { item: 'Vial of water', count: 1000 } }));
    for (const item of ['Steel scimitar', 'Steel platebody']) expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'SmithingBot', output: { item, count: 1000 } }));
    expect(plans(s).some(p => p.script === 'PotionMaker')).toBe(false);
    s.quests['Druidic Ritual'] = true;
    s.stock['#199'] = 10;
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'HerbCleaner', output: { item: 'Guam leaf', count: 1000 } }));
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'PotionMaker', output: { item: 'Super attack(3)', count: 1000 },
        settings: expect.objectContaining({ herb: 'Irit leaf', secondary: 'Eye of newt', outputId: 145 }) }));
    s.levels.crafting = 1;
    s.levels.smithing = 5;
    s.levels.herblore = 10;
    expect(plans(s).some(p => ['SmithingBot', 'GemCutter', 'PotionMaker'].includes(p.script))).toBe(false);
});

test('depleted gem and vial children finish their activity while their supplier keeps running', async () => {
    const stopped: string[] = [];
    const gem = new GemCutter();
    gem.bindFinish(reason => stopped.push(reason));
    gem.deny({ key: 'sapphire', name: 'Sapphire', level: 20, cutId: 1607, uncutId: 1623, xp: 500, canCrush: false });
    const vials = new VialFiller();
    vials.bindFinish(reason => stopped.push(reason));
    const patches = [
        spyOn(Game, 'tile').mockReturnValue({ x: 2946, z: 3369, level: 0 }),
        spyOn(Bank, 'openNearest').mockResolvedValue(true), spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined),
        spyOn(Bank, 'count').mockReturnValue(0), spyOn(Inventory, 'count').mockReturnValue(0)
    ];
    try {
        await vials.loop();
        expect(stopped).toEqual(['no cuttable gems remain', 'no Vials left in the bank']);
    } finally {
        for (const patch of patches) patch.mockRestore();
    }
});

test('tracks the blue hide lot independently from other colours, and permits rune platebodies at 99', () => {
    const s = snapshot({ coins: 200, lobster: 70, 'rune scimitar': 1, 'iron chainbody': 1,
        'iron platelegs': 1, 'dragonfire shield': 1, '#1751': 900, '#1753': 700, dragonhide: 1600, 'runite bar': 5, hammer: 1 });
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'JiveDragons', output: { item: 'Dragonhide', id: 1751, count: 1000 } }));
    s.levels.smithing = 98;
    expect(plans(s).some(p => p.output?.item === 'Rune platebody')).toBe(false);
    s.levels.smithing = 99;
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'SmithingBot', output: { item: 'Rune platebody', count: 1000 } }));
});

test('dragon suppliers can walk with banked lobsters when sharks and teleport runes would need acquiring', () => {
    const s = snapshot({ coins: 50000, harpoon: 1, lobster: 40, 'dragonfire shield': 1, 'rune scimitar': 1, 'iron platelegs': 1, 'iron chainbody': 1, 'law talisman': 1 });
    s.levels.fishing = 80;
    s.levels.cooking = 80;
    s.quests['Rune Mysteries Quest'] = true;
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'JiveDragons', food: 'Lobster',
        settings: expect.objectContaining({ food: 'Lobster', leaveVia: 'walk' }) }));
});

test('gathers and processes secondaries with owned travel supplies, food, tools and keys', () => {
    const s = snapshot({ coins: 200 });
    const products = () => plans(s).filter(plan => plan.script === 'HerbloreSecondaries').map(plan => plan.output?.item);
    expect(products()).toEqual([]);
    Object.assign(s.stock, { trout: 6, 'pestle and mortar': 1, 'unicorn horn': 3 });
    expect(products()).toContain('Snape grass');
    expect(products()).toContain('Unicorn horn dust');
    expect(products()).not.toContain('Blue dragon scale');
    expect(products()).not.toContain("Red spiders' eggs");
    Object.assign(s.stock, { 'dragonfire shield': 1, 'dusty key': 1 });
    expect(plans(s)).toContainEqual(expect.objectContaining({ script: 'HerbloreSecondaries',
        settings: expect.objectContaining({ secondary: 'Blue dragon scale', food: 'Trout', foodWithdraw: 6 }),
        needs: expect.arrayContaining([{ item: 'Dusty key', count: 1, carry: 1 }, { item: 'Dragonfire shield', count: 1, carry: 1, equip: true }]) }));
    s.wilderness = true;
    expect(products()).toContain("Red spiders' eggs");
    expect(products()).toContain('White berries');
    expect(products()).not.toContain("Toad's legs");
    expect(products()).not.toContain('Eye of newt');
    expect(products()).not.toContain('Chocolate dust');
});
