import { describe, expect, test } from 'bun:test';

import doors from '#/bot/event/webwalk/data/doors.json';

interface DoorEdge { x: number; z: number; level: number; locId: number; locName: string; dir: string }

const edges = doors as DoorEdge[];

// Fight Arena's scripted doors. arena_prisondoor and arena_jeremydoor never open;
// fightarena_door1 teleports the player into the arena instead of opening.
const REFUSED_IDS = [79, 80, 81];

describe('Fight Arena scripted doors', () => {
    test('no baked edge belongs to a scripted arena door', () => {
        const baked = edges.filter(e => REFUSED_IDS.includes(e.locId));
        expect(baked.map(e => `${e.locId}@${e.x},${e.z},${e.level}`)).toEqual([]);
    });

    test('the ordinary doors around Port Khazard are still baked', () => {
        const nearby = edges.filter(e => e.x >= 2560 && e.x <= 2624 && e.z >= 3136 && e.z <= 3200);
        expect(nearby.length).toBeGreaterThan(0);
    });
});
