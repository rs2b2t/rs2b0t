import { expect, test } from 'bun:test';
import type Pix3D from '#/client/dash3d/Pix3D.js';
import Pix2D from '#/client/graphics/Pix2D.js';
import Pix8 from '#/client/graphics/Pix8.js';

let moduleId = 0;
async function loadRenderer(lowMem: boolean): Promise<typeof Pix3D> {
    const renderer: typeof Pix3D = (await import(`../../../src/client/dash3d/Pix3D.ts?pool=${++moduleId}`)).default;
    renderer.lowMem = lowMem;
    renderer.initPool(20);
    return renderer;
}

function buffers(renderer: typeof Pix3D) {
    expect(renderer.poolSize).toBe(20);
    expect(renderer.texelPool).toHaveLength(20);
    const buffers = Array.from(renderer.texelPool!, texels => texels!.buffer);
    expect(new Set(buffers).size).toBe(20);
    return buffers;
}

for (const lowMem of [true, false]) {
    test(`idle rebuild reuses all 20 texel buffers (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(lowMem);
        const original = new Set(buffers(renderer));
        renderer.clearTexels();
        renderer.initPool(20);
        expect(buffers(renderer).filter(buffer => !original.has(buffer))).toHaveLength(0);
    });

    test(`rebuild reclaims active texels and redraws with the current palette (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(lowMem);
        const original = new Set(buffers(renderer));
        const palette = Int32Array.of(0, 0xf80000);
        const texture = new Pix8(64, 64, palette);
        texture.data.fill(1);
        renderer.numTextures = 21;
        for (let id = 0; id < renderer.numTextures; id++) {
            renderer.textures[id] = texture;
            renderer.texPal[id] = palette;
            expect(renderer['getTexels'](id)?.[0]).toBe(0xf80000);
        }
        expect(renderer.poolSize).toBe(0);
        palette[1] = 0x00f800;
        renderer.clearTexels();
        renderer.initPool(20);
        expect(buffers(renderer).filter(buffer => !original.has(buffer))).toHaveLength(0);
        expect(renderer['getTexels'](20)?.[0]).toBe(0x00f800);
    });

    for (const rebuild of [false, true]) {
        test.each(['texture', 'palette'])(`repeated draw with missing %s (lowMem=${lowMem}, rebuild=${rebuild})`, async missing => {
            const renderer = await loadRenderer(lowMem);
            renderer.clearTexels();
            renderer.initPool(20);
            const palette = Int32Array.of(0, 0xf80000);
            const texture = new Pix8(64, 64, palette);
            texture.data.fill(1);
            renderer.textures[17] = texture;
            renderer.texPal[17] = palette;

            const previous2D = { ...Pix2D };
            const pixels = new Int32Array(16);
            const draw = (id: number) => renderer.textureTriangle(0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, id);
            try {
                Pix2D.setPixels(pixels, 4, 4);
                renderer.setRenderClipping();
                draw(17);
                expect(pixels[0]).toBe(0xf80000);

                if (rebuild) {
                    renderer.clearTexels();
                    renderer.initPool(20);
                } else {
                    renderer.pushTexture(17);
                }
                if (missing === 'texture') renderer.texPal[0] = palette;
                else renderer.textures[0] = texture;
                pixels.fill(0xffffff);
                draw(0);
                expect(pixels[0]).toBe(0xffffff);
                draw(0);
                expect(pixels[0]).toBe(rebuild ? 0 : 0xf80000);
            } finally {
                Object.assign(Pix2D, previous2D);
            }
        });
    }

    test(`rebuild sizes texels for the new memory mode (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(!lowMem);
        renderer.clearTexels();
        renderer.lowMem = lowMem;
        renderer.initPool(20);
        const bytes = (lowMem ? 16384 : 65536) * Int32Array.BYTES_PER_ELEMENT;
        expect(buffers(renderer).every(buffer => buffer.byteLength === bytes)).toBe(true);
    });
}
