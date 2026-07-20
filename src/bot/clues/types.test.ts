import { describe, expect, test } from 'bun:test';
import type { ClueRow } from './types.js';

describe('ClueRow medium fields', () => {
    test('a sextant dig row carries needsSextant', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_sextant001', id: 1, type: 'dig', coord: { x: 1, z: 2, level: 0 }, casketObj: 'c', casketId: 2, needsSextant: true };
        expect(row.needsSextant).toBe(true);
    });
    test('a kill-for-key search row carries keyFrom', () => {
        const row: ClueRow = { obj: 'trail_clue_medium_riddle001', id: 3, type: 'search', coord: { x: 1, z: 2, level: 0 }, keyFrom: { npc: 'Black Heather', keyObj: 'trail_clue_medium_riddle001_key', keyId: 99 } };
        expect(row.keyFrom?.keyId).toBe(99);
    });
});
