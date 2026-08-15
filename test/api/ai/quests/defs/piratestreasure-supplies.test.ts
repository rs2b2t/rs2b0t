import { expect, test, describe } from 'bun:test';
import { kit, COIN_TARGET, COIN_LOW } from '#/bot/api/ai/quests/defs/piratestreasure/supplies.js';
import { PT_ID } from '#/bot/api/ai/quests/defs/piratestreasure/areas.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (over: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(),
    bankKnown: true,
    ...over
});

describe('pirate kit', () => {
    test('an unread bank is scanned before anything is decided', () => {
        const step = kit(snap({ bankKnown: false }), false, false);
        expect(step?.kind).toBe('scanBank');
    });

    test('an empty pack withdraws the coin float', () => {
        const step = kit(snap({ bank: new Map([['coins', 100_000]]) }), false, false);
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]).toEqual({ name: 'Coins', qty: COIN_TARGET });
    });

    test('coins above the low-water mark are left alone', () => {
        const s = snap({ inv: new Map([['coins', COIN_LOW + 1]]), invIds: new Map([[PT_ID.COINS, COIN_LOW + 1]]), bank: new Map([['coins', 100_000]]) });
        expect(kit(s, false, false)).toBeNull();
    });

    test('a banked apron is withdrawn by id rather than bought', () => {
        const s = snap({
            inv: new Map([['coins', 5000]]),
            invIds: new Map([[PT_ID.COINS, 5000]]),
            bank: new Map([['coins', 5000], ['white apron', 1]]),
            bankIds: new Map([[PT_ID.WHITE_APRON, 1]])
        });
        const step = kit(s, true, false);
        expect(step?.kind === 'withdraw' && step.items[0]).toEqual({ name: 'White apron', qty: 1, id: PT_ID.WHITE_APRON });
    });

    test('no banked apron buys one at Thessalia', () => {
        const s = snap({ inv: new Map([['coins', 5000]]), invIds: new Map([[PT_ID.COINS, 5000]]), bank: new Map([['coins', 5000]]) });
        const step = kit(s, true, false);
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Thessalia');
    });

    test('a worn apron counts as held', () => {
        const s = snap({ inv: new Map([['coins', 5000]]), invIds: new Map([[PT_ID.COINS, 5000]]), wornIds: new Set([PT_ID.WHITE_APRON]), bank: new Map([['coins', 5000]]) });
        expect(kit(s, true, false)).toBeNull();
    });

    test('no banked spade falls back to the Falador park ground spawn', () => {
        const s = snap({ inv: new Map([['coins', 5000]]), invIds: new Map([[PT_ID.COINS, 5000]]), bank: new Map([['coins', 5000]]) });
        const step = kit(s, false, true);
        expect(step?.kind).toBe('grabGround');
        expect(step?.kind === 'grabGround' && step.item).toBe('Spade');
    });

    test('the spade is not fetched until the leg that digs asks for it', () => {
        const s = snap({ inv: new Map([['coins', 5000]]), invIds: new Map([[PT_ID.COINS, 5000]]), bank: new Map([['coins', 5000]]) });
        expect(kit(s, false, false)).toBeNull();
    });
});
