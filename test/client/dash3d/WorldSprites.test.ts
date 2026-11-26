import { expect, test } from 'bun:test';
import ModelSource from '#/client/dash3d/ModelSource.js';
import World from '#/client/dash3d/World.js';
import { Int32Array3d } from '#/client/util/Arrays.js';

function baseWorld(size: number): World {
    const world = new World(new Int32Array3d(1, size + 1, size + 1), size, 1, size);
    world.fillBaseLevel(0);
    return world;
}

const scenery = 2 << 29;

test('one 2x2 placement allocates sprite storage on four of 10,816 tiles', () => {
    const world = baseWorld(104);
    expect(world.addScenery(0, 1, 1, 0, new ModelSource(), scenery, 0, 2, 2, 0)).toBe(true);

    const tiles = world['squares'][0].flat();
    expect(tiles.filter(tile => tile?.sprites).length).toBe(4);
    expect(tiles.filter(tile => tile?.spriteSpan).length).toBe(4);
});

test('a full tile rejects the sixth sprite and removal restores each footprint mask', () => {
    const world = baseWorld(3);
    const model = new ModelSource();
    const tiles = world['squares'][0];
    for (let i = 0; i < 4; i++) {
        expect(world.addDynamic2(0, 128, 0, 128, 0, 1, 1, 1, model, i, 0)).toBe(true);
    }
    expect(world.addScenery(0, 1, 1, 0, model, scenery, 0, 2, 2, 0)).toBe(true);
    expect(tiles[1][1]?.spriteSpans).toBe(7);
    expect(world.addScenery(0, 1, 0, 0, model, scenery, 0, 1, 2, 0)).toBe(false);
    expect(tiles[1][0]?.sprites).toBeNull();
    expect(tiles[1][0]?.spriteSpan).toBeNull();

    world.removeSprites();
    const footprint = [tiles[1][1], tiles[1][2], tiles[2][1], tiles[2][2]];
    expect(footprint.map(tile => tile?.spriteSpans)).toEqual([6, 12, 3, 9]);
    expect(footprint.map(tile => tile?.spriteCount)).toEqual([1, 1, 1, 1]);
    expect(world.getScene(0, 1, 1)?.typecode).toBe(scenery);

    world.delLoc(0, 1, 1);
    expect(footprint.map(tile => tile?.spriteSpans)).toEqual([0, 0, 0, 0]);
    expect(footprint.map(tile => tile?.spriteCount)).toEqual([0, 0, 0, 0]);
    expect(world.getScene(0, 1, 1)).toBeNull();
});
