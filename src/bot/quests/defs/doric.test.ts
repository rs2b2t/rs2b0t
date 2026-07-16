import { expect, test, describe } from 'bun:test';
import { decide, gatherOre } from './doric.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('doric decide', () => {
    test('always talks to Doric until complete (start at 0, auto hand-in at stage 10)', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Doric');
        const s2 = decide(snap('inProgress', [['clay', 6], ['copper ore', 4], ['iron ore', 2]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Doric');
        expect(decide(snap('complete')).kind).toBe('done');
    });
});

describe('gatherOre', () => {
    test('mines with a pickaxe held', () => {
        const s = gatherOre(snap('inProgress', [['bronze pickaxe', 1]]), 'Clay', 6);
        expect(s.kind).toBe('mineRock');
        if (s.kind === 'mineRock') { expect(s.rock).toBe('Clay'); expect(s.qty).toBe(6); }
    });
    test('no pickaxe -> wait (watchdog will park with a visible reason)', () => {
        const s = gatherOre(snap('inProgress'), 'Clay', 6);
        expect(s.kind).toBe('wait');
    });
    test('per-ore anchor is set for each of the three ores', () => {
        for (const item of ['Clay', 'Copper ore', 'Iron ore'] as const) {
            const s = gatherOre(snap('inProgress', [['bronze pickaxe', 1]]), item, 1);
            expect(s.kind).toBe('mineRock');
            if (s.kind === 'mineRock') { expect(s.anchor).toBeDefined(); }
        }
    });
});
