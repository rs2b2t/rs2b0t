import { describe, expect, test } from 'bun:test';
import { resolveLoopCadence } from '#/bot/api/Bot.js';

describe('resolveLoopCadence', () => {
    test('0 → frame', () => {
        expect(resolveLoopCadence(0)).toEqual({ kind: 'frame' });
        expect(resolveLoopCadence(-1)).toEqual({ kind: 'frame' });
    });

    test('600 (legacy default / explicit overrides) → next server tick', () => {
        expect(resolveLoopCadence(600)).toEqual({ kind: 'server-tick', ticks: 1 });
    });

    test('other ms → wall-clock time', () => {
        expect(resolveLoopCadence(5000)).toEqual({ kind: 'time', ms: 5000 });
        expect(resolveLoopCadence(50)).toEqual({ kind: 'time', ms: 50 });
    });

    test('explicit loopCadence wins over loopDelay', () => {
        expect(resolveLoopCadence(600, { kind: 'time', ms: 600 })).toEqual({ kind: 'time', ms: 600 });
        expect(resolveLoopCadence(5000, { kind: 'server-tick', ticks: 2 })).toEqual({
            kind: 'server-tick',
            ticks: 2
        });
        expect(resolveLoopCadence(600, { kind: 'frame' })).toEqual({ kind: 'frame' });
    });
});
