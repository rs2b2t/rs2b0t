import { expect, test, describe } from 'bun:test';
import { NO_PROGRESS_PARK, NO_PROGRESS_WARN, ProgressWatchdog, progressSignature } from './watchdog.js';
import type { QuestSnapshot } from './types.js';

const snap = (journal: string, items: [string, number][]): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0
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
});

describe('ProgressWatchdog', () => {
    test('unchanged signature counts up; change resets', () => {
        const w = new ProgressWatchdog();
        expect(w.note('a')).toBe(0); // first sighting is progress
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
