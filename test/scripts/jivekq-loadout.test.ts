import { expect, test } from 'bun:test';
import { tripPack } from '../../src/bot/scripts/JiveKQ/loadout.js';

test('all four carry super potions and a dueling ring in a full inventory', () => {
    for (let slot = 0; slot < 4; slot++) {
        const pack = new Map(tripPack(slot));
        for (const id of [2436, 2440, 2442]) expect(pack.get(id)).toBe(1);
        expect(pack.get(2552)).toBe(1);
        expect(pack.get(556)).toBe(5);
        expect(pack.get(563)).toBe(1);
        expect(pack.has(557)).toBe(false);
        expect([...pack].reduce((slots, [id, count]) => slots + ([1854, 556, 563].includes(id) ? 1 : count), 0)).toBe(28);
        expect(pack.has(995)).toBe(false);
    }
});

test('only the leader carries ropes and followers fill those slots with sharks', () => {
    expect(new Map(tripPack(0)).get(954)).toBe(2);
    expect(new Map(tripPack(0)).get(385)).toBe(14);
    for (let slot = 1; slot < 4; slot++) {
        expect(new Map(tripPack(slot)).has(954)).toBe(false);
        expect(new Map(tripPack(slot)).get(385)).toBe(16);
    }
});
