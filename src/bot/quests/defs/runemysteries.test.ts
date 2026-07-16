import { expect, test, describe } from 'bun:test';
import { decide } from './runemysteries.js';
import type { QuestSnapshot } from '../engine/types.js';

const snap = (journal: string, items: string[] = [], noProgress = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items.map(n => [n, 1])),
    worn: new Set(),
    noProgress,
    bankCoins: 0
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);

describe('runemysteries decide', () => {
    test('journal drives the ends', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(npcOf(decide(snap('notStarted')))).toBe('Duke Horacio');
    });
    test('held item drives the deliveries (exact full-name CI match)', () => {
        expect(npcOf(decide(snap('inProgress', ['air talisman'])))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', ['research package'])))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', ['notes'])))).toBe('Sedridor');
        // 'Notes' is generic — substring must NOT match; empty-handed probe applies
        expect(npcOf(decide(snap('inProgress', ['research notes'])))).toBe('Aubury');
    });
    test('inProgress empty-handed rotates the RECOVER probe Aubury -> Sedridor -> Duke via noProgress', () => {
        // Same probe order as the old bot's recoverOrder (RuneMysteries.ts:134-136);
        // rotation now comes from the engine watchdog count instead of module state.
        expect(npcOf(decide(snap('inProgress', [], 0)))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', [], 1)))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', [], 2)))).toBe('Duke Horacio');
        expect(npcOf(decide(snap('inProgress', [], 3)))).toBe('Aubury'); // wraps
    });
});
