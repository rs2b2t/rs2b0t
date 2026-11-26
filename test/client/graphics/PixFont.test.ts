import { expect, test } from 'bun:test';
import Pix2D from '#/client/graphics/Pix2D.js';
import { fontFixture, fontOutputDigest } from '../../../tools/graphics/bench-font-masks.js';

test('decoded masks, font metrics and five text render paths match the original output', () => {
    const previous = { ...Pix2D };
    try {
        expect(fontOutputDigest(fontFixture().decode())).toBe('dc4c7caaa9c2c48c0883bf3e73ee1ac57a4144fe8ef2f8b1b62f41afd328e65d');
    } finally {
        Object.assign(Pix2D, previous);
    }
});

test('each decoded font owns one buffer with disjoint glyph views', () => {
    const { members, decode } = fontFixture();
    const source = members.get('p11_full.dat')!;
    const original = source.slice();
    const fonts = decode();
    const buffers = new Set<ArrayBufferLike>();
    for (const font of fonts) {
        const buffer = font.charMask[0].buffer;
        buffers.add(buffer);
        let end = 0;
        for (const [c, mask] of font.charMask.entries()) {
            expect(mask.buffer === buffer).toBe(true);
            expect(mask.byteOffset).toBe(end);
            expect(mask.length).toBe(font.charMaskWidth[c] * font.charMaskHeight[c]);
            end += mask.length;
        }
        expect(buffer.byteLength).toBe(end);
    }
    expect(buffers.size).toBe(4);
    const [first, neighbor] = fonts[0].charMask;
    const saved = neighbor.slice();
    first.fill(99);
    expect(neighbor).toEqual(saved);
    expect(source).toEqual(original);
});
