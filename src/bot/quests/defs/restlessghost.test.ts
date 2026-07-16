import { expect, test, describe } from 'bun:test';
import { decide } from './restlessghost.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, inv: string[] = [], worn: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv.map(n => [n, 1])),
    worn: new Set(worn),
    noProgress: 0,
    bankCoins: 0
});

describe('restlessghost decide', () => {
    test('ends and start', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Aereck');
    });
    test('no amulet anywhere -> Urhney (also the lost-amulet recovery)', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Urhney');
    });
    test('amulet in pack but not worn -> equip', () => {
        expect(decide(snap('inProgress', ['ghostspeak amulet'])).kind).toBe('equip');
    });
    test('amulet worn, no skull -> ghost+skull custom', () => {
        const s = decide(snap('inProgress', [], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('ghost + skull');
    });
    test('skull held -> return-to-coffin custom (works regardless of worn state)', () => {
        const s = decide(snap('inProgress', ['skull'], ['ghostspeak amulet']));
        expect(s.kind === 'custom' && s.name).toBe('return skull');
    });
});
