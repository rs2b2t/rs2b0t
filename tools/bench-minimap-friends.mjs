import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

const load = createJiti(import.meta.url, { fsCache: false, interopDefault: false, alias: { '#': resolve('src') } });
const JString = load('#/client/datastruct/JString.js').default;
const Pix32 = load('#/client/graphics/Pix32.js').default;
const { ServerProt } = load('#/client/io/ServerProt.js');
const file = 'src/client/shell/Client.ts';
const baseline = execFileSync('git', ['show', 'c31473da:' + file], { encoding: 'utf8' });
globalThis.BroadcastChannel = undefined;
globalThis.document = { getElementById: () => ({ getContext: () => ({ fillRect() {} }) }) };
globalThis.window = { location: { search: '' } };
const versions = [baseline, readFileSync(file, 'utf8')].map(source => {
    const headless = source.replace(/^import .*from '#\/client\/(?:3rdparty\/.*|shell\/MobileKeyboard)\.js';$/gm, '');
    return load.evalModule(headless, { filename: resolve(file) }).Client;
});

const terrain = new Pix32(512, 512);
for (let i = 0; i < terrain.data.length; i++) terrain.data[i] = 1 + i;
const offsets = new Int32Array(151);
const lengths = new Int32Array(151).fill(146);
const mask = { data: new Uint8Array(172 * 156) };
const ordinary = 0xffff00;
const friend = 0x00ff00;
function dot(colour) {
    const sprite = new Pix32(3, 3);
    sprite.data.fill(colour);
    return sprite;
}
const name = i => 'Player' + i;
const hash = i => JString.toUserhash(name(i));

function fixture(client, count) {
    const players = Array.from({ length: 64 }, (_, i) => ({
        name: name(i), isReady: () => true,
        x: (208 + (i % 8) * 18 - 63) * 32, z: (208 + (i >> 3) * 18 - 63) * 32
    }));
    return Object.assign(client, {
        localPlayer: { name: 'Local', x: 208 * 32, z: 208 * 32 },
        playerCount: 64, playerIds: Int32Array.from(players, (_, i) => i), players,
        friendCount: count, friendUsername: Array.from({ length: 200 }, (_, i) => name(i < 16 ? i : 64 + i)),
        friendUserhash: BigInt64Array.from({ length: 200 }, (_, i) => hash(i < 16 ? i : 64 + i)),
        friendNodeId: Int32Array.from({ length: 200 }, (_, i) => i % 2 ? 10 : 0),
        areaMap: new Pix32(172, 156), minimap: terrain, mapback: mask, mapdots3: dot(ordinary), mapdots4: dot(friend),
        minimapMaskLineOffsets: offsets, minimapMaskLineLengths: lengths,
        macroMinimapAngle: 0, macroMinimapZoom: 0, minimapFlagX: 0, hintType: 0, minusedlevel: 0,
        minimapState: 0, npcCount: 0, activeMapFunctionCount: 0,
        groundObj: client.groundObj ?? [Array.from({ length: 104 }, () => Array(104).fill(null))]
    });
}

function draw(client, angle) {
    client.orbitCameraYaw = angle;
    client.minimapDraw();
}

function sweep(clients, frames) {
    const start = performance.now();
    for (let f = 0; f < frames; f++) {
        for (const client of clients) draw(client, (f * 37) & 2047);
    }
    return (performance.now() - start) / frames;
}

for (const [count, profiles] of [[100, 30], [100, 61], [0, 61]]) {
    const batches = versions.map(Client => Array.from({ length: profiles }, () => fixture(Object.create(Client.prototype), count)));
    const samples = [[], []];
    for (const batch of batches) sweep(batch, 32);
    for (let i = 0; i < 11; i++) {
        for (const v of i % 2 ? [1, 0] : [0, 1]) samples[v].push(sweep(batches[v], 16));
    }
    for (let f = 0; f < 16; f++) {
        for (let p = 0; p < profiles; p++) {
            for (const batch of batches) draw(batch[p], f * 37);
            assert.deepEqual(batches[0][p].areaMap.data, batches[1][p].areaMap.data);
        }
    }
    const medians = samples.map(times => times.sort((a, b) => a - b)[5].toFixed(2));
    console.log(`${profiles} profiles, ${count} friends: ${medians.join(' -> ')} ms/frame`);
}

const clients = versions.map(Client => fixture(new Client(), 100));
let pairs = 0;
function check(label, colour) {
    for (const [angle, x, y] of [[0, 89, 124], [512, 53, 70]]) {
        for (const client of clients) draw(client, angle);
        assert.deepEqual(clients[1].areaMap.data, clients[0].areaMap.data, label);
        assert.equal(clients[1].areaMap.data[y * 172 + x], colour, label);
        pairs++;
    }
}

async function update(client, userhash, world) {
    const bytes = new Uint8Array(9);
    new DataView(bytes.buffer).setBigUint64(0, userhash);
    bytes[8] = world;
    client.ptype = ServerProt.UPDATE_FRIENDLIST;
    client.psize = bytes.length;
    client.stream = { available: bytes.length, readBytes: dst => dst.set(bytes) };
    assert(await client.tcpIn());
}

check('initial', friend);
check('unchanged', friend);
for (const client of clients) await update(client, hash(11), 0);
check('offline', ordinary);
for (const client of clients) await update(client, hash(11), 12);
check('online', friend);
for (const client of clients) client.players[11].name = name(199);
check('rename', ordinary);
for (const client of clients) client.players[11].name = 'pLaYeR11';
check('normalized name', friend);
for (const client of clients) client.players[11] = { ...client.players[11], name: 'Newplayer' };
check('replacement', ordinary);
const added = JString.toUserhash('Newplayer');
for (const client of clients) client.addFriend(added);
check('local add', ordinary);
for (const client of clients) await update(client, added, 15);
check('online after add', friend);
for (const client of clients) client.delFriend(added);
check('remove', ordinary);
for (const client of clients) await update(client, added, 12);
check('server add', friend);
for (const client of clients) {
    const players = client.players.slice();
    const reads = [...Array(8).fill(0), 2, 0, 0];
    client.openLoginStream = () => ({ read: () => reads.shift(), write() {} });
    client.validateIdkDesign = client.prepareGame = () => {};
    await client.login('Local', '', true);
    assert.equal(client.friendCount, 0);
    Object.assign(client, { players, playerCount: 64, localPlayer: { x: 208 * 32, z: 208 * 32 }, macroMinimapAngle: 0, macroMinimapZoom: 0 });
}
check('session reset', ordinary);
console.log(`${pairs} paired transition frames matched`);

function counts(Client) {
    const client = fixture(new Client(), 100);
    draw(client, 0);
    const toUserhash = JString.toUserhash;
    let hashes = 0;
    let comparisons = 0;
    client.friendUserhash = new Proxy(client.friendUserhash, {
        get(array, key) { comparisons++; return array[key]; }
    });
    try {
        JString.toUserhash = value => { hashes++; return toUserhash(value); };
        draw(client, 0);
    } finally {
        JString.toUserhash = toUserhash;
    }
    return [hashes, comparisons];
}
const work = versions.map(counts);
console.log('warm hashes and comparisons:', work);
assert.deepEqual(work, [[64, 5672], [0, 0]]);
