import { afterEach, beforeEach, expect, test } from 'bun:test';
import AnimFrame from '#/client/dash3d/AnimFrame.js';
import Model from '#/client/dash3d/Model.js';

const header = [0, 4, 0, 2, 4, 0, 9, 4, 0, 13, 2, 0, 17, 0];
const flags = [0, 7, 1, 1, 0, 7, 2, 1, 0, 7];
const values = [62, 67, 60, 0xc1, 0, 67, 68, 62, 69, 0xc0, 64, 60, 0x80, 0, 0xff, 0xff, 0];
const delays = [5, 6, 7, 8];
const skeleton = [4, 0, 1, 3, 5, 1, 0, 1, 0, 1, 0, 1, 0];
const archive = Uint8Array.of(...header, ...flags, ...values, ...delays, ...skeleton, 0, 12, 0, 10, 0, 17, 0, 4);

let savedFrames: Pick<typeof AnimFrame, 'list' | 'opaque'>;
let savedOrigin: Pick<typeof Model, 'oX' | 'oY' | 'oZ'>;
beforeEach(() => {
    savedFrames = { list: AnimFrame.list, opaque: AnimFrame.opaque };
    savedOrigin = { oX: Model.oX, oY: Model.oY, oZ: Model.oZ };
    AnimFrame.init(17);
    AnimFrame.unpack(archive);
});
afterEach(() => {
    Object.assign(AnimFrame, savedFrames);
    Object.assign(Model, savedOrigin);
});

function model() {
    const m = new Model();
    m.labelVertices = [Int32Array.of(0, 1)];
    m.labelFaces = [Int32Array.of(0)];
    m.pointX = Int32Array.of(0, 4);
    m.pointY = Int32Array.of(1, 5);
    m.pointZ = Int32Array.of(3, 7);
    m.faceAlpha = Int32Array.of(100);
    return m;
}

function pose(m: Model) {
    return [m.pointX!, m.pointY!, m.pointZ!, m.faceAlpha!].map(a => Array.from(a));
}

test('decoded frames retain one compact transform array', () => {
    const arrays = Object.values(AnimFrame.get(2)).filter(ArrayBuffer.isView);
    expect(arrays).toHaveLength(1);
    expect(arrays[0].byteLength).toBe(4 * 4 * 2);
});

test('sparse frames keep delays, implicit origins, opacity and signed smart limits', () => {
    expect(AnimFrame.get(1)).toBeUndefined();
    expect(AnimFrame.get(2).size).toBe(4);
    expect(AnimFrame.get(17).size).toBe(0);
    expect(AnimFrame.get(13).delay).toBe(7);
    expect([2, 9, 13, 17].map(id => AnimFrame.opaque[id])).toEqual([false, false, true, true]);
    const m = model();
    for (const id of [13, 17, 1, -1]) m.animate(id);
    expect(pose(m)).toEqual([[-16384, -16380], [16384, 16388], [-61, -57], [100]]);
});

test('animate applies implicit origin, signed translation, partial scale and alpha', () => {
    const m = model();
    m.animate(2);
    expect(pose(m)).toEqual([[-6, 2], [4, 8], [-1, 3], [124]]);
});

test('maskAnimate uses the secondary scale around the translated origin and the secondary alpha', () => {
    const m = model();
    m.maskAnimate(2, 9, Int32Array.of(2, 3, 999));
    expect(pose(m)).toEqual([[-2, 2], [5, 7], [-1, 3], [68]]);
});

test('maskAnimate falls back to the primary frame for an absent secondary frame or mask', () => {
    for (const [id, mask] of [[1, Int32Array.of(2, 999)], [9, null], [-1, null]] as const) {
        const m = model();
        m.maskAnimate(2, id, mask);
        expect(pose(m)).toEqual([[-6, 2], [4, 8], [-1, 3], [124]]);
    }
});
