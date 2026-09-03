import { describe, expect, test } from 'bun:test';
import { DRAGON_SITES, SITE_OPTIONS, siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { derive, inputsPresent } from '../../../tools/nav/jive-safespots.js';

describe('DRAGON_SITES', () => {
    test('Taverley blue is the only entry and every option resolves', () => {
        expect(SITE_OPTIONS).toEqual(['taverley-blue']);
        for (const key of SITE_OPTIONS) {
            expect(siteFor(key).key).toBe(key);
        }
    });

    test('an unknown key falls back to Taverley rather than throwing', () => {
        expect(siteFor('nope').key).toBe('taverley-blue');
    });

    test('the derived tiles match what the collision probe produced', () => {
        const s = DRAGON_SITES['taverley-blue']!;
        expect(s.safespots.map(t => [t.x, t.z])).toEqual([[2901, 9809], [2900, 9809], [2901, 9810]]);
        expect([s.meleeAnchor.x, s.meleeAnchor.z]).toEqual([2900, 9808]);
        expect(s.approach.map(t => [t.x, t.z])).toEqual([[2911, 9809]]);
        expect(s.gate).toMatchObject({ locId: 2623, op: 'Open' });
        expect([s.gate!.outside.x, s.gate!.outside.z]).toEqual([2924, 9803]);
        expect([s.gate!.inside.x, s.gate!.inside.z]).toEqual([2923, 9803]);
        expect(s.keyItem).toEqual({ name: 'Dusty key', id: 1590 });
        expect([s.bank.x, s.bank.z, s.bank.level]).toEqual([2946, 3369, 0]);
        expect([s.walkOut.x, s.walkOut.z, s.walkOut.level]).toEqual([2884, 3398, 0]);
        expect(s.escapeTeleportId).toBe('falador');
        expect(s.target).toBe('Blue dragon');
        expect(s.bones).toBe('Dragon bones');
        expect(s.safespots.every(t => t.level === 0)).toBe(true);
    });

    test('the melee anchor stands outside every adult spawn footprint', () => {
        const s = DRAGON_SITES['taverley-blue']!;
        const spawns = [[2897, 9797], [2899, 9802], [2904, 9802]];
        for (const [x, z] of spawns) {
            const inside = s.meleeAnchor.x >= x! && s.meleeAnchor.x <= x! + 3 && s.meleeAnchor.z >= z! && s.meleeAnchor.z <= z! + 3;
            expect(inside).toBe(false);
        }
    });

    test('the escape teleport names a catalog entry, it does not copy one', () => {
        const s = DRAGON_SITES['taverley-blue']!;
        expect(SPELL_TELEPORTS.some(t => t.teleportId === s.escapeTeleportId)).toBe(true);
    });

    test('inArea holds inside the lair and rejects the entrance corridor', () => {
        const s = DRAGON_SITES['taverley-blue']!;
        expect(s.inArea({ x: 2901, z: 9809, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2923, z: 9803, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2884, z: 9798, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2924, z: 9803, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2901, z: 3809, level: 0 })).toBe(false);
        expect(s.inArea(null)).toBe(false);
    });

    test('every edge of the lair box is pinned from both sides', () => {
        const s = DRAGON_SITES['taverley-blue']!;
        expect(s.inArea({ x: 2888, z: 9800, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2887, z: 9800, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2923, z: 9800, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2924, z: 9800, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2900, z: 9769, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2900, z: 9768, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2900, z: 9816, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2900, z: 9817, level: 0 })).toBe(false);
    });

    test('a tile on another plane is outside the lair', () => {
        expect(DRAGON_SITES['taverley-blue']!.inArea({ x: 2901, z: 9809, level: 1 })).toBe(false);
    });
});

// Why: the derivation needs out/collision.lcnav.gz and the rs2b2t-content maps, and CI carries neither.
describe.skipIf(!inputsPresent())('the checked-in derivation (pack-gated)', () => {
    test('the tool still lands on the tiles DRAGON_SITES carries', () => {
        const site = DRAGON_SITES['taverley-blue']!;
        const derived = derive();
        expect([derived.anchor.x, derived.anchor.z]).toEqual([site.meleeAnchor.x, site.meleeAnchor.z]);
        const flanking = derived.flanking.map(t => `${t.x},${t.z}`).sort();
        expect(flanking).toEqual(site.safespots.map(t => `${t.x},${t.z}`).sort());
        expect(derived.spawns.filter(s => s.adult).map(s => [s.x, s.z])).toEqual([[2897, 9797], [2899, 9802], [2904, 9802]]);
    }, 60_000);
});
