import { sleep } from '../../client/util/JsUtil.js';

const HUB_KEY = '__rs2b0tWorkerClockHubV1';

const LOCAL_WORKER_SRC = `
const timers = new Map();
onmessage = (e) => {
    const d = e.data;
    timers.set(d.id, setTimeout(() => { timers.delete(d.id); postMessage(d.id); }, d.ms));
};
`;

// One parent-owned timer serves every renderer-off subframe, since Firefox can suspend a subframe's worker once that frame stops painting.
const SHARED_WORKER_SRC = `
const due = new Map();
let timer = null;
let wakeAt = Infinity;
function schedule() {
    let earliest = Infinity;
    for (const at of due.values()) earliest = Math.min(earliest, at);
    if (earliest === Infinity) return;
    if (timer !== null && wakeAt <= earliest) return;
    if (timer !== null) clearTimeout(timer);
    wakeAt = earliest;
    timer = setTimeout(flush, Math.max(0, earliest - performance.now()));
}
function flush() {
    timer = null;
    wakeAt = Infinity;
    const now = performance.now();
    const ready = [];
    for (const [id, at] of due) {
        if (at <= now + 0.5) { due.delete(id); ready.push(id); }
    }
    if (ready.length > 0) postMessage(ready);
    schedule();
}
onmessage = (e) => {
    due.set(e.data.id, performance.now() + Math.max(0, e.data.ms));
    schedule();
};
`;

interface ClockGlobal {
    Worker?: typeof Worker;
    Blob?: typeof Blob;
    URL?: typeof URL;
    setTimeout(handler: () => void, timeout?: number): unknown;
    [HUB_KEY]?: WorkerClockHub;
}

export interface WorkerClockHub {
    sleep(ms: number): Promise<void>;
}

class TimerWorkerClock implements WorkerClockHub {
    private worker: Worker | null = null;
    private available = true;
    private nextId = 1;
    private pending = new Map<number, { resolve: () => void; ms: number; startedAt: number }>();

    constructor(private owner: ClockGlobal, private source: string) {}

    sleep(ms: number): Promise<void> {
        const worker = this.ensure();
        if (!worker) return sleep(ms);

        const id = this.nextId++;
        return new Promise<void>(resolve => {
            this.pending.set(id, { resolve, ms, startedAt: performance.now() });
            worker.postMessage({ id, ms });
        });
    }

    private ensure(): Worker | null {
        if (this.worker || !this.available) return this.worker;

        const { Worker: WorkerCtor, Blob: BlobCtor, URL: UrlApi } = this.owner;
        if (!WorkerCtor || !BlobCtor || typeof UrlApi?.createObjectURL !== 'function') {
            this.available = false;
            return null;
        }
        try {
            const url = UrlApi.createObjectURL(new BlobCtor([this.source], { type: 'text/javascript' }));
            this.worker = new WorkerCtor(url);
            UrlApi.revokeObjectURL(url);
            this.worker.onmessage = (event: MessageEvent): void => {
                const ids = Array.isArray(event.data) ? event.data as number[] : [event.data as number];
                for (const id of ids) {
                    this.pending.get(id)?.resolve();
                    this.pending.delete(id);
                }
            };
            this.worker.onerror = (): void => this.fail();
        } catch {
            this.available = false;
        }
        return this.worker;
    }

    private fail(): void {
        this.available = false;
        this.worker?.terminate();
        this.worker = null;
        const now = performance.now();
        for (const { resolve, ms, startedAt } of this.pending.values()) {
            this.owner.setTimeout(resolve, Math.max(0, ms - (now - startedAt)));
        }
        this.pending.clear();
    }
}

export function installWorkerClockHub(owner: ClockGlobal = globalThis as unknown as ClockGlobal): WorkerClockHub {
    return owner[HUB_KEY] ??= new TimerWorkerClock(owner, SHARED_WORKER_SRC);
}

function parentHub(): WorkerClockHub | null {
    if (typeof window === 'undefined' || window.top === window) return null;
    try {
        return (window.top as unknown as ClockGlobal)[HUB_KEY] ?? null;
    } catch {
        return null;
    }
}

const localClock = new TimerWorkerClock(globalThis as unknown as ClockGlobal, LOCAL_WORKER_SRC);

export const WorkerClock = {
    sleep(ms: number, useParentClock: boolean = false): Promise<void> {
        return (useParentClock ? parentHub() : null)?.sleep(ms) ?? localClock.sleep(ms);
    }
};
