// Why: content uses `level_mx_mz_lx_lz` with a map-square size of 64, so worldX = mx * 64 + lx and worldZ = mz * 64 + lz.

import type { NavPoint } from '../types.js';

/** Parse `0_38_53_29_52` or `3_38_54_33_45` into a world tile. */
export function parseLcCoord(raw: string): NavPoint {
    const parts = raw.trim().split('_').map(Number);
    if (parts.length !== 5 || parts.some(n => !Number.isFinite(n))) {
        throw new Error(`invalid LostCity coord: ${raw}`);
    }
    const [level, mx, mz, lx, lz] = parts as [number, number, number, number, number];
    return {
        level,
        x: mx * 64 + lx,
        z: mz * 64 + lz
    };
}

/** Build a world tile from map-square + local offsets (same fields as content). */
export function lcCoord(level: number, mx: number, mz: number, lx: number, lz: number): NavPoint {
    return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}

/**
 * Pack/unpack engine coord integers (LostCity CoordGrid).
 * layout: level << 28 | x << 14 | z  (14-bit x/z, 2-bit level)
 */
export function packCoord(level: number, x: number, z: number): number {
    return (z & 0x3fff) | ((x & 0x3fff) << 14) | ((level & 0x3) << 28);
}

export function unpackCoord(coord: number): NavPoint {
    return {
        level: (coord >> 28) & 0x3,
        x: (coord >> 14) & 0x3fff,
        z: coord & 0x3fff
    };
}

export function packNavPoint(p: NavPoint): number {
    return packCoord(p.level, p.x, p.z);
}
