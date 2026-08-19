// docs/reference/multibox.md#resource-telemetry
import type { CpuPayload, MemoryPayload, ResourcePayload, TrafficPayload, TrafficTotals } from './ResourcePayload.js';
import type { TrafficSnapshot } from '../adapter/TrafficAdapter.js';

export type { TrafficPayload, TrafficTotals } from './ResourcePayload.js';

export interface ResourcePanelNodes {
    botCount: HTMLElement;
    cpu: HTMLElement;
    memory: HTMLElement;
    traffic: HTMLElement;
    cpuRow?: HTMLElement;
    memoryRow?: HTMLElement;
}

interface TrafficSample extends TrafficTotals {
    at: number;
}

type MetricState = { status: 'available'; text: string; title?: string } | { status: 'measuring' | 'unavailable' | 'error'; title: string };

type ResourceFetch = (input: string, init: RequestInit) => Promise<Response>;

interface ResourcePanelOptions {
    fetch?: ResourceFetch;
    getTrafficSnapshot?: () => TrafficSnapshot;
    endpoint?: string;
    intervalMs?: number;
    now?: () => number;
}

const MEASURING = 'measuring…';
const UNAVAILABLE = 'unavailable';
const OFFLINE = 'offline';
const MONITOR_ERROR = 'monitor error';
const DEFAULT_ENDPOINT = '/__rs2b0t/resources';
const DEFAULT_INTERVAL_MS = 1000;

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactNumber(value: number): string {
    if (value > 0 && value < 0.01) {
        return '<0.01';
    }
    const digits = value > 0 && value < 0.1 ? 2 : 1;
    return value.toFixed(digits).replace(/\.0+$/, '');
}

function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const digits = unit === 0 || value >= 10 ? 0 : 1;
    return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[unit]}`;
}

function formatByteRate(bytesPerSecond: number): string {
    if (bytesPerSecond > 0 && bytesPerSecond < 1) {
        return '<1 B/s';
    }
    return `${formatBytes(bytesPerSecond)}/s`;
}

function parseCpu(value: unknown): CpuPayload | null {
    if (!isObject(value)) {
        return null;
    }
    if (value.status === 'warming-up') {
        return { status: 'warming-up' };
    }
    if (value.status === 'unavailable') {
        if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
            return null;
        }
        return { status: 'unavailable', reason: value.reason };
    }
    if (value.status !== 'available' || !isFiniteNonNegative(value.cpuCores) || !isFiniteNonNegative(value.cpuPercent) || !isFiniteNonNegative(value.logicalCpuCount) || value.logicalCpuCount < 1) {
        return null;
    }
    return {
        status: 'available',
        cpuCores: value.cpuCores,
        cpuPercent: value.cpuPercent,
        logicalCpuCount: value.logicalCpuCount
    };
}

function readCpu(value: unknown): MetricState {
    const cpu = parseCpu(value);
    if (cpu === null) {
        return { status: 'error', title: 'resource monitor returned an invalid CPU response' };
    }
    if (cpu.status === 'warming-up') {
        return { status: 'measuring', title: 'waiting for a second CPU sample' };
    }
    if (cpu.status === 'unavailable') {
        return { status: 'unavailable', title: cpu.reason };
    }
    const coreLabel = cpu.cpuCores === 1 ? 'core' : 'cores';
    return {
        status: 'available',
        text: `${compactNumber(cpu.cpuCores)} ${coreLabel} (${compactNumber(cpu.cpuPercent)}% of ${compactNumber(cpu.logicalCpuCount)})`
    };
}

function parseMemory(value: unknown): MemoryPayload | null {
    if (!isObject(value)) {
        return null;
    }
    if (value.status === 'unavailable') {
        if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
            return null;
        }
        return { status: 'unavailable', reason: value.reason };
    }
    if (value.status !== 'available' || !isFiniteNonNegative(value.memoryBytes) || (value.memorySource !== 'cgroup' && value.memorySource !== 'pss' && value.memorySource !== 'rss')) {
        return null;
    }
    return {
        status: 'available',
        memoryBytes: value.memoryBytes,
        memorySource: value.memorySource
    };
}

function readMemory(value: unknown): MetricState {
    const memory = parseMemory(value);
    if (memory === null) {
        return { status: 'error', title: 'resource monitor returned an invalid RAM response' };
    }
    if (memory.status === 'unavailable') {
        return { status: 'unavailable', title: memory.reason };
    }
    return {
        status: 'available',
        text: formatBytes(memory.memoryBytes),
        title: memory.memorySource === 'cgroup'
            ? 'Memory source: cgroup v2 memory.current'
            : `Memory source: ${memory.memorySource}`
    };
}

type ResourceEnvelope = Omit<ResourcePayload, 'cpu' | 'memory' | 'traffic'> & {
    cpu: unknown;
    memory: unknown;
    traffic: unknown;
};

function parseResourceEnvelope(value: unknown): ResourceEnvelope | null {
    if (!isObject(value) || value.scope !== 'bot-browser' || !Number.isSafeInteger(value.sampledAt) || !isFiniteNonNegative(value.sampledAt) || !Object.hasOwn(value, 'cpu') || !Object.hasOwn(value, 'memory') || !Object.hasOwn(value, 'traffic')) {
        return null;
    }
    return {
        scope: value.scope,
        sampledAt: value.sampledAt,
        cpu: value.cpu,
        memory: value.memory,
        traffic: value.traffic
    };
}

function validTrafficTotals(value: Record<string, unknown>): value is Record<string, unknown> & TrafficTotals {
    return Number.isSafeInteger(value.receivedBytes) && isFiniteNonNegative(value.receivedBytes) && Number.isSafeInteger(value.sentBytes) && isFiniteNonNegative(value.sentBytes);
}

function parseTraffic(value: unknown): TrafficPayload | null {
    if (!isObject(value)) {
        return null;
    }
    if (value.status === 'unavailable') {
        if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
            return null;
        }
        return { status: 'unavailable', reason: value.reason };
    }
    if (value.status !== 'available' || !validTrafficTotals(value)) {
        return null;
    }
    return {
        status: 'available',
        receivedBytes: value.receivedBytes,
        sentBytes: value.sentBytes
    };
}

function render(node: HTMLElement, state: MetricState): void {
    const detailed = state.status === 'unavailable' || state.status === 'error';
    if (state.status === 'available') {
        node.textContent = state.text;
    } else if (state.status === 'measuring') {
        node.textContent = MEASURING;
    } else if (state.status === 'unavailable') {
        node.textContent = `${UNAVAILABLE} — ${state.title}`;
    } else {
        node.textContent = `${MONITOR_ERROR} — ${state.title}`;
    }
    node.classList.toggle('mbx-resource-detail', detailed);
    if (state.title) {
        node.title = state.title;
    } else {
        node.removeAttribute('title');
    }
}

export class ResourcePanel {
    private readonly fetchResource: ResourceFetch;
    private readonly getTrafficSnapshot: (() => TrafficSnapshot) | null;
    private readonly endpoint: string;
    private readonly intervalMs: number;
    private readonly now: () => number;
    private previousTraffic: TrafficSample | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private hostTelemetry = true;

    constructor(
        private readonly nodes: ResourcePanelNodes,
        options: ResourcePanelOptions = {}
    ) {
        this.fetchResource = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.getTrafficSnapshot = options.getTrafficSnapshot ?? null;
        this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
        this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.now = options.now ?? (() => Date.now());
    }

    setBotCount(count: number, running: number): void {
        const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
        const safeRunning = Number.isFinite(running) && running > 0 ? Math.floor(running) : 0;
        this.nodes.botCount.textContent = `${safeCount} ${safeCount === 1 ? 'bot' : 'bots'} (${safeRunning} running)`;
    }

    async refresh(): Promise<boolean> {
        if (!this.hostTelemetry) {
            return this.refreshTrafficOnly();
        }

        let response: Response;
        try {
            response = await this.fetchResource(this.endpoint, { cache: 'no-store' });
        } catch {
            this.previousTraffic = null;
            this.renderAll(OFFLINE, 'resource monitor is offline');
            return false;
        }

        // Why: a wall served straight from an engine has no proxy behind this route,
        // and traffic stays measurable in the browser.
        if (response.status === 404) {
            this.hostTelemetry = false;
            this.previousTraffic = null;
            for (const row of [this.nodes.cpuRow, this.nodes.memoryRow]) {
                if (row) {
                    row.hidden = true;
                }
            }
            return this.refreshTrafficOnly();
        }

        if (!response.ok) {
            this.previousTraffic = null;
            this.renderAll(MONITOR_ERROR, `resource monitor returned HTTP ${response.status}`);
            return false;
        }

        let resource: ResourceEnvelope;
        try {
            const raw = (await response.json()) as unknown;
            const parsed = parseResourceEnvelope(raw);
            if (parsed === null) {
                throw new Error('invalid resource response');
            }
            resource = parsed;
        } catch {
            this.previousTraffic = null;
            this.renderAll(MONITOR_ERROR, 'resource monitor returned an invalid response');
            return false;
        }

        const cpu = readCpu(resource.cpu);
        const memory = readMemory(resource.memory);
        const traffic = this.readTraffic(resource.traffic, resource.sampledAt);
        render(this.nodes.cpu, cpu);
        render(this.nodes.memory, memory);
        render(this.nodes.traffic, traffic);
        return cpu.status !== 'error' && memory.status !== 'error' && traffic.status !== 'error';
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.previousTraffic = null;
        this.running = true;
        void this.poll();
    }

    stop(): void {
        this.running = false;
        if (this.timer !== null) {
            globalThis.clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async poll(): Promise<void> {
        await this.refresh();
        if (this.running) {
            this.timer = globalThis.setTimeout(() => void this.poll(), this.intervalMs);
        }
    }

    private readTraffic(value: unknown, sampledAt: number): MetricState {
        if (this.getTrafficSnapshot !== null) {
            let browserTraffic: unknown;
            try {
                browserTraffic = this.getTrafficSnapshot();
            } catch {
                this.previousTraffic = null;
                return { status: 'unavailable', title: 'browser traffic collector is unavailable' };
            }
            if (!isObject(browserTraffic)) {
                this.previousTraffic = null;
                return { status: 'error', title: 'browser traffic collector returned an invalid state' };
            }
            if (browserTraffic.status === 'measuring') {
                this.previousTraffic = null;
                return { status: 'measuring', title: 'waiting for browser WebSocket traffic publishers' };
            }
            if (browserTraffic.status === 'unavailable') {
                this.previousTraffic = null;
                return typeof browserTraffic.reason === 'string' && browserTraffic.reason.trim().length > 0
                    ? { status: 'unavailable', title: browserTraffic.reason }
                    : { status: 'error', title: 'browser traffic collector returned an invalid state' };
            }
            if (browserTraffic.status !== 'available' || !validTrafficTotals(browserTraffic)) {
                this.previousTraffic = null;
                return { status: 'error', title: 'browser traffic collector returned invalid counters' };
            }
            return this.rateForTraffic(browserTraffic, sampledAt);
        }

        const traffic = parseTraffic(value);
        if (traffic === null) {
            this.previousTraffic = null;
            return { status: 'error', title: 'resource monitor returned an invalid Traffic response' };
        }
        if (traffic.status === 'unavailable') {
            this.previousTraffic = null;
            return { status: 'unavailable', title: traffic.reason };
        }

        return this.rateForTraffic(traffic, sampledAt);
    }

    private refreshTrafficOnly(): boolean {
        const traffic = this.readTraffic(null, this.now());
        render(this.nodes.traffic, traffic);
        return traffic.status !== 'error';
    }

    private rateForTraffic(traffic: TrafficTotals, sampledAt: number): MetricState {
        const current: TrafficSample = {
            receivedBytes: traffic.receivedBytes,
            sentBytes: traffic.sentBytes,
            at: sampledAt
        };
        const previous = this.previousTraffic;
        this.previousTraffic = current;
        if (!previous || current.receivedBytes < previous.receivedBytes || current.sentBytes < previous.sentBytes) {
            return { status: 'measuring', title: 'waiting for another traffic sample' };
        }
        if (current.at <= previous.at) {
            this.previousTraffic = null;
            return { status: 'unavailable', title: 'traffic sampling clock did not advance' };
        }

        const elapsedSeconds = (current.at - previous.at) / 1000;
        const receivedPerSecond = (current.receivedBytes - previous.receivedBytes) / elapsedSeconds;
        const sentPerSecond = (current.sentBytes - previous.sentBytes) / elapsedSeconds;
        return {
            status: 'available',
            text: `↓ ${formatByteRate(receivedPerSecond)}  ↑ ${formatByteRate(sentPerSecond)}`
        };
    }

    private renderAll(text: string, title: string): void {
        for (const node of [this.nodes.cpu, this.nodes.memory, this.nodes.traffic]) {
            node.textContent = `${text} — ${title}`;
            node.title = title;
            node.classList.add('mbx-resource-detail');
        }
    }
}
