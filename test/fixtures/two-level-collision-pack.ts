export function twoLevelCollisionPack(squares: ReadonlyArray<readonly [mx: number, mz: number]>): Buffer {
    const header = Buffer.alloc(10);
    header.write('LCNV');
    header[4] = 1;
    header.writeUInt16LE(squares.length, 8);
    const levels = Buffer.alloc(2 * (4096 + 512), 0xff);
    return Buffer.concat([header, ...squares.flatMap(([mx, mz]) => [Buffer.from([mx, mz, 3]), levels])]);
}
