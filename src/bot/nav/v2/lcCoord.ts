/**
 * LostCity / content-script coordinate helpers.
 *
 * Content uses `level_mx_mz_lx_lz` where map-square size is 64:
 *   worldX = mx * 64 + lx, worldZ = mz * 64 + lz
 */

import type { NavPoint } from './types.js';

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
