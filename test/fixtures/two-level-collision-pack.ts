export function twoLevelCollisionPack(squares: ReadonlyArray<readonly [mx: number, mz: number]>, exitMask = 0xff): Buffer {
    const header = Buffer.alloc(10);
    header.write('LCNV');
    header[4] = 1;
    header.writeUInt16LE(squares.length, 8);
    const level = Buffer.alloc(4096 + 512, 0xff);
    level.fill(exitMask, 0, 4096);
    return Buffer.concat([header, ...squares.flatMap(([mx, mz]) => [Buffer.from([mx, mz, 3]), level, level])]);
}
