import { expect, test } from 'bun:test';
import { hardClueKit, superantiDoses } from '#/bot/api/ai/clues/hardClueKit.js';
import { hardTrailFoodTarget } from '#/bot/api/ai/clues/packPlan.js';

const ready = { attack: 60, lostCity: true, items: [{ id: 1231, count: 1 }, { id: 185, count: 1 }, { id: 385, count: 15 }] };

test.each([1231, 185, 385])('rejects a kit missing item %s', id => {
    const input = { ...ready, items: ready.items.filter(item => item.id !== id) };
    expect(hardClueKit(input)).not.toBe('ready');
});
test('rejects fourteen Sharks and accepts fifteen', () => {
    expect(hardClueKit({ ...ready, items: [...ready.items.slice(0, 2), { id: 385, count: 14 }] })).toBe('sharks');
    expect(hardClueKit(ready)).toBe('ready');
});
test.each([2448, 181, 183, 185])('accepts Superantipoison dose id %s', id => {
    expect(hardClueKit({ ...ready, items: [ready.items[0], { id, count: 1 }, ready.items[2]] })).toBe('ready');
});
test('does not substitute ordinary antipoison', () => {
    expect(superantiDoses([{ id: 2446, count: 1 }])).toBe(0);
    expect(superantiDoses([{ id: 2448, count: 1 }, { id: 181, count: 1 }, { id: 183, count: 1 }, { id: 185, count: 1 }])).toBe(10);
});
test('requires Attack 60 and Lost City', () => {
    expect(hardClueKit({ ...ready, attack: 59 })).toBe('attack');
    expect(hardClueKit({ ...ready, lostCity: false })).toBe('lost-city');
});
test('allows the unpoisoned local DDS but no substitute', () => {
    expect(hardClueKit({ ...ready, items: [{ id: 1215, count: 1 }, ...ready.items.slice(1)] })).toBe('ready');
    expect(hardClueKit({ ...ready, items: [{ id: 1305, count: 1 }, ...ready.items.slice(1)] })).toBe('dds');
});
test('reserves the mandatory thirteen slots without lowering the minimum', () => {
    expect(hardTrailFoodTarget({ heldFood: 0, freeSlots: 15, reserveSlots: 0 })).toBe(15);
    expect(hardTrailFoodTarget({ heldFood: 0, freeSlots: 21, reserveSlots: 1 })).toBe(20);
    expect(hardTrailFoodTarget({ heldFood: 0, freeSlots: 14, reserveSlots: 0 })).toBeNull();
});
