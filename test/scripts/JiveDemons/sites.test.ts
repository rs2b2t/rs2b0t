import { describe, expect, test } from 'bun:test';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { TAVERLEY_BLUE } from '#/bot/scripts/JiveDragons/sites.js';
import { DEMON_SITES, SITE_OPTIONS, TAVERLEY_BLACK_DEMON, siteFor } from '#/bot/scripts/JiveDemons/sites.js';
import { BLACK_DEMON, derive, inputsPresent } from '../../../tools/nav/jive-safespots.js';

describe('DEMON_SITES', () => {
    test('Taverley black is the only entry and every option resolves', () => {
        expect(SITE_OPTIONS).toEqual(['taverley-black-demon']);
        for (const key of SITE_OPTIONS) {
            expect(siteFor(key).key).toBe(key);
        }
    });

    test('an unknown key falls back to Taverley rather than throwing', () => {
        expect(siteFor('nope').key).toBe('taverley-black-demon');
    });

    test('the target is the client display name, capital D and all', () => {
        expect(TAVERLEY_BLACK_DEMON.target).toBe('Black Demon');
    });

    test('the tiles are the probe tile the run was given and the two derived beside it', () => {
        const s = DEMON_SITES['taverley-black-demon']!;
        expect(s.safespots.map(t => [t.x, t.z])).toEqual([[2856, 9786], [2857, 9786], [2855, 9786]]);
        expect([s.meleeAnchor.x, s.meleeAnchor.z]).toEqual([2859, 9786]);
        expect(s.safespots.every(t => t.level === 0)).toBe(true);
    });

    test('the approach runs down the passage and along the corridor before the pocket', () => {
        const s = DEMON_SITES['taverley-black-demon']!;
        expect(s.approach.map(t => [t.x, t.z])).toEqual([[2893, 9790], [2893, 9771], [2875, 9774]]);
    });

    test('demons drop ashes, so there is nothing to bury', () => {
        expect(TAVERLEY_BLACK_DEMON.bones).toBe('');
    });

    test('the demons sit behind the same gate, key, bank and escape as the blue dragons', () => {
        const s = TAVERLEY_BLACK_DEMON;
        expect(s.gate).toEqual(TAVERLEY_BLUE.gate);
        expect(s.keyItem).toEqual(TAVERLEY_BLUE.keyItem);
        expect(s.bank).toEqual(TAVERLEY_BLUE.bank);
        expect(s.walkOut).toEqual(TAVERLEY_BLUE.walkOut);
        expect(s.escapeTeleportId).toBe(TAVERLEY_BLUE.escapeTeleportId);
        expect(SPELL_TELEPORTS.some(t => t.teleportId === s.escapeTeleportId)).toBe(true);
    });

    test('inArea holds the blue lair, the passage, the corridor and the pocket', () => {
        const s = TAVERLEY_BLACK_DEMON;
        expect(s.inArea({ x: 2923, z: 9803, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2901, z: 9809, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2893, z: 9782, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2883, z: 9769, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2856, z: 9786, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2854, z: 9776, level: 0 })).toBe(true);
    });

    test('inArea rejects the entrance corridor, the far side of the gate and the surface', () => {
        const s = TAVERLEY_BLACK_DEMON;
        expect(s.inArea({ x: 2884, z: 9798, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2881, z: 9796, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2887, z: 9810, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2924, z: 9803, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2856, z: 3786, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2856, z: 9786, level: 1 })).toBe(false);
        expect(s.inArea(null)).toBe(false);
    });

    test('the pocket box is pinned from both sides on every edge', () => {
        const s = TAVERLEY_BLACK_DEMON;
        expect(s.inArea({ x: 2850, z: 9776, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2849, z: 9776, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2880, z: 9790, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2881, z: 9790, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2860, z: 9762, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2860, z: 9761, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2870, z: 9797, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2870, z: 9798, level: 0 })).toBe(false);
    });

    test('the corridor box bridges the pocket to the passage without touching the ladder side', () => {
        const s = TAVERLEY_BLACK_DEMON;
        expect(s.inArea({ x: 2885, z: 9770, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2885, z: 9776, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2885, z: 9762, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2885, z: 9761, level: 0 })).toBe(false);
    });
});

// Why: the derivation needs out/collision.lcnav.gz and the rs2b2t-content maps, and CI carries neither.
describe.skipIf(!inputsPresent(BLACK_DEMON))('the checked-in demon derivation (pack-gated)', () => {
    test('every ladder tile is a derived safespot and the anchor is the derived one', () => {
        const site = TAVERLEY_BLACK_DEMON;
        const derived = derive(BLACK_DEMON);
        expect([derived.anchor.x, derived.anchor.z]).toEqual([site.meleeAnchor.x, site.meleeAnchor.z]);
        const spots = new Set(derived.safespots.map(s => `${s.x},${s.z}`));
        for (const t of site.safespots) {
            expect(spots.has(`${t.x},${t.z}`)).toBe(true);
        }
        expect(derived.spawns.filter(s => s.adult).map(s => [s.x, s.z])).toEqual([[2854, 9776], [2860, 9781], [2863, 9769], [2869, 9776]]);
    }, 60_000);

    test('the area covers every tile the run stands on and none on the ladder side of the gate', () => {
        const site = TAVERLEY_BLACK_DEMON;
        const derived = derive(BLACK_DEMON);
        for (const t of [...site.safespots, site.meleeAnchor, ...site.approach, site.gate!.inside]) {
            expect(derived.reachable.has(`${t.x},${t.z}`)).toBe(true);
            expect(site.inArea(t)).toBe(true);
        }
        for (const k of derived.outside) {
            const [x, z] = k.split(',').map(Number);
            expect(site.inArea({ x: x!, z: z!, level: 0 })).toBe(false);
        }
    }, 60_000);
});
