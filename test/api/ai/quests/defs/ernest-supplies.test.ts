import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EC_ID } from '#/bot/api/ai/quests/defs/ernest/areas.js';
import { kit } from '#/bot/api/ai/quests/defs/ernest/supplies.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

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
    return {
        journal: 'inProgress',
        inv: new Map([['lobster', options.food ?? 10]]),
        invIds: new Map(options.invIds ?? [[EC_ID.SPADE, 1]]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(options.bank ?? []),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: { x: 3093, z: 3243, level: 0 },
        freeSlots: 20
    };
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

    test('tops food up once the pack drops under the low-water mark', () => {
        const step = kit(snap({ food: 1, bank: [['lobster', 40]] }));
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]).toEqual({ name: 'Lobster', qty: 7 });
    });

    test('does not ask for food the bank does not have', () => {
        // An empty bank must not park the quest on a withdrawal that can never fill.
        expect(kit(snap({ food: 1 }))).toBeNull();
    });
});
