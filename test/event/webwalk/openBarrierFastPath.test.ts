import { describe, expect, test } from 'bun:test';
import { barrierLooksOpen } from '#/bot/event/webwalk/exec/doorCrossing.js';
import { isOpenBarrierLeaf, isOpenableBarrier } from '#/bot/event/webwalk/exec/doorCrossing.js';

describe('open barrier leaf detection', () => {
    test('shut door has Open', () => {
        expect(isOpenableBarrier('Door', ['Open', 'Examine'])).toBe(true);
        expect(isOpenBarrierLeaf('Door', ['Open', 'Examine'])).toBe(false);
    });
    test('open door has Close', () => {
        expect(isOpenBarrierLeaf('Door', ['Close', 'Examine'])).toBe(true);
        expect(isOpenableBarrier('Door', ['Close', 'Examine'])).toBe(false);
    });
    test('gate naming', () => {
        expect(isOpenableBarrier('Gate', ['Open'])).toBe(true);
        expect(isOpenBarrierLeaf('Metal gate', ['Close'])).toBe(true);
    });
});

describe('barrierLooksOpen (no live scene → null loc → looks open)', () => {
    test('returns true when Locs empty (detached reader)', () => {
        // Without a live client, Locs.query is empty so findTransportLoc is null.
        expect(
            barrierLooksOpen({
                locName: 'Door',
                action: 'Open',
                locX: 3200,
                locZ: 3200
            })
        ).toBe(true);
    });
});
