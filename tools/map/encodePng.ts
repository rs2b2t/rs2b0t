/**
 * Minimal PNG encoder (RGBA8, filter none) using Node zlib.
 * Avoids canvas deps for headless basemap bake.
 */
import { deflateSync } from 'node:zlib';

function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        }
    }
    return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, data.length);
    const crcIn = new Uint8Array(typeBytes.length + data.length);
    crcIn.set(typeBytes, 0);
    crcIn.set(data, typeBytes.length);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32(crcIn));
    const out = new Uint8Array(4 + typeBytes.length + data.length + 4);
    out.set(len, 0);
    out.set(typeBytes, 4);
    out.set(data, 4 + typeBytes.length);
    out.set(crc, 4 + typeBytes.length + data.length);
    return out;
}

/** Encode packed RGBA (row-major) to PNG bytes. */
export function encodePngRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
    if (rgba.length !== width * height * 4) {
        throw new Error(`rgba length ${rgba.length} != ${width}*${height}*4`);
    }
    const stride = width * 4 + 1;
    const raw = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const row = y * stride;
        raw[row] = 0; // filter none
        raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1);
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
    let total = 0;
    for (const p of parts) {
        total += p.length;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

/** Convert MapView/Pix2D 0x00RRGGBB pixels to RGBA. */
export function pix2dToRgba(pixels: Int32Array): Uint8Array {
    const rgba = new Uint8Array(pixels.length * 4);
    for (let i = 0; i < pixels.length; i++) {
        const p = pixels[i] >>> 0;
        const o = i * 4;
        rgba[o] = (p >> 16) & 0xff;
        rgba[o + 1] = (p >> 8) & 0xff;
        rgba[o + 2] = p & 0xff;
        rgba[o + 3] = 0xff;
    }
    return rgba;
}
