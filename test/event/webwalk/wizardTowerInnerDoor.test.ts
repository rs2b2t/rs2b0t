import { describe, expect, test } from 'bun:test';

import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import doors from '#/bot/event/webwalk/data/doors.json';
import transports from '#/bot/event/webwalk/data/transports.json';

interface DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
}

const doorEdges = doors as DoorEdge[];
const hops = transports as TransportEdgeData[];

describe("Wizards' Tower inner door", () => {
    test('loc 1536 at the unwalkable midpoint is recorded', () => {
        expect(doorEdges.some(d => d.x === 3107 && d.z === 3162 && d.level === 0 && d.locId === 1536)).toBe(true);
    });

    test('the 2-tile hop 3106↔3108 remains the live crossing', () => {
        const pair = hops.filter(e => e.locId === 1536 && e.locX === 3107 && e.locZ === 3162);
        expect(pair.some(e => e.from.x === 3106 && e.to.x === 3108)).toBe(true);
        expect(pair.some(e => e.from.x === 3108 && e.to.x === 3106)).toBe(true);
    });
});
