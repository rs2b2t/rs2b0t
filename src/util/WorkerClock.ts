import { sleep } from './JsUtil.js';

/**
 * A timer backed by a Web Worker, immune to background-tab throttling.
 *
 * Browsers clamp `setTimeout` in a minimized/occluded tab to ~once per minute
 * (intensive throttling). The client's frame loop paces on `setTimeout`, so a
 * backgrounded bot stalls and drops its connection. Worker timers are NOT
 * throttled, so we relay the frame delay through a tiny inline worker.
 *
 * Falls back to `setTimeout` when a worker can't be created (no `Worker`, no
 * blob URLs, or a strict CSP blocking `worker-src blob:`), so it is always
 * safe to call — the worst case is the pre-existing throttled behaviour.
 */
const WORKER_SRC = `
const timers = new Map();
onmessage = (e) => {
    const d = e.data;
    if (d.cancel !== undefined) {
        const t = timers.get(d.cancel);
        if (t !== undefined) { clearTimeout(t); timers.delete(d.cancel); }
        return;
    }
    timers.set(d.id, setTimeout(() => { timers.delete(d.id); postMessage(d.id); }, d.ms));
};
`;

class WorkerClockImpl {
    private worker: Worker | null = null;
    private available = true;
    private nextId = 1;
    private pending = new Map<number, { resolve: () => void; ms: number; startedAt: number }>();

    private ensure(): Worker | null {
        if (this.worker || !this.available) {
            return this.worker;
        }
        if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
            this.available = false;
            return null;
        }
        try {
            const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
            const worker = new Worker(url);
            URL.revokeObjectURL(url);
            worker.onmessage = (e: MessageEvent): void => {
                const entry = this.pending.get(e.data as number);
                if (entry) {
                    this.pending.delete(e.data as number);
                    entry.resolve();
                }
            };
            worker.onerror = (): void => this.fail();
            this.worker = worker;
        } catch {
            this.available = false;
        }
        return this.worker;
    }

    /** Worker died: re-arm every pending wait on setTimeout so nothing hangs. */
    private fail(): void {
        this.available = false;
        this.worker = null;
        const now = performance.now();
        for (const { resolve, ms, startedAt } of this.pending.values()) {
            setTimeout(resolve, Math.max(0, ms - (now - startedAt)));
        }
        this.pending.clear();
    }

    /** Resolve after ~ms, unaffected by background-tab timer throttling. */
    sleep(ms: number): Promise<void> {
        const worker = this.ensure();
        if (!worker) {
            return sleep(ms);
        }
        const id = this.nextId++;
        return new Promise<void>(resolve => {
            this.pending.set(id, { resolve, ms, startedAt: performance.now() });
            worker.postMessage({ id, ms });
        });
    }
}

export const WorkerClock = new WorkerClockImpl();
export type { WorkerClockImpl };
