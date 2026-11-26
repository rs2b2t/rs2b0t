import { expect, spyOn, test } from 'bun:test';
import Pix32 from '#/client/graphics/Pix32.js';
import Pix8 from '#/client/graphics/Pix8.js';
import { mapSpriteArchive } from './mapSprites.fixture.js';

test('decoding 100 map sprites reads each sheet and its index once', () => {
    const archive = mapSpriteArchive();
    const reads = spyOn(archive, 'read');
    const scenes = new Array<Pix8>(50);
    const functions = new Array<Pix32>(50);
    Pix8.depackSheet(archive, 'mapscene', scenes);
    Pix32.depackSheet(archive, 'mapfunction', functions);
    expect(reads.mock.calls).toEqual([['mapscene.dat'], ['index.dat'], ['mapfunction.dat'], ['index.dat']]);

    expect(scenes[0].bpal[1]).toBe(0);
    expect(functions[0].data[0]).toBe(1);
    expect(functions[0].data[63]).toBe(0);

    for (let i = 49; i >= 0; i--) {
        const scene = Pix8.depack(archive, 'mapscene', i);
        const icon = Pix32.depack(archive, 'mapfunction', i);
        expect(scenes[i]).toEqual(scene);
        expect(functions[i]).toEqual(icon);
        for (const sprite of [scene, icon, scenes[i], functions[i]]) sprite.rgbAdjust(5, -8, 13);
        expect(scenes[i]).toEqual(scene);
        expect(functions[i]).toEqual(icon);
    }
});

for (const [name, Sprite, member] of [['mapscene', Pix8, 0], ['mapfunction', Pix32, 1]] as const) {
    for (const truncated of ['data', 'index']) {
        test(`${name} retains completed frames on truncated ${truncated}`, () => {
            const archive = mapSpriteArchive();
            const expected = [Sprite.depack(archive, name, 0), Sprite.depack(archive, name, 1), null, null];
            const data = archive.fileUnpacked[member];
            if (truncated === 'data') {
                archive.fileUnpacked[member] = data.subarray(0, 2 + 12 * 12 + 13 * 13 + 1);
            } else {
                const firstHeader = (data[0] << 8 | data[1]) + 5 + 63 * 3;
                archive.fileUnpacked[2] = archive.fileUnpacked[2].subarray(0, firstHeader + 2 * 7 + 1);
            }
            const frames = new Array(4).fill(null);
            expect(() => Sprite.depackSheet(archive, name, frames)).toThrow();
            expect(frames).toEqual(expected);
            expect(() => Sprite.depack(archive, name, 2)).toThrow();
        });
    }

    test(`${name} skips the pixel span of an unknown encoding`, () => {
        const archive = mapSpriteArchive();
        const expected = Sprite.depack(archive, name, 1);
        const data = archive.fileUnpacked[member];
        const firstHeader = (data[0] << 8 | data[1]) + 5 + 63 * 3;
        archive.fileUnpacked[2][firstHeader + 6] = 2;
        const frames = new Array(2);
        Sprite.depackSheet(archive, name, frames);
        expect(frames[0]).toEqual(Sprite.depack(archive, name, 0));
        expect(frames[1]).toEqual(expected);
    });
}
