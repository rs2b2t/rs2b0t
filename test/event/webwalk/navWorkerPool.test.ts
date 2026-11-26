import { expect, spyOn, test } from 'bun:test';
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

test('worker startup consumes the path timeout and only live requests dispatch on ready', async () => {
    const wall: NavPoolHost & { __rs2b0tNavPack: Promise<SharedArrayBuffer> } = { __rs2b0tNavPack: Promise.resolve(new SharedArrayBuffer(1)) };
    installNavWorkerPool(wall);
    const workers: WorkerFixture[] = [];
    const paths: Extract<NavRequest, { type: 'path' }>[] = [];
    class WorkerFixture {
        onmessage!: (event: { data: NavResponse }) => void;
        constructor() {
            workers.push(this);
        }
        postMessage(message: NavRequest) {
            if (message.type !== 'path') return;
            paths.push(message);
            this.onmessage({ data: { type: 'path', id: message.id, ok: true, expanded: 0, elapsedMs: 0, cost: 0, hops: [], waypoints: [] } });
        }
    }
    const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: WorkerFixture });
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
        for (const worker of workers) worker.onmessage({ data: { type: 'ready', mapsquares: 0, doorEdges: 0, transportEdges: 0 } });
        expect(await expired).toEqual({ ok: false, reason: 'path request timed out after 5ms', expanded: 0 });
        expect((await live).ok).toBe(true);
        expect(paths.map(path => path.expiresAt)).toEqual([1060]);
    } finally {
        clock.mockRestore();
        if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
        else Reflect.deleteProperty(globalThis, 'Worker');
        setNavPackHost({});
    }
});
