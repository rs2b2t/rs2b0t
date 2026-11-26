import type JagFile from '#/client/io/JagFile.js';
import Packet from '#/client/io/Packet.js';
import { TypedArray1d } from '#/client/util/Arrays.js';

interface DefinitionList<T> {
    new (id: number): T;
    list: T[];
    numDefinitions: number;
}

export function loadDefinitions<T extends { decode(dat: Packet): void }>(Type: DefinitionList<T>, config: JagFile, file: string): Packet {
    const dat = new Packet(config.read(file));
    Type.numDefinitions = dat.g2();
    Type.list = new Array(Type.numDefinitions);
    for (let id = 0; id < Type.numDefinitions; id++) {
        const type = new Type(id);
        Type.list[id] = type;
        type.decode(dat);
    }
    return dat;
}

interface IndexedDefinitions<T> {
    new (): T;
    dat: Packet | null;
    idx: Int32Array | null;
    numDefinitions: number;
    recent: (T | null)[] | null;
    recentPos: number;
}

export function loadDefinitionIndex<T>(Type: IndexedDefinitions<T>, config: JagFile, name: string, cacheSize: number): void {
    Type.dat = new Packet(config.read(name + '.dat'));
    const idx = new Packet(config.read(name + '.idx'));
    Type.numDefinitions = idx.g2();
    Type.idx = new Int32Array(Type.numDefinitions);
    let offset = 2;
    for (let id = 0; id < Type.numDefinitions; id++) {
        Type.idx[id] = offset;
        offset += idx.g2();
    }
    Type.recent = new TypedArray1d(cacheSize, null);
    for (let i = 0; i < cacheSize; i++) {
        Type.recent[i] = new Type();
    }
}

export function getIndexedDefinition<T extends { id: number }>(
    Type: IndexedDefinitions<T>,
    id: number,
    decode: (recent: (T | null)[], slot: number, dat: Packet) => T
): T {
    const { recent, dat, idx } = Type;
    if (!recent || !idx || !dat) {
        throw new Error();
    }
    for (let i = 0; i < recent.length; i++) {
        const type = recent[i];
        if (type && type.id === id) return type;
    }
    Type.recentPos = (Type.recentPos + 1) % recent.length;
    dat.pos = idx[id];
    return decode(recent, Type.recentPos, dat);
}
