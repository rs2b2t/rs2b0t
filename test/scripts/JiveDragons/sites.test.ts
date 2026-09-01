import { describe, expect, test } from 'bun:test';
import { DRAGON_SITES, SITE_OPTIONS, siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';

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
        expect([s.meleeAnchor.x, s.meleeAnchor.z]).toEqual([2902, 9805]);
        expect(s.approach.map(t => [t.x, t.z])).toEqual([[2911, 9809]]);
        expect(s.gate).toMatchObject({ locId: 2623, op: 'Open' });
        expect([s.gate!.outside.x, s.gate!.outside.z]).toEqual([2924, 9803]);
        expect([s.gate!.inside.x, s.gate!.inside.z]).toEqual([2923, 9803]);
        expect(s.keyItem).toEqual({ name: 'Dusty key', id: 1590 });
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
});
