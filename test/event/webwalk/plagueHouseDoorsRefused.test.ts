import { describe, expect, test } from 'bun:test';

import doors from '#/bot/event/webwalk/data/doors.json';

interface DoorEdge { x: number; z: number; level: number; locId: number; locName: string; dir: string }

const edges = doors as DoorEdge[];

// West Ardougne's plague house. loc_2534 answers "This door is locked." to everyone, and
// loc_2535 opens only for a warrant holder with a mourner in earshot, through a conversation.
const REFUSED_IDS = [2534, 2535];

describe('plague house scripted doors', () => {
    test('no baked edge belongs to a plague house door', () => {
        const baked = edges.filter(e => REFUSED_IDS.includes(e.locId));
        expect(baked.map(e => `${e.locId}@${e.x},${e.z},${e.level}`)).toEqual([]);
    });

    test('the ordinary doors around West Ardougne are still baked', () => {
        const nearby = edges.filter(e => e.x >= 2496 && e.x <= 2560 && e.z >= 3264 && e.z <= 3328);
        expect(nearby.length).toBeGreaterThan(0);
    });
});
