import { expect, test, describe } from 'bun:test';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from '#/bot/quests/engine/watchdog.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (journal: string, items: [string, number][]): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('progressSignature', () => {
    test('same state -> same signature regardless of map insertion order', () => {
        expect(progressSignature(snap('inProgress', [['egg', 1], ['pot', 2]])))
            .toBe(progressSignature(snap('inProgress', [['pot', 2], ['egg', 1]])));
    });
    test('journal or count change -> different signature', () => {
        const base = progressSignature(snap('inProgress', [['egg', 1]]));
        expect(progressSignature(snap('complete', [['egg', 1]]))).not.toBe(base);
        expect(progressSignature(snap('inProgress', [['egg', 2]]))).not.toBe(base);
    });
    test('quest-stage transitions count as progress even when inventory is unchanged', () => {
        const base = snap('inProgress', [['knife', 1]]);
        expect(progressSignature({ ...base, stage: 2 }))
            .not.toBe(progressSignature({ ...base, stage: 3 }));
    });
    test('equipment changes count as progress and worn ordering is stable', () => {
        const base = snap('inProgress', [['knife', 1]]);
        const empty = progressSignature(base);
        const first = progressSignature({ ...base, worn: new Set(['bronze axe', 'dramen staff']) });
        const reordered = progressSignature({ ...base, worn: new Set(['dramen staff', 'bronze axe']) });
        expect(first).toBe(reordered);
        expect(first).not.toBe(empty);
    });
    test('same-named exact item changes count as progress and ID ordering is stable', () => {
        const base = snap('inProgress', [['a key', 1]]);
        const golrie = progressSignature({ ...base, invIds: new Map([[293, 1], [954, 1]]), wornIds: new Set([295, 100]) });
        const reordered = progressSignature({ ...base, invIds: new Map([[954, 1], [293, 1]]), wornIds: new Set([100, 295]) });
        const baxtorian = progressSignature({ ...base, invIds: new Map([[298, 1], [954, 1]]), wornIds: new Set([295, 100]) });
        expect(golrie).toBe(reordered);
        expect(golrie).not.toBe(baxtorian);
    });
    test('travel between quest areas counts as progress', () => {
        const base = snap('inProgress', [['knife', 1]]);
        expect(progressSignature({ ...base, tile: { x: 3046, z: 3235, level: 0 } }))
            .not.toBe(progressSignature({ ...base, tile: { x: 2834, z: 3334, level: 1 } }));
    });
    test('bank-aware snapshot fields remain available without destabilizing the world signature', () => {
        const base = snap('inProgress', [['knife', 1]]);
        const beforeScan: QuestSnapshot = { ...base, bank: new Map(), bankKnown: false };
        const afterScan: QuestSnapshot = {
            ...base,
            bank: new Map([['dramen staff', 1]]),
            bankKnown: true
        };
        expect(afterScan.bankKnown).toBe(true);
        expect(afterScan.bank?.get('dramen staff')).toBe(1);
        expect(progressSignature(beforeScan)).toBe(progressSignature(afterScan));
    });
});

describe('ProgressWatchdog', () => {
    test('unchanged signature counts up; change resets', () => {
        const w = new ProgressWatchdog();
        expect(w.note('a')).toBe(0);
        expect(w.note('a')).toBe(1);
        expect(w.note('a')).toBe(2);
        expect(w.note('b')).toBe(0);
        expect(w.note('b')).toBe(1);
    });
    test('thresholds are 3 warn / 8 park (park must exceed the longest probe cycle — R&J needs 7)', () => {
        expect(NO_PROGRESS_WARN).toBe(3);
        expect(NO_PROGRESS_PARK).toBe(8);
    });
});

describe('progressSignature — journal flags', () => {
    const withFlags = (flags: string[]): QuestSnapshot => ({
        ...snap('inProgress', [['knife', 1]]),
        stage: 7,
        progress: { stage: 7, flags: new Set(flags) }
    });

    test('a flag-only change counts as progress', () => {
        // Reading a scroll or searching a lock moves nothing else at all. Without
        // flags in the signature such a step burns the whole no-progress budget.
        expect(progressSignature(withFlags(['read-tattered'])))
            .not.toBe(progressSignature(withFlags(['read-tattered', 'read-crumpled'])));
    });

    test('the same flags in a different order are the same signature', () => {
        expect(progressSignature(withFlags(['b', 'a']))).toBe(progressSignature(withFlags(['a', 'b'])));
    });
});
