import { expect, test, describe } from 'bun:test';
import { decide, gatherBalls } from './sheepshearer.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
});

describe('sheepshearer gatherBalls', () => {
    test('no shears and short of wool -> grab the free shears spawn', () => {
        expect(gatherBalls(snap('inProgress'), 20).kind).toBe('grabGround');
    });
    test('shears held, short of wool -> shear (custom)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 3]]), 20);
        expect(s.kind).toBe('custom');
    });
    test('enough wool -> spin it (useOn wheel)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 20]]), 20);
        expect(s.kind === 'useOn' && s.target).toBe('Spinning wheel');
    });
});

describe('sheepshearer decide', () => {
    test('notStarted -> Fred; balls held -> Fred (hand-in); complete -> done', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Fred the Farmer');
        const s2 = decide(snap('inProgress', [['ball of wool', 20]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Fred the Farmer');
        expect(decide(snap('complete')).kind).toBe('done');
    });
    test('inProgress with no balls -> re-gather (partial hand-in / lost wool recovery)', () => {
        expect(decide(snap('inProgress')).kind).not.toBe('talk');
    });
});
