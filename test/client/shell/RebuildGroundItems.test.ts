import { expect, test } from 'bun:test';
import Packet from '#/client/io/Packet.js';
import { ServerProt } from '#/client/io/ServerProt.js';
import { TypedArray3d } from '#/client/util/Arrays.js';
import { registerSilentAudio } from './fixtures/silentAudio.js';

registerSilentAudio();
const { Client } = await import('#/client/shell/Client.js');

test('eastward rebuild moves ground-item rows intact and recycles the vacated rows', async () => {
    const groundObj = new TypedArray3d<object | null>(4, 104, 104, null);
    const oldRows = groundObj[0].slice();
    const pile = {};
    groundObj[0][0][8] = {};
    groundObj[0][32][8] = pile;

    const client = Object.assign(Object.create(Client.prototype), {
        ptype: ServerProt.REBUILD_NORMAL,
        psize: 4,
        in: new Packet(Uint8Array.of(0, 10, 0, 6)),
        stream: { available: 4, readBytes() {} },
        mapBuildPrevBaseX: 0,
        mapBuildPrevBaseZ: 0,
        groundObj,
        npc: [],
        players: [],
        locChanges: { head: () => null },
        minimapFlagX: 0
    });

    expect(await client.tcpInDispatch()).toBe(true);
    expect(groundObj[0][0][8]).toBe(pile);
    expect(groundObj[0].slice(72).every(row => row.every(cell => cell === null))).toBe(true);
    expect(new Set(groundObj[0]).size).toBe(104);
    expect(groundObj[0].every(row => oldRows.includes(row))).toBe(true);
    expect(groundObj[0].slice(0, 72).every((row, x) => row === oldRows[x + 32])).toBe(true);
});
