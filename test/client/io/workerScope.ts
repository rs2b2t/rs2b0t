import { mock } from 'bun:test';

export const scope = Object.assign(new EventTarget(), { postMessage: mock((_message: unknown) => {}) });

export async function loadWorkerScope() {
    const original = self;
    Reflect.set(globalThis, 'self', scope);
    try {
        await import('#/client/io/OnDemandWorker.js');
    } finally {
        Reflect.set(globalThis, 'self', original);
    }
}
