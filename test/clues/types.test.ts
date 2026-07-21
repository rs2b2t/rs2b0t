import { describe, expect, test } from 'bun:test';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import type { ClueRow } from '#/bot/clues/types.js';

describe('ClueRow medium fields', () => {
    test('a sextant dig row carries needsSextant', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_sextant001', id: 1, type: 'dig', coord: { x: 1, z: 2, level: 0 }, casketObj: 'c', casketId: 2, needsSextant: true };
        expect(row.needsSextant).toBe(true);
    });
    test('a row can carry extra required inventory items', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_sextant006', id: 2811, type: 'dig', coord: { x: 2512, z: 3467, level: 0 }, needsSextant: true, items: ['Rope'] };
        expect(row.items).toEqual(['Rope']);
    });
    test('2811 (Baxtorian Falls ledge dig) requires a Rope', () => {
        expect(CLUE_DB[2811].items).toEqual(['Rope']);
    });
    test('a kill-for-key search row carries keyFrom', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_riddle001', id: 3, type: 'search', coord: { x: 1, z: 2, level: 0 }, keyFrom: { npc: 'Black Heather', keyObj: 'trail_clue_medium_riddle001_key', keyId: 99 } };
        expect(row.keyFrom?.keyId).toBe(99);
    });
});
