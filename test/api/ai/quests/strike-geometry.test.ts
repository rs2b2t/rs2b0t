import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ARENA_COVER, DEMON_COVER, EXPERIMENT_COVER, EXPERIMENT_TRAP } from '#/bot/api/ai/quests/strikeCombat.js';
import { hasLineOfSightLocal } from '#/bot/event/webwalk/geometry/lineOfSight.js';
import CollisionEngine from '#/bot/event/webwalk/rsmod/CollisionEngine.js';
import { canTravel } from '#/bot/event/webwalk/rsmod/StepValidator.js';
import { changeLocCollision } from '#/bot/event/webwalk/rsmod/collision.js';
import { CollisionType } from '#/bot/event/webwalk/rsmod/flags.js';
import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, packCoord, parseLands } from '../../../../tools/nav/lib.js';

const engine = process.env.ENGINE_DIR ?? join(homedir(), 'code/rs2b2t-engine');
const pathfinder = join(engine, 'src/engine/routefinder/NaivePathFinder.ts');
const present = [pathfinder, join(engine, 'data/pack/server/loc.dat'), join(engine, 'data/pack/client/config')].every(existsSync);
type Point = { x: number; z: number };

describe.skipIf(!present)('quest Strike packed geometry', () => {
    const collision = new CollisionEngine();
    let naive: (flags: CollisionEngine, ...args: number[]) => Uint32Array;
    beforeAll(async () => {
        naive = (await import(pathfinder)).findNaivePath;
        const types = loadLocTypes(engine).configs;
        for (const square of loadMapsquares(engine).filter(s => (s.mx === 40 && s.mz === 49) || (s.mx === 38 && s.mz === 154) || (s.mx === 45 && s.mz === 54))) {
            const ox = square.mx * 64, oz = square.mz * 64;
            const lands = parseLands(new Reader(square.land));
            for (let level = 0; level < 4; level++) for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) {
                collision.allocateIfAbsent(ox + x, oz + z, level);
                const coord = packCoord(x, z, level);
                const actual = bridgedLevel(lands, coord, x, z, level);
                if ((lands[coord] & 1) && actual >= 0) collision.changeFloor(ox + x, oz + z, actual, true);
            }
            forEachLoc(new Reader(square.loc), ({ locId, x, z, level, coord, shape, angle }) => {
                const type = types[locId];
                const actual = bridgedLevel(lands, coord, x, z, level);
                if (actual >= 0 && type?.blockwalk) changeLocCollision(collision, shape, angle, type.blockrange, type.length, type.width, type.active, ox + x, oz + z, actual, true);
            });
        }
    });
    const step = (src: Point, dest: Point, size: number): Point => {
        const next = naive(collision, 0, src.x, src.z, dest.x, dest.z, size, size, 1, 1, 0, CollisionType.NORMAL)[0];
        const dx = Math.sign(((next >> 14) & 0x3fff) - src.x);
        const dz = Math.sign((next & 0x3fff) - src.z);
        for (const [x, z] of [[dx, dz], [dx, 0], [0, dz]]) {
            if ((x || z) && canTravel(collision, 0, src.x, src.z, x, z, size, 0, CollisionType.NORMAL)) return { x: src.x + x, z: src.z + z };
        }
        return src;
    };
    const sight = (src: Point, dest: Point, size: number) => hasLineOfSightLocal((x, z) => collision.get(x, z, 0),
        { lx: src.x, lz: src.z, size: 1 }, { lx: dest.x, lz: dest.z, size });
    test('all admitted arena approaches stop east of the rock in casting range', () => {
        for (let x = 2596; x <= 2603; x++) for (let z = 3166; z <= 3169; z++) {
            let npc = { x, z };
            for (let tick = 0; tick < 100; tick++) {
                npc = step(npc, ARENA_COVER, 2);
                expect(Math.max(npc.x - ARENA_COVER.x, npc.z - ARENA_COVER.z, ARENA_COVER.z - npc.z - 1), `from ${x},${z} at ${npc.x},${npc.z}`).toBeGreaterThan(1);
            }
            expect(sight(ARENA_COVER, npc, 2)).toBe(true);
        }
    });
    test('the demon cannot follow into the root passage', () => {
        let npc = { x: 2479, z: 9867 };
        for (let tick = 0; tick < 1000; tick++) {
            npc = step(npc, DEMON_COVER, 3);
            expect(npc.x - DEMON_COVER.x).toBeGreaterThan(1);
        }
        expect(sight(DEMON_COVER, npc, 3)).toBe(true);
    });
    test('the small experiment stays trapped north-east of the casting tile', () => {
        let npc: Point = EXPERIMENT_TRAP;
        for (let tick = 0; tick < 1000; tick++) npc = step(npc, EXPERIMENT_COVER, 1);
        expect(npc).toMatchObject({ x: 2937, z: 3466 });
        expect(sight(EXPERIMENT_COVER, npc, 1)).toBe(true);
    });
    test('the bear cannot enter the southern one-tile gap', () => {
        const cover = { x: 2936, z: 3459 };
        let npc = { x: 2935, z: 3462 };
        for (let tick = 0; tick < 1000; tick++) {
            npc = step(npc, cover, 2);
            expect(npc.z - cover.z).toBeGreaterThan(1);
        }
        expect(sight(cover, npc, 2)).toBe(true);
    });
});
