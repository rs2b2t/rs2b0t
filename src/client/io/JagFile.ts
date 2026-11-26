import { bunzip2 } from '#/client/io/BZip2.js';
import JagCache from '#/client/io/JagCache.js';
import Packet from '#/client/io/Packet.js';

export default class JagFile {
    static genHash(name: string): number {
        let hash: number = 0;
        name = name.toUpperCase();
        for (let i: number = 0; i < name.length; i++) {
            hash = (hash * 61 + name.charCodeAt(i) - 32) | 0;
        }
        return hash;
    }

    data: Uint8Array;
    unpacked: boolean;
    fileCount: number;
    fileHash: number[];
    fileUnpackedSize: number[];
    filePackedSize: number[];
    fileOffset: number[];
    fileUnpacked: Uint8Array[] = [];

    private readonly cache?: JagCache;

    constructor(src: Uint8Array, crc?: number) {
        if (crc !== undefined) this.cache = JagCache.open(crc);
        let data: Packet = new Packet(src);
        const unpackedSize: number = data.g3();
        const packedSize: number = data.g3();

        if (unpackedSize === packedSize) {
            this.data = src;
            this.unpacked = false;
        } else {
            this.data = this.decode(src.subarray(6), unpackedSize, -1);
            data = new Packet(this.data);
            this.unpacked = true;
        }

        this.fileCount = data.g2();
        this.fileHash = [];
        this.fileUnpackedSize = [];
        this.filePackedSize = [];
        this.fileOffset = [];

        let offset: number = data.pos + this.fileCount * 10;
        for (let i: number = 0; i < this.fileCount; i++) {
            this.fileHash.push(data.g4());
            this.fileUnpackedSize.push(data.g3());
            this.filePackedSize.push(data.g3());
            this.fileOffset.push(offset);
            offset += this.filePackedSize[i];
        }
    }

    private decode(src: Uint8Array, size: number, index: number): Uint8Array {
        return this.cache ? this.cache.decode(src, size, index) : bunzip2(src, false, false, size);
    }

    read(name: string): Uint8Array | null {
        const hash: number = JagFile.genHash(name);
        const index: number = this.fileHash.indexOf(hash);
        if (index === -1) {
            return null;
        }
        return this.readIndex(index);
    }

    readIndex(index: number): Uint8Array | null {
        if (index < 0 || index >= this.fileCount) {
            return null;
        }

        if (this.fileUnpacked[index]) {
            return this.fileUnpacked[index];
        }

        const offset: number = this.fileOffset[index];
        const length: number = this.filePackedSize[index];
        const src: Uint8Array = this.data.subarray(offset, offset + length);
        if (this.unpacked) {
            this.fileUnpacked[index] = src;
            return src;
        } else {
            const data: Uint8Array = this.decode(src, this.fileUnpackedSize[index], index);
            this.fileUnpacked[index] = data;
            return data;
        }
    }
}
