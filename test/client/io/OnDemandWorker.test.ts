import { afterEach, beforeAll, beforeEach, expect, jest, mock, spyOn, test } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { loadWorkerScope, scope } from './workerScope.js';
import ClientStream from '#/client/io/ClientStream.js';

const clock = jest as typeof jest & { advanceTimersByTime(ms: number): void; getTimerCount(): number };
const cached = Uint8Array.of(0, 1);

function result<T>(value: T) {
    const request = { result: value, onsuccess() {} };
    queueMicrotask(() => request.onsuccess());
    return request;
}

const store = { get: (key: string) => result(key === '1.0' ? cached.slice() : undefined) };
const database = { transaction: () => ({ objectStore: () => store }), close() {} };

async function message(data: object) {
    scope.dispatchEvent(new MessageEvent('message', { data }));
    await setImmediate();
}

async function init(dbEnabled = true, trafficPort: MessagePort | null = null) {
    await message({
        type: 'init', trafficPort,
        versions: [Uint16Array.of(1, 1), Uint16Array.of(), Uint16Array.of(), Uint16Array.of()],
        crcs: [Int32Array.of(0, 0), Int32Array.of(), Int32Array.of(), Int32Array.of()],
        dbEnabled, ingame: true, host: 'fixture.invalid', secured: false
    });
}

async function advance(ms: number) {
    clock.advanceTimersByTime(ms);
    await setImmediate();
}

beforeAll(loadWorkerScope);

const originalDatabase = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => result(database) } });
    spyOn(ClientStream, 'openSocket').mockRejectedValue(new Error('offline fixture'));
    scope.postMessage.mockClear();
});

afterEach(async () => {
    await message({ type: 'stop' });
    if (originalDatabase) Object.defineProperty(globalThis, 'indexedDB', originalDatabase);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
    mock.restore();
    jest.useRealTimers();
});

test('the worker publishes idle heartbeats on its transferred init port and stops on shutdown', async () => {
    const { port1, port2 } = new MessageChannel();
    const first = new Promise(resolve => { port1.onmessage = event => resolve(event.data); });
    try {
        await message({ type: 'init', trafficPort: structuredClone(port2, { transfer: [port2] }), versions: [], crcs: [] });
        await advance(1000);
        expect(await first).toEqual({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 0, sentBytes: 0 });
        await message({ type: 'stop' });
        expect(clock.getTimerCount()).toBe(0);
    } finally {
        port1.close();
    }
});

test('each cached request completes once and leaves the worker idle', async () => {
    await init();
    const completed = { type: 'completed', archive: 0, file: 0, urgent: true, data: cached.buffer };
    for (let requests = 1; requests <= 2; requests++) {
        await message({ type: 'request', archive: 0, file: 0 });
        await advance(50);
        expect(scope.postMessage.mock.calls.map(([message]) => message)).toEqual(Array(requests).fill(completed));
        expect(clock.getTimerCount()).toBe(0);
        await advance(1000);
        expect(scope.postMessage).toHaveBeenCalledTimes(requests);
        expect(ClientStream.openSocket).not.toHaveBeenCalled();
    }
});

test('batched requests complete cached files in submission order', async () => {
    await init();
    const get = spyOn(store, 'get').mockImplementation(() => result(cached.slice()));
    await message({ type: 'requestBatch', archive: 0, files: [1, 2, 0] });
    await advance(50);
    expect(get.mock.calls).toEqual([['1.1'], ['1.0']]);
    expect(scope.postMessage.mock.calls.map(([message]) => message)).toEqual([1, 0].map(file => ({
        type: 'completed', archive: 0, file, urgent: true, data: cached.buffer
    })));
    expect(clock.getTimerCount()).toBe(0);
});

test('a priority cache miss wakes the idle worker', async () => {
    await init();
    await advance(50);
    await message({ type: 'prefetchPriority', archive: 0, file: 1, priority: 2, id: 7 });
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ack', id: 7 });
    await advance(50);
    expect(ClientStream.openSocket).toHaveBeenCalledTimes(1);
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'message', message: 'Loading extra files - 100%' });
});

test('pending requests retry and the in-game stream keeps its keepalive cadence', async () => {
    const writes: number[][] = [];
    const socket = {
        readyState: WebSocket.OPEN,
        onmessage: (_event: MessageEvent) => {},
        close() {},
        send(bytes: Uint8Array) {
            writes.push([...bytes]);
            if (bytes.length === 1) socket.onmessage(new MessageEvent('message', { data: new ArrayBuffer(8) }));
        }
    };
    spyOn(ClientStream, 'openSocket').mockResolvedValue(socket as unknown as WebSocket);
    const { port1, port2 } = new MessageChannel();
    const firstHeartbeat = new Promise(resolve => { port1.onmessage = event => resolve(event.data); });
    await init(false, port2);
    await message({ type: 'request', archive: 0, file: 1 });
    for (let tick = 0; tick < 50; tick++) await advance(20);
    const request = [0, 0, 1, 2];
    expect(writes).toEqual([[15], request]);
    expect(await firstHeartbeat).toEqual({ type: 'rs2b0t:traffic', status: 'available', receivedBytes: 8, sentBytes: 5 });
    port1.close();
    await advance(20);
    expect(writes).toEqual([[15], request, request]);

    socket.onmessage(new MessageEvent('message', { data: Uint8Array.of(0, 0, 1, 0, 0, 0).buffer }));
    for (let tick = 0; tick < 499; tick++) await advance(20);
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'completed', archive: 0, file: 1, urgent: true, data: null });
    expect(writes).toHaveLength(3);
    await advance(20);
    expect(writes[3]).toEqual([0, 0, 0, 10]);
});
