type Point = { x: number; z: number };
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const squareSize = 3 + 4096 + 512;

export function collisionPack(...islands: (readonly Point[])[]): Uint8Array {
    const squares = new Map<string, Uint8Array>();
    for (const island of islands) {
        const tiles = new Set(island.map(({ x, z }) => `${x}|${z}`));
        for (const { x, z } of island) {
            const mx = x >> 6;
            const mz = z >> 6;
            const key = `${mx}|${mz}`;
            let square = squares.get(key);
            if (!square) {
                square = new Uint8Array(squareSize);
                square.set([mx, mz, 1]);
                squares.set(key, square);
            }
            const index = (x & 63) * 64 + (z & 63);
            square[3 + 4096 + (index >> 3)] |= 1 << (index & 7);
            for (let dir = 0; dir < DX.length; dir++) {
                if (tiles.has(`${x + DX[dir]}|${z + DZ[dir]}`)) square[3 + index] |= 1 << dir;
            }
        }
    }
    const bytes = new Uint8Array(10 + squares.size * squareSize);
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, squares.size, true);
    let offset = 10;
    for (const square of squares.values()) {
        bytes.set(square, offset);
        offset += squareSize;
    }
    return bytes;
}

export function segmentPack(segments: readonly (readonly [Point, Point?])[]): Uint8Array {
    const tiles: Point[] = [];
    for (const [from, to = from] of segments) {
        let { x, z } = from;
        tiles.push({ x, z });
        while (x !== to.x || z !== to.z) {
            x += Math.sign(to.x - x);
            z += Math.sign(to.z - z);
            tiles.push({ x, z });
        }
    }
    return collisionPack(tiles);
}
