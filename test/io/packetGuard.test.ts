import { describe, expect, test } from 'bun:test';

import { assertPacketConsumed } from '../../src/client/io/packetGuard.js';

describe('assertPacketConsumed', () => {
    test('accepts a handler that consumed exactly the declared length', () => {
        expect(() => assertPacketConsumed(10, 3, 3)).not.toThrow();
    });

    test('throws when a handler under-reads, which is the p2-read-as-p1 bug', () => {
        expect(() => assertPacketConsumed(10, 3, 1)).toThrow(
            'packet 10 declared 3 bytes, consumed 1'
        );
    });

    test('throws when a handler over-reads', () => {
        expect(() => assertPacketConsumed(10, 3, 5)).toThrow(
            'packet 10 declared 3 bytes, consumed 5'
        );
    });

    test('accepts an allowlisted opcode that legitimately ignores trailing bytes', () => {
        expect(() => assertPacketConsumed(-1, 3, 1)).not.toThrow();
    });
});
