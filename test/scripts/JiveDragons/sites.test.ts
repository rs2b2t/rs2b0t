import { describe, expect, test } from 'bun:test';
import { BRIMHAVEN_IRON, BRIMHAVEN_STEEL, DRAGON_SITES, MAX_STANDS, SITE_OPTIONS, STAND_SITE_KEYS, TAVERLEY_BLUE, huntNames, needsShield, siteFor, standFor } from '#/bot/scripts/JiveDragons/sites.js';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { BLACK_DRAGON, GUTANOTH_BLUE, HEROES_BLUE, IRON_DRAGON, STEEL_DRAGON, derive, inputsPresent } from '../../../tools/nav/jive-safespots.js';

describe('DRAGON_SITES', () => {
    test('the two Taverley sites, the Heroes\' Guild pen, the Enclave and the two Brimhaven rooms are the entries, and every option resolves', () => {
        expect(SITE_OPTIONS).toEqual(['taverley-blue', 'taverley-black', 'heroes-blue', 'gutanoth-blue', 'brimhaven-iron', 'brimhaven-steel']);
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

// Why: the guard is an npc with a two-option chat rather than a door, and nothing walks out of the cave, so this site is the one that exercises talkGate and exit.
describe("the Gu'Tanoth Enclave blue dragons", () => {
    const s = DRAGON_SITES['gutanoth-blue']!;

    test('the way in is the guard conversation, not a gate or a key', () => {
        expect(s.gate).toBeNull();
        expect(s.keyItem).toBeNull();
        expect(s.talkGate).toMatchObject({ npc: 'Enclave guard', op: 'Talk-to', choose: 'I want to go in there' });
        expect([s.talkGate!.stand.x, s.talkGate!.stand.z]).toEqual([2508, 3038]);
    });

    test('the way out is the cave loc, since no route leaves the Enclave on foot', () => {
        expect(s.exit).toMatchObject({ locId: 2813, op: 'Enter' });
        expect([s.exit!.stand.x, s.exit!.stand.z]).toEqual([2597, 9468]);
        expect([s.walkOut.x, s.walkOut.z]).toEqual([2540, 3054]);
    });

    test('it banks at Yanille and escapes on the Watchtower spell the quest already covers', () => {
        expect([s.bank.x, s.bank.z, s.bank.level]).toEqual([2612, 3092, 0]);
        expect(s.escapeTeleportId).toBe('watchtower');
        expect(SPELL_TELEPORTS.some(t => t.teleportId === s.escapeTeleportId)).toBe(true);
    });

    // Why: the stand is melee-proof but the cave is not range-proof, and a soak took 8 and 13 off it with one adult up, so a hit there must not read as a bad tile.
    test('a hit on the stand is the room, not the tile', () => {
        expect(s.rangedThreat).toBe(true);
    });

    test('it hunts blue dragons for dragon bones, off its own merged chip list', () => {
        expect(s.target).toBe('Blue dragon');
        expect(s.bones).toBe('Dragon bones');
        expect(s.lootSetting).toBe('lootEnclave');
    });

    // Why: a stand is idle while its dragon respawns, and the cave puts a greater demon inside a cast of stand 1, so the idle time goes on that.
    test('and fills the respawn downtime with the cave greater demons', () => {
        expect(s.alsoHunt).toEqual(['Greater demon']);
        expect(huntNames(s)).toEqual(['Blue dragon', 'Greater demon']);
    });

    // Why: the cave holds six dragons and which one is worth camping depends on what else is in the room, so the stands are numbered and the operator picks one.
    test('it carries six numbered stands, one per dragon in the cave', () => {
        expect(s.stands).toHaveLength(6);
        for (const st of s.stands!) {
            expect(st.tiles).toHaveLength(3);
            expect(st.label).toMatch(/dragon at \d{4},\d{4}/);
            for (const t of st.tiles) {
                expect(s.inArea(t)).toBe(true);
            }
            expect(s.inArea(st.anchor)).toBe(true);
        }
    });

    // Why: a stand that sees a sliver of its dragon's wander takes no kills, which is what the first pass at the south stand did on a live run.
    test('every stand looks at its own dragon and sits clear of the rest of the cave', () => {
        const spawns = [[2590, 9461], [2568, 9437], [2579, 9445], [2592, 9431], [2604, 9443], [2609, 9459]];
        s.stands!.forEach((st, i) => {
            const [x, z] = spawns[i]!;
            const cheb = (t: { x: number; z: number }) => Math.max(Math.abs(t.x - x!), Math.abs(t.z - z!));
            expect(st.label).toContain(`${x},${z}`);
            // the body is 4 wide, so a tile within 14 of the spawn corner is inside a 10 cast of some of it
            expect(Math.min(...st.tiles.map(cheb))).toBeLessThanOrEqual(14);
        });
    });

    test('no two stands share a tile, so a number picks a place rather than a shade of one', () => {
        const seen = new Set<string>();
        for (const st of s.stands!) {
            for (const t of st.tiles) {
                expect(seen.has(`${t.x},${t.z}`)).toBe(false);
                seen.add(`${t.x},${t.z}`);
            }
        }
    });

    test('stand 1 is what the site fights from by default, since it is the one with a live proof', () => {
        expect(s.safespots).toEqual(s.stands![0]!.tiles);
        expect(s.meleeAnchor).toEqual(s.stands![0]!.anchor);
    });

    test('the stand and the anchor sit in the cave, and the guard does not', () => {
        for (const t of s.safespots) {
            expect(s.inArea(t)).toBe(true);
        }
        expect(s.inArea(s.meleeAnchor)).toBe(true);
        expect(s.inArea(s.exit!.stand)).toBe(true);
        expect(s.inArea(s.talkGate!.stand)).toBe(false);
        expect(s.inArea(s.walkOut)).toBe(false);
        expect(s.inArea(null)).toBe(false);
    });

    test('every edge of the cave box is pinned from both sides', () => {
        expect(s.inArea({ x: 2560, z: 9440, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2559, z: 9440, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2623, z: 9440, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2624, z: 9440, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2590, z: 9408, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2590, z: 9407, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2590, z: 9471, level: 0 })).toBe(true);
        expect(s.inArea({ x: 2590, z: 9472, level: 0 })).toBe(false);
        expect(s.inArea({ x: 2585, z: 9468, level: 1 })).toBe(false);
    });

    test('the melee anchor stands outside every adult spawn footprint', () => {
        const spawns = [[2568, 9437], [2579, 9445], [2590, 9461], [2592, 9431], [2604, 9443], [2609, 9459]];
        for (const [x, z] of spawns) {
            const inside = s.meleeAnchor.x >= x! - 3 && s.meleeAnchor.x <= x! + 3 && s.meleeAnchor.z >= z! - 3 && s.meleeAnchor.z <= z! + 3;
            expect(inside).toBe(false);
        }
    });
});

describe.skipIf(!inputsPresent(GUTANOTH_BLUE))('the Enclave derivation (pack-gated)', () => {
    test('the tool still derives every checked-in tile as a safespot', () => {
        const site = DRAGON_SITES['gutanoth-blue']!;
        const derived = derive(GUTANOTH_BLUE);
        expect(derived.spawns.filter(sp => sp.adult).map(sp => [sp.x, sp.z]))
            .toEqual([[2568, 9437], [2579, 9445], [2590, 9461], [2592, 9431], [2604, 9443], [2609, 9459]]);
        const spots = new Set(derived.safespots.map(t => `${t.x},${t.z}`));
        for (const t of site.safespots) {
            expect(spots.has(`${t.x},${t.z}`)).toBe(true);
        }
        expect(derived.anchors.some(a => a.x === site.meleeAnchor.x && a.z === site.meleeAnchor.z)).toBe(true);
    }, 60_000);
});

// Why: the number comes off a settings box, so a typo or an old profile must land on a stand rather than throw.
describe('standFor', () => {
    const enclave = DRAGON_SITES['gutanoth-blue']!;

    test('picks the numbered stand, 1-based', () => {
        expect(standFor(enclave, 1)).toEqual(enclave.stands![0]!);
        expect(standFor(enclave, 3)).toEqual(enclave.stands![2]!);
        expect(standFor(enclave, 6)).toEqual(enclave.stands![5]!);
    });

    test('clamps a number past either end rather than throwing', () => {
        expect(standFor(enclave, 0)).toEqual(enclave.stands![0]!);
        expect(standFor(enclave, -4)).toEqual(enclave.stands![0]!);
        expect(standFor(enclave, 99)).toEqual(enclave.stands![5]!);
        expect(standFor(enclave, 2.7)).toEqual(enclave.stands![1]!);
        expect(standFor(enclave, Number.NaN)).toEqual(enclave.stands![0]!);
    });

    test('a site that names no stands answers with its own tiles, whatever the number', () => {
        const taverley = DRAGON_SITES['taverley-blue']!;
        expect(taverley.stands).toBeUndefined();
        for (const n of [1, 4, 99]) {
            const stand = standFor(taverley, n);
            expect(stand.tiles).toEqual(taverley.safespots);
            expect(stand.anchor).toEqual(taverley.meleeAnchor);
        }
    });
});

// Why: the target has to come first, or a site that fills downtime would take the filler while its own target is up.
describe('huntNames', () => {
    test('puts the site target first and the filler after it', () => {
        expect(huntNames(DRAGON_SITES['gutanoth-blue']!)[0]).toBe('Blue dragon');
    });

    test('a site that fills no downtime hunts its target and nothing else', () => {
        for (const key of ['taverley-blue', 'taverley-black', 'heroes-blue']) {
            const site = DRAGON_SITES[key]!;
            expect(site.alsoHunt).toBeUndefined();
            expect(huntNames(site)).toEqual([site.target]);
        }
    });
});

describe('the Brimhaven Dungeon metal dragons', () => {
    const iron = DRAGON_SITES['brimhaven-iron']!;
    const steel = DRAGON_SITES['brimhaven-steel']!;

    test('pay Saniboch and take the entrance tree, with no key and no door', () => {
        expect(iron.keyItem).toBeNull();
        expect(iron.gate).toBeNull();
        expect(iron.feeGate).toMatchObject({ npc: 'Saniboch', op: 'Pay', coins: 875, entrance: { locId: 5083, op: 'Enter' } });
        expect(iron.feeGate!.paidLine.test('You pay Saniboch 875 coins.')).toBe(true);
        expect(iron.coins).toBeGreaterThanOrEqual(875 + 60);
        expect(steel.feeGate).toBe(iron.feeGate);
    });

    test('breathe at range, so every style wears the shield and the trip carries antifire and an axe', () => {
        for (const s of [iron, steel]) {
            expect(s.fireAtRange).toBe(true);
            expect(s.rangedThreat).toBe(true);
            expect(s.antifire).toBe(true);
            expect(s.axe).toBe(true);
            expect(needsShield(s, 'mage')).toBe(true);
            expect(needsShield(s, 'melee')).toBe(true);
        }
        expect(needsShield(TAVERLEY_BLUE, 'mage')).toBe(false);
        expect(needsShield(TAVERLEY_BLUE, 'melee')).toBe(true);
    });

    test('leave by the exit loc, teleport to Ardougne and bank at the east booth', () => {
        expect(iron.exit).toMatchObject({ locId: 5084, op: 'leave' });
        expect([iron.exit!.stand.x, iron.exit!.stand.z]).toEqual([2713, 9564]);
        expect(iron.escapeTeleportId).toBe('ardougne');
        expect(SPELL_TELEPORTS.some(t => t.teleportId === iron.escapeTeleportId)).toBe(true);
        expect([iron.bank.x, iron.bank.z]).toEqual([2655, 3283]);
    });

    test('the approach runs one stop per obstacle from the landing to the pipe', () => {
        expect(iron.approach.map(t => [t.x, t.z])).toEqual([[2691, 9564], [2649, 9562], [2672, 9499], [2682, 9506], [2698, 9500], [2698, 9492]]);
    });

    test('the whole dungeon is the area, so the landing never reads as outside and the surface always does', () => {
        for (const s of [iron, steel]) {
            expect(s.inArea({ x: 2713, z: 9564, level: 0 })).toBe(true);
            expect(s.inArea({ x: 2697, z: 9458, level: 0 })).toBe(true);
            expect(s.inArea({ x: 2745, z: 3152, level: 0 })).toBe(false);
            expect(s.inArea({ x: 2697, z: 9458, level: 2 })).toBe(false);
        }
    });

    test('iron carries four numbered stands and steel one, and the picker knows which sites have several', () => {
        expect(iron.stands!.length).toBe(4);
        expect(steel.stands!.length).toBe(1);
        expect(iron.safespots).toBe(iron.stands![0]!.tiles);
        expect(standFor(iron, 9).label).toBe(iron.stands![3]!.label);
        expect(standFor(steel, 3).tiles).toBe(steel.stands![0]!.tiles);
        expect(STAND_SITE_KEYS).toEqual(['gutanoth-blue', 'brimhaven-iron']);
        expect(MAX_STANDS).toBe(6);
    });

    test('steel is the iron site with its own target, stands and loot chips', () => {
        expect(steel.target).toBe('Steel dragon');
        expect(steel.lootSetting).toBe('lootSteel');
        expect(iron.lootSetting).toBe('lootIron');
        expect(steel.bank).toBe(iron.bank);
        expect(huntNames(steel)).toEqual(['Steel dragon']);
    });
});

// Why: the room is one open cave under a chase leash of 20, so the pockets the sites carry are pinned as tiles the probe still calls melee-proof, and the stand's dragon as one it sees.
describe.skipIf(!inputsPresent(IRON_DRAGON))('the Brimhaven derivation (pack-gated)', () => {
    test('every iron stand tile is a derived safespot and sees the dragon it is named for', () => {
        const derived = derive(IRON_DRAGON);
        const spots = new Map(derived.safespots.map(s => [`${s.x},${s.z}`, s]));
        for (const stand of BRIMHAVEN_IRON.stands!) {
            const [x, z] = stand.label.match(/(\d+),(\d+)/)!.slice(1).map(Number);
            const i = derived.spawns.filter(s => s.adult).findIndex(s => s.x === x && s.z === z);
            expect(i).toBeGreaterThanOrEqual(0);
            for (const t of stand.tiles) {
                const spot = spots.get(`${t.x},${t.z}`);
                expect(spot).toBeDefined();
                expect(spot!.shares[i]).toBeGreaterThan(0);
            }
        }
    }, 120_000);

    test('the steel stand is a derived safespot for its dragon', () => {
        const derived = derive(STEEL_DRAGON);
        const spots = new Set(derived.safespots.map(s => `${s.x},${s.z}`));
        for (const t of BRIMHAVEN_STEEL.stands![0]!.tiles) {
            expect(spots.has(`${t.x},${t.z}`)).toBe(true);
        }
    }, 120_000);
});
