import { expect, test } from 'bun:test';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import OnDemand from '#/client/io/OnDemand.js';

test('cache worker receives the selected frame target instead of the wall origin', () => {
    const previousTarget = { ...TARGET };
    const previousWorker = globalThis.Worker;
    let init: unknown;
    class WorkerFixture {
        postMessage(message: unknown) {
            init = message;
        }
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: WorkerFixture });
    try {
        Object.assign(TARGET, resolveTarget('proxy', 'localhost:8081', false, new URLSearchParams('world=2')));
        const loader = Object.create(OnDemand.prototype);
        Object.assign(loader, { app: { ingame: false, db: null }, worker: null, versions: [], crcs: [] });
        Reflect.get(loader, 'startWorker').call(loader);
        expect(init).toEqual({ type: 'init', versions: [], crcs: [], host: 'localhost:8081/__rs2b0t/world/2', secured: false, ingame: false, dbEnabled: false });
    } finally {
        delete TARGET.world;
        delete TARGET.httpPrefix;
        Object.assign(TARGET, previousTarget);
        Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: previousWorker });
    }
});
