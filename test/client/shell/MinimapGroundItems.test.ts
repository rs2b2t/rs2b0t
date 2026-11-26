import { expect, test } from 'bun:test';
import { registerSilentAudio } from './fixtures/silentAudio.js';

registerSilentAudio();

const { Client } = await import('#/client/shell/Client.js');

test.each([[52, 52], [0, 0], [0, 103], [103, 0], [103, 103]])('ground-item scan at tile (%i, %i) preserves visible dots within the read budget', (tileX, tileZ) => {
    const offsets = [-21, -20, -16, -12, 0, 12, 16, 20, 21];
    const tiles: [number, number][] = [];
    const grid = Array.from({ length: 104 }, () => Array<boolean>(104).fill(false));
    for (const offsetX of offsets) {
        for (const offsetZ of offsets) {
            const x = tileX + offsetX;
            const z = tileZ + offsetZ;
            if (x >= 0 && x < 104 && z >= 0 && z < 104) {
                grid[x][z] = true;
                tiles.push([x, z]);
            }
        }
    }

    let reads = 0;
    const calls: number[][] = [];
    const client = Object.assign(Object.create(Client.prototype), {
        groundObj: [grid.map(row => new Proxy(row, {
            get(target, key) {
                if (!Reflect.has(target, key)) throw new RangeError(`ground-item row index ${String(key)}`);
                reads++;
                return Reflect.get(target, key);
            }
        }))],
        minusedlevel: 0,
        macroMinimapAngle: 0,
        minimapFlagX: 0,
        mapback: {},
        mapdots1: {
            owi: 1, ohi: 1,
            plotSprite: (x: number, y: number) => calls.push([x, y, 0]),
            scanlinePlotSprite: (_mask: unknown, x: number, y: number) => calls.push([x, y, 1])
        }
    });

    let maxReads = 0;
    for (const subX of [0, 32, 64, 127]) {
        for (const subZ of [0, 32, 64, 127]) {
            client.localPlayer = { x: tileX * 128 + subX, z: tileZ * 128 + subZ };
            for (const yaw of [0, 512]) {
                client.orbitCameraYaw = yaw;
                client.macroMinimapZoom = yaw === 0 ? 0 : 256;
                reads = 0;
                calls.length = 0;
                client.minimapDraw();
                maxReads = Math.max(maxReads, reads);

                const expected = [];
                for (const [x, z] of tiles) {
                    const dx = (x - tileX) * 4 + 2 - Math.floor(subX / 32);
                    const dz = (z - tileZ) * 4 + 2 - Math.floor(subZ / 32);
                    const distance = Math.hypot(dx, dz);
                    if (distance <= 80) {
                        const screenX = yaw === 0 ? dx : Math.floor(dz / 2);
                        const screenY = yaw === 0 ? dz : Math.floor(-dx / 2);
                        expected.push([98 + screenX, 79 - screenY, Number(distance > 50)]);
                    }
                }
                expect(calls).toEqual(expected);
            }
        }
    }
    expect(maxReads).toBeLessThanOrEqual(1681);
});
