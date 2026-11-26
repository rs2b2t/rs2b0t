import { expect, type Mock, spyOn, test } from 'bun:test';

import * as bzip from '#/client/io/BZip2.js';
import JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';
import { Client } from '#/client/shell/Client.js';

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
    const data = bzip.bunzip2(Buffer.concat([Buffer.from('BZh1'), member]), true, true);
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

async function withParent(parent: PropertyDescriptor, run: (decode: Mock<typeof bzip.bunzip2>) => void | Promise<void>) {
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, ...parent });
    const decode = spyOn(bzip, 'bunzip2');
    try {
        await run(decode);
    } finally {
        decode.mockRestore();
        if (original) Object.defineProperty(window, 'parent', original);
        else Reflect.deleteProperty(window, 'parent');
    }
}

for (const layout of ['whole', 'member'] as const) {
    test(`frames decode a shared ${layout} once and own their returned bytes`, () => {
        return withParent({ value: { Map, Uint8Array } }, async decode => {
            const input = Buffer.from(fixtures[1][layout], 'hex');
            function load(search: string) {
                const client: Client = Object.assign(Object.create(Client.prototype), {
                    searchParams: new URLSearchParams(search),
                    jagChecksum: [Packet.getcrc(input, 0, input.length)],
                    db: { read: () => Uint8Array.from(input) },
                    drawProgress() {
                        throw new Error('expected a cached archive');
                    }
                });
                return client['getJagFile']('fixture', 0, 'fixture', 0);
            }
            const first = (await load('box=one')).read('A')!;
            first.fill(0);
            const second = await load('box=two');
            const bytes = second.read('A')!;
            expect(bytes.length).toBe(65536);
            expect(bytes.every(byte => byte === 65)).toBe(true);
            expect(bytes.buffer).not.toBe(first.buffer);
            expect(second.readIndex(0)).toBe(bytes);
            bytes[0] = 0;
            const third = (await load('box=three')).read('A')!;
            expect(third[0]).toBe(65);
            expect(third.buffer).not.toBe(bytes.buffer);
            expect(decode).toHaveBeenCalledTimes(1);
            expect((await load('')).read('A')).toEqual(third);
            expect(decode).toHaveBeenCalledTimes(2);
        });
    });
}

test('lazy reads verify the current packed member, including after a revision change', () => {
    return withParent({ value: { Map, Uint8Array } }, decode => {
        const input = Buffer.from(fixtures[0].member, 'hex');
        const original = new JagFile(input, 1);
        expect(decode).toHaveBeenCalledTimes(0);
        expect(original.read('A')!.every(byte => byte === 65)).toBe(true);

        const revised = new JagFile(Buffer.from(input), 2);
        expect(revised.read('A')).toEqual(original.read('A'));
        expect(decode).toHaveBeenCalledTimes(2);

        const modified = new JagFile(Buffer.from(input), 2);
        modified.data.set(Buffer.from('31415926535954f4043400000004041000040020002100828317724538509054f40434', 'hex'), modified.fileOffset[0]);
        expect(modified.readIndex(0)!.every(byte => byte === 66)).toBe(true);
        expect(new JagFile(input, 2).read('A')).toEqual(original.read('A'));
        expect(decode).toHaveBeenCalledTimes(4);
    });
});

test('standalone and unavailable parents decode locally', async () => {
    const input = Buffer.from(fixtures[0].whole, 'hex');
    for (const parent of [
        { value: window },
        { value: Object.freeze({ Map, Uint8Array }) },
        {
            get() {
                throw new DOMException();
            }
        }
    ]) {
        await withParent(parent, decode => {
            const first = new JagFile(input, 1).read('A');
            expect(new JagFile(input, 1).read('A')).toEqual(first);
            expect(decode).toHaveBeenCalledTimes(2);
        });
    }
});

test('both the byte budget and entry budget evict old revisions', async () => {
    for (const [fixture, revisions] of [
        [fixtures[0], 513],
        [fixtures[1], 128]
    ] as const) {
        await withParent({ value: { Map, Uint8Array } }, decode => {
            const input = Buffer.from(fixture.member, 'hex');
            for (let crc = 0; crc < revisions; crc++) new JagFile(input, crc).read('A');
            const latest = new JagFile(input, revisions - 1).read('A');
            expect(decode).toHaveBeenCalledTimes(revisions);
            expect(new JagFile(input, 0).read('A')).toEqual(latest);
            expect(decode).toHaveBeenCalledTimes(revisions + 1);
        });
    }
});
