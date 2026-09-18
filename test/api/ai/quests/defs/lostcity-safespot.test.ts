import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LURE, TREE_STAND, TREE_SPIRIT_SAFESPOT, TREE_SPIRIT_TRAP } from '#/bot/api/ai/quests/defs/lostcityCombat.js';
import { hasLineOfSightLocal } from '#/bot/event/webwalk/geometry/lineOfSight.js';
import CollisionEngine from '#/bot/event/webwalk/rsmod/CollisionEngine.js';
import { canTravel } from '#/bot/event/webwalk/rsmod/StepValidator.js';
import { changeLocCollision } from '#/bot/event/webwalk/rsmod/collision.js';
import { CollisionFlag, CollisionType } from '#/bot/event/webwalk/rsmod/flags.js';
import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, packCoord, parseLands } from '../../../../../tools/nav/lib.js';

const engine = process.env.ENGINE_DIR ?? join(homedir(), 'code/rs2b2t-engine');
const pathfinder = join(engine, 'src/engine/routefinder/NaivePathFinder.ts');
const present = [pathfinder, join(engine, 'data/pack/server/loc.dat'), join(engine, 'data/pack/client/config')].every(existsSync)
    && ['data/pack/.cache/maps-server.zip', 'data/pack/server/maps/m44_152'].some(path => existsSync(join(engine, path)));
type Point = { x: number; z: number };
const point = ({ x, z }: Point): Point => ({ x, z });
const distance = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

describe.skipIf(!present)('Lost City packed safespot geometry', () => {
    const collision = new CollisionEngine();
    const placements: { id: number; x: number; z: number; level: number; shape: number }[] = [];
    let types: ReturnType<typeof loadLocTypes>['configs'];
    let naive: (flags: CollisionEngine, ...args: number[]) => Uint32Array;

    beforeAll(async () => {
        naive = (await import(pathfinder)).findNaivePath;
        types = loadLocTypes(engine).configs;
        const square = loadMapsquares(engine).find(({ mx, mz }) => mx === 44 && mz === 152)!;
        expect(square).toBeDefined();
        const lands = parseLands(new Reader(square.land));
        for (let level = 0; level < 4; level++) {
            for (let x = 0; x < 64; x++) {
                for (let z = 0; z < 64; z++) {
                    collision.allocateIfAbsent(2816 + x, 9728 + z, level);
                    const coord = packCoord(x, z, level);
                    const actual = bridgedLevel(lands, coord, x, z, level);
                    if ((lands[coord] & 1) && actual >= 0) collision.changeFloor(2816 + x, 9728 + z, actual, true);
                }
            }
        }
        forEachLoc(new Reader(square.loc), ({ locId, x, z, level, coord, shape, angle }) => {
            const type = types[locId];
            const actual = bridgedLevel(lands, coord, x, z, level);
            if (actual < 0 || !type) return;
            placements.push({ id: locId, x: 2816 + x, z: 9728 + z, level: actual, shape });
            if (type.blockwalk) changeLocCollision(collision, shape, angle, type.blockrange, type.length, type.width, type.active, 2816 + x, 9728 + z, actual, true);
        });
    });

    const travel = (src: Point, dx: number, dz: number): boolean => canTravel(collision, 0, src.x, src.z, dx, dz, 1, 0, CollisionType.NORMAL);
    const sight = (src: Point, dest: Point): boolean => hasLineOfSightLocal((x, z) => collision.get(x, z, 0),
        { lx: src.x, lz: src.z, size: 1 }, { lx: dest.x, lz: dest.z, size: 1 });
    const step = (src: Point, dest: Point): Point => {
        const next = naive(collision, 0, src.x, src.z, dest.x, dest.z, 1, 1, 1, 1, 0, CollisionType.NORMAL)[0];
        const dx = Math.sign(((next >> 14) & 0x3fff) - src.x);
        const dz = Math.sign((next & 0x3fff) - src.z);
        for (const [x, z] of [[dx, dz], [dx, 0], [0, dz]]) {
            if ((x || z) && travel(src, x, z)) return { x: src.x + x, z: src.z + z };
        }
        return src;
    };

    test('the fungus blocks walking while allowing a two-tile Strike ray', () => {
        expect(placements).toContainEqual({ id: 1172, x: 2859, z: 9732, level: 0, shape: 10 });
        expect(types[1172]).toMatchObject({ blockwalk: true, blockrange: false });
        for (const tile of [TREE_SPIRIT_SAFESPOT, TREE_SPIRIT_TRAP]) {
            expect(tile.level).toBe(0);
            expect(collision.get(tile.x, tile.z, 0) & CollisionFlag.WALK_BLOCKED).toBe(0);
        }
        expect(distance(TREE_SPIRIT_SAFESPOT, TREE_SPIRIT_TRAP)).toBe(2);
        expect(travel(TREE_SPIRIT_TRAP, 0, -1)).toBe(false);
        expect(sight(TREE_SPIRIT_SAFESPOT, TREE_SPIRIT_TRAP)).toBe(true);
        expect(sight(TREE_SPIRIT_TRAP, TREE_SPIRIT_SAFESPOT)).toBe(true);
    });

    test('the trapped spirit cannot advance through its entire spawn lifetime', () => {
        let npc = point(TREE_SPIRIT_TRAP);
        for (let tick = 0; tick < 1200; tick++) npc = step(npc, TREE_SPIRIT_SAFESPOT);
        expect(npc).toEqual(point(TREE_SPIRIT_TRAP));
    });

    test('the south lure traps a fresh spawn across 686 tick order and delay combinations', () => {
        const route = [TREE_STAND, ...LURE].map(point);
        for (let i = 1; i < route.length; i++) {
            expect(distance(route[i - 1], route[i])).toBe(1);
            expect(travel(route[i - 1], route[i].x - route[i - 1].x, route[i].z - route[i - 1].z)).toBe(true);
        }
        let combinations = 0;
        for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) for (let c = 0; c <= 6; c++) {
            for (const npcFirst of [false, true]) {
                let npc: Point = { x: 2860, z: 9737 };
                let player = route[0];
                const advance = () => { npc = step(npc, player); expect(distance(npc, player)).toBeGreaterThan(1); };
                for (let tick = 0; tick < a; tick++) advance();
                for (let i = 1; i < route.length; i++) {
                    if (npcFirst) advance();
                    player = route[i];
                    if (!npcFirst) advance();
                    const wait = i === 1 ? b : i === 2 ? c : 0;
                    for (let tick = 0; tick < wait; tick++) advance();
                }
                for (let tick = 0; tick < 20; tick++) advance();
                expect(player).toEqual(point(TREE_SPIRIT_SAFESPOT));
                expect(npc).toEqual(point(TREE_SPIRIT_TRAP));
                expect(sight(player, npc)).toBe(true);
                combinations++;
            }
        }
        expect(combinations).toBe(686);
    });
});
