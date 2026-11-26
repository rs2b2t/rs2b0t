import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type Pix3D from '#/client/dash3d/Pix3D.js';
import Pix8 from '#/client/graphics/Pix8.js';

test('all brightness settings preserve both palettes within 256 powers per rebuild', async () => {
    const modulePath = '../../../src/client/dash3d/Pix3D.ts?colour-table';
    const renderer: typeof Pix3D = (await import(modulePath)).default;
    renderer.textures[17] = new Pix8(2, 2, Int32Array.of(0, 0xffffff, 0x0180fe, 0xc73d09));
    const digest = createHash('sha256');
    const { random, pow } = Math;
    let calls = 0;
    let maxCalls = 0;
    try {
        Math.pow = (x, y) => {
            calls++;
            return pow(x, y);
        };
        for (const brightness of [0.9, 0.8, 0.7, 0.6]) {
            for (const sample of [0, 0.5, 0.999]) {
                Math.random = () => sample;
                calls = 0;
                renderer.initColourTable(brightness);
                maxCalls = Math.max(maxCalls, calls);
                digest.update(renderer.colourTable);
                digest.update(renderer.texPal[17]!);
            }
        }
    } finally {
        Math.random = random;
        Math.pow = pow;
    }
    expect(digest.digest('hex')).toBe('ad8ecf632e948a3422d099995474e6e3871d86696131c8cfc2e87583e19878be');
    expect(maxCalls).toBeLessThanOrEqual(256);
});
