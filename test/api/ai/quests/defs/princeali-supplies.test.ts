import { describe, expect, test } from 'bun:test';

import { PA_ITEM, PA_SHOP, PA_TILE } from '#/bot/api/ai/quests/defs/princeali/areas.js';
import {
    PURSE_FLOOR,
    PURSE_TOP,
    banked,
    buyItem,
    fromBank,
    grabItem,
    hasAnyPickaxe,
    held,
    owned,
    scanBank,
    sourceCoins
} from '#/bot/api/ai/quests/defs/princeali/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    ...extra
});

describe('counting', () => {
    test('held, banked and owned read the id maps', () => {
        const s = snap([[PA_ITEM.ROPE.id, 2]], [[PA_ITEM.ROPE.id, 5]]);
        expect(held(s, PA_ITEM.ROPE.id)).toBe(2);
        expect(banked(s, PA_ITEM.ROPE.id)).toBe(5);
        expect(owned(s, PA_ITEM.ROPE.id)).toBe(7);
    });

    test('a plain wig does not count as a blond one', () => {
        const s = snap([[PA_ITEM.PLAIN_WIG.id, 1]]);
        expect(held(s, PA_ITEM.BLOND_WIG.id)).toBe(0);
        expect(held(s, PA_ITEM.PLAIN_WIG.id)).toBe(1);
    });

    test('any pickaxe counts, held or worn', () => {
        expect(hasAnyPickaxe(snap())).toBe(false);
        expect(hasAnyPickaxe(snap([[1265, 1]]))).toBe(true);
        expect(hasAnyPickaxe(snap([], [], { wornIds: new Set([1271]) }))).toBe(true);
    });

    test('a banked pickaxe is not a held one', () => {
        expect(hasAnyPickaxe(snap([], [[1265, 1]]))).toBe(false);
    });
});

describe('fromBank', () => {
    test('null once the pack has enough', () => {
        expect(fromBank(snap([[PA_ITEM.ROPE.id, 2]]), PA_ITEM.ROPE, 2)).toBeNull();
    });

    test('scans first when the bank has never been seen', () => {
        const s = snap([], [], { bankKnown: false });
        expect(fromBank(s, PA_ITEM.ROPE, 1)).toEqual(scanBank());
    });

    test('withdraws by id, capped at what the bank holds', () => {
        const step = fromBank(snap([], [[PA_ITEM.ROPE.id, 1]]), PA_ITEM.ROPE, 2);
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Rope', id: 954, qty: 1 }]);
    });

    test('withdraw steps use the nearest bank, not a fixed one', () => {
        const step = fromBank(snap([], [[PA_ITEM.ROPE.id, 1]]), PA_ITEM.ROPE, 1);
        expect(step?.kind === 'withdraw' && step.bank).toBeUndefined();
    });

    test('null when neither pack nor bank can supply it', () => {
        expect(fromBank(snap(), PA_ITEM.ROPE, 1)).toBeNull();
    });
});

describe('buyItem', () => {
    test('bank before shop', () => {
        const step = buyItem(snap([], [[PA_ITEM.TINDERBOX.id, 1]]), PA_ITEM.TINDERBOX, 1, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind).toBe('withdraw');
    });

    test('shop when the bank is empty, priced for the shortfall', () => {
        const step = buyItem(snap(), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind === 'buy' && step.item).toBe('Beer');
        expect(step?.kind === 'buy' && step.qty).toBe(3);
        expect(step?.kind === 'buy' && step.estGp).toBe(30);
    });

    test('only buys the shortfall', () => {
        const step = buyItem(snap([[PA_ITEM.BEER.id, 1]]), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind === 'buy' && step.qty).toBe(2);
    });

    test('null once satisfied', () => {
        expect(buyItem(snap([[PA_ITEM.BEER.id, 3]]), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10)).toBeNull();
    });
});

describe('grabItem', () => {
    test('bank before the ground spawn', () => {
        const step = grabItem(snap([], [[PA_ITEM.PICKAXE.id, 1]]), PA_ITEM.PICKAXE, PA_TILE.PICKAXE_SPAWN);
        expect(step?.kind).toBe('withdraw');
    });

    test('otherwise walks to the spawn and waits for a respawn', () => {
        const step = grabItem(snap(), PA_ITEM.LOGS, PA_TILE.LOGS_SPAWN);
        expect(step?.kind === 'grabGround' && step.item).toBe('Logs');
        expect(step?.kind === 'grabGround' && step.waitIfMissing).toBe(true);
    });

    test('null once held', () => {
        expect(grabItem(snap([[PA_ITEM.LOGS.id, 1]]), PA_ITEM.LOGS, PA_TILE.LOGS_SPAWN)).toBeNull();
    });
});

describe('sourceCoins', () => {
    test('null while the purse is above the floor', () => {
        expect(sourceCoins(snap([[PA_ITEM.COINS.id, PURSE_FLOOR]]), PURSE_FLOOR, PURSE_TOP)).toBeNull();
    });

    test('tops up to PURSE_TOP when below the floor', () => {
        const step = sourceCoins(snap([[PA_ITEM.COINS.id, 10]], [[PA_ITEM.COINS.id, 2_000_000]]), PURSE_FLOOR, PURSE_TOP);
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', id: 995, qty: PURSE_TOP - 10 }]);
    });

    test('takes what the bank has when it cannot cover the top-up', () => {
        const step = sourceCoins(snap([], [[PA_ITEM.COINS.id, 40]]), PURSE_FLOOR, PURSE_TOP);
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', id: 995, qty: 40 }]);
    });

    test('an empty bank and an empty purse is an honest wait, not a loop', () => {
        expect(sourceCoins(snap(), PURSE_FLOOR, PURSE_TOP)?.kind).toBe('wait');
    });

    test('scans an unseen bank before deciding it is empty', () => {
        const s = snap([], [], { bankKnown: false });
        expect(sourceCoins(s, PURSE_FLOOR, PURSE_TOP)).toEqual(scanBank());
    });

    test('the floor is low enough that a shop trip does not trigger a bank trip', () => {
        // Every purchase in this quest is well under PURSE_FLOOR, so a purse topped to
        // PURSE_TOP survives the route without bouncing back to a bank.
        expect(PURSE_TOP - PURSE_FLOOR).toBeGreaterThan(500);
    });
});
