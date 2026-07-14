// Main-thread facade over the NavWorker. Lazy-spawns the worker
// exactly like the client spawns OnDemand (src/io/OnDemand.ts), fetches the
// collision pack relative to the bundle and transfers it in init, and
// correlates path requests by id.
//
// findPath() is plain-promise async: infrastructure code. Scripts never await
// it directly — WalkExecutor bridges it into Execution.delayUntil so stop/
// abort semantics hold.

import type { NavPoint, NavResponse, PathOutcome } from './PathFinder.js';

export type PathResult = PathOutcome & { elapsedMs?: number };

const FIND_TIMEOUT_MS = 20_000;

interface PendingRequest {
    resolve: (result: PathResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

class NavigatorImpl {
    private worker: Worker | null = null;
    private state: 'idle' | 'starting' | 'ready' | 'failed' = 'idle';
    private failReason = '';

    mapsquares = 0;
    doorEdges = 0;
    transportEdges = 0;
    /** elapsedMs of every completed worker pathfind this session (for stats). */
    readonly timings: number[] = [];

    private nextId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly readyWaiters: (() => void)[] = [];

    isReady(): boolean {
        return this.state === 'ready';
    }

    /** Spawn the worker and ship it the collision pack. Idempotent. */
    start(): void {
        if (this.state !== 'idle') {
            return;
        }
        this.state = 'starting';

        const worker = new Worker(new URL('./navworker.js', import.meta.url), { type: 'module' });
        this.worker = worker;

        worker.onmessage = (event: MessageEvent): void => this.onMessage(event.data as NavResponse);
        worker.onerror = (event: ErrorEvent): void => this.fail(`worker error: ${event.message}`);

        fetch(new URL('./collision.lcnav.gz', import.meta.url))
            .then(res => {
                if (!res.ok) {
                    throw new Error(`collision pack fetch failed: HTTP ${res.status}`);
                }
                return res.arrayBuffer();
            })
            .then(pack => {
                if (this.worker === worker) {
                    worker.postMessage({ type: 'init', pack }, [pack]);
                }
            })
            .catch(err => this.fail(err instanceof Error ? err.message : String(err)));
    }

    /**
     * Resolve a world path off-thread. Never rejects: failures come back as
     * {ok:false, reason}. Queues behind init when the worker isn't ready yet.
     */
    async findPath(from: NavPoint, to: NavPoint, opts?: { avoidDoors?: { x: number; z: number }[]; timeoutMs?: number; maxExpansions?: number }): Promise<PathResult> {
        this.start();

        if (this.state === 'starting') {
            await new Promise<void>(resolve => this.readyWaiters.push(resolve));
        }
        if (this.state !== 'ready' || !this.worker) {
            return { ok: false, reason: `navigator unavailable: ${this.failReason || this.state}`, expanded: 0 };
        }

        const timeoutMs = opts?.timeoutMs ?? FIND_TIMEOUT_MS;
        const id = this.nextId++;
        return new Promise<PathResult>(resolve => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve({ ok: false, reason: `path request timed out after ${timeoutMs}ms`, expanded: 0 });
            }, timeoutMs);
            this.pending.set(id, { resolve, timer });
            this.worker!.postMessage({ type: 'path', id, from, to, avoid: opts?.avoidDoors, maxExpansions: opts?.maxExpansions });
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
                return; // raced its timeout
            }
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            this.timings.push(message.elapsedMs);
            request.resolve(message);
        }
    }

    private fail(reason: string): void {
        console.error(`[rs2b0t] navigator failed: ${reason}`);
        this.failReason = reason;
        this.state = 'failed';
        this.flushReadyWaiters();
        for (const [, request] of this.pending) {
            clearTimeout(request.timer);
            request.resolve({ ok: false, reason: `navigator failed: ${reason}`, expanded: 0 });
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
    }

    private flushReadyWaiters(): void {
        const waiters = this.readyWaiters.splice(0);
        for (const waiter of waiters) {
            waiter();
        }
    }
}

export const Navigator = new NavigatorImpl();
