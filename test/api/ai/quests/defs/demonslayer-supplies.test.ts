import { expect, test } from 'bun:test';
import { decide } from '#/bot/api/ai/quests/defs/demonslayer.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

function snapshot(bones = 0, bankBones = 83): QuestSnapshot {
    return {
        journal: 'inProgress', inv: new Map([['key', 1], ['bones', bones]]),
        invIds: new Map([[2400, 1], [526, bones]]), worn: new Set(),
        bank: new Map([['bones', bankBones]]), bankIds: new Map([[526, bankBones]]), bankKnown: true,
        bankCoins: 1000, noProgress: 0, freeSlots: 27 - bones
    };
}

test.each([
    [0, 83, 25],
    [1, 83, 24],
    [12, 13, 13],
    [1, 10, 10]
])('with %i Bones held and %i banked, withdraws %i before grinding', (held, banked, quantity) => {
    expect(decide(snapshot(held, banked))).toEqual({
        kind: 'withdraw', items: [{ name: 'Bones', id: 526, qty: quantity }]
    });
});

test('reads an unknown bank before choosing to grind bones', () => {
    expect(decide({ ...snapshot(), bankKnown: false })).toEqual({ kind: 'scanBank' });
});

test('leaves a full partial pack for Traiborn to accept', () => {
    expect(decide({ ...snapshot(20), freeSlots: 0 }).kind).toBe('custom');
});

test('withdraws only as many bones as the pack can hold', () => {
    expect(decide({ ...snapshot(20), freeSlots: 2 })).toEqual({
        kind: 'withdraw', items: [{ name: 'Bones', id: 526, qty: 2 }]
    });
});

test('grinds when the known bank has no bones', () => {
    expect(decide(snapshot(1, 0)).kind).toBe('custom');
});

test('takes a complete bone load to Traiborn', () => {
    expect(decide(snapshot(25)).kind).toBe('custom');
});

test('does not withdraw bones after receiving Traiborn\'s key', () => {
    expect(decide({ ...snapshot(), invIds: new Map([[2400, 1], [2399, 1]]) }).kind).toBe('custom');
});

test('gets Rovin\'s key before sourcing bones', () => {
    expect(decide({ ...snapshot(), invIds: new Map() }).kind).toBe('custom');
});
