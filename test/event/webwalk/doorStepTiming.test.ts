import { describe, expect, test } from 'bun:test';
import { crossingTiming } from '#/bot/event/webwalk/exec/doorCrossing.js';

describe('crossingTiming', () => {
    test('says nothing when no Open was sent this crossing', () => {
        expect(crossingTiming(null, null, null, 40)).toBe('');
    });

    test('counts the open leaf, the step click and the crossing from the Open click', () => {
        expect(crossingTiming(10, 11, 11, 12)).toBe(' (Open sent tick 10, open +1, stepped +1, crossed +2)');
    });

    test('marks an open or a step the poll never saw', () => {
        expect(crossingTiming(10, null, null, 13)).toBe(' (Open sent tick 10, open unseen, stepped unseen, crossed +3)');
    });
});
