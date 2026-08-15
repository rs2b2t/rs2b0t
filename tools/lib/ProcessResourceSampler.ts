import { execFile as execFileCallback } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { cpus } from 'node:os';
import { promisify } from 'node:util';

export type ProcessMemorySource = 'pss' | 'rss';
export type AggregateMemorySource = ProcessMemorySource | 'unavailable';

export interface CollectedProcess {
    pid: number;
    parentPid: number;
    /** Stable across samples for one process lifetime (Linux start ticks, macOS start time). */
    identity: string;
    /** User + system CPU time consumed by every thread in the process. */
    cpuSeconds: number | null;
    memoryBytes: number | null;
    memorySource: ProcessMemorySource | null;
}

export interface AvailableProcessCollection {
    status: 'available';
    logicalCpuCount: number | null;
    cpuUnavailableReason?: string;
    processes: CollectedProcess[];
}

export interface UnavailableProcessCollection {
    status: 'unavailable';
    reason: string;
}

export type ProcessCollection = AvailableProcessCollection | UnavailableProcessCollection;

export interface ProcessCollector {
    collect(rootPid: number): Promise<ProcessCollection>;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>;

export interface ProcessResourceSamplerOptions {
    rootPid: number;
    collector?: ProcessCollector;
    /** Must be monotonic. Defaults to performance.now(). */
    now?: () => number;
}

export interface AvailableProcessResourceSample {
    status: 'available';
    rootPid: number;
    sampledAtMs: number;
    processCount: number;
    logicalCpuCount: number | null;
    cpuStatus: 'available' | 'warming-up' | 'unavailable';
    cpuCores: number | null;
    /** Machine-wide normalization: cpuCores / logicalCpuCount * 100. */
    cpuPercent: number | null;
    cpuUnavailableReason?: string;
    memoryBytes: number | null;
    memorySource: AggregateMemorySource;
    memoryUnavailableProcessCount: number;
}

export interface UnavailableProcessResourceSample {
    status: 'unavailable';
    rootPid: number;
    sampledAtMs: number;
    reason: string;
}

export type ProcessResourceSample = AvailableProcessResourceSample | UnavailableProcessResourceSample;

interface PreviousSample {
    sampledAtMs: number;
    rootIdentity: string;
    cpuSecondsByProcess: Map<string, number>;
}

const execFile = promisify(execFileCallback);

async function runCommand(command: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFile(command, [...args], { encoding: 'utf8' });
    return stdout;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function defaultExpectedUid(): number | null {
    return typeof process.getuid === 'function' ? process.getuid() : null;
}

function logicalCpuCount(override?: number): number {
    return override ?? cpus().length;
}

function processKey(process: CollectedProcess): string {
    return `${process.pid}:${process.identity}`;
}

/** Selects the root process and its transitive descendants, never siblings or parents. */
export function selectProcessTree(rootPid: number, processes: readonly CollectedProcess[]): CollectedProcess[] {
    const byPid = new Map<number, CollectedProcess>();
    const children = new Map<number, CollectedProcess[]>();

    for (const process of processes) {
        if (!Number.isInteger(process.pid) || process.pid <= 0 || byPid.has(process.pid)) continue;
        byPid.set(process.pid, process);
        const siblings = children.get(process.parentPid);
        if (siblings) siblings.push(process);
        else children.set(process.parentPid, [process]);
    }

    const root = byPid.get(rootPid);
    if (!root) return [];

    const selected: CollectedProcess[] = [];
    const visited = new Set<number>();
    const pending = [root];
    while (pending.length > 0) {
        const process = pending.pop();
        if (!process || visited.has(process.pid)) continue;
        visited.add(process.pid);
        selected.push(process);
        pending.push(...(children.get(process.pid) ?? []));
    }
    return selected;
}

export class ProcessResourceSampler {
    private readonly rootPid: number;
    private readonly collector: ProcessCollector;
    private readonly now: () => number;
    private registeredRootIdentity: string | null = null;
    private previous: PreviousSample | null = null;
    private samplingTail: Promise<void> = Promise.resolve();

    constructor(options: ProcessResourceSamplerOptions) {
        this.rootPid = options.rootPid;
        this.collector = options.collector ?? createPlatformProcessCollector();
        this.now = options.now ?? (() => performance.now());
    }

    sample(): Promise<ProcessResourceSample> {
        const result = this.samplingTail.then(() => this.sampleOnce());
        this.samplingTail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async sampleOnce(): Promise<ProcessResourceSample> {
        const sampledAtMs = this.now();
        if (!Number.isInteger(this.rootPid) || this.rootPid <= 0) {
            this.previous = null;
            return { status: 'unavailable', rootPid: this.rootPid, sampledAtMs, reason: 'root PID must be a positive integer' };
        }

        const collection = await this.collector.collect(this.rootPid);
        if (collection.status === 'unavailable') {
            this.previous = null;
            return { status: 'unavailable', rootPid: this.rootPid, sampledAtMs, reason: collection.reason };
        }
        const tree = selectProcessTree(this.rootPid, collection.processes);
        const root = tree.find(process => process.pid === this.rootPid);
        if (!root) {
            this.previous = null;
            return { status: 'unavailable', rootPid: this.rootPid, sampledAtMs, reason: `root process ${this.rootPid} is unavailable` };
        }
        if (this.registeredRootIdentity === null) {
            this.registeredRootIdentity = root.identity;
        } else if (root.identity !== this.registeredRootIdentity) {
            this.previous = null;
            return {
                status: 'unavailable',
                rootPid: this.rootPid,
                sampledAtMs,
                reason: `registered root process ${this.rootPid} changed identity`
            };
        }
        const unavailableMemory = tree.filter(process => process.memoryBytes === null
            || process.memorySource === null
            || !Number.isFinite(process.memoryBytes)
            || process.memoryBytes < 0);
        const sources = new Set(tree.map(process => process.memorySource).filter((source): source is ProcessMemorySource => source !== null));
        const uniformMemorySource = unavailableMemory.length === 0 && sources.size === 1 ? (sources.values().next().value ?? null) : null;
        const memoryBytes = uniformMemorySource === null ? null : tree.reduce((total, process) => total + (process.memoryBytes ?? 0), 0);
        const memorySource: AggregateMemorySource = uniformMemorySource ?? 'unavailable';

        let cpuStatus: AvailableProcessResourceSample['cpuStatus'] = 'warming-up';
        let cpuCores: number | null = null;
        let cpuPercent: number | null = null;
        let cpuUnavailableReason: string | undefined;

        const cpuInputFailure = collection.cpuUnavailableReason
            ?? (!Number.isInteger(collection.logicalCpuCount) || (collection.logicalCpuCount ?? 0) <= 0
                ? 'logical CPU count is unavailable'
                : tree.some(process => process.cpuSeconds === null || !Number.isFinite(process.cpuSeconds) || process.cpuSeconds < 0)
                    ? 'collector returned an invalid cumulative CPU time'
                    : null);
        const currentCpuSecondsByProcess = cpuInputFailure === null
            ? new Map(tree.map(process => [processKey(process), process.cpuSeconds as number]))
            : null;
        const previous = this.previous;
        if (cpuInputFailure !== null) {
            cpuStatus = 'unavailable';
            cpuUnavailableReason = cpuInputFailure;
            this.previous = null;
        } else if (previous && previous.rootIdentity === root.identity && currentCpuSecondsByProcess !== null) {
            const elapsedSeconds = (sampledAtMs - previous.sampledAtMs) / 1000;
            if (elapsedSeconds <= 0 || !Number.isFinite(elapsedSeconds)) {
                cpuStatus = 'unavailable';
                cpuUnavailableReason = 'sampling clock did not advance';
            } else {
                const processTreeChanged = currentCpuSecondsByProcess.size !== previous.cpuSecondsByProcess.size
                    || [...currentCpuSecondsByProcess.keys()].some(key => !previous.cpuSecondsByProcess.has(key));
                if (processTreeChanged) {
                    cpuStatus = 'unavailable';
                    cpuUnavailableReason = 'browser process tree changed during the sampling interval';
                } else {
                    let cpuDeltaSeconds = 0;
                    let counterRegressed = false;
                    for (const [key, current] of currentCpuSecondsByProcess) {
                        const before = previous.cpuSecondsByProcess.get(key);
                        if (before === undefined || current < before) {
                            counterRegressed = true;
                            break;
                        }
                        cpuDeltaSeconds += current - before;
                    }
                    if (counterRegressed) {
                        cpuStatus = 'unavailable';
                        cpuUnavailableReason = 'a browser CPU counter regressed during the sampling interval';
                    } else {
                        const measuredCpuCores = cpuDeltaSeconds / elapsedSeconds;
                        const measuredCpuPercent = (measuredCpuCores / (collection.logicalCpuCount as number)) * 100;
                        if (!Number.isFinite(measuredCpuCores) || measuredCpuCores < 0 || !Number.isFinite(measuredCpuPercent) || measuredCpuPercent < 0) {
                            cpuStatus = 'unavailable';
                            cpuUnavailableReason = 'derived browser CPU usage is invalid';
                        } else {
                            cpuCores = measuredCpuCores;
                            cpuPercent = measuredCpuPercent;
                            cpuStatus = 'available';
                        }
                    }
                }
            }
        }

        if (currentCpuSecondsByProcess !== null) {
            this.previous = {
                sampledAtMs,
                rootIdentity: root.identity,
                cpuSecondsByProcess: currentCpuSecondsByProcess
            };
        }

        return {
            status: 'available',
            rootPid: this.rootPid,
            sampledAtMs,
            processCount: tree.length,
            logicalCpuCount: collection.logicalCpuCount,
            cpuStatus,
            cpuCores,
            cpuPercent,
            ...(cpuUnavailableReason ? { cpuUnavailableReason } : {}),
            memoryBytes,
            memorySource,
            memoryUnavailableProcessCount: unavailableMemory.length
        };
    }
}

interface ParsedProcStat {
    pid: number;
    parentPid: number;
    cpuTicks: number;
    startTicks: string;
}

function parseProcStat(raw: string): ParsedProcStat | null {
    const open = raw.indexOf('(');
    const close = raw.lastIndexOf(')');
    if (open <= 0 || close <= open) return null;

    const pid = Number(raw.slice(0, open).trim());
    const fields = raw
        .slice(close + 1)
        .trim()
        .split(/\s+/);
    // fields[0] is stat field 3 (state); ppid=4, utime=14, stime=15, starttime=22.
    const parentPid = Number(fields[1]);
    const userTicks = Number(fields[11]);
    const systemTicks = Number(fields[12]);
    const startTicks = fields[19];
    if (![pid, parentPid, userTicks, systemTicks].every(Number.isFinite) || startTicks === undefined) return null;
    return { pid, parentPid, cpuTicks: userTicks + systemTicks, startTicks };
}

function parseKilobytes(raw: string, field: string): number | null {
    const match = raw.match(new RegExp(`^${field}:\\s+(\\d+)\\s+kB\\s*$`, 'm'));
    return match ? Number(match[1]) * 1024 : null;
}

export interface LinuxProcCollectorOptions {
    procRoot?: string;
    clockTicksPerSecond?: number;
    logicalCpuCount?: number;
    /** Defaults to the current uid. Pass null to disable ownership validation. */
    expectedUid?: number | null;
    commandRunner?: CommandRunner;
    /** Test seam for deterministic /proc churn. Defaults to fs.readFile(path, 'utf8'). */
    readProcFile?: (path: string) => Promise<string>;
}

type ProcStatRead = { status: 'available'; process: ParsedProcStat } | { status: 'missing' } | { status: 'unreadable' };

type ResolvedLinuxProcess = { status: 'included'; process: CollectedProcess } | { status: 'root-unavailable'; reason: string };

export class LinuxProcCollector implements ProcessCollector {
    private readonly procRoot: string;
    private readonly configuredClockTicks: number | undefined;
    private readonly configuredLogicalCpuCount: number | undefined;
    private readonly expectedUid: number | null;
    private readonly commandRunner: CommandRunner;
    private readonly readProcFile: (path: string) => Promise<string>;
    private detectedClockTicks: Promise<number | null> | null = null;

    constructor(options: LinuxProcCollectorOptions = {}) {
        this.procRoot = options.procRoot ?? '/proc';
        this.configuredClockTicks = options.clockTicksPerSecond;
        this.configuredLogicalCpuCount = options.logicalCpuCount;
        this.expectedUid = options.expectedUid === undefined ? defaultExpectedUid() : options.expectedUid;
        this.commandRunner = options.commandRunner ?? runCommand;
        this.readProcFile = options.readProcFile ?? (path => readFile(path, 'utf8'));
    }

    async collect(rootPid: number): Promise<ProcessCollection> {
        try {
            const rootPath = `${this.procRoot}/${rootPid}`;
            const rootInfo = await stat(rootPath);
            if (this.expectedUid !== null && rootInfo.uid !== this.expectedUid) {
                return {
                    status: 'unavailable',
                    reason: `root process ${rootPid} is owned by uid ${rootInfo.uid}, expected ${this.expectedUid}`
                };
            }

            const ticksPerSecond = await this.getClockTicksPerSecond();
            const cpuCount = logicalCpuCount(this.configuredLogicalCpuCount);
            const validCpuCount = Number.isInteger(cpuCount) && cpuCount > 0 ? cpuCount : null;
            const cpuUnavailableReason = ticksPerSecond === null
                ? 'could not determine Linux clock ticks per second'
                : validCpuCount === null
                    ? 'logical CPU count is unavailable'
                    : null;

            const entries = await readdir(this.procRoot, { withFileTypes: true });
            const pids = entries.filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => Number(entry.name));
            const parsed = (await Promise.all(pids.map(pid => this.readStat(pid)))).filter((process): process is ParsedProcStat => process !== null);

            const candidates: CollectedProcess[] = parsed.map(process => ({
                pid: process.pid,
                parentPid: process.parentPid,
                identity: process.startTicks,
                cpuSeconds: ticksPerSecond === null ? null : process.cpuTicks / ticksPerSecond,
                memoryBytes: null,
                memorySource: null
            }));
            const tree = selectProcessTree(rootPid, candidates);
            if (tree.length === 0) {
                return { status: 'unavailable', reason: `root process ${rootPid} disappeared while sampling` };
            }

            const resolved = await Promise.all(tree.map(process => this.resolveMemory(rootPid, process)));
            const rootFailure = resolved.find(result => result.status === 'root-unavailable');
            if (rootFailure?.status === 'root-unavailable') {
                return { status: 'unavailable', reason: rootFailure.reason };
            }
            const processes = resolved.filter((result): result is Extract<ResolvedLinuxProcess, { status: 'included' }> => result.status === 'included').map(result => result.process);
            return {
                status: 'available',
                logicalCpuCount: validCpuCount,
                ...(cpuUnavailableReason === null ? {} : { cpuUnavailableReason }),
                processes
            };
        } catch (error) {
            return { status: 'unavailable', reason: `Linux process collection failed: ${errorMessage(error)}` };
        }
    }

    private async getClockTicksPerSecond(): Promise<number | null> {
        if (this.configuredClockTicks !== undefined) {
            return Number.isFinite(this.configuredClockTicks) && this.configuredClockTicks > 0 ? this.configuredClockTicks : null;
        }
        this.detectedClockTicks ??= this.commandRunner('getconf', ['CLK_TCK'])
            .then(stdout => {
                const value = Number(stdout.trim());
                return Number.isFinite(value) && value > 0 ? value : null;
            })
            .catch(() => null);
        return this.detectedClockTicks;
    }

    private async readStat(pid: number): Promise<ParsedProcStat | null> {
        const result = await this.readStatResult(pid);
        return result.status === 'available' ? result.process : null;
    }

    private async readStatResult(pid: number): Promise<ProcStatRead> {
        try {
            const process = parseProcStat(await this.readProcFile(`${this.procRoot}/${pid}/stat`));
            return process ? { status: 'available', process } : { status: 'unreadable' };
        } catch (error) {
            // Processes can exit between /proc enumeration and the read.
            return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable' };
        }
    }

    private async readPss(pid: number): Promise<number | null> {
        try {
            return parseKilobytes(await this.readProcFile(`${this.procRoot}/${pid}/smaps_rollup`), 'Pss');
        } catch {
            return null;
        }
    }

    private async resolveMemory(rootPid: number, process: CollectedProcess): Promise<ResolvedLinuxProcess> {
        const pss = await this.readPss(process.pid);
        // Always verify the stable identity after reading PSS. A successful PSS
        // read can race with PID reuse as a failed read can.
        const current = await this.readStatResult(process.pid);
        const disappeared = current.status === 'missing';
        const reused = current.status === 'available' && current.process.startTicks !== process.identity;
        if (disappeared || reused) {
            if (process.pid === rootPid) {
                const event = disappeared ? 'disappeared' : 'changed identity';
                return {
                    status: 'root-unavailable',
                    reason: `root process ${rootPid} ${event} while reading memory`
                };
            }
            // Why: keeping the original tree node stops a vanished intermediate process disconnecting still-live descendants from the aggregate.
            // Its unknown memory makes RAM explicitly unavailable for this pass.
            return {
                status: 'included',
                process: { ...process, memoryBytes: null, memorySource: null }
            };
        }

        if (current.status === 'available' && pss !== null) {
            return {
                status: 'included',
                process: { ...process, memoryBytes: pss, memorySource: 'pss' }
            };
        }

        // An unreadable stat is not proof that identity stayed stable. Preserve
        // the process and report RAM unavailable rather than silently undercounting.
        return {
            status: 'included',
            process: { ...process, memoryBytes: null, memorySource: null }
        };
    }
}

function parseCpuTime(raw: string): number | null {
    const dayParts = raw.split('-');
    if (dayParts.length > 2) return null;
    const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
    const clock = dayParts.at(-1)?.split(':').map(Number) ?? [];
    if (!Number.isFinite(days) || (clock.length !== 2 && clock.length !== 3) || clock.some(value => !Number.isFinite(value))) return null;
    const [hours, minutes, seconds] = clock.length === 3 ? clock : [0, clock[0], clock[1]];
    return days * 86400 + (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

interface ParsedPsProcess extends CollectedProcess {
    uid: number;
}

function parsePsLine(line: string): ParsedPsProcess | null {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) return null;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const uid = Number(match[3]);
    const cpuSeconds = parseCpuTime(match[4] ?? '');
    const rssKilobytes = Number(match[5]);
    const identity = match[6];
    if (identity === undefined || ![pid, parentPid, uid, rssKilobytes].every(Number.isFinite)) return null;
    return {
        pid,
        parentPid,
        uid,
        identity,
        cpuSeconds,
        memoryBytes: rssKilobytes * 1024,
        memorySource: 'rss'
    };
}

export interface MacOsPsCollectorOptions {
    logicalCpuCount?: number;
    /** Defaults to the current uid. Pass null to disable ownership validation. */
    expectedUid?: number | null;
    commandRunner?: CommandRunner;
}

export class MacOsPsCollector implements ProcessCollector {
    private readonly configuredLogicalCpuCount: number | undefined;
    private readonly expectedUid: number | null;
    private readonly commandRunner: CommandRunner;

    constructor(options: MacOsPsCollectorOptions = {}) {
        this.configuredLogicalCpuCount = options.logicalCpuCount;
        this.expectedUid = options.expectedUid === undefined ? defaultExpectedUid() : options.expectedUid;
        this.commandRunner = options.commandRunner ?? runCommand;
    }

    async collect(rootPid: number): Promise<ProcessCollection> {
        try {
            const stdout = await this.commandRunner('ps', ['-axo', 'pid=,ppid=,uid=,time=,rss=,lstart=']);
            const parsed = stdout
                .split('\n')
                .map(parsePsLine)
                .filter((process): process is ParsedPsProcess => process !== null);
            const root = parsed.find(process => process.pid === rootPid);
            if (!root) return { status: 'unavailable', reason: `root process ${rootPid} is unavailable` };
            if (this.expectedUid !== null && root.uid !== this.expectedUid) {
                return {
                    status: 'unavailable',
                    reason: `root process ${rootPid} is owned by uid ${root.uid}, expected ${this.expectedUid}`
                };
            }
            const cpuCount = logicalCpuCount(this.configuredLogicalCpuCount);
            const processes = selectProcessTree(rootPid, parsed);
            const validCpuCount = Number.isInteger(cpuCount) && cpuCount > 0 ? cpuCount : null;
            const invalidCpuTime = processes.some(process => process.cpuSeconds === null);
            const cpuUnavailableReason = validCpuCount === null
                ? 'logical CPU count is unavailable'
                : invalidCpuTime
                    ? 'macOS returned an unreadable cumulative CPU time'
                    : null;
            return {
                status: 'available',
                logicalCpuCount: validCpuCount,
                ...(cpuUnavailableReason === null ? {} : { cpuUnavailableReason }),
                processes
            };
        } catch (error) {
            return { status: 'unavailable', reason: `macOS process collection failed: ${errorMessage(error)}` };
        }
    }
}

class UnavailableProcessCollector implements ProcessCollector {
    constructor(private readonly reason: string) {}

    async collect(_rootPid: number): Promise<ProcessCollection> {
        return { status: 'unavailable', reason: this.reason };
    }
}

export interface PlatformProcessCollectorOptions extends LinuxProcCollectorOptions, MacOsPsCollectorOptions {
    platform?: string;
}

export function createPlatformProcessCollector(options: PlatformProcessCollectorOptions = {}): ProcessCollector {
    const platform = options.platform ?? process.platform;
    if (platform === 'linux') return new LinuxProcCollector(options);
    if (platform === 'darwin') return new MacOsPsCollector(options);
    return new UnavailableProcessCollector(`process resource collection is unavailable on ${platform}`);
}
