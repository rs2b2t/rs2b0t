import Linkable from '#/client/datastruct/Linkable.js';

export default class HashTable<T extends Linkable> {
    readonly bucketCount: number;
    readonly buckets: (Linkable | undefined)[];

    constructor(size: number) {
        this.buckets = new Array(size);
        this.bucketCount = size;
    }

    find(key: bigint): T | null {
        const start = this.buckets[Number(key & BigInt(this.bucketCount - 1))];
        if (!start) {
            return null;
        }

        for (let node = start.next; node !== start; node = node?.next ?? null) {
            if (node && node.key === key) {
                return node as T;
            }
        }

        return null;
    }

    put(node: T, key: bigint): void {
        if (node.prev) {
            node.unlink();
        }

        const index = Number(key & BigInt(this.bucketCount - 1));
        let sentinel = this.buckets[index];
        if (!sentinel) {
            sentinel = new Linkable();
            sentinel.next = sentinel;
            sentinel.prev = sentinel;
            this.buckets[index] = sentinel;
        }

        node.prev = sentinel.prev;
        node.next = sentinel;
        if (node.prev) {
            node.prev.next = node;
        }
        node.next.prev = node;
        node.key = key;
    }
}
