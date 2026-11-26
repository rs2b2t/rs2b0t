import { expect, test } from 'bun:test';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import CollisionMap, { BuildArea } from '#/client/dash3d/CollisionMap.js';
import { registerSilentAudio } from './fixtures/silentAudio.js';

registerSilentAudio();
const { Client } = await import('#/client/shell/Client.js');

test('click routes ignore old distances across a gate closing and reopening', () => {
    const map = new CollisionMap();
    map.flags.fill(CollisionFlag.WR_GRND);
    for (let x = 40; x <= 45; x++) map.unblockGround(x, 40);
    const client = Object.assign(Object.create(Client.prototype), {
        collision: [map], minusedlevel: 0, dirMap: new Uint8Array(BuildArea.SIZE ** 2),
        distMap: new Uint16Array(BuildArea.SIZE ** 2), routeX: new Int32Array(4000), routeZ: new Int32Array(4000),
        out: { p1Enc() {}, p1() {}, p2() {} }, keyHeld: [], mapBuildBaseX: 0, mapBuildBaseZ: 0
    });
    const walk = (x: number) => client.tryMove(40, 40, x, 40, true, 0, 0, 0, 0, 0, 0);
    let writes = 0;
    client.distMap = new Proxy(client.distMap, {
        get(grid: Uint16Array, key: string) {
            if (client.dirMap[Number(key)] === 0) throw new Error('read distance of unvisited tile');
            return grid[Number(key)];
        },
        set(grid: Uint16Array, key: string, distance: number) {
            writes++;
            grid[Number(key)] = distance;
            return true;
        }
    });
    expect(walk(40)).toBe(true);
    expect(writes).toBe(1);
    expect(walk(45)).toBe(true);
    map.blockGround(42, 40);
    expect(walk(45)).toBe(false);
    expect(client.lastWalkPathLocal).toEqual([]);
    map.unblockGround(42, 40);
    expect(walk(45)).toBe(true);
    expect(client.lastWalkPathLocal).toHaveLength(6);
});
