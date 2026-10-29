import { describe, expect, test } from 'bun:test';
import { targetChanges } from '../../e2e/lib/firegiantTargetChanges.js';

// The harness fails a run when any change is unexplained, so an adoption over
// a held target must land there, while one after a recorded release must not.
describe('targetChanges adoption', () => {
    const adopt = (t: number, idx: number) => ({ t, msg: `fire giant ${idx} is on us — switching to it` });
    const unexplained = (events: { t: number; msg: string }[]) => targetChanges(events).filter(c => c.why === 'unexplained');

    test('a second adoption with no recorded release is unexplained', () => {
        const changes = targetChanges([adopt(2, 2604), adopt(4, 2607)]);
        expect(changes.map(c => c.why)).toEqual(['giant on us adopted', 'unexplained']);
        expect(unexplained([adopt(2, 2604), adopt(4, 2607)])).toHaveLength(1);
    });

    test('an adoption after a recorded kill release stands', () => {
        const events = [adopt(2, 2604), { t: 10, msg: 'fire giant down — 1 kills' }, adopt(12, 2607)];
        expect(targetChanges(events).map(c => c.why)).toEqual(['giant on us adopted', 'giant on us adopted']);
        expect(unexplained(events)).toHaveLength(0);
    });

    test('an adoption after a recorded steal release stands', () => {
        const events = [adopt(2, 2604), { t: 6, msg: 'giant 2604 was taken by another player — finding another' }, adopt(8, 2607)];
        expect(unexplained(events)).toHaveLength(0);
    });

    test('an adoption over a target held by an engage is unexplained', () => {
        const events = [{ t: 2, msg: 'engaging fire giant 2604 at 2568,9893 (d=1)' }, adopt(4, 2607)];
        expect(unexplained(events)).toHaveLength(1);
    });
});
