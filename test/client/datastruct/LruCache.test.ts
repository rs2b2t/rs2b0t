import { expect, test } from 'bun:test';
import Linkable2 from '#/client/datastruct/Linkable2.js';
import LruCache from '#/client/datastruct/LruCache.js';

test.each([30, 61])('%i synthetic profiles allocate no bucket heads on construction or lookup misses', profiles => {
    const sizes = [30, 500, 30, 30, 50, 200, 30, 200];
    const caches = Array.from({ length: profiles }, () => sizes.map(size => new LruCache(size))).flat();
    const heads = () => caches.reduce((count, cache) => count + cache.table.buckets.filter(Boolean).length, 0);

    expect(heads()).toBe(0);
    for (const cache of caches) {
        expect(cache.find(1n)).toBeNull();
    }
    expect(heads()).toBe(0);
});

test('colliding keys share a bucket through eviction and refill', () => {
    const cache = new LruCache<Linkable2>(2);
    const first = new Linkable2();
    const second = new Linkable2();
    const third = new Linkable2();
    cache.put(first, 1n);
    cache.put(second, 1025n);
    expect(cache.table.buckets.filter(Boolean)).toHaveLength(1);
    expect(cache.find(1025n)).toBe(second);
    expect(cache.find(1n)).toBe(first);

    cache.put(third, 2n);
    expect(cache.find(1025n)).toBeNull();
    expect(cache.find(1n)).toBe(first);
    expect(cache.find(2n)).toBe(third);

    cache.clear();
    expect(cache.find(1n)).toBeNull();
    expect(cache.find(2n)).toBeNull();
    expect(cache.available).toBe(2);
    cache.put(first, 1n);
    cache.put(second, 1025n);
    expect(cache.find(1n)).toBe(first);
    expect(cache.find(1025n)).toBe(second);
});
