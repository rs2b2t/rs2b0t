import type { WorldTile } from '../../adapter/ClientAdapter.js';

/** Rune essence mine, the instanced region Aubury and the Varrock portal teleport into. */
export function inEssMine(x: number, z: number): boolean {
    return (x >> 6) === 45 && (z >> 6) === 75;
}

export function inWestArdougne({ x, z, level }: WorldTile): boolean {
    return level === 0 && x >= 2433 && x <= 2556 && z >= 3266 && z <= 3334;
}
