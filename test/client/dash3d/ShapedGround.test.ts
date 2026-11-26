import { expect, test } from 'bun:test';
import World from '#/client/dash3d/World.js';
import { Int32Array3d } from '#/client/util/Arrays.js';

test('a grid covering all shaped tiles retains at most one index triple per shape and rotation', () => {
    const world = new World(new Int32Array3d(1, 23, 25), 24, 1, 22);
    const indices = new Set<Int32Array>();
    for (let i = 0; i < 22 * 24; i++) {
        const x = i % 22;
        const z = Math.floor(i / 22);
        world.setGround(0, x, z, 2 + i % 11, Math.floor(i / 11) % 4, i % 2 ? -1 : 3,
            0, 2, 4, 6, i, 2, 3, 4, 5, 6, 7, 8, 9, 10);
        const tile = world['squares'][0][x][z]!.ground!;
        indices.add(tile.faceVertexA).add(tile.faceVertexB).add(tile.faceVertexC);
    }
    expect(indices.size).toBeLessThanOrEqual(132);
});

test('repeated rotated faces retain tile-local colours and textures', () => {
    const world = new World(new Int32Array3d(1, 4, 2), 1, 1, 3);
    for (let x = 0; x < 3; x++) {
        world.setGround(0, x, 0, 2, 1, x - 1, 0, 1, 2, 3,
            x, x + 10, x + 20, x + 30, x + 40, x + 50, x + 60, x + 70, 5, 6);
    }
    for (let x = 0; x < 3; x++) {
        const tile = world['squares'][0][x][0]!.ground!;
        expect([...tile.faceColourA]).toEqual([x, x + 70]);
        expect([...tile.faceColourB]).toEqual([x + 10, x + 40]);
        expect([...tile.faceColourC]).toEqual([x + 20, x + 60]);
        expect(tile.faceTexture && [...tile.faceTexture]).toEqual(x === 0 ? null : [-1, x - 1]);
    }
});
