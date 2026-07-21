import { expect, test, describe } from 'bun:test';
import { decide } from '#/bot/quests/defs/priestperil.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (journal: string, items: string[] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items.map(n => [n, 1])),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

const routed = (s: ReturnType<typeof decide>): string =>
    s.kind === 'talk' ? `talk:${s.stop.npc}` : s.kind === 'custom' ? `custom:${s.name}` : s.kind;

describe('priestperil decide', () => {
    test('journal drives the ends', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(routed(decide(snap('notStarted')))).toBe('talk:King Roald');
    });

    test('held items route the mid-quest legs (exact full-name keys)', () => {
        expect(routed(decide(snap('inProgress', ['golden key'])))).toBe('custom:monument key swap');
        expect(routed(decide(snap('inProgress', ['iron key'])))).toBe('custom:unlock the cell');
        // murky AND blessed water both display "Bucket of water" (priestperil.obj) —
        // the water leg disambiguates by obj id 2953/2954 at runtime
        expect(routed(decide(snap('inProgress', ['bucket of water'])))).toBe('custom:water chain');
        expect(routed(decide(snap('inProgress', ['rune essence'])))).toBe('custom:essence delivery');
    });

    test('key priority: a golden key outranks essence in the pack', () => {
        expect(routed(decide(snap('inProgress', ['rune essence', 'golden key'])))).toBe('custom:monument key swap');
    });

    test('a plain empty Bucket does NOT trigger the water chain (exact-key get)', () => {
        expect(routed(decide(snap('inProgress', ['bucket'])))).toBe('custom:locate phase');
    });

    test('empty-handed inProgress runs the stage-oracle spine', () => {
        expect(routed(decide(snap('inProgress')))).toBe('custom:locate phase');
    });
});
