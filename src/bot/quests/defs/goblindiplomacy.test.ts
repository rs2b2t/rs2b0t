import { expect, test, describe } from 'bun:test';
import { decide } from './goblindiplomacy.js';
import type { QuestSnapshot } from '../engine/types.js';

// inv entries are [lowercased display name, count] — quantities matter here
// (the plain-mail count gates the dye legs), unlike Romeo & Juliet's set model.
const snap = (journal: string, inv: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);
const useProduct = (s: ReturnType<typeof decide>): string => (s.kind === 'useOn' ? (s.product ?? '') : `<${s.kind}>`);

describe('goblindiplomacy decide', () => {
    test('journal branches', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(npcOf(decide(snap('notStarted')))).toBe('Bartender');
    });

    test('provisioned start (3 mail + both dyes) dyes orange first', () => {
        const s = decide(snap('inProgress', [['goblin mail', 3], ['orange dye', 1], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Orange goblin mail');
    });

    test('after orange made, blue is dyed while 2 plain remain (keeps 1 for brown)', () => {
        const s = decide(snap('inProgress', [['goblin mail', 2], ['orange goblin mail', 1], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Blue goblin mail');
    });

    test('blue dye is NOT applied with only 1 plain mail left (reserved for brown)', () => {
        // 1 plain + blue dye but no spare: fall through to the hand-in talk.
        const s = decide(snap('inProgress', [['goblin mail', 1], ['blue dye', 1]]));
        expect(npcOf(s)).toBe('General Wartface');
    });

    test('both armours made -> hand in at the generals', () => {
        const s = decide(snap('inProgress', [['goblin mail', 1], ['orange goblin mail', 1], ['blue goblin mail', 1]]));
        expect(npcOf(s)).toBe('General Wartface');
    });

    test('order-independent: blue-first start still keeps a plain for brown', () => {
        // 3 plain + blue dye only (orange dye not yet held): blue leg has >=2, fires.
        const s = decide(snap('inProgress', [['goblin mail', 3], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Blue goblin mail');
    });

    test('bare in-progress re-entry falls back to the generals (total)', () => {
        expect(npcOf(decide(snap('inProgress')))).toBe('General Wartface');
    });
});
