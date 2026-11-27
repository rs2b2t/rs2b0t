import assert from 'node:assert/strict';
import type { Client as GameClient } from '#/client/shell/Client.js';
import { mountCanvas } from './mountCanvas.js';

mountCanvas(canvas => {
    Object.assign(canvas, { getContext: () => ({ fillRect() {} }) });
});

const { Client } = await import('#/client/shell/Client.js');
const { default: Database } = await import('#/client/io/Database.js');
const { default: PixFont } = await import('#/client/graphics/PixFont.js');
const { default: Pix32 } = await import('#/client/graphics/Pix32.js');
const { default: PixMap } = await import('#/client/graphics/PixMap.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { default: ModelSource } = await import('#/client/dash3d/ModelSource.js');

Database.openDatabase = async () => { throw new Error('offline'); };
PixFont.depack = () => new PixFont();
const loc = new LocType();
loc.mapfunction = 22;
LocType.list = () => loc;
Math.random = () => 0.5;

const tiles = [[0, 24, 40, 0x123456], [0, 58, 18, 0xabcdef], [1, 73, 54, 0x654321]];
const model = new ModelSource();
const icon = new Pix32(1, 1);
function populate(client: GameClient) {
    const world = client['world']!;
    for (const [level, x, z, colour] of tiles) {
        world.setGround(level, x, z, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, colour, 0);
    }
    world.setWall(0, 24, 40, 0, 1, 0, model, null, 1, 0);
    world.setGroundDecor(model, 0, 58, 18, 0, 1, 0);
}

const expected = [new Int32Array(512 * 512), new Int32Array(512 * 512)];
for (const [level, x, z, colour] of tiles) {
    for (let row = 0; row < 4; row++) {
        const start = (48 + 4 * (103 - z) + row) * 512 + 48 + 4 * x;
        expected[level].fill(colour, start, start + 4);
        if (x === 24) expected[level][start] = 0xee0000;
    }
}

async function startup() {
    const client: GameClient = Reflect.construct(Client, []);
    const atUpdateList = Promise.withResolvers<void>();
    Object.assign(client, {
        getJagChecksums() {},
        loadTitleBackground() {},
        loadTitleImages() {},
        getJagFile(_name: string, _progress: number, archive: string) {
            if (archive === 'versionlist') {
                atUpdateList.resolve();
                return new Promise(() => {});
            }
            return {};
        }
    });
    await Promise.race([atUpdateList.promise, client.maininit().then(() => assert.fail('startup ended before scene initialization'))]);
    client['areaGame'] = new PixMap(1, 1);
    client['mapfunction'][22] = icon;
    populate(client);
    client['sceneState'] = 2;
    return client;
}

function build(client: GameClient, level: number) {
    client['minusedlevel'] = level;
    const start = performance.now();
    client['checkMinimap']();
    const ms = performance.now() - start;
    const map = client['minimap']!;
    assert.deepEqual([map.wi, map.hi], [512, 512]);
    assert.ok(Buffer.from(map.data.buffer).equals(Buffer.from(expected[level].buffer)), 'minimap raster');
    assert.equal(client['activeMapFunctionCount'], level === 0 ? 1 : 0);
    if (level === 0) {
        assert.equal(client['activeMapFunctions'][0], icon);
        assert.deepEqual([client['activeMapFunctionX'][0], client['activeMapFunctionZ'][0]], [58, 18]);
    }
    return ms;
}

const count = Number(process.argv[2] ?? 1);
const clients = await Promise.all(Array.from({ length: count }, startup));
const bytes = () => clients.reduce((total, client) => total + (client['minimap']?.data.buffer.byteLength ?? 0), 0);
const startupBytes = bytes();
const firstBuilds = clients.map(client => build(client, 0));
const activeBytes = bytes();
for (const client of clients) {
    const first = client['minimap']!.data.buffer;
    build(client, 1);
    assert.equal(client['minimap']!.data.buffer, first);
    await client['logout']();
}
const logoutBytes = bytes();
for (const client of clients) {
    populate(client);
    build(client, 0);
}
firstBuilds.sort((a, b) => a - b);
console.log(JSON.stringify({ count, startupBytes, activeBytes, logoutBytes, firstBuildMs: (firstBuilds[(count - 1) >> 1] + firstBuilds[count >> 1]) / 2 }));
