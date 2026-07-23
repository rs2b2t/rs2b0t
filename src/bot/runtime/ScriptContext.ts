export class ScriptAborted extends Error {
    constructor() {
        super('script stopped');
        this.name = 'ScriptAborted';
    }
}

type ScriptState = 'running' | 'paused' | 'stopping' | 'stopped' | 'crashed';

type LogLevel = 'info' | 'warn' | 'error';

interface LogLine {
    time: number;
    level: LogLevel;
    msg: string;
}

export type WaiterSpec = { kind: 'time'; dueAt: number } | { kind: 'tick'; dueTick: number } | { kind: 'cond'; cond: () => boolean; timeoutAt: number | null };

export type Waiter = WaiterSpec & {
    resolve: (value: boolean) => void;
    reject: (err: Error) => void;
};

const LOG_RING_CAPACITY = 500;

export class ScriptContext {
    state: ScriptState = 'running';
    waiters: Waiter[] = [];

    loopInFlight = false;
    nextLoopAt = 0;
    loopCount = 0;

    lastProgressAt = performance.now();
    watchdogWarned = false;

    crashError: Error | null = null;

    activeEvent: string | null = null;

    startedAt = performance.now();
    private pausedAt = 0;

    log: LogLine[] = [];
    private logListeners = new Set<() => void>();

    get aborted(): boolean {
        return this.state === 'stopping' || this.state === 'stopped' || this.state === 'crashed';
    }

    addLog(level: LogLevel, msg: string): void {
        this.log.push({ time: Date.now(), level, msg });
        if (this.log.length > LOG_RING_CAPACITY) {
            this.log.splice(0, this.log.length - LOG_RING_CAPACITY);
        }

        for (const listener of this.logListeners) {
            try {
                listener();
            } catch {
            }
        }
    }

    onLog(cb: () => void): () => void {
        this.logListeners.add(cb);
        return () => this.logListeners.delete(cb);
    }

    progress(): void {
        this.lastProgressAt = performance.now();
        this.watchdogWarned = false;
    }

    pause(): void {
        if (this.state !== 'running') {
            return;
        }

        this.state = 'paused';
        this.pausedAt = performance.now();
    }

    resume(): void {
        if (this.state !== 'paused') {
            return;
        }

        const pausedFor = performance.now() - this.pausedAt;
        for (const waiter of this.waiters) {
            if (waiter.kind === 'time') {
                waiter.dueAt += pausedFor;
            } else if (waiter.kind === 'cond' && waiter.timeoutAt !== null) {
                waiter.timeoutAt += pausedFor;
            }
        }
        this.nextLoopAt += pausedFor;
        this.state = 'running';
        this.progress();
    }

    abortWaiters(): void {
        const pending = this.waiters;
        this.waiters = [];
        for (const waiter of pending) {
            waiter.reject(new ScriptAborted());
        }
    }
}
