import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { gzipSync } from 'fflate';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import AnimFrame from '#/client/dash3d/AnimFrame.js';
import Model from '#/client/dash3d/Model.js';
import PixFont from '#/client/graphics/PixFont.js';
import Database from '#/client/io/Database.js';
import type JagFile from '#/client/io/JagFile.js';
import OnDemand from '#/client/io/OnDemand.js';
import { installWallTrafficChannel } from '#/client/io/TrafficChannel.js';
import { Client } from '#/client/shell/Client.js';
import ClientBuild from '#/client/shell/ClientBuild.js';
import * as JsUtil from '#/client/util/JsUtil.js';

const originalWorker = globalThis.Worker;

beforeEach(() => {
    Reflect.set(globalThis, 'Worker', WorkerFixture);
});

afterEach(() => {
    globalThis.Worker = originalWorker;
    mock.restore();
});

const versionlist = {
    read(name: string) {
        if (name === 'anim_version' || name === 'midi_version') return Uint8Array.of(0, 1);
        return new Uint8Array(name === 'anim_crc' || name === 'midi_crc' ? 4 : 0);
    }
} as JagFile;

class WorkerFixture {
    constructor(_url: URL, readonly options: WorkerOptions) {}
    postMessage(_message: { type: string; id?: number; archive?: number; file?: number }) {}
    terminate() {}
}

function loaderFixture() {
    return new OnDemand(versionlist, { ingame: false, db: {} } as Client);
}

function failWorker(loader: OnDemand) {
    const worker = loader.worker!;
    worker.onerror!(new ErrorEvent('error', { message: 'Synthetic module load failure' }));
}

function completeFile(loader: OnDemand, archive: number, file: number, data: Uint8Array | null) {
    let buffer: ArrayBuffer | null = null;
    if (data) {
        const compressed = gzipSync(data, { mtime: 0 });
        const payload = new Uint8Array(compressed.length + 2);
        payload.set(compressed);
        buffer = payload.buffer;
    }
    loader.worker!.onmessage!(new MessageEvent('message', { data: { type: 'completed', archive, file, urgent: true, data: buffer } }));
}

test('cache workers inherit the traffic channel of the frame that starts them', () => {
    const wall = document.implementation.createHTMLDocument();
    const frame = wall.createElement('iframe');
    const name = installWallTrafficChannel(wall);
    Object.defineProperty(window, 'frameElement', { configurable: true, value: frame });
    try {
        expect(loaderFixture().worker).toMatchObject({ options: { type: 'module', name } });
    } finally {
        Reflect.deleteProperty(window, 'frameElement');
    }
});

test('cache worker receives the selected frame target instead of the wall origin', () => {
    const previousTarget = { ...TARGET };
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    try {
        Object.assign(TARGET, resolveTarget('proxy', 'localhost:8081', false, new URLSearchParams('world=2')));
        new OnDemand(versionlist, { ingame: false, db: null } as Client);
        expect(post).toHaveBeenCalledWith({
            type: 'init',
            versions: [Uint16Array.of(), Uint16Array.of(1), Uint16Array.of(1), Uint16Array.of()],
            crcs: [Int32Array.of(), Int32Array.of(0), Int32Array.of(0), Int32Array.of()],
            host: 'localhost:8081/__rs2b0t/world/2', secured: false, ingame: false, dbEnabled: false
        });
    } finally {
        delete TARGET.world;
        delete TARGET.httpPrefix;
        Object.assign(TARGET, previousTarget);
    }
});

test('worker load failure reaches the startup error screen while requesting animations', async () => {
    spyOn(Database, 'openDatabase').mockRejectedValue(new Error('cache disabled'));
    spyOn(PixFont, 'depack').mockReturnValue(new PixFont());
    spyOn(AnimFrame, 'init').mockImplementation(() => {});
    spyOn(Model, 'init').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});
    const drawError = mock(() => {});
    let failed = false;
    const client: Client = Object.assign(Object.create(Client.prototype), {
        collision: [],
        getJagChecksums() {},
        getJagFile: () => versionlist,
        loadTitleBackground() {},
        loadTitleImages() {},
        drawError,
        drawProgress(message: string, percent: number) {
            client['lastProgressMessage'] = message;
            client['lastProgressPercent'] = percent;
        },
        async onDemandLoop() {
            const loader = client['onDemand']!;
            if (failed) throw new Error('Startup kept polling the failed worker');
            failed = true;
            failWorker(loader);
            await Client.prototype.onDemandLoop.call(client);
        }
    });

    await client.maininit();
    expect(client['errorMessage']).toContain('Requesting animations 65%: Synthetic module load failure');
    await client.mainredraw();
    expect(drawError).toHaveBeenCalledTimes(1);
});

async function checkStartupAssets(optional: boolean, responseDelay?: number) {
    const files = {
        read(name: string) {
            if (name.endsWith('_version')) return Uint8Array.of(0, 1);
            if (name.endsWith('_crc')) return new Uint8Array(4);
            if (name === 'model_index') return Uint8Array.of(1);
            if (name === 'map_index') return Uint8Array.of(48, 47, 0, 0, 0, 0, 0);
            return new Uint8Array();
        }
    } as JagFile;
    spyOn(Database, 'openDatabase').mockResolvedValue({} as IDBDatabase);
    spyOn(PixFont, 'depack').mockReturnValue(new PixFont());
    spyOn(AnimFrame, 'init').mockImplementation(() => {});
    spyOn(Model, 'init').mockImplementation(() => {});
    const animation = spyOn(AnimFrame, 'unpack').mockImplementation(() => {});
    const model = spyOn(Model, 'unpack').mockImplementation(() => {});
    const saveMidi = mock((_data: Uint8Array, _fading: boolean) => {});
    const progress: [string, number][] = [];
    let deliver: (() => void) | undefined;
    let start = 0;
    let elapsed = 0;
    const client: Client = Object.assign(Object.create(Client.prototype), {
        collision: [], midiActive: optional, searchParams: new URLSearchParams(optional ? '' : 'box'),
        sceneState: 1, mapBuildGroundFile: [0], mapBuildGroundData: [null], mapBuildLocationData: [null],
        getJagChecksums() {}, getJagFile: () => files, loadTitleBackground() {}, loadTitleImages() {},
        saveMidi,
        async onDemandLoop() {
            await Client.prototype.onDemandLoop.call(client);
            deliver?.();
            deliver = undefined;
        },
        drawProgress(message: string, percent: number) {
            progress.push([message, percent]);
            if (percent === 65) start = performance.now();
            if (percent === 80) {
                elapsed = performance.now() - start;
                throw new Error('End of asset stages');
            }
        }
    });
    spyOn(console, 'error').mockImplementation(() => {});
    const requests: number[][] = [];
    spyOn(WorkerFixture.prototype, 'postMessage').mockImplementation((message) => {
        if (message.type === 'prefetchPriority') {
            client['onDemand']!.worker!.onmessage!(new MessageEvent('message', { data: { type: 'ack', id: message.id } }));
        } else if (message.type === 'request' && message.archive !== undefined && message.file !== undefined) {
            const { archive, file } = message;
            requests.push([archive, file]);
            const reply = () => completeFile(client['onDemand']!, archive, file, Uint8Array.of(archive, file));
            if (responseDelay === undefined) deliver = reply;
            else setTimeout(reply, responseDelay);
        }
    });
    const sleep = JsUtil.sleep;
    const sleeps: number[][] = [];
    spyOn(JsUtil, 'sleep').mockImplementation(async ms => {
        sleeps.push([client['onDemand']!.remaining(), ms]);
        if (responseDelay !== undefined) await sleep(ms);
    });

    await client.maininit();

    const stages: [string, number][] = [['Connecting to update server', 60], ['Requesting animations', 65], ['Requesting models', 70]];
    if (optional) stages.push(['Requesting maps', 75]);
    expect(progress).toEqual([...stages, ['Unpacking media', 80]]);
    expect(requests).toEqual(optional ? [[2, 0], [1, 0], [0, 0], [3, 0]] : [[1, 0], [0, 0]]);
    expect(animation.mock.calls).toEqual([[Uint8Array.of(1, 0)]]);
    expect(model.mock.calls).toEqual([[0, Uint8Array.of(0, 0)]]);
    expect(saveMidi.mock.calls).toEqual(optional ? [[Uint8Array.of(2, 0), true]] : []);
    expect(client['mapBuildGroundData']).toEqual([optional ? Uint8Array.of(3, 0) : null]);
    expect(client['onDemand']!.remaining()).toBe(0);
    return { sleeps, elapsed };
}

test.each([
    { stages: 'animation and model', optional: false },
    { stages: 'music, animation, model and map', optional: true }
])('startup polls only pending assets for $stages', async ({ optional }) => {
    const { sleeps } = await checkStartupAssets(optional);
    expect(sleeps).toEqual(Array(optional ? 4 : 2).fill([1, 100]));
});

const benchmarkDelay = process.env.STARTUP_POLL_BENCH_MS;
if (benchmarkDelay) {
    test('measure animation and model polling', async () => {
        const { elapsed, sleeps } = await checkStartupAssets(false, Number(benchmarkDelay));
        const empty = sleeps.filter(([remaining]) => remaining === 0).length;
        console.log('sample', elapsed, empty, sleeps.length - empty);
    });
}

test('pending and subsequent priority prefetches settle after worker load failure', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const loader = loaderFixture();
    loader.request(1, 0);
    loader.request(2, 0);
    const pending = loader.prefetchPriority(1, 0, 2);
    failWorker(loader);
    await expect(pending).rejects.toThrow('Synthetic module load failure');
    await expect(loader.prefetchPriority(1, 0, 2)).rejects.toThrow('Synthetic module load failure');
    expect(loader.requests.size()).toBe(0);
    expect(loader['pendingByArchive'].every(pending => pending.size === 0)).toBe(true);
    loader.request(1, 0);
    expect(loader.requests.size()).toBe(0);
    expect(loader.worker).toBeNull();
});

test.each([
    { archive: 2, file: 1 },
    { archive: 4, file: 0 }
])('request($archive, $file) leaves the queue empty and the last MIDI file still completes', ({ archive, file }) => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    loader.request(archive, file);
    expect(loader.remaining()).toBe(0);
    expect(post).not.toHaveBeenCalled();

    loader.request(2, 0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: 'request', archive: 2, file: 0 });
    expect(loader.remaining()).toBe(1);
    completeFile(loader, 2, 0, Uint8Array.of(42));
    expect(loader.loop()).toMatchObject({ archive: 2, file: 0, data: Uint8Array.of(42) });
    expect(loader.loop()).toBeNull();
    expect(loader.remaining()).toBe(0);
});

test('a healthy worker delivers the requested animation exactly once', async () => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    loader.request(1, 0);
    expect(post).toHaveBeenCalledWith({ type: 'request', archive: 1, file: 0 });
    expect(loader.remaining()).toBe(1);

    completeFile(loader, 1, 0, Uint8Array.of(42));

    await loader.run();
    expect(loader.loop()).toMatchObject({ archive: 1, file: 0, data: Uint8Array.of(42) });
    expect(loader.remaining()).toBe(0);
    expect(loader.loop()).toBeNull();
});

test('requests stay distinct by archive and suppress duplicates until drained', () => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    const scan = spyOn(loader.requests, 'head');
    loader.request(1, 0);
    loader.request(1, 0);
    loader.request(2, 0);
    completeFile(loader, 2, 0, null);
    completeFile(loader, 1, 0, null);
    loader.request(2, 0);
    expect(loader.remaining()).toBe(2);
    expect(loader.loop()).toMatchObject({ archive: 2, file: 0 });
    loader.request(2, 0);
    loader.request(1, 0);
    completeFile(loader, 2, 0, null);
    expect(loader.loop()).toMatchObject({ archive: 1, file: 0 });
    expect(loader.loop()).toMatchObject({ archive: 2, file: 0 });
    expect(loader.remaining()).toBe(0);
    expect(post.mock.calls.map(([message]) => message)).toEqual([
        { type: 'request', archive: 1, file: 0 },
        { type: 'request', archive: 2, file: 0 },
        { type: 'request', archive: 2, file: 0 }
    ]);
    expect(scan).not.toHaveBeenCalled();
});

test('draining unsolicited completions preserves a later request for the same file', () => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    completeFile(loader, 93, 0, null);
    completeFile(loader, 1, 0, null);
    loader.request(1, 0);
    expect(loader.loop()).toMatchObject({ archive: 93, file: 0 });
    expect(loader.loop()).toMatchObject({ archive: 1, file: 0 });
    loader.request(1, 0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(loader.remaining()).toBe(1);
    completeFile(loader, 1, 0, null);
    expect(loader.loop()).toMatchObject({ archive: 1, file: 0 });
    expect(loader.remaining()).toBe(0);
});

test.each([
    { missing: 'ground', file: 0, pendingStatus: -2 },
    { missing: 'location', file: 1, pendingStatus: -1 }
])('a missing $missing file waits only for the other map file and player info', async ({ file, pendingStatus }) => {
    const loader = loaderFixture();
    loader.versions[3] = Uint16Array.of(1, 1);
    const mapBuild = mock(() => {});
    const client: Client = Object.assign(Object.create(Client.prototype), {
        onDemand: loader, sceneState: 1, awaitingPlayerInfo: true, minusedlevel: ClientBuild.minusedlevel,
        mapBuildIndex: Int32Array.of(0), mapBuildGroundFile: [0], mapBuildLocationFile: [1],
        mapBuildGroundData: [null], mapBuildLocationData: [null], mapBuild, out: { p1Enc() {} }
    });
    loader.request(3, 0);
    loader.request(3, 1);
    completeFile(loader, 3, file, null);
    await client.onDemandLoop();
    expect(loader.remaining()).toBe(1);
    expect(client['mapBuildGroundFile']).toEqual([file === 0 ? -1 : 0]);
    expect(client['mapBuildLocationFile']).toEqual([file === 1 ? -1 : 1]);
    expect(client['checkScene']()).toBe(pendingStatus);
    expect(client['sceneState']).toBe(1);

    const data = Uint8Array.of(0);
    completeFile(loader, 3, 1 - file, data);
    await client.onDemandLoop();
    expect(loader.remaining()).toBe(0);
    expect(client['mapBuildGroundData']).toEqual([file === 0 ? null : data]);
    expect(client['mapBuildLocationData']).toEqual([file === 1 ? null : data]);
    expect(client['checkScene']()).toBe(-4);
    client['awaitingPlayerInfo'] = false;
    expect(client['checkScene']()).toBe(0);
    expect(client['sceneState']).toBe(2);
    expect(mapBuild).toHaveBeenCalledTimes(1);
});

test('a missing animation drains without unpacking', async () => {
    const loader = loaderFixture();
    const client: Client = Object.assign(Object.create(Client.prototype), { onDemand: loader });
    const unpack = spyOn(AnimFrame, 'unpack').mockImplementation(() => {});
    loader.request(1, 0);
    completeFile(loader, 1, 0, null);
    await client.onDemandLoop();
    expect(loader.remaining()).toBe(0);
    expect(unpack).not.toHaveBeenCalled();
});

test('priority prefetch resolves on acknowledgement or normal shutdown', async () => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    const first = loader.prefetchPriority(1, 0, 2);
    const worker = loader.worker!;
    worker.onmessage!(new MessageEvent('message', { data: { type: 'ack', id: post.mock.calls[0][0].id } }));
    await first;

    const second = loader.prefetchPriority(1, 0, 2);
    loader.stop();
    await second;
});

test('a worker error after a prefetch acknowledgement preserves the map diagnostic', async () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const diagnostic = spyOn(console, 'log').mockImplementation(() => {});
    const loader = loaderFixture();
    const worker = loader.worker!;
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    const first = loader.prefetchPriority(1, 0, 2);
    worker.onmessage!(new MessageEvent('message', { data: { type: 'ack', id: post.mock.calls[0][0].id } }));
    await first;

    loader.request(1, 0);
    worker.onerror!(new ErrorEvent('error', { message: 'Synthetic runtime error' }));

    const client: Client = Object.assign(Object.create(Client.prototype), {
        onDemand: loader, sceneState: 1, sceneLoadStartTime: performance.now() - 360001
    });
    client['checkMinimap']();
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Synthetic runtime error');
    expect(loader.remaining()).toBe(1);
    expect(loader.worker).toBe(worker);
});

test('a runtime error after the worker loads releases the first pending prefetch', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const loader = loaderFixture();
    const worker = loader.worker!;
    const pending = loader.prefetchPriority(1, 0, 2);
    worker.onmessage!(new MessageEvent('message', { data: { type: 'ready' } }));
    worker.onerror!(new ErrorEvent('error', { message: 'Synthetic runtime error' }));
    await pending;
    expect(loader.worker).toBe(worker);
});
