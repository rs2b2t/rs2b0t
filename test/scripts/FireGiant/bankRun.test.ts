import { expect, test } from 'bun:test';
import FireGiant from '#/bot/scripts/FireGiant/FireGiant.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends FireGiant {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void {
        this.registered.push(...tasks);
    }
}

interface Item {
    id: number;
    name: string;
    slot: number;
    count: number;
    ops: string[];
    comId: number;
}

const item = (id: number, name: string, slot: number, count = 1): Item => ({ id, name, slot, count, ops: [], comId: 1 });

/** Lobsters, then the rope and the two Camelot rune stacks a restock leaves, then any loot. */
function pack(food: number, loot: Item[] = []): Item[] {
    return [
        ...Array.from({ length: food }, (_, s) => item(379, 'Lobster', s)),
        item(954, 'Rope', food),
        item(556, 'Air rune', food + 1, 15),
        item(563, 'Law rune', food + 2, 3),
        ...loot.map((i, k) => ({ ...i, slot: food + 3 + k }))
    ];
}

const bones = (n: number): Item[] => Array.from({ length: n }, () => item(532, 'Big bones', 0));

const AMULET = item(589, "Glarial's amulet", 2);
const MELEE_GEAR = [item(1333, 'Rune scimitar', 3), AMULET];
const RANGE_GEAR = [item(853, 'Maple shortbow', 3), item(884, 'Iron arrow', 13, 500), AMULET];
const MAGE_GEAR = [item(1387, 'Staff of fire', 3), AMULET];

async function bankRunValid(settings: Record<string, unknown>, inventory: Item[], equipment: Item[] = MELEE_GEAR): Promise<boolean> {
    const restores = [
        stubProps(reader, {
            bankComId: () => -1,
            inventorySize: () => 28,
            inventory: () => inventory,
            equipment: () => equipment
        }),
        stubProps(Game, { ingame: () => true, tile: () => new Tile(2568, 9893) }),
        stubProps(Quests, { status: () => 'complete' }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(Skills, { xp: () => 0, level: () => 99, effective: () => 99, hpFraction: () => 1 })
    ];
    const bot = new Fighter();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ escapeTele: 'Camelot', loot: ['Big bones'], buryBones: false, ...settings });
    try {
        await bot.onStart();
        const bankRun = bot.registered.find(task => task.constructor.name === 'BankRun')!;
        return await bankRun.validate();
    } finally {
        bot.disposeSubscriptions();
        for (const restore of restores.reverse()) restore();
    }
}

test('a restock that fills the pack with kit alone does not bank before fighting', async () => {
    // 25 food + rope + air + law = 28 slots, nothing to deposit.
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 25 }, pack(25))).toBe(false);
});

test('one looted bones topping off a 24-food restock does not bank before fighting', async () => {
    // 24 food + rope + air + law = 27 slots; the bones take slot 28.
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 24 }, pack(24, bones(1)))).toBe(false);
});

test('an ordinary pack full of wanted loot still banks', async () => {
    // The default 20-food restock leaves five slots; five bones fill them.
    expect(await bankRunValid({ combatStyle: 'range', foodWithdraw: 20 }, pack(20, bones(5)), RANGE_GEAR)).toBe(true);
});

test('food back at the withdrawn amount still banks a full loot load', async () => {
    // Fire giants drop lobster, so an eaten food can be replaced mid-trip and the
    // food count alone cannot say whether the pack is freshly restocked.
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 20 }, pack(20, bones(5)))).toBe(true);
});

test('two bankable loot slots in a full pack bank', async () => {
    // One food eaten on a 24-food trip, then two bones held: a load, not a top-off.
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 24 }, pack(23, bones(2)))).toBe(true);
});

test('fire runes supplied by the wielded staff count as bankable loot', async () => {
    // The fire staff supplies Fire Bolt's fire runes, so the looted fire stack
    // deposits without being withdrawn again: with the bones, a two-slot load.
    const inventory = [
        ...Array.from({ length: 22 }, (_, s) => item(379, 'Lobster', s)),
        item(954, 'Rope', 22),
        item(556, 'Air rune', 23, 950),
        item(563, 'Law rune', 24, 3),
        item(562, 'Chaos rune', 25, 650),
        item(554, 'Fire rune', 26, 150),
        item(532, 'Big bones', 27)
    ];
    const settings = {
        combatStyle: 'mage', staff: 'Staff of fire', spell: 'Fire Bolt',
        foodWithdraw: 22, loot: ['Fire rune', 'Big bones'], bankCommonJunk: false
    };
    expect(await bankRunValid(settings, inventory, MAGE_GEAR)).toBe(true);
});

test('a pack that is not full does not bank on fullness', async () => {
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 20 }, pack(20, bones(2)))).toBe(false);
});

test('bones set to bury are not a bank load', async () => {
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 20, buryBones: true }, pack(20, bones(5)))).toBe(false);
});

test('running out of food still banks even with nothing to deposit', async () => {
    expect(await bankRunValid({ combatStyle: 'melee', foodWithdraw: 20 }, pack(0, bones(1)))).toBe(true);
});
