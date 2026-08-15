import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { isAbsolute, join, normalize, posix, relative, resolve } from 'node:path';

export type CgroupMemorySource = 'cgroup' | 'unavailable';

export interface CgroupResourceSamplerOptions {
    /** Absolute path to one dedicated cgroup-v2 directory. */
    cgroupDir: string;
    /** Process registered as the viewer root. It must remain a direct cgroup member. */
    rootPid: number;
    /** Test seam. Defaults to fs.readFile(path, 'utf8'). */
    readFile?: (path: string) => Promise<string>;
    /** Monotonic milliseconds. Defaults to performance.now(). */
    now?: () => number;
    /** Defaults to os.cpus().length. */
    logicalCpuCount?: number | (() => number);
}

export interface ResolveDedicatedCgroupOptions {
    procRoot?: string;
    cgroupRoot?: string;
    /** Test seam. Defaults to fs.readFile(path, 'utf8'). */
    readFile?: (path: string) => Promise<string>;
}

export type DedicatedCgroupResolution =
    | { status: 'available'; cgroupDir: string }
    | { status: 'unavailable'; reason: string };

export interface AvailableCgroupResourceSample {
    status: 'available';
    rootPid: number;
    /** Null only when the injected monotonic clock itself is invalid. */
    sampledAtMs: number | null;
    processCount: number;
    logicalCpuCount: number | null;
    cpuStatus: 'available' | 'warming-up' | 'unavailable';
    cpuCores: number | null;
    /** Machine-wide normalization: cpuCores / logicalCpuCount * 100. */
    cpuPercent: number | null;
    cpuUnavailableReason?: string;
    memoryBytes: number | null;
    memorySource: CgroupMemorySource;
    memoryUnavailableReason?: string;
}

export interface UnavailableCgroupResourceSample {
    status: 'unavailable';
    rootPid: number;
    sampledAtMs: number | null;
    reason: string;
}

export type CgroupResourceSample = AvailableCgroupResourceSample | UnavailableCgroupResourceSample;

interface CpuBaseline {
    sampledAtMs: number;
    usageUsec: number;
}

type ParsedNumber = { status: 'available'; value: number } | { status: 'unavailable'; reason: string };
type FileRead = { status: 'available'; contents: string } | { status: 'unavailable'; reason: string };

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function parseUnsignedSafeInteger(raw: string, label: string): ParsedNumber {
    const value = raw.trim();
    if (/^-\d+$/.test(value)) {
        return { status: 'unavailable', reason: `${label} must not be negative` };
    }
    if (!/^\d+$/.test(value)) {
        return { status: 'unavailable', reason: `${label} is malformed` };
    }

    const parsed = BigInt(value);
    if (parsed > MAX_SAFE_INTEGER) {
        return { status: 'unavailable', reason: `${label} exceeds JavaScript's safe integer range` };
    }
    return { status: 'available', value: Number(parsed) };
}

function parseUsageUsec(cpuStat: string): ParsedNumber {
    const matches = cpuStat
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('usage_usec'));
    if (matches.length === 0) {
        return { status: 'unavailable', reason: 'cpu.stat does not contain usage_usec' };
    }
    if (matches.length !== 1) {
        return { status: 'unavailable', reason: 'cpu.stat contains duplicate usage_usec counters' };
    }

    const fields = matches[0]?.split(/\s+/) ?? [];
    if (fields.length !== 2 || fields[0] !== 'usage_usec' || fields[1] === undefined) {
        return { status: 'unavailable', reason: 'cpu.stat usage_usec is malformed' };
    }
    return parseUnsignedSafeInteger(fields[1], 'cpu.stat usage_usec');
}

function parseCgroupProcs(raw: string): { status: 'available'; pids: number[] } | { status: 'unavailable'; reason: string } {
    const contents = raw.trim();
    if (contents === '') return { status: 'available', pids: [] };

    const pids: number[] = [];
    const seen = new Set<number>();
    for (const token of contents.split(/\s+/)) {
        const parsed = parseUnsignedSafeInteger(token, 'cgroup.procs PID');
        if (parsed.status === 'unavailable') return parsed;
        if (parsed.value === 0) {
            return { status: 'unavailable', reason: 'cgroup.procs PID must be positive' };
        }
        if (seen.has(parsed.value)) {
            return { status: 'unavailable', reason: `cgroup.procs contains duplicate PID ${parsed.value}` };
        }
        seen.add(parsed.value);
        pids.push(parsed.value);
    }
    return { status: 'available', pids };
}

function validMonotonicTime(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validLogicalCpuCount(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}

/** Resolves a process's unified cgroup only when it is an rs2b0t-owned leaf. */
export async function resolveDedicatedCgroupDir(
    rootPid: number,
    options: ResolveDedicatedCgroupOptions = {}
): Promise<DedicatedCgroupResolution> {
    if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
        return { status: 'unavailable', reason: 'registered root PID must be a positive safe integer' };
    }

    const procRoot = normalize(options.procRoot ?? '/proc');
    const cgroupRoot = normalize(options.cgroupRoot ?? '/sys/fs/cgroup');
    if (!isAbsolute(procRoot)) return { status: 'unavailable', reason: 'proc root must be an absolute path' };
    if (!isAbsolute(cgroupRoot)) return { status: 'unavailable', reason: 'cgroup root must be an absolute path' };

    const readTextFile = options.readFile ?? ((path: string) => readFile(path, 'utf8'));
    let membership: string;
    try {
        membership = await readTextFile(join(procRoot, String(rootPid), 'cgroup'));
    } catch (error) {
        return {
            status: 'unavailable',
            reason: `could not read registered root cgroup membership: ${errorMessage(error)}`
        };
    }

    const unified = membership
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('0::'));
    if (unified.length === 0) {
        return { status: 'unavailable', reason: 'registered root has no unified cgroup-v2 membership' };
    }
    if (unified.length !== 1) {
        return { status: 'unavailable', reason: 'registered root has duplicate unified cgroup-v2 memberships' };
    }

    const match = unified[0]?.match(/^0::(\/[^\0\r\n]*)$/);
    if (!match || match[1] === undefined) {
        return { status: 'unavailable', reason: 'registered root cgroup-v2 membership is malformed' };
    }
    const membershipPath = match[1];
    const components = membershipPath.split('/').slice(1);
    if (components.some(component => component === '' || component === '.' || component === '..')) {
        return { status: 'unavailable', reason: 'registered root cgroup-v2 path is malformed' };
    }
    const leaf = posix.basename(membershipPath);
    if (!leaf.startsWith('rs2b0t-viewer-')) {
        return {
            status: 'unavailable',
            reason: `registered root is not in a dedicated rs2b0t viewer cgroup (found ${leaf || '/'})`
        };
    }

    const cgroupDir = resolve(cgroupRoot, ...components);
    const withinRoot = relative(cgroupRoot, cgroupDir);
    if (withinRoot === '' || withinRoot === '..' || withinRoot.startsWith(`..${posix.sep}`) || isAbsolute(withinRoot)) {
        return { status: 'unavailable', reason: 'registered root cgroup-v2 path escapes the cgroup root' };
    }
    return { status: 'available', cgroupDir };
}

/** Samples one dedicated cgroup-v2.
 *  Why: cpu.stat is cumulative across exited children, so ordinary browser process churn cannot invalidate a CPU interval the way a /proc tree snapshot can. */
export class CgroupResourceSampler {
    private readonly cgroupDir: string;
    private readonly rootPid: number;
    private readonly readTextFile: (path: string) => Promise<string>;
    private readonly now: () => number;
    private readonly getLogicalCpuCount: () => number;
    private previous: CpuBaseline | null = null;
    private samplingTail: Promise<void> = Promise.resolve();

    constructor(options: CgroupResourceSamplerOptions) {
        this.cgroupDir = normalize(options.cgroupDir);
        this.rootPid = options.rootPid;
        this.readTextFile = options.readFile ?? (path => readFile(path, 'utf8'));
        this.now = options.now ?? (() => performance.now());
        const configuredLogicalCpuCount = options.logicalCpuCount;
        this.getLogicalCpuCount = typeof configuredLogicalCpuCount === 'function'
            ? configuredLogicalCpuCount
            : () => configuredLogicalCpuCount ?? cpus().length;
    }

    sample(): Promise<CgroupResourceSample> {
        const result = this.samplingTail.then(() => this.sampleOnce());
        this.samplingTail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async readCgroupFile(name: string): Promise<FileRead> {
        try {
            return { status: 'available', contents: await this.readTextFile(join(this.cgroupDir, name)) };
        } catch (error) {
            return { status: 'unavailable', reason: `could not read ${name}: ${errorMessage(error)}` };
        }
    }

    private unavailable(sampledAtMs: number | null, reason: string): UnavailableCgroupResourceSample {
        this.previous = null;
        return { status: 'unavailable', rootPid: this.rootPid, sampledAtMs, reason };
    }

    private async sampleOnce(): Promise<CgroupResourceSample> {
        if (!isAbsolute(this.cgroupDir)) {
            return this.unavailable(null, 'cgroup directory must be an absolute path');
        }
        if (!Number.isSafeInteger(this.rootPid) || this.rootPid <= 0) {
            return this.unavailable(null, 'registered root PID must be a positive safe integer');
        }

        // Start independent reads together, but associate the timestamp with
        // cpu.stat itself rather than charging arbitrary file latency to CPU.
        const procsPromise = this.readCgroupFile('cgroup.procs');
        const memoryPromise = this.readCgroupFile('memory.current');
        const cpuRead = await this.readCgroupFile('cpu.stat');

        let sampledAtMs: number | null = null;
        let clockFailure: string | null = null;
        try {
            const value = this.now();
            if (validMonotonicTime(value)) sampledAtMs = value;
            else clockFailure = 'monotonic sampling clock returned an invalid value';
        } catch (error) {
            clockFailure = `monotonic sampling clock failed: ${errorMessage(error)}`;
        }
        const [procsRead, memoryRead] = await Promise.all([procsPromise, memoryPromise]);

        if (procsRead.status === 'unavailable') return this.unavailable(sampledAtMs, procsRead.reason);
        const parsedProcs = parseCgroupProcs(procsRead.contents);
        if (parsedProcs.status === 'unavailable') return this.unavailable(sampledAtMs, parsedProcs.reason);
        if (!parsedProcs.pids.includes(this.rootPid)) {
            return this.unavailable(sampledAtMs, `registered root PID ${this.rootPid} is not directly in the cgroup`);
        }

        let memoryBytes: number | null = null;
        let memorySource: CgroupMemorySource = 'unavailable';
        let memoryUnavailableReason: string | undefined;
        if (memoryRead.status === 'unavailable') {
            memoryUnavailableReason = memoryRead.reason;
        } else {
            const parsedMemory = parseUnsignedSafeInteger(memoryRead.contents, 'memory.current');
            if (parsedMemory.status === 'unavailable') {
                memoryUnavailableReason = parsedMemory.reason;
            } else {
                memoryBytes = parsedMemory.value;
                memorySource = 'cgroup';
            }
        }

        let logicalCpuCount: number | null = null;
        let cpuInputFailure: string | null = clockFailure;
        try {
            const value = this.getLogicalCpuCount();
            if (validLogicalCpuCount(value)) logicalCpuCount = value;
            else cpuInputFailure ??= 'logical CPU count must be a positive safe integer';
        } catch (error) {
            cpuInputFailure ??= `logical CPU count failed: ${errorMessage(error)}`;
        }

        let usageUsec: number | null = null;
        if (cpuRead.status === 'unavailable') {
            cpuInputFailure ??= cpuRead.reason;
        } else {
            const parsedUsage = parseUsageUsec(cpuRead.contents);
            if (parsedUsage.status === 'unavailable') cpuInputFailure ??= parsedUsage.reason;
            else usageUsec = parsedUsage.value;
        }

        let cpuStatus: AvailableCgroupResourceSample['cpuStatus'] = 'warming-up';
        let cpuCores: number | null = null;
        let cpuPercent: number | null = null;
        let cpuUnavailableReason: string | undefined;
        const previous = this.previous;

        if (cpuInputFailure !== null || usageUsec === null || sampledAtMs === null || logicalCpuCount === null) {
            cpuStatus = 'unavailable';
            cpuUnavailableReason = cpuInputFailure ?? 'cgroup CPU accounting is unavailable';
            this.previous = usageUsec !== null && sampledAtMs !== null
                ? { sampledAtMs, usageUsec }
                : null;
        } else if (previous !== null) {
            const elapsedMs = sampledAtMs - previous.sampledAtMs;
            const usageDeltaUsec = usageUsec - previous.usageUsec;
            if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
                cpuStatus = 'unavailable';
                cpuUnavailableReason = 'monotonic sampling clock did not advance';
            } else if (!Number.isSafeInteger(usageDeltaUsec) || usageDeltaUsec < 0) {
                cpuStatus = 'unavailable';
                cpuUnavailableReason = usageDeltaUsec < 0
                    ? 'cgroup CPU usage counter regressed'
                    : 'cgroup CPU usage delta is unsafe';
            } else {
                const measuredCpuCores = usageDeltaUsec / (elapsedMs * 1000);
                const measuredCpuPercent = measuredCpuCores / logicalCpuCount * 100;
                if (!Number.isFinite(measuredCpuCores) || measuredCpuCores < 0
                    || !Number.isFinite(measuredCpuPercent) || measuredCpuPercent < 0) {
                    cpuStatus = 'unavailable';
                    cpuUnavailableReason = 'derived cgroup CPU usage is invalid';
                } else {
                    cpuStatus = 'available';
                    cpuCores = measuredCpuCores;
                    cpuPercent = measuredCpuPercent;
                }
            }
            // A rejected interval is never published as zero, but its valid
            // endpoint becomes the next baseline so a later interval can recover.
            this.previous = { sampledAtMs, usageUsec };
        } else {
            this.previous = { sampledAtMs, usageUsec };
        }

        return {
            status: 'available',
            rootPid: this.rootPid,
            sampledAtMs,
            processCount: parsedProcs.pids.length,
            logicalCpuCount,
            cpuStatus,
            cpuCores,
            cpuPercent,
            ...(cpuUnavailableReason === undefined ? {} : { cpuUnavailableReason }),
            memoryBytes,
            memorySource,
            ...(memoryUnavailableReason === undefined ? {} : { memoryUnavailableReason })
        };
    }
}
