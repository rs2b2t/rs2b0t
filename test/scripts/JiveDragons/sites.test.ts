import { describe, expect, test } from 'bun:test';
import { DRAGON_SITES, SITE_OPTIONS, TAVERLEY_BLUE, siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { BLACK_DRAGON, HEROES_BLUE, derive, inputsPresent } from '../../../tools/nav/jive-safespots.js';

describe('DRAGON_SITES', () => {
    test('the two Taverley sites and the Heroes\' Guild pen are the entries, and every option resolves', () => {
        expect(SITE_OPTIONS).toEqual(['taverley-blue', 'taverley-black', 'heroes-blue']);
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

describe('the Taverley black dragons', () => {
    const s = DRAGON_SITES['taverley-black']!;

    // Why: derived by tools/nav/jive-safespots.ts --target black, the same probe the blue tiles came from.
    test('stand in the corridor south of the room, off every tile a dragon reaches', () => {
        expect(s.safespots.map(t => [t.x, t.z])).toEqual([[2836, 9817], [2835, 9817], [2834, 9817]]);
        expect([s.meleeAnchor.x, s.meleeAnchor.z]).toEqual([2835, 9818]);
        expect(s.safespots.every(t => t.level === 0)).toBe(true);
    });

    test('take the gate, the key, the bank and the way out from the blue site, since they share a dungeon', () => {
        expect(s.gate).toEqual(TAVERLEY_BLUE.gate);
        expect(s.keyItem).toEqual(TAVERLEY_BLUE.keyItem);
        expect(s.bank).toEqual(TAVERLEY_BLUE.bank);
        expect(s.escapeTeleportId).toBe(TAVERLEY_BLUE.escapeTeleportId);
        expect(s.walkOut).toEqual(TAVERLEY_BLUE.walkOut);
    });

    test('carry their own target, loot list, food and poison kit', () => {
        expect(s.target).toBe('Black dragon');
        expect(s.bones).toBe('Dragon bones');
        expect(s.lootSetting).toBe('lootBlack');
        expect(s.food).toBe('Shark');
        expect(s.antipoison).toBe(true);
        expect(TAVERLEY_BLUE.lootSetting).toBeUndefined();
        expect(TAVERLEY_BLUE.antipoison).toBeUndefined();
    });

    // Why: the dragons only breathe from melee reach on this content, so a melee-proof tile is breath-proof and the site needs no ranged-threat flag.
    test('are not a ranged threat, the same as the blues', () => {
        expect(s.rangedThreat).toBeUndefined();
    });

    test('cover both spawns, the walk in and the blue lair, but never the surface', () => {
        for (const [x, z] of [[2829, 9826], [2835, 9824]]) {
            expect(s.inArea({ x: x!, z: z!, level: 0 })).toBe(true);
        }
        expect(s.inArea({ x: 2836, z: 9817, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2911, z: 9809, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2946, z: 3369, level: 0 })).toBe(false);
        expect(s.inArea(null)).toBe(false);
    });

    test('the blue area stays its own, so the two sites do not swap lairs', () => {
        expect(TAVERLEY_BLUE.inArea({ x: 2829, z: 9826, level: 0 })).toBe(false);
    });
});

// Why: the tool's own pick for this room is the west cluster, which the walk in reaches only by crossing the dragons, so the site takes the corridor tiles instead and this pins them as tiles the probe still calls safe.
describe.skipIf(!inputsPresent(BLACK_DRAGON))('the black dragon derivation (pack-gated)', () => {
    test('every safespot the site carries is one the probe derived, and both spawns are covered', () => {
        const site = DRAGON_SITES['taverley-black']!;
        const derived = derive(BLACK_DRAGON);
        const safe = new Set(derived.safespots.map(t => `${t.x},${t.z}`));
        for (const tile of site.safespots) {
            expect(safe.has(`${tile.x},${tile.z}`)).toBe(true);
        }
        expect(derived.spawns.filter(sp => sp.adult)).toHaveLength(2);
    });

    test('the melee anchor is one the probe derived too', () => {
        const site = DRAGON_SITES['taverley-black']!;
        const anchors = new Set(derive(BLACK_DRAGON).anchors.map(a => `${a.x},${a.z}`));
        expect(anchors.has(`${site.meleeAnchor.x},${site.meleeAnchor.z}`)).toBe(true);
    });
});

describe("the Heroes' Guild blue dragon", () => {
    const s = DRAGON_SITES['heroes-blue']!;

    test('takes no key and no gate, since the cellar ladder is the whole way in', () => {
        expect(s.keyItem).toBeNull();
        expect(s.gate).toBeNull();
        expect(s.approach.map(t => [t.x, t.z, t.level])).toEqual([[2892, 9908, 0]]);
    });

    // Why: derived by tools/nav/jive-safespots.ts --target heroes, which rebuilds collision off the engine loc configs so the `blockrange=no` railing stops reading as opaque.
    test('stands off the pen, on tiles that keep the whole wander area in sight', () => {
        expect(s.safespots.map(t => [t.x, t.z])).toEqual([[2905, 9909], [2906, 9911], [2907, 9911]]);
        expect([s.meleeAnchor.x, s.meleeAnchor.z]).toEqual([2909, 9910]);
        expect(s.safespots.every(t => t.level === 0)).toBe(true);
    });

    test('shares the blue drop table and the Falador bank and escape', () => {
        expect(s.target).toBe(TAVERLEY_BLUE.target);
        expect(s.bones).toBe('Dragon bones');
        expect(s.lootSetting).toBeUndefined();
        expect(s.bank).toEqual(TAVERLEY_BLUE.bank);
        expect(s.escapeTeleportId).toBe('falador');
        expect(SPELL_TELEPORTS.some(t => t.teleportId === s.escapeTeleportId)).toBe(true);
    });

    test('walks out past the guild doors, not to a tile still inside them', () => {
        expect([s.walkOut.x, s.walkOut.z, s.walkOut.level]).toEqual([2904, 3510, 0]);
        expect(s.inArea(s.walkOut)).toBe(false);
    });

    // Why: the dragon only breathes out of ai_opplayer2, which needs melee reach, so a fenced-off stand is breath-proof and the site needs no ranged-threat flag.
    test('is not a ranged threat, and carries no poison kit', () => {
        expect(s.rangedThreat).toBeUndefined();
        expect(s.antipoison).toBeUndefined();
    });

    test('covers the spawn, the pen and the ladder landing, and never the guild above it', () => {
        expect(s.inArea({ x: 2908, z: 9905, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2892, z: 9908, level: 0 })).toBe(true);
        for (const t of s.safespots) {
            expect(s.inArea(t)).toBe(true);
        }
        expect(s.inArea({ x: 2892, z: 3508, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2908, z: 9905, level: 1 })).toBe(false);
        expect(s.inArea(null)).toBe(false);
    });

    test('every edge of the cellar box is pinned from both sides', () => {
        expect(s.inArea({ x: 2886, z: 9900, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2885, z: 9900, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2942, z: 9900, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2943, z: 9900, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2900, z: 9883, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2900, z: 9882, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2900, z: 9917, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2900, z: 9918, level: 0 })).toBe(false);
    });

    test('the Taverley lair stays its own, so the two blue sites do not swap rooms', () => {
        expect(TAVERLEY_BLUE.inArea({ x: 2908, z: 9905, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2901, z: 9809, level: 0 })).toBe(false);
    });
});

// Why: the railing and the spearwall are `blockrange=no`, so this derivation needs the engine's loc configs rather than the collision pack, which bakes only the walking wall layer and finds no safespot here at all.
describe.skipIf(!inputsPresent(HEROES_BLUE))("the Heroes' Guild derivation (engine-gated)", () => {
    const site = DRAGON_SITES['heroes-blue']!;
    let cache: ReturnType<typeof derive> | null = null;
    const derived = (): ReturnType<typeof derive> => (cache ??= derive(HEROES_BLUE));

    test('finds the one adult and the pen it never leaves, even with the gate open', () => {
        expect(derived().spawns).toEqual([{ x: 2908, z: 9905, size: 4, adult: true }]);
        expect(derived().adultBodies).toBe(44);
    }, 60_000);

    test('every safespot the site carries is one the probe derived, and sees the whole body', () => {
        const safe = new Map(derived().safespots.map(t => [`${t.x},${t.z}`, t]));
        for (const tile of site.safespots) {
            const spot = safe.get(`${tile.x},${tile.z}`);
            expect(spot).toBeDefined();
            expect(spot!.covers).toBe(derived().adultBodies);
        }
    }, 60_000);

    test('the melee anchor is the gate tile the probe picked, with safespots to step back onto', () => {
        expect([derived().anchor.x, derived().anchor.z]).toEqual([site.meleeAnchor.x, site.meleeAnchor.z]);
        expect(derived().flanking.length).toBeGreaterThan(0);
    }, 60_000);

    test('the site box bounds the cellar exactly and swallows nothing on the ladder side', () => {
        for (const k of derived().reachable) {
            const [x, z] = k.split(',').map(Number);
            expect(site.inArea({ x: x!, z: z!, level: 0 })).toBe(true);
        }
        for (const k of derived().outside) {
            const [x, z] = k.split(',').map(Number);
            expect(site.inArea({ x: x!, z: z!, level: 0 })).toBe(false);
        }
    }, 60_000);
});
