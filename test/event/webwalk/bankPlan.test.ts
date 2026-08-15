import { describe, expect, test } from 'bun:test';
import {
    itemsRequiredByWaypoints,
    missingItemsForPath,
    pathHasTeleport,
    planBankLeg,
    WITHDRAW_COST
} from '#/bot/event/webwalk/bankPlan.js';
import { virtualizeWithItems } from '#/bot/event/webwalk/virtualState.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import type { Waypoint } from '#/bot/event/webwalk/PathFinder.js';

const wp = (x: number, z: number, transport?: Waypoint['transport']): Waypoint => ({
    x,
    z,
    level: 0,
    transport
});

describe('virtualizeWithItems', () => {
    test('adds counts on top of inventory', () => {
        const base = emptyWorldStateData();
        base.items['Law rune'] = 1;
        const v = virtualizeWithItems(base, { 'Law rune': 5, 'Air rune': 3 });
        expect(v.items['Law rune']).toBe(6);
        expect(v.items['Air rune']).toBe(3);
        expect(base.items['Air rune']).toBeUndefined();
    });
});

describe('itemsRequiredByWaypoints / missing', () => {
    test('varrock tele hop needs runes', () => {
        const path: Waypoint[] = [
            wp(3222, 3218),
            wp(3213, 3424, {
                locName: 'Varrock teleport',
                action: 'Cast',
                locX: 3222,
                locZ: 3218,
                kind: 'teleport',
                teleportId: 'varrock'
            })
        ];
        const need = itemsRequiredByWaypoints(path);
        expect(need['Law rune']).toBe(1);
        expect(need['Fire rune']).toBe(1);
        expect(need['Air rune']).toBe(3);
        expect(pathHasTeleport(path)).toBe(true);

        const empty = emptyWorldStateData();
        empty.skills.magic = 25;
        const missing = missingItemsForPath(path, empty);
        expect(missing.find(m => m.name === 'Law rune')?.count).toBe(1);

        // Partial inventory: count is shortage only (required − held), not total.
        const partial = emptyWorldStateData();
        partial.skills.magic = 25;
        partial.items = { 'Law rune': 0, 'Fire rune': 1, 'Air rune': 1 };
        const partialMissing = missingItemsForPath(path, partial);
        expect(partialMissing.find(m => m.name === 'Law rune')?.count).toBe(1);
        expect(partialMissing.find(m => m.name === 'Fire rune')).toBeUndefined();
        expect(partialMissing.find(m => m.name === 'Air rune')?.count).toBe(2);

        const full = emptyWorldStateData();
        full.items = { 'Law rune': 1, 'Fire rune': 1, 'Air rune': 3 };
        expect(missingItemsForPath(path, full)).toEqual([]);
    });

    test('Al Kharid toll on path needs coins', () => {
        const path: Waypoint[] = [
            wp(3267, 3227),
            wp(3268, 3227, {
                locName: 'Gate',
                action: 'Open',
                locX: 3268,
                locZ: 3227,
                kind: 'door'
            })
        ];
        const need = itemsRequiredByWaypoints(path);
        expect(need['Coins']).toBe(10);
    });

    // Why: the baked pack keys the crossing at the approach stand (3304,3118) while the loc sits at (3302,3116), so a lookup on the loc alone finds nothing.
    test('Shantay pass toll is found when the loc tile differs from the crossing key', () => {
        const path: Waypoint[] = [
            wp(3304, 3118),
            wp(3304, 3114, {
                locName: 'Shantay pass',
                action: 'Go-through',
                locX: 3302,
                locZ: 3116,
                kind: 'door'
            })
        ];
        expect(itemsRequiredByWaypoints(path)['Shantay pass']).toBe(1);

        const broke = emptyWorldStateData();
        expect(missingItemsForPath(path, broke)).toEqual([{ name: 'Shantay pass', count: 1 }]);

        const holding = emptyWorldStateData();
        holding.items = { 'Shantay pass': 1 };
        expect(missingItemsForPath(path, holding)).toEqual([]);
    });
});

describe('planBankLeg', () => {
    test('skips when direct already has teleport', () => {
        const r = planBankLeg({
            directCost: 200,
            directHasTeleport: true,
            toBankCost: 10,
            bankToDestCost: 40,
            missing: [{ name: 'Law rune', count: 1 }]
        });
        expect(r.action).toBe('skip');
    });

    test('skips when missing empty', () => {
        const r = planBankLeg({
            directCost: 500,
            directHasTeleport: false,
            toBankCost: 20,
            bankToDestCost: 40,
            missing: []
        });
        expect(r.action).toBe('skip');
    });

    test('banks when virtual route is cheaper', () => {
        const r = planBankLeg({
            directCost: 400,
            directHasTeleport: false,
            toBankCost: 30,
            bankToDestCost: 50,
            missing: [{ name: 'Law rune', count: 1 }]
        });
        expect(r.action).toBe('bank');
        if (r.action === 'bank') {
            expect(r.estimatedCost).toBe(30 + WITHDRAW_COST + 50);
            expect(r.missing[0]!.name).toBe('Law rune');
        }
    });

    test('skips when bank detour is more expensive', () => {
        const r = planBankLeg({
            directCost: 80,
            directHasTeleport: false,
            toBankCost: 100,
            bankToDestCost: 50,
            missing: [{ name: 'Law rune', count: 1 }]
        });
        expect(r.action).toBe('skip');
    });
});
