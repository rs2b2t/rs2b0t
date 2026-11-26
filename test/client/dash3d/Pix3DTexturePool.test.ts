import { expect, test } from 'bun:test';
import type Pix3D from '#/client/dash3d/Pix3D.js';
import Pix8 from '#/client/graphics/Pix8.js';
import { withPixelViewport } from './pixelViewport.fixture.js';

let moduleId = 0;
async function loadRenderer(lowMem: boolean): Promise<typeof Pix3D> {
    const renderer: typeof Pix3D = (await import(`../../../src/client/dash3d/Pix3D.ts?pool=${++moduleId}`)).default;
    renderer.lowMem = lowMem;
    renderer.initPool(20);
    return renderer;
}

function buffers(renderer: typeof Pix3D) {
    const texels = [...renderer['texelBuffers'], ...renderer.texelPool!, ...renderer.activeTexels];
    return new Set(texels.flatMap(data => data ? [data.buffer] : []));
}

function setTexture(renderer: typeof Pix3D, id: number, colour: number) {
    const palette = Int32Array.of(0, colour);
    const texture = new Pix8(64, 64, palette);
    texture.data.fill(1);
    renderer.textures[id] = texture;
    renderer.texPal[id] = palette;
    return palette;
}

function draw(renderer: typeof Pix3D, id: number) {
    renderer.textureTriangle(0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, id);
}

test('retrying the last buffer allocation keeps all 20 textures cached', async () => {
    const renderer = await loadRenderer(true);
    renderer.numTextures = 20;
    for (let id = 0; id < 20; id++) {
        setTexture(renderer, id, 0xf80000);
    }
    for (let id = 0; id < 19; id++) {
        renderer['getTexels'](id);
    }

    const allocator = globalThis.Int32Array;
    try {
        globalThis.Int32Array = new Proxy(allocator, {
            construct() { throw new RangeError('texel allocation failed'); }
        });
        expect(() => renderer['getTexels'](19)).toThrow('texel allocation failed');
    } finally {
        globalThis.Int32Array = allocator;
    }

    expect(renderer['getTexels'](19)?.[0]).toBe(0xf80000);
    let misses = 0;
    for (let pass = 0; pass < 2; pass++) {
        for (let id = 0; id < 20; id++) {
            if (!renderer.activeTexels[id]) misses++;
            expect(renderer['getTexels'](id)?.[0]).toBe(0xf80000);
        }
    }
    expect(misses).toBe(0);
});

test('retrying a failed mode switch returns standard-width texels', async () => {
    const renderer = await loadRenderer(true);
    setTexture(renderer, 0, 0xf80000);
    expect(renderer['getTexels'](0)?.length).toBe(16384);
    renderer.clearTexels();
    renderer.lowMem = false;
    expect(() => renderer.initPool(-1)).toThrow(RangeError);
    renderer.initPool(20);
    expect(renderer['getTexels'](0)?.length).toBe(65536);
});

for (const lowMem of [true, false]) {
    test(`two draws allocate two buffers and reuse them after rebuild (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(lowMem);
        expect(renderer.poolSize).toBe(20);
        expect(buffers(renderer).size).toBe(0);
        const palette = setTexture(renderer, 0, 0xf80000);
        setTexture(renderer, 1, 0x0000ff);
        withPixelViewport(renderer, 4, 4, pixels => {
            draw(renderer, 0);
            expect(pixels[0]).toBe(0xf80000);
            expect(buffers(renderer).size).toBe(1);
            draw(renderer, 1);
            expect(pixels[0]).toBe(0x0000ff);
            const original = buffers(renderer);
            expect(original.size).toBe(2);

            palette[1] = 0x00f800;
            renderer.clearTexels();
            renderer.initPool(20);
            draw(renderer, 0);
            expect(pixels[0]).toBe(0x00f800);
            draw(renderer, 1);
            expect(pixels[0]).toBe(0x0000ff);
            expect(buffers(renderer).size).toBe(2);
            for (const id of [0, 1]) expect(original.has(renderer.activeTexels[id]!.buffer)).toBe(true);
        });
    });

    test(`the 21st texture reuses the oldest of 20 buffers (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(lowMem);
        renderer.numTextures = 21;
        for (let id = 0; id < 20; id++) {
            setTexture(renderer, id, 0xf80000);
            expect(renderer['getTexels'](id)?.[0]).toBe(0xf80000);
        }
        const oldest = renderer.activeTexels[0];
        setTexture(renderer, 20, 0x00f800);
        expect(renderer['getTexels'](20)).toBe(oldest);
        expect(oldest?.[0]).toBe(0x00f800);
        expect(renderer.activeTexels[0]).toBeNull();
        expect(renderer.poolSize).toBe(0);
        const original = buffers(renderer);
        expect(original.size).toBe(20);
        renderer.clearTexels();
        renderer.initPool(20);
        expect(renderer.poolSize).toBe(20);
        for (const texels of renderer.texelPool!) expect(original.has(texels!.buffer)).toBe(true);
    });

    for (const rebuild of [false, true]) {
        test.each(['texture', 'palette'])(`repeated draw with missing %s (lowMem=${lowMem}, rebuild=${rebuild})`, async missing => {
            const renderer = await loadRenderer(lowMem);
            renderer.clearTexels();
            renderer.initPool(20);
            const palette = setTexture(renderer, 17, 0xf80000);

            withPixelViewport(renderer, 4, 4, pixels => {
                draw(renderer, 17);
                expect(pixels[0]).toBe(0xf80000);

                if (rebuild) {
                    renderer.clearTexels();
                    renderer.initPool(20);
                } else {
                    renderer.pushTexture(17);
                }
                if (missing === 'texture') renderer.texPal[0] = palette;
                else renderer.textures[0] = renderer.textures[17];
                pixels.fill(0xffffff);
                draw(renderer, 0);
                expect(pixels[0]).toBe(0xffffff);
                draw(renderer, 0);
                expect(pixels[0]).toBe(rebuild ? 0 : 0xf80000);
            });
        });
    }

    test(`rebuild sizes texels for the new memory mode (lowMem=${lowMem})`, async () => {
        const renderer = await loadRenderer(!lowMem);
        setTexture(renderer, 0, 0xf80000);
        expect(renderer['getTexels'](0)?.length).toBe(lowMem ? 65536 : 16384);
        renderer.clearTexels();
        renderer.lowMem = lowMem;
        renderer.initPool(20);
        const bytes = (lowMem ? 16384 : 65536) * Int32Array.BYTES_PER_ELEMENT;
        expect(buffers(renderer).size).toBe(0);
        expect(renderer['getTexels'](0)?.byteLength).toBe(bytes);
    });
}
