export function rebaseGroundItems<T>(groundObj: (T | null)[][][], dx: number, dz: number): void {
    if (dx === 0 && dz === 0) {
        return;
    }

    for (const level of groundObj) {
        const size = level.length;
        const step = dx < 0 ? -1 : 1;
        for (let x = dx < 0 ? size - 1 : 0; x >= 0 && x < size; x += step) {
            const sourceX = x + dx;
            if (sourceX < 0 || sourceX >= size || Math.abs(dz) >= size) {
                level[x].fill(null);
                continue;
            }

            const row = level[sourceX];
            if (dx !== 0) {
                level[sourceX] = level[x];
                level[x] = row;
            }
            if (dz > 0) {
                for (let z = 0; z < size - dz; z++) {
                    row[z] = row[z + dz];
                }
                row.fill(null, size - dz);
            } else if (dz < 0) {
                for (let z = size - 1; z >= -dz; z--) {
                    row[z] = row[z + dz];
                }
                row.fill(null, 0, -dz);
            }
        }
    }
}
