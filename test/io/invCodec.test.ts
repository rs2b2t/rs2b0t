import { describe, expect, test } from 'bun:test';

import Packet from '../../src/client/io/Packet.js';

function packet(bytes: number[]): Packet {
    const p = new Packet(new Uint8Array(bytes));
    p.pos = 0;
    return p;
}

// Mirrors UpdateInvFullEncoder on 289: component p2, slot count p2.
describe('UPDATE_INV_FULL 289 shape', () => {
    test('reads a slot count above 255, which p1 could not express', () => {
        // component 3214 = 0x0C8E, count 800 = 0x0320
        const buf = packet([0x0c, 0x8e, 0x03, 0x20]);

        expect(buf.g2()).toBe(3214);
        expect(buf.g2()).toBe(800);
        expect(buf.pos).toBe(4);
    });
});

// Mirrors UpdateInvPartialEncoder on 289: slot index psmart.
describe('UPDATE_INV_PARTIAL slot index', () => {
    test('reads a one-byte smart index', () => {
        const buf = packet([27]);

        expect(buf.gsmart()).toBe(27);
        expect(buf.pos).toBe(1);
    });

    test('reads a two-byte smart index', () => {
        // 482 encodes as 0x8000 + 482 = 0x81E2
        const buf = packet([0x81, 0xe2]);

        expect(buf.gsmart()).toBe(482);
        expect(buf.pos).toBe(2);
    });

    test('a p1 read of a two-byte index returns the wrong value and desyncs', () => {
        // This is the bug being fixed: g1 on 0x81E2 yields 129 and leaves a stray byte.
        const buf = packet([0x81, 0xe2]);

        expect(buf.g1()).toBe(129);
        expect(buf.pos).toBe(1);
    });
});
