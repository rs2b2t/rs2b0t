import { expect, test, describe } from 'bun:test';
import { decide, gatherBalls } from '#/bot/quests/defs/sheepshearer.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('sheepshearer gatherBalls', () => {
    test('no shears and short of wool -> grab the free shears spawn', () => {
        expect(gatherBalls(snap('inProgress'), 20).kind).toBe('grabGround');
    });
    test('shears held, short of wool -> shear (custom)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 3]]), 20);
        expect(s.kind).toBe('custom');
    });
    test('enough wool -> spin the batch (custom, Falador wheel)', () => {
        const s = gatherBalls(snap('inProgress', [['shears', 1], ['wool', 20]]), 20);
        expect(s.kind === 'custom' && s.name).toBe('spin wool at Falador');
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
