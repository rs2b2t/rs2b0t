import { existsSync } from 'node:fs';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

import { readCollisionPack } from '../../tools/lib/readCollisionPack.js';

const packPath = 'out/collision.lcnav.gz';
export const hasCollisionPack = existsSync(packPath);

function finderFor(bytes: Uint8Array): PathFinder {
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

export function fullMapFinder(): PathFinder {
    return finderFor(readCollisionPack(packPath));
}

export function isolatedLandingFinder(tiles: NavPoint[]): PathFinder {
    const squares = new Set(tiles.map(t => ((t.x >> 6) << 8) | (t.z >> 6)));
    const levelBytes = 4096 + 512;
    const bytes = new Uint8Array(10 + squares.size * (3 + 4 * levelBytes));
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, squares.size, true);
    let pos = 10;
    for (const square of squares) {
        const mx = square >> 8;
        const mz = square & 255;
        bytes.set([mx, mz, 0b1111], pos);
        pos += 3;
        for (const tile of tiles) {
            if (tile.x >> 6 !== mx || tile.z >> 6 !== mz) continue;
            const index = (tile.x & 63) * 64 + (tile.z & 63);
            const walk = pos + tile.level * levelBytes + 4096;
            bytes[walk + (index >> 3)] |= 1 << (index & 7);
        }
        pos += 4 * levelBytes;
    }
    return finderFor(bytes);
}
