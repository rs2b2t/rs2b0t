import { expect, spyOn, test } from 'bun:test';
import { gzipSync } from 'fflate';
import { installNavWorkerPool, type NavPoolHost, type PathResult } from '#/bot/event/webwalk/NavWorkerClient.js';
import { setNavPackHost } from '#/bot/event/webwalk/navPack.js';
import type { NavRequest, NavResponse } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

test('61 profiles share four route planners owned by their wall across tile reloads', () => {
    const wall: NavPoolHost = {};
    installNavWorkerPool(wall);
    const profiles = Array.from({ length: 61 }, () => wall.__rs2b0tAcquireNavigator!());
    expect(new Set(profiles).size).toBe(4);
    installNavWorkerPool(wall);
    expect(wall.__rs2b0tAcquireNavigator!()).toBe(profiles[1]);
    const secondWall: NavPoolHost = {};
    installNavWorkerPool(secondWall);
    expect(profiles).not.toContain(secondWall.__rs2b0tAcquireNavigator!());
});

function replaceGlobal(key: string, value: unknown): () => void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return () => {
        if (previous) Object.defineProperty(globalThis, key, previous);
        else Reflect.deleteProperty(globalThis, key);
    };
}

function mockWorkers(readyOnInit = false) {
    const workers: WorkerFixture[] = [];
    const paths: Extract<NavRequest, { type: 'path' }>[] = [];
    class WorkerFixture {
        onmessage!: (event: { data: NavResponse }) => void;
        terminated = false;
        constructor() {
            workers.push(this);
        }
        terminate() {
            this.terminated = true;
        }
        ready() {
            this.onmessage({ data: { type: 'ready', mapsquares: 0, doorEdges: 0, transportEdges: 0 } });
        }
        postMessage(message: NavRequest) {
            if (message.type === 'init' && readyOnInit) this.ready();
            if (message.type !== 'path') return;
            paths.push(message);
            this.onmessage({ data: { type: 'path', id: message.id, ok: true, expanded: 0, elapsedMs: 0, cost: 0, hops: [], waypoints: [] } });
        }
    }
    return { workers, paths, restore: replaceGlobal('Worker', WorkerFixture) };
}

test('worker startup consumes the path timeout and only live requests dispatch on ready', async () => {
    const wall: NavPoolHost & { __rs2b0tNavPack: Promise<SharedArrayBuffer> } = { __rs2b0tNavPack: Promise.resolve(new SharedArrayBuffer(1)) };
    installNavWorkerPool(wall);
    const { workers, paths, restore } = mockWorkers();
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    try {
        const point = { x: 1, z: 1, level: 0 };
        const profiles = Array.from({ length: 61 }, () => wall.__rs2b0tAcquireNavigator!());
        const state = emptyWorldStateData();
        const results: PathResult[] = [];
        for (const client of profiles) {
            void client.findPath(point, point, { timeoutMs: 10, state }).then(result => results.push(result));
        }
        clock.mockReturnValue(1010);
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(results).toHaveLength(61);
        for (const result of results) expect(result).toEqual({ ok: false, reason: 'path request timed out after 10ms', expanded: 0 });
        for (const client of new Set(profiles)) expect([...client['readyWaiters']]).toHaveLength(0);

        const expired = profiles[0].findPath(point, point, { timeoutMs: 5, state });
        const live = profiles[0].findPath(point, point, { timeoutMs: 50, state });
        clock.mockReturnValue(1015);
        for (const worker of workers) worker.ready();
        expect(await expired).toEqual({ ok: false, reason: 'path request timed out after 5ms', expanded: 0 });
        expect((await live).ok).toBe(true);
        expect(paths.map(path => path.expiresAt)).toEqual([1060]);
    } finally {
        clock.mockRestore();
        restore();
        setNavPackHost({});
    }
});

test('61 profiles recover on the same wall after one shared pack read fails', async () => {
    const wall: NavPoolHost = {};
    installNavWorkerPool(wall);
    const profiles = Array.from({ length: 61 }, () => wall.__rs2b0tAcquireNavigator!());
    const point = { x: 1, z: 1, level: 0 };
    const state = emptyWorldStateData();
    const pack = gzipSync(Uint8Array.of(0x4c, 0x43, 0x4e, 0x56, 1, 0, 0, 0, 0, 0));
    let reads = 0;
    const restoreFetch = replaceGlobal('fetch', async () => {
        reads++;
        return reads === 1 ? new Response(null, { status: 503 }) : new Response(pack.slice());
    });
    const restoreIsolation = replaceGlobal('crossOriginIsolated', true);
    const { workers, paths, restore } = mockWorkers(true);
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    const requestAll = () => Promise.all(profiles.map(client => client.findPath(point, point, { state, timeoutMs: 50 })));
    try {
        for (const result of await requestAll()) {
            expect(result).toEqual({ ok: false, reason: 'navigator unavailable: collision pack fetch failed: HTTP 503', expanded: 0 });
        }
        expect(reads).toBe(1);
        expect(workers).toHaveLength(4);
        expect(workers.every(worker => worker.terminated)).toBe(true);
        expect(paths).toHaveLength(0);

        const retries = requestAll();
        const expired = profiles[0].findPath(point, point, { state, timeoutMs: 5 });
        clock.mockReturnValue(1010);
        const results = await retries;
        expect(reads).toBe(2);
        expect(workers).toHaveLength(8);
        expect(results.every(result => result.ok)).toBe(true);
        expect(await expired).toEqual({ ok: false, reason: 'path request timed out after 5ms', expanded: 0 });
        expect(paths).toHaveLength(61);
        expect(paths.every(path => path.expiresAt === 1050)).toBe(true);
    } finally {
        clock.mockRestore();
        restore();
        restoreIsolation();
        restoreFetch();
        setNavPackHost({});
    }
});
