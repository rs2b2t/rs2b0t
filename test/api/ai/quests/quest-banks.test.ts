import { describe, expect, test } from 'bun:test';

import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import type Tile from '#/bot/geometry/Tile.js';

const bankKeys = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

/** The quests that name a bank. The rest ask for whichever one is nearest. */
const pinned = QUEST_DEFS
    .filter(d => d.bank !== undefined && d.bank !== 'nearest')
    .map(d => ({ id: d.record.id, tile: d.bank as Tile }));

describe('per-quest provisioning bank', () => {
    test('every implemented quest declares a bank, or asks for the nearest', () => {
        const missing = QUEST_DEFS.filter(d => d.bank === undefined).map(d => d.record.id);
        expect(missing).toEqual([]);
    });

    test('every pinned quest bank is a real known BANK_LOCATIONS tile', () => {
        for (const { id, tile } of pinned) {
            expect(bankKeys.has(`${tile.x},${tile.z},${tile.level}`), `${id} → (${tile.x},${tile.z},${tile.level})`).toBe(true);
        }
    });

    test('every pinned quest bank is level 0', () => {
        for (const { id, tile } of pinned) {
            expect(tile.level, id).toBe(0);
        }
    });
});

// Why: a free quest is fought at low level against low-level things, and the pack pays for food it never eats with slots the quest items need. Dragon Slayer keeps its ration, since Elvarg is the one free fight that earns it.
describe('food on the free quests', () => {
    const FREE_WITH_FOOD = ['blackknight', 'demon', 'haunted', 'gobdip', 'squire', 'hunt', 'blackarmgang', 'vampire'];

    test('none of the free quests carries a food float, Dragon Slayer aside', () => {
        for (const id of FREE_WITH_FOOD) {
            const module = QUEST_DEFS.find(m => m.record.id === id);
            expect(module, `no module for '${id}'`).toBeDefined();
            expect(module!.food, `${id} still asks for food`).toBeUndefined();
        }
    });

    test('Dragon Slayer keeps its ration', () => {
        const ds = QUEST_DEFS.find(m => m.record.id === 'dragon');
        expect(ds?.food).toBeGreaterThan(0);
    });
});
