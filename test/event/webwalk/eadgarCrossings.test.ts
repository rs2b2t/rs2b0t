import { describe, expect, test } from 'bun:test';

import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import doors from '#/bot/event/webwalk/data/doors.json';
import transports from '#/bot/event/webwalk/data/transports.json';

const edges = transports as TransportEdgeData[];
const doorEdges = doors as { x: number; z: number; level: number; locId: number }[];

const byLoc = (locId: number): TransportEdgeData[] => edges.filter(edge => edge.locId === locId && !edge.disabledReason);
const tile = (point: { x: number; z: number; level: number }): string => `${point.x},${point.z},${point.level}`;

// Why: the storeroom half of the stronghold's bottom floor hangs off one staircase, and the stair deriver only understands `case <coord> : p_telejump(...)`, not the `switch_int(loc_angle)` the troll stairs are written with — so both directions are curated by hand.
describe('troll storeroom staircase', () => {
    test('descends from the kitchen floor into the crate maze and climbs back', () => {
        const down = byLoc(3789).find(edge => tile(edge.from) === '2852,10060,1');
        const up = byLoc(3788).find(edge => tile(edge.from) === '2852,10064,0');

        expect(down && tile(down.to)).toBe('2852,10064,0');
        expect(down?.action).toBe('Climb-down');
        expect(up && tile(up.to)).toBe('2852,10060,1');
        expect(up?.action).toBe('Climb-up');
    });

    // Why: the storeroom door and the interior door were already derived; only the stair was missing,
    // and without it the goutweed crate is unreachable from anywhere in the stronghold.
    test('the two doors past it are still in the door data', () => {
        expect(doorEdges.some(door => door.locId === 3810 && door.x === 2869 && door.z === 10085)).toBe(true);
        expect(doorEdges.some(door => door.locId === 3776 && door.x === 2861 && door.z === 10092)).toBe(true);
    });
});

describe("Mad Eadgar's cave", () => {
    test('enters from Trollheim and leaves back onto it', () => {
        const enter = byLoc(3759);
        const exit = byLoc(3760);

        expect(enter).toHaveLength(1);
        expect(tile(enter[0]!.from)).toBe('2893,3671,0');
        expect(tile(enter[0]!.to)).toBe('2893,10074,2');
        expect(enter[0]!.kind).toBe('dungeon');

        expect(exit).toHaveLength(1);
        expect(tile(exit[0]!.from)).toBe('2893,10074,2');
        expect(tile(exit[0]!.to)).toBe('2893,3671,0');
    });

    // Why: the entrance drops an account that never opened Eadgar's cell onto level 0 of the same
    // mapsquare, which is empty — so the edge is gated on the quest that opens it.
    test('the entrance is gated on Troll Stronghold', () => {
        expect(byLoc(3759)[0]!.requires?.quests).toEqual([{ quest: 'Troll Stronghold', minStatus: 'complete' }]);
    });
});

// Why: the Ardougne wheat field is a sealed 228-tile pocket without this, and it is the closest
// grain to the zoo, the trees and the chicken farm the rest of the scarecrow comes from.
describe('Ardougne farm stile', () => {
    test('crosses the fence both ways', () => {
        const stile = byLoc(993);
        expect(stile).toHaveLength(2);
        expect(new Set(stile.map(edge => `${tile(edge.from)}>${tile(edge.to)}`))).toEqual(
            new Set(['2637,3350,0>2640,3350,0', '2640,3350,0>2637,3350,0'])
        );
        expect(stile.every(edge => edge.kind === 'shortcut' && edge.action === 'Climb-over')).toBe(true);
    });
});
