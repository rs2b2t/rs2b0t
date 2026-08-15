import { describe, expect, test } from 'bun:test';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';

describe('specialRequiresAt — guild skill gates (content-backed)', () => {
    test('Fishing Guild doors require fishing 68', () => {
        expect(specialRequiresAt(2611, 3394, 0)?.skills).toEqual([{ name: 'fishing', level: 68 }]);
        expect(specialRequiresAt(2611, 3398, 0)?.skills).toEqual([{ name: 'fishing', level: 68 }]);
    });

    test('Magic Guild doors require magic 66', () => {
        expect(specialRequiresAt(2584, 3087, 0)?.skills).toEqual([{ name: 'magic', level: 66 }]);
        expect(specialRequiresAt(2597, 3088, 0)?.skills).toEqual([{ name: 'magic', level: 66 }]);
    });

    test('Crafting Guild door requires crafting 40', () => {
        expect(specialRequiresAt(2933, 3289, 0)?.skills).toEqual([{ name: 'crafting', level: 40 }]);
    });

    test('Cooking Guild door requires cooking 32 and Chef hat worn', () => {
        const r = specialRequiresAt(3143, 3444, 0);
        expect(r?.skills).toEqual([{ name: 'cooking', level: 32 }]);
        expect(r?.worn).toEqual([{ name: "Chef's hat", count: 1 }]);
    });

    test('Ranging Guild door requires ranged 40 on loc and transport stands', () => {
        const r40 = [{ name: 'ranged', level: 40 }];
        // doors.json loc tile
        expect(specialRequiresAt(2658, 3438, 0)?.skills).toEqual(r40);
        // transports.json from-stands (PathFinder attaches via edge.from)
        expect(specialRequiresAt(2657, 3439, 0)?.skills).toEqual(r40);
        expect(specialRequiresAt(2659, 3437, 0)?.skills).toEqual(r40);
    });

    test('Mining Guild ladder descent requires mining 60 on all four surface stands', () => {
        const mining60 = [{ name: 'mining', level: 60 }];
        for (const [x, z] of [
            [3018, 3340],
            [3019, 3339],
            [3019, 3341],
            [3020, 3340]
        ] as const) {
            expect(specialRequiresAt(x, z, 0)?.skills).toEqual(mining60);
        }
        // exit from cellar has no gate
        expect(specialRequiresAt(3019, 9739, 0)).toBeUndefined();
    });

    test('unrelated tile has no gate', () => {
        expect(specialRequiresAt(3200, 3200, 0)).toBeUndefined();
    });

    test('ship fares attach at pier L0 even when SC is keyed at deck L1', () => {
        // transports.json from is L0; specialCrossings ships at L1 same x/z
        const sarim = specialRequiresAt(3027, 3218, 0);
        expect(sarim?.currency).toEqual({ name: 'Coins', amount: 30 });
        expect(sarim?.items?.[0]).toMatchObject({ name: 'Coins', count: 30 });
        const barnaby = specialRequiresAt(2683, 3272, 0);
        expect(barnaby?.currency?.amount).toBe(30);
    });

    test('hill giant hut door requires a Brass key at plan time', () => {
        expect(specialRequiresAt(3115, 3450, 0)?.items).toEqual([{ name: 'Brass key', count: 1, consumed: true }]);
    });

    test('Mort Myre unlock freeSlots is not a plan-time require', () => {
        // freeSlots only matter when starting Nature Spirit (execute unlock path)
        expect(specialRequiresAt(3443, 3458, 0)).toBeUndefined();
        expect(specialRequiresAt(3444, 3458, 0)).toBeUndefined();
    });

    test('outer island ropeswings need agility 10; softlock swing does not', () => {
        expect(specialRequiresAt(2709, 3209, 0)?.skills).toEqual([{ name: 'agility', level: 10 }]);
        expect(specialRequiresAt(2511, 3091, 0)?.skills).toEqual([{ name: 'agility', level: 10 }]);
        // tree_ropeswing2 — content skips level check to prevent island softlock
        expect(specialRequiresAt(2705, 3205, 0)).toBeUndefined();
    });
});
