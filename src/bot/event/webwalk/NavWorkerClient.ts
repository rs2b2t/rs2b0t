import { setNavPackHost, navPackForWorker } from './navPack.js';
import type { NavPoint, NavResponse, PathOutcome } from './PathFinder.js';
import type { PathPolicy } from './types.js';
import type { WorldStateData } from './worldStateData.js';

declare const NAV_WORKER_URL: string;

export type PathResult = PathOutcome & { elapsedMs?: number };

export type FindPathOpts = {
    avoidDoors?: { x: number; z: number }[];
    timeoutMs?: number;
    maxExpansions?: number;
    state?: WorldStateData;
    policy?: PathPolicy;
    useTeleportCatalog?: boolean;
    /** Resolved danger-zone rects (use resolveDangerZones for ids). Idea @lolwut. */
    avoidZones?: readonly import('./data/dangerZones.js').DangerZoneRect[];
};

const FIND_TIMEOUT_MS = 20_000;

interface PendingRequest {
    resolve: (result: PathResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

export class NavWorkerClient {
    private worker: Worker | null = null;
    private state: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
    private failReason = '';

    mapsquares = 0;
    doorEdges = 0;
    transportEdges = 0;

    private nextId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly readyWaiters = new Set<() => void>();

    isReady(): boolean {
        return this.state === 'ready';
    }

    start(): void {
        if (this.state !== 'idle') {
            return;
        }
        this.state = 'starting';

        let worker: Worker;
        try {
            const url = new URL(typeof NAV_WORKER_URL === 'undefined' ? './navworker.js' : NAV_WORKER_URL, import.meta.url);
            worker = new Worker(url, { type: 'module' });
        } catch (err) {
            this.fail(String(err));
            return;
        }
        this.worker = worker;

        worker.onmessage = (event: MessageEvent): void => this.onMessage(event.data as NavResponse);
        worker.onerror = (event: ErrorEvent): void => this.fail(`worker error: ${event.message}`);

        void this.initWorker(worker);
    }

    private async initWorker(worker: Worker): Promise<void> {
        let payload;
        try {
            payload = await navPackForWorker(new URL('./collision.lcnav.gz', import.meta.url));
        } catch (err) {
            if (this.worker === worker) this.fail(err, 'idle');
            return;
        }
        if (this.worker !== worker) return;
        try {
            worker.postMessage({ type: 'init', pack: payload.pack }, payload.transfer);
        } catch (err) {
            this.fail(err);
        }
    }

    async findPath(from: NavPoint, to: NavPoint, opts: FindPathOpts & { state: WorldStateData }): Promise<PathResult> {
        const timeoutMs = opts.timeoutMs ?? FIND_TIMEOUT_MS;
        const expiresAt = Date.now() + timeoutMs;
        const timedOut = (): PathResult => ({ ok: false, reason: `path request timed out after ${timeoutMs}ms`, expanded: 0 });
        this.start();

        if (this.state === 'starting') {
            const startupFinished = await new Promise<boolean>(resolve => {
                const wake = () => {
                    clearTimeout(timer);
                    resolve(true);
                };
                const timer = setTimeout(() => {
                    this.readyWaiters.delete(wake);
                    resolve(false);
                }, expiresAt - Date.now());
                this.readyWaiters.add(wake);
            });
            if (!startupFinished) return timedOut();
        }
        if (this.state !== 'ready' || !this.worker) {
            return { ok: false, reason: `navigator unavailable: ${this.failReason || this.state}`, expanded: 0 };
        }

        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) return timedOut();
        const id = this.nextId++;
        return new Promise<PathResult>(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(timedOut());
            }, remainingMs);
            this.pending.set(id, { resolve, timer });
            this.worker!.postMessage({
                type: 'path',
                id,
                expiresAt,
                from,
                to,
                avoid: opts.avoidDoors,
                maxExpansions: opts.maxExpansions,
                state: opts.state,
                policy: opts.policy,
                useTeleportCatalog: opts.useTeleportCatalog,
                avoidZones: opts.avoidZones
            });
        });
    }

    private onMessage(message: NavResponse): void {
        if (message.type === 'ready') {
            this.mapsquares = message.mapsquares;
            this.doorEdges = message.doorEdges;
            this.transportEdges = message.transportEdges;
            this.state = 'ready';
            console.log(`[rs2b0t] nav worker ready: ${message.mapsquares} mapsquares, ${message.doorEdges} door edges, ${message.transportEdges} transport edges`);
            this.flushReadyWaiters();
        } else if (message.type === 'error') {
            this.fail(message.message);
        } else if (message.type === 'path') {
            const request = this.pending.get(message.id);
            if (!request) {
                return;
            }
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            request.resolve(message);
        }
    }

    private fail(error: unknown, nextState: 'idle' | 'failed' = 'failed'): void {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[rs2b0t] navigator failed: ${reason}`);
        this.failReason = reason;
        this.state = nextState;
        this.flushReadyWaiters();
        for (const [, request] of this.pending) {
            clearTimeout(request.timer);
            request.resolve({ ok: false, reason: `navigator failed: ${reason}`, expanded: 0 });
        }
        this.pending.clear();
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            this.worker.terminate();
        }
        this.worker = null;
    }

    private flushReadyWaiters(): void {
        for (const waiter of this.readyWaiters) {
            waiter();
        }
        this.readyWaiters.clear();
    }
}

const POOL_SIZE = 4;

export interface NavPoolHost {
    __rs2b0tAcquireNavigator?: () => NavWorkerClient;
}

export function installNavWorkerPool(owner: NavPoolHost, size = POOL_SIZE): void {
    if (owner.__rs2b0tAcquireNavigator) return;
    setNavPackHost(owner);
    const workers: NavWorkerClient[] = [];
    let next = 0;
    owner.__rs2b0tAcquireNavigator = () => {
        const index = next++ % size;
        return (workers[index] ??= new NavWorkerClient());
    };
}
