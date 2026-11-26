import { TARGET } from '#/client/config/target.js';
import { gunzipSync } from 'fflate';

import type { Client } from '#/client/shell/Client.js';

import LinkList2 from '#/client/datastruct/LinkList2.js';
import LinkList from '#/client/datastruct/LinkList.js';

import type JagFile from '#/client/io/JagFile.js';
import OnDemandProvider from '#/client/io/OnDemandProvider.js';
import OnDemandRequest from '#/client/io/OnDemandRequest.js';
import Packet from '#/client/io/Packet.js';
import { openFrameTrafficPort } from '#/client/io/TrafficChannel.js';

declare const ONDEMAND_WORKER_URL: string;

export default class OnDemand extends OnDemandProvider {
    versions: number[][] = [];
    crcs: number[][] = [];
    modelUse: number[] = [];
    mapIndex: number[] = [];
    mapLand: number[] = [];
    mapLoc: number[] = [];
    mapFree: number[] = [];
    animFrameIndex: number[] = [];
    midiJingle: number[] = [];
    running: boolean = true;
    app: Client;
    requests: LinkList2<OnDemandRequest> = new LinkList2();
    private readonly pendingByArchive: Map<number, OnDemandRequest>[] = [];
    completed: LinkList<OnDemandRequest> = new LinkList();
    message: string = '';
    cycle: number = 0;
    failCount: number = 0;
    worker: Worker | null = null;
    private releaseWorkerPort?: () => void;
    private workerError: Error | null = null;
    private lastIngame: boolean = false;
    private workerMessageId: number = 0;
    private workerAcks: Map<number, () => void> = new Map();

    constructor(versionlist: JagFile, app: Client) {
        super();

        const version: string[] = ['model_version', 'anim_version', 'midi_version', 'map_version'];
        for (let i = 0; i < 4; i++) {
            this.pendingByArchive[i] = new Map();
            const data = versionlist.read(version[i]);
            if (!data) {
                throw new Error();
            }

            const count = data.length / 2;
            const buf = new Packet(data);

            this.versions[i] = new Array(count);

            for (let j = 0; j < count; j++) {
                this.versions[i][j] = buf.g2();
            }
        }

        const crc: string[] = ['model_crc', 'anim_crc', 'midi_crc', 'map_crc'];
        for (let i = 0; i < 4; i++) {
            const data = versionlist.read(crc[i]);
            if (!data) {
                throw new Error();
            }

            const count = data.length / 4;
            const buf = new Packet(data);

            this.crcs[i] = new Array(count);

            for (let j = 0; j < count; j++) {
                this.crcs[i][j] = buf.g4();
            }
        }

        let data = versionlist.read('model_index');
        if (data) {
            const count = this.versions[0].length;
            this.modelUse = new Array(count);

            for (let i = 0; i < count; i++) {
                if (i < data.length) {
                    this.modelUse[i] = data[i];
                } else {
                    this.modelUse[i] = 0;
                }
            }
        }

        data = versionlist.read('map_index');
        if (data) {
            const count = data.length / 7;
            const buf = new Packet(data);

            this.mapIndex = new Array(count);
            this.mapLand = new Array(count);
            this.mapLoc = new Array(count);
            this.mapFree = new Array(count);

            for (let i = 0; i < count; i++) {
                this.mapIndex[i] = buf.g2();
                this.mapLand[i] = buf.g2();
                this.mapLoc[i] = buf.g2();
                this.mapFree[i] = buf.g1();
            }
        }

        data = versionlist.read('anim_index');
        if (data) {
            const count = data.length / 2;
            const buf = new Packet(data);

            this.animFrameIndex = new Array(count);
            for (let i = 0; i < count; i++) {
                this.animFrameIndex[i] = buf.g2();
            }
        }

        data = versionlist.read('midi_index');
        if (data) {
            const count = data.length;
            const buf = new Packet(data);

            this.midiJingle = new Array(count);
            for (let i = 0; i < count; i++) {
                this.midiJingle[i] = buf.g1();
            }
        }

        this.app = app;
        this.running = true;
        this.startWorker();
    }

    stop() {
        this.worker?.postMessage({ type: 'stop' });
        this.terminateWorker();
    }

    private terminateWorker() {
        this.running = false;
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            this.worker.terminate();
            this.worker = null;
        }
        this.releaseWorkerPort?.();
        this.releaseWorkerPort = undefined;
        this.resolveWorkerAcks();
    }

    private resolveWorkerAcks() {
        for (const resolve of this.workerAcks.values()) {
            resolve();
        }
        this.workerAcks.clear();
    }

    getFileCount(archive: number) {
        return this.versions[archive].length;
    }

    getAnimFrameCount() {
        return this.animFrameIndex.length;
    }

    getMapFile(x: number, z: number, type: number) {
        const map = (x << 8) + z;

        for (let i = 0; i < this.mapIndex.length; i++) {
            if (this.mapIndex[i] === map) {
                if (type === 0) {
                    return this.mapLand[i];
                } else {
                    return this.mapLoc[i];
                }
            }
        }

        return -1;
    }

    async prefetchMaps(members: boolean) {
        const count = this.mapIndex.length;
        for (let i = 0; i < count; i++) {
            if (members || this.mapFree[i] !== 0) {
                await this.prefetchPriority(3, this.mapLoc[i], 2);
                await this.prefetchPriority(3, this.mapLand[i], 2);
            }
        }
    }

    hasMapLocFile(file: number) {
        for (let i = 0; i < this.mapIndex.length; i++) {
            if (this.mapLoc[i] === file) {
                return true;
            }
        }

        return false;
    }

    getModelUse(id: number) {
        return this.modelUse[id] & 0xFF;
    }

    isMidiJingle(id: number) {
        return this.midiJingle[id] === 1;
    }

    requestModel(id: number) {
        this.request(0, id);
    }

    request(archive: number, file: number) {
        if (this.workerError || archive < 0 || archive >= this.versions.length || file < 0 || file >= this.versions[archive].length || this.versions[archive][file] === 0) {
            return;
        }

        const pending = this.pendingByArchive[archive];
        if (pending.has(file)) {
            return;
        }

        const req = new OnDemandRequest();
        req.archive = archive;
        req.file = file;
        req.urgent = true;

        this.requests.push(req);
        pending.set(file, req);
        this.postWorker({
            type: 'request',
            archive,
            file
        });
    }

    remaining() {
        if (this.workerError) {
            throw this.workerError;
        }
        return this.requests.size();
    }

    loop(): OnDemandRequest | null {
        const req = this.completed.popFront();
        if (req === null) {
            return null;
        }

        if (req.prev2) {
            this.pendingByArchive[req.archive].delete(req.file);
            req.unlink2();
        }

        if (req.data === null) {
            return req;
        }

        req.data = gunzipSync(req.data.subarray(0, req.data.length - 2));
        return req;
    }

    async prefetchPriority(archive: number, file: number, priority: number) {
        if (!this.app.db || this.versions[archive][file] === 0) {
            return;
        }

        await this.postWorkerAck({
            type: 'prefetchPriority',
            archive,
            file,
            priority
        });
    }

    clearPrefetches() {
        this.postWorker({ type: 'clearPrefetches' });
    }

    prefetch(archive: number, file: number) {
        if (!this.app.db || this.versions[archive][file] === 0) {
            return;
        }

        this.postWorker({
            type: 'prefetch',
            archive,
            file
        });
    }

    async run() {
        if (!this.running) {
            return;
        }

        this.startWorker();
        this.cycle++;

        if (this.lastIngame !== this.app.ingame) {
            this.lastIngame = this.app.ingame;
            this.postWorker({
                type: 'setIngame',
                ingame: this.app.ingame
            });
        }
    }

    private startWorker(): void {
        if (this.worker || this.workerError) {
            return;
        }

        const url = new URL(typeof ONDEMAND_WORKER_URL === 'undefined' ? './ondemandworker.js' : ONDEMAND_WORKER_URL, import.meta.url);
        const worker = new Worker(url, { type: 'module' });
        this.worker = worker;
        this.lastIngame = this.app.ingame;

        let loaded = false;
        worker.onmessage = (event: MessageEvent): void => {
            loaded = true;
            const message = event.data as
                | { type: 'ready' }
                | { type: 'completed'; archive: number; file: number; urgent: boolean; data: ArrayBuffer | null }
                | { type: 'message'; message: string }
                | { type: 'failCount'; failCount: number }
                | { type: 'ack'; id: number }
                | { type: 'error'; error: string };

            if (message.type === 'completed') {
                this.receiveCompleted(message.archive, message.file, message.urgent, message.data);
            } else if (message.type === 'message') {
                this.message = message.message;
            } else if (message.type === 'failCount') {
                this.failCount = message.failCount;
            } else if (message.type === 'ack') {
                const resolve = this.workerAcks.get(message.id);
                if (resolve) {
                    this.workerAcks.delete(message.id);
                    resolve();
                }
            } else if (message.type === 'error') {
                console.error(message.error);
            }
        };

        worker.onerror = (event: ErrorEvent): void => {
            if (loaded) {
                console.error(event.message);
                this.resolveWorkerAcks();
                return;
            }
            this.workerError = new Error(event.message || 'Asset worker failed to load');
            console.error(this.workerError);
            this.terminateWorker();
            this.requests = new LinkList2();
            for (const pending of this.pendingByArchive) pending.clear();
            this.completed.clear();
        };

        const traffic = openFrameTrafficPort();
        const init = {
            type: 'init',
            versions: this.versions,
            crcs: this.crcs,
            host: TARGET.wsHost,
            secured: TARGET.tls,
            ingame: this.app.ingame,
            dbEnabled: !!this.app.db
        };
        if (traffic) {
            try {
                worker.postMessage({ ...init, trafficPort: traffic.port }, [traffic.port]);
                this.releaseWorkerPort = traffic.close;
                return;
            } catch {
                traffic.close();
            }
        }
        worker.postMessage(traffic === undefined ? init : { ...init, trafficPort: null });
    }

    private postWorker(message: unknown): void {
        this.startWorker();
        this.worker?.postMessage(message);
    }

    private async postWorkerAck(message: Record<string, unknown>): Promise<void> {
        this.startWorker();

        const worker = this.worker;
        if (worker) {
            await new Promise<void>((resolve): void => {
                const id = ++this.workerMessageId;
                this.workerAcks.set(id, resolve);
                worker.postMessage({ ...message, id });
            });
        }
        if (this.workerError) {
            throw this.workerError;
        }
    }

    private receiveCompleted(archive: number, file: number, urgent: boolean, data: ArrayBuffer | null): void {
        const req = this.pendingByArchive[archive]?.get(file) ?? new OnDemandRequest();

        req.archive = archive;
        req.file = file;
        req.urgent = urgent;
        req.data = data ? new Uint8Array(data) : null;

        this.completed.push(req);
    }
}
