import { createHash } from 'node:crypto';
import Pix2D from '#/client/graphics/Pix2D.js';
import PixFont from '#/client/graphics/PixFont.js';
import JagFile from '#/client/io/JagFile.js';

export function fontFixture() {
    const names = ['p11_full', 'p12_full', 'b12_full', 'q8_full'];
    const index = [0, 0, 0, 0];
    const members = new Map<string, Uint8Array>();
    for (const [f, name] of names.entries()) {
        const offset = index.length - 4;
        const data = [offset >> 8, offset & 255];
        index.push(2, 1, 2, 3);
        for (let c = 0; c < 256; c++) {
            const w = c === 32 ? 0 : 4 + (c + f) % 7;
            const h = c === 32 ? 0 : 6 + (c + 2 * f) % 6;
            const order = c % 2;
            index.push(c % 3, (c + f) % 4, 0, w, 0, h, order);
            for (let i = 0; i < w * h; i++) {
                const x = order ? Math.floor(i / h) : i % w;
                const y = order ? i % h : Math.floor(i / w);
                data.push([0, 1, 17, 255, 0][(x + 2 * y + c + f) % 5]);
            }
        }
        members.set(name + '.dat', Uint8Array.from(data));
    }
    members.set('index.dat', Uint8Array.from(index));
    const archive = new JagFile(new Uint8Array(8));
    archive.read = name => members.get(name) ?? null;
    return { members, decode: () => names.map(name => PixFont.depack(archive, name, name === 'q8_full')) };
}

export function fontOutputDigest(fonts: PixFont[]) {
    const hash = createHash('sha256');
    for (const font of fonts) {
        for (const mask of font.charMask) hash.update(mask);
        for (const metric of [font.charMaskWidth, font.charMaskHeight, font.charOffsetX, font.charOffsetY, font.charAdvance]) hash.update(metric);
        hash.update(String(font.height));
        const pixels = new Int32Array(96 * 24);
        const sample = 'Ii Abéÿ';
        Pix2D.setPixels(pixels, 96, 24);
        for (const draw of [
            () => font.drawString(sample, 2, 16, 0xffeecc),
            () => {
                Pix2D.setClipping(6, 4, 40, 14);
                font.drawString(sample, 2, 12, 0xffeecc);
            },
            () => font.centreStringWave(sample, 48, 14, 0xffeecc, 7),
            () => font.drawStringTag('@red@' + sample, 2, 16, 0xffeecc, true),
            () => font.drawStringAntiMacro(sample, 2, 16, 0xffeecc, true, 1234)
        ]) {
            Pix2D.resetClipping();
            pixels.fill(0x334455);
            draw();
            hash.update(pixels);
        }
    }
    return hash.digest('hex');
}

function retainedBytes() {
    globalThis.gc!();
    globalThis.gc!();
    const { heapUsed, arrayBuffers } = process.memoryUsage();
    return heapUsed + arrayBuffers;
}

if (import.meta.main) {
    const clients = Number(process.argv[2] ?? 61);
    const { members, decode } = fontFixture();
    const bytes = [...members.values()].reduce((sum, data) => sum + data.byteLength, 0);
    for (let i = 0; i < 10; i++) decode();
    const before = retainedBytes();
    const start = performance.now();
    const fonts = Array.from({ length: clients }, decode).flat();
    const ms = performance.now() - start;
    const mib = (retainedBytes() - before) / 2 ** 20;
    const buffers = new Set(fonts.flatMap(font => font.charMask.map(mask => mask.buffer))).size;
    console.log(JSON.stringify({ clients, bytes, mib, buffers, ms, sha256: fontOutputDigest(fonts.slice(0, 4)) }));
}
