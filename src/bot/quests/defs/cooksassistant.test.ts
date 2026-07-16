import { expect, test, describe } from 'bun:test';
import { decide, gatherFlour, gatherMilk } from './cooksassistant.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('cooksassistant gathers', () => {
    test('flour: pot first, then grain, then the mill custom', () => {
        expect(gatherFlour(snap('inProgress')).kind).toBe('grabGround');            // no Pot
        expect(gatherFlour(snap('inProgress', [['pot', 1]])).kind).toBe('pickLoc'); // no Grain
        expect(gatherFlour(snap('inProgress', [['pot', 1], ['grain', 1]])).kind).toBe('custom');
    });
    test('milk: bucket first, then use it on a cow', () => {
        expect(gatherMilk(snap('inProgress')).kind).toBe('grabGround');
        const s = gatherMilk(snap('inProgress', [['bucket', 1]]));
        expect(s.kind === 'useOn' && s.target).toBe('Cow');
    });
});

describe('cooksassistant decide', () => {
    test('notStarted and full-handed both talk to the Cook', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Cook');
        const s2 = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1], ['pot of flour', 1]]));
        expect(s2.kind === 'talk' && s2.stop.npc).toBe('Cook');
    });
    test('inProgress missing an ingredient self-heals through the gathers', () => {
        const s = decide(snap('inProgress', [['egg', 1], ['bucket of milk', 1]]));
        expect(s.kind).not.toBe('talk'); // goes flour-gathering instead of nagging the Cook
    });
});
