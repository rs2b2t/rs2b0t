import { expect, test } from 'bun:test';

import { bunzip2 } from '#/client/io/BZip2.js';
import JagFile from '#/client/io/JagFile.js';

const fixtures = [
    {
        size: 200,
        member: '00002f00002f0001000000210000c8000023314159265359d7a1a98b000000040420000400200021008283177245385090d7a1a98b',
        whole: '0000d400002e3141592653598f9a6b15000002540460002000200004402000212991ea0c024abb85429e2ee48a70a1211f34d62a'
    },
    {
        size: 65536,
        member: '000033000033000100000021010000000027314159265359bc79719c0000808400a000000820003080291a01a4038bb9229c28485e3cb8ce00',
        whole: '01000c00003131415926535909a251420000025400e000200020000008200030cd005534d1125d2c760094c01e2ee48a70a1201344a284'
    }
];

for (const fixture of fixtures) {
    for (const layout of ['member', 'whole'] as const) {
        test(`${layout} compression preserves and caches ${fixture.size} repeated bytes`, () => {
            const archive = new JagFile(Buffer.from(fixture[layout], 'hex'));
            const data = archive.read('A')!;
            expect(data.length).toBe(fixture.size);
            expect(data.every(byte => byte === 0x41)).toBe(true);
            expect(archive.read('A')).toBe(data);
            expect(data.buffer.byteLength).toBe(layout === 'whole' ? fixture.size + 12 : fixture.size);
        });
    }
}

test('bunzip2 preserves a long run without a declared size', () => {
    const member = Buffer.from(fixtures[0].member, 'hex').subarray(18);
    const data = bunzip2(Buffer.concat([Buffer.from('BZh1'), member]), true, true);
    expect(data.length).toBe(200);
    expect(data.every(byte => byte === 0x41)).toBe(true);
});

test('bunzip2 preserves a single 0xff byte in headerless and CRC-checked streams', () => {
    const stream = Buffer.from('425a6831314159265359000000ff00000000008000a00021184682ee48a70a120000001fe0', 'hex');
    const expected = Uint8Array.of(0xff);
    expect(bunzip2(stream.subarray(4), false, false, 1)).toEqual(expected);
    expect(bunzip2(stream, true, true, 1)).toEqual(expected);
});

test('61 independent member reads each allocate one 64 KiB output', () => {
    const fixture = fixtures[1];
    const input = Buffer.from(fixture.member, 'hex');
    const archives = Array.from({ length: 61 }, () => new JagFile(input));
    const allocations: number[] = [];
    const original = Uint8Array;
    globalThis.Uint8Array = new Proxy(original, {
        construct(target, args) {
            const result = Reflect.construct(target, args);
            allocations.push(result.byteLength);
            return result;
        }
    });
    try {
        for (const archive of archives) {
            const data = archive.read('A')!;
            expect(archive.read('A')).toBe(data);
        }
    } finally {
        globalThis.Uint8Array = original;
    }
    expect(allocations.length).toBe(61);
    expect(allocations.every(size => size === fixture.size)).toBe(true);
});
