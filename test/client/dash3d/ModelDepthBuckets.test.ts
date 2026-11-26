import { expect, test } from 'bun:test';
import Model from '#/client/dash3d/Model.js';
import Pix3D from '#/client/dash3d/Pix3D.js';
import { withPixelViewport } from './pixelViewport.fixture.js';

function triangles(count: number): Model {
    const model = new Model();
    model.numFaces = count;
    model.numPoints = count * 3;
    model.faceVertexA = Int32Array.from({ length: count }, (_, i) => i * 3);
    model.faceVertexB = model.faceVertexA.map(a => a + 1);
    model.faceVertexC = model.faceVertexA.map(a => a + 2);
    model.pointX = new Int32Array(model.numPoints);
    model.pointY = new Int32Array(model.numPoints);
    model.pointZ = new Int32Array(model.numPoints);
    for (let i = 0; i < count; i++) {
        const x = (i % 32) * 4 - 64;
        const y = Math.floor(i / 32) * 4 - 34;
        model.pointX.set([x, x, x + 3], i * 3);
        model.pointY.set([y, y + 3, y], i * 3);
    }
    model.faceRenderType = new Int32Array(count).fill(1);
    model.faceColourA = new Int32Array(count).fill(1);
    model.calcBoundingCylinder();
    return model;
}

test('61 idle model modules allocate no face ID rows', async () => {
    const models = new Set<typeof Model>();
    let rows = 0;
    for (let i = 0; i < 61; i++) {
        const model: typeof Model = (await import(`../../../src/client/dash3d/Model.ts?idle=${i}`)).default;
        models.add(model);
        rows += model.tmpDepthFaces.filter(Boolean).length;
        rows += model.tmpPriorityFaces.filter(Boolean).length;
    }
    expect(models.size).toBe(61);
    expect(rows).toBe(0);
});

function withViewport(draw: (pixels: Int32Array) => void): void {
    const previous3D = { scanline: Pix3D.scanline, originX: Pix3D.originX, originY: Pix3D.originY, hclip: Pix3D.hclip, trans: Pix3D.trans };
    const colour = Pix3D.colourTable[1];
    try {
        withPixelViewport(Pix3D, 128, 68, pixels => {
            Pix3D.colourTable[1] = 1;
            Pix3D.trans = 0;
            draw(pixels);
        });
    } finally {
        Pix3D.colourTable[1] = colour;
        Object.assign(Pix3D, previous3D);
    }
}

for (const priorities of [false, true]) {
    test(`dense rows paint every triangle and reuse capacity (priorities=${priorities})`, () => {
        const model = triangles(513);
        if (priorities) model.facePriority = new Int32Array(513);
        withViewport(pixels => {
            let denseRow: Int32Array | undefined;
            for (const count of [512, 513, 1, 513]) {
                pixels.fill(0);
                model.numFaces = count;
                model.objRender(0, 0, 0, 0, 0, 0, 512);
                let painted = 0;
                for (let i = 0; i < 513; i++) {
                    painted += pixels[Math.floor(i / 32) * 4 * 128 + (i % 32) * 4];
                }
                expect(painted).toBe(count);
                const row = Model.tmpDepthFaces[model.minDepth];
                if (denseRow) expect(row).toBe(denseRow);
                if (count === 513) denseRow = row;
            }
        });
    });
}

test('repeated draws skip the maxDepth bucket and paint the next face', () => {
    const model = triangles(2);
    model.pointX!.set([-1, -1, 1, -1, -1, 1]);
    model.pointY!.set([-1, 1, -1, -1, 1, -1]);
    model.pointZ!.set([100, 100, 100, 99, 99, 99]);
    model.calcBoundingCylinder();
    expect(model.minDepth).toBe(100);
    expect(model.maxDepth).toBe(200);

    const row = Model.tmpDepthFaces[200];
    const count = Model.tmpDepthFaceCount[200];
    withViewport(pixels => {
        for (let i = 0; i < 1025; i++) {
            model.objRender(0, 0, 0, 0, 0, 0, 128);
        }
        expect(pixels.includes(1)).toBe(true);
    });
    expect(Model.tmpDepthFaces[200]?.length).toBe(row?.length);
    expect(Model.tmpDepthFaceCount[200]).toBe(count);
});

test('world rendering buckets triangles crossing the near plane', () => {
    const model = triangles(1);
    model.faceColourB = model.faceColourA;
    model.faceColourC = model.faceColourA;
    model.pointX!.set([-2, -2, 2]);
    model.pointY!.set([-2, 2, -2]);
    model.pointZ![0] = -3;
    model.calcBoundingCylinder();
    withViewport(pixels => {
        model.worldRender(0, 0, 65536, 0, 65536, 0, 0, 51, 0);
        expect(pixels.includes(1)).toBe(true);
    });
});

test('depth ties keep face order through both sorting paths', () => {
    const model = triangles(4);
    model.pointZ!.set([16, 16, 16], 3);
    model.pointZ!.set([16, 16, 16], 9);
    model.calcBoundingCylinder();
    const faces: number[] = [];
    model['render3'] = face => {
        faces.push(face);
    };
    model.objRender(0, 0, 0, 0, 0, 0, 512);
    expect(faces).toEqual([1, 3, 0, 2]);
    faces.length = 0;
    model.facePriority = Int32Array.of(0, 1, 0, 1);
    model.objRender(0, 0, 0, 0, 0, 0, 512);
    expect(faces).toEqual([0, 2, 1, 3]);
});

for (const priority of [0, 10, 11]) {
    test(`priority ${priority} draws all 2001 coplanar faces before priority 9`, () => {
        const model = triangles(1);
        model.faceVertexA = new Int32Array(2002);
        model.faceVertexB = new Int32Array(2002).fill(1);
        model.faceVertexC = new Int32Array(2002).fill(2);
        model.facePriority = new Int32Array(2002).fill(priority);
        model.facePriority[0] = 9;

        const faces: number[] = [];
        model['render3'] = face => faces.push(face);
        for (const count of [2000, 2001]) {
            model.numFaces = count + 1;
            faces.length = 0;
            model.objRender(0, 0, 0, 0, 0, 0, 512);
            expect(faces).toEqual([...Array.from({ length: count }, (_, i) => i + 1), 0]);
        }
    });
}
