import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EC_ID } from '#/bot/api/ai/quests/defs/ernest/areas.js';
import { kit } from '#/bot/api/ai/quests/defs/ernest/supplies.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { ernestSnapshot } from './ernest-snapshot.fixture.js';

// QuestFood is a live module-level object; restore it or this file silently
// changes whichever test bun runs next.
const originalFood = QuestFood.name;
beforeAll(() => { QuestFood.name = 'Lobster'; });
afterAll(() => { QuestFood.name = originalFood; });

function snap(options: {
    invIds?: [number, number][];
    bankIds?: [number, number][];
    /** Name-keyed, like the live snapshot: this is where food is looked up. */
    bank?: [string, number][];
    food?: number;
    bankKnown?: boolean;
} = {}): QuestSnapshot {
    return ernestSnapshot({ ...options, journal: 'inProgress', food: options.food ?? 10 });
}

describe('Ernest kit()', () => {
    test('asks for nothing when the spade and food are already packed', () => {
        expect(kit(snap())).toBeNull();
    });

    test('scans the bank before deciding anything when the bank is unknown', () => {
        expect(kit(snap({ invIds: [], bankKnown: false }))?.kind).toBe('scanBank');
    });

    test('withdraws a banked spade by id, not by name', () => {
        const step = kit(snap({ invIds: [], bankIds: [[EC_ID.SPADE, 1]] }));
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]).toEqual({ name: 'Spade', qty: 1, id: EC_ID.SPADE });
    });

    test('falls back to the manor ground spawn when no spade is banked', () => {
        const step = kit(snap({ invIds: [] }));
        expect(step?.kind).toBe('grabGround');
        expect(step?.kind === 'grabGround' && step.item).toBe('Spade');
    });

    test('leaves a comfortable pack alone even with food banked', () => {
        expect(kit(snap({ food: 6, bank: [['lobster', 40]] }))).toBeNull();
    });

    // Why: nothing in the manor is aggressive and the quest is free, so the trip carries the spade and nothing to eat.
    test('draws the spade and never the food, however much of it the bank holds', () => {
        const step = kit(snap({ food: 1, invIds: [], bankIds: [[EC_ID.SPADE, 1]], bank: [['lobster', 40]] }));
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Spade', qty: 1, id: EC_ID.SPADE }]);
    });

    test('asks for nothing once the spade is held, however empty the pack is of food', () => {
        expect(kit(snap({ food: 0, bank: [['lobster', 40]] }))).toBeNull();
    });
});
