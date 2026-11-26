import { bunzip2 } from '#/client/io/BZip2.js';

const byteLimit = 8 * 1024 * 1024;
const entryLimit = 512;

type Entries = Map<string, Uint8Array> & { bytes: number };
type Host = Window & typeof globalThis & { __rs2b0tJagCacheV1?: Entries };

function matches(src: Uint8Array, cached: Uint8Array): boolean {
    for (let i = 0; i < src.length; i++) {
        if (src[i] !== cached[i]) return false;
    }
    return true;
}

export default class JagCache {
    static open(crc: number): JagCache | undefined {
        try {
            const host = window.parent as Host;
            if (host === window || !host.Uint8Array) return;

            let entries = host.__rs2b0tJagCacheV1;
            if (!entries) {
                entries = Object.assign(new host.Map<string, Uint8Array>(), { bytes: 0 });
                host.__rs2b0tJagCacheV1 = entries;
            }
            return new JagCache(crc, entries, host.Uint8Array);
        } catch {
            return;
        }
    }

    private constructor(
        private readonly crc: number,
        private readonly entries: Entries,
        private readonly hostBytes: Uint8ArrayConstructor
    ) {}

    decode(src: Uint8Array, size: number, index: number): Uint8Array {
        const length = src.length + size;
        if (length > byteLimit) return bunzip2(src, false, false, size);

        const key = `${this.crc}:${index}:${src.length}:${size}`;
        const cached = this.entries.get(key);
        if (cached && matches(src, cached)) {
            return new Uint8Array(cached.subarray(src.length));
        }

        const data = bunzip2(src, false, false, size);
        if (data.length !== size) return data;

        if (cached) {
            this.entries.delete(key);
            this.entries.bytes -= cached.byteLength;
        }
        while (this.entries.size >= entryLimit || this.entries.bytes + length > byteLimit) {
            const oldest = this.entries.keys().next().value!;
            this.entries.bytes -= this.entries.get(oldest)!.byteLength;
            this.entries.delete(oldest);
        }
        const copy = new this.hostBytes(length);
        copy.set(src);
        copy.set(data, src.length);
        this.entries.set(key, copy);
        this.entries.bytes += length;
        return data;
    }
}
