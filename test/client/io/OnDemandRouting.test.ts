import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { gzipSync } from 'fflate';
import { TARGET, resolveTarget } from '#/client/config/target.js';
import AnimFrame from '#/client/dash3d/AnimFrame.js';
import Model from '#/client/dash3d/Model.js';
import PixFont from '#/client/graphics/PixFont.js';
import Database from '#/client/io/Database.js';
import type JagFile from '#/client/io/JagFile.js';
import OnDemand from '#/client/io/OnDemand.js';
import { Client } from '#/client/shell/Client.js';

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
        if (name === 'anim_version') return Uint8Array.of(0, 1);
        return new Uint8Array(name === 'anim_crc' ? 4 : 0);
    }
} as JagFile;

class WorkerFixture {
    postMessage(_message: { type: string; id?: number }) {}
    terminate() {}
}

function loaderFixture() {
    return new OnDemand(versionlist, { ingame: false, db: {} } as Client);
}

function failWorker(loader: OnDemand) {
    const worker = loader.worker!;
    worker.onerror!(new ErrorEvent('error', { message: 'Synthetic module load failure' }));
}

test('cache worker receives the selected frame target instead of the wall origin', () => {
    const previousTarget = { ...TARGET };
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    try {
        Object.assign(TARGET, resolveTarget('proxy', 'localhost:8081', false, new URLSearchParams('world=2')));
        new OnDemand(versionlist, { ingame: false, db: null } as Client);
        expect(post).toHaveBeenCalledWith({ type: 'init', versions: [[], [1], [], []], crcs: [[], [0], [], []], host: 'localhost:8081/__rs2b0t/world/2', secured: false, ingame: false, dbEnabled: false });
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

test('pending and subsequent priority prefetches settle after worker load failure', async () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const loader = loaderFixture();
    loader.request(1, 0);
    const pending = loader.prefetchPriority(1, 0, 2);
    failWorker(loader);
    await expect(pending).rejects.toThrow('Synthetic module load failure');
    await expect(loader.prefetchPriority(1, 0, 2)).rejects.toThrow('Synthetic module load failure');
    expect(loader.requests.size()).toBe(0);
    loader.request(1, 0);
    expect(loader.requests.size()).toBe(0);
    expect(loader.worker).toBeNull();
});

test('a healthy worker delivers the requested animation exactly once', async () => {
    const loader = loaderFixture();
    const post = spyOn(WorkerFixture.prototype, 'postMessage');
    loader.request(1, 0);
    expect(post).toHaveBeenCalledWith({ type: 'request', archive: 1, file: 0 });
    expect(loader.remaining()).toBe(1);

    const compressed = gzipSync(Uint8Array.of(42));
    const file = new Uint8Array(compressed.length + 2);
    file.set(compressed);
    const worker = loader.worker!;
    worker.onmessage!(new MessageEvent('message', { data: { type: 'completed', archive: 1, file: 0, urgent: true, data: file.buffer } }));

    await loader.run();
    expect(loader.loop()).toMatchObject({ archive: 1, file: 0, data: Uint8Array.of(42) });
    expect(loader.remaining()).toBe(0);
    expect(loader.loop()).toBeNull();
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
