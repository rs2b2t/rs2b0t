import { expect, test, describe } from 'bun:test';
import { decide, WIZARD_HOPS } from '#/bot/api/ai/quests/defs/runemysteries.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import Tile from '#/bot/geometry/Tile.js';

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
        expect(npcOf(decide(snap('inProgress', ['research notes'])))).toBe('Aubury');
    });
    test('research package outranks a leftover air talisman', () => {
        expect(npcOf(decide(snap('inProgress', ['air talisman', 'research package'])))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', ['notes', 'air talisman'])))).toBe('Sedridor');
    });
    test('climb-down long-walks the hall east of the inner door', () => {
        const down = WIZARD_HOPS.find(h => h.op === 'Climb-down');
        expect(down?.stand.equals(new Tile(3105, 3162, 0))).toBe(true);
        expect(down?.walk?.equals(new Tile(3108, 3162, 0))).toBe(true);
    });
    test('inProgress empty-handed rotates the RECOVER probe Aubury -> Sedridor -> Duke via noProgress', () => {
        expect(npcOf(decide(snap('inProgress', [], 0)))).toBe('Aubury');
        expect(npcOf(decide(snap('inProgress', [], 1)))).toBe('Sedridor');
        expect(npcOf(decide(snap('inProgress', [], 2)))).toBe('Duke Horacio');
        expect(npcOf(decide(snap('inProgress', [], 3)))).toBe('Aubury');
    });
});
