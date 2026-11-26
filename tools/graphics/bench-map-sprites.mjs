import assert from 'node:assert/strict';
import Pix8 from '../../src/client/graphics/Pix8.ts';
import Pix32 from '../../src/client/graphics/Pix32.ts';
import Packet from '../../src/client/io/Packet.ts';
import { mapSpriteArchive } from '../../test/client/graphics/mapSprites.fixture.ts';

const Before8 = (await import(new URL('./Pix8.mjs', import.meta.url))).default;
const Before32 = (await import(new URL('./Pix32.mjs', import.meta.url))).default;

function before(jag, scenes, functions) {
    for (let i = 0; i < scenes.length; i++) scenes[i] = Before8.depack(jag, 'mapscene', i);
    for (let i = 0; i < functions.length; i++) functions[i] = Before32.depack(jag, 'mapfunction', i);
}

function after(jag, scenes, functions) {
    Pix8.depackSheet(jag, 'mapscene', scenes);
    Pix32.depackSheet(jag, 'mapfunction', functions);
}

const archive = mapSpriteArchive();
assert.equal(archive.fileUnpacked.reduce((sum, bytes) => sum + bytes.length, 0), 18566);

function check(decode, expectedReads, expectedColours) {
    const scenes = new Array(50);
    const functions = new Array(50);
    const read = archive.read;
    const g3 = Packet.prototype.g3;
    let reads = 0;
    let colours = 0;
    archive.read = function (name) {
        reads++;
        return read.call(this, name);
    };
    Packet.prototype.g3 = function () {
        colours++;
        return g3.call(this);
    };
    try {
        decode(archive, scenes, functions);
    } finally {
        delete archive.read;
        Packet.prototype.g3 = g3;
    }
    assert.equal(reads, expectedReads);
    assert.equal(colours, expectedColours);
    return scenes.concat(functions);
}

const expected = check(before, 200, 6300);
const actual = check(after, 4, 126);
for (let i = 0; i < expected.length; i++) {
    const a = expected[i];
    const b = actual[i];
    assert.deepEqual({ ...a }, { ...b });
    a.rgbAdjust(5, -8, 13);
    b.rgbAdjust(5, -8, 13);
    assert.deepEqual({ ...a }, { ...b });
}
console.log('100 sprites matched before and after rgbAdjust; member reads 200 -> 4; palette reads 6300 -> 126');

for (const [member, name, Base, Patch] of [[0, 'mapscene', Before8, Pix8], [1, 'mapfunction', Before32, Pix32]]) {
    const short = mapSpriteArchive();
    short.fileUnpacked[member] = short.fileUnpacked[member].subarray(0, -1);
    const prefix = new Array(50).fill(null);
    assert.throws(() => {
        for (let i = 0; i < prefix.length; i++) prefix[i] = Base.depack(short, name, i);
    });
    const frames = new Array(50).fill(null);
    assert.throws(() => Patch.depackSheet(short, name, frames));
    assert.equal(prefix.filter(Boolean).length, 49);
    assert.equal(frames[49], null);
    for (let i = 0; i < 49; i++) assert.deepEqual({ ...frames[i] }, { ...prefix[i] });
}
console.log('49-frame prefixes matched on both truncated sheets');

function time(decode, count) {
    const clients = Array.from({ length: count }, () => [new Array(50), new Array(50)]);
    const start = performance.now();
    for (const [scenes, functions] of clients) decode(archive, scenes, functions);
    return performance.now() - start;
}

for (const count of [30, 61]) {
    const samples = [[], []];
    for (let i = 0; i < 25; i++) {
        for (const version of i % 2 ? [1, 0] : [0, 1]) {
            const ms = time(version ? after : before, count);
            if (i >= 4) samples[version].push(ms);
        }
    }
    const [base, patch] = samples.map(times => times.sort((a, b) => a - b)[10]);
    console.log(`${count} clients: ${base.toFixed(2)} -> ${patch.toFixed(2)} ms median`);
}
