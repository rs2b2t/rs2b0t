import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LinuxProcCollector, ProcessResourceSampler, createPlatformProcessCollector, type CollectedProcess, type ProcessCollection, type ProcessCollector } from '../../tools/lib/ProcessResourceSampler.js';

class SnapshotCollector implements ProcessCollector {
    private index = 0;

    constructor(private readonly snapshots: ProcessCollection[]) {}

    async collect(_rootPid: number): Promise<ProcessCollection> {
        const snapshot = this.snapshots[Math.min(this.index, this.snapshots.length - 1)];
        this.index++;
        if (!snapshot) return { status: 'unavailable', reason: 'no test snapshot' };
        return snapshot;
    }
}

function collectedProcess(pid: number, parentPid: number, identity: string, cpuSeconds: number, memoryBytes: number | null, memorySource: 'pss' | 'rss' | null = memoryBytes === null ? null : 'pss'): CollectedProcess {
    return { pid, parentPid, identity, cpuSeconds, memoryBytes, memorySource };
}

describe('ProcessResourceSampler', () => {
    test('uses cumulative CPU deltas for only the root tree and rejects mixed memory accounting', async () => {
        const collector = new SnapshotCollector([
            {
                status: 'available',
                logicalCpuCount: 8,
                processes: [collectedProcess(10, 1, 'root', 5, 100, 'pss'), collectedProcess(11, 10, 'child', 2, 50, 'rss'), collectedProcess(12, 11, 'grandchild', 1, 25, 'pss'), collectedProcess(20, 1, 'unrelated', 100, 10_000, 'rss')]
            },
            {
                status: 'available',
                logicalCpuCount: 8,
                processes: [collectedProcess(10, 1, 'root', 5.4, 110, 'pss'), collectedProcess(11, 10, 'child', 2.8, 60, 'rss'), collectedProcess(12, 11, 'grandchild', 1.2, 30, 'pss'), collectedProcess(20, 1, 'unrelated', 500, 20_000, 'rss')]
            }
        ]);
        const times = [1_000, 3_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 3_000 });

        const warmup = await sampler.sample();
        expect(warmup).toMatchObject({
            status: 'available',
            processCount: 3,
            cpuStatus: 'warming-up',
            cpuCores: null,
            cpuPercent: null,
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableProcessCount: 0
        });

        const sample = await sampler.sample();
        expect(sample.status).toBe('available');
        if (sample.status !== 'available') return;
        expect(sample.processCount).toBe(3);
        expect(sample.memoryBytes).toBeNull();
        expect(sample.memorySource).toBe('unavailable');
        expect(sample.memoryUnavailableProcessCount).toBe(0);
        expect(sample.cpuCores).toBeCloseTo(0.7, 10);
        expect(sample.cpuPercent).toBeCloseTo(8.75, 10);
    });

    test('marks a changed process tree unavailable for one interval, then resumes from a real baseline', async () => {
        const collector = new SnapshotCollector([
            {
                status: 'available',
                logicalCpuCount: 4,
                processes: [collectedProcess(10, 1, 'root', 1, 100), collectedProcess(11, 10, 'old-child', 40, 100)]
            },
            {
                status: 'available',
                logicalCpuCount: 4,
                processes: [collectedProcess(10, 1, 'root', 1.2, 100), collectedProcess(11, 10, 'new-child', 0.4, 100)]
            },
            {
                status: 'available',
                logicalCpuCount: 4,
                processes: [collectedProcess(10, 1, 'root', 1.5, 100), collectedProcess(11, 10, 'new-child', 0.6, 100)]
            }
        ]);
        const times = [0, 1_000, 2_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 2_000 });

        await sampler.sample();
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuPercent: null,
            cpuUnavailableReason: 'browser process tree changed during the sampling interval'
        });
        const stable = await sampler.sample();
        expect(stable.status).toBe('available');
        if (stable.status !== 'available') return;
        expect(stable.cpuCores).toBeCloseTo(0.5, 10);
        expect(stable.cpuPercent).toBeCloseTo(12.5, 10);
    });

    test('never converts a regressing cumulative CPU counter into a zero', async () => {
        const collector = new SnapshotCollector([
            { status: 'available', logicalCpuCount: 4, processes: [collectedProcess(10, 1, 'root', 5, 100)] },
            { status: 'available', logicalCpuCount: 4, processes: [collectedProcess(10, 1, 'root', 4, 100)] },
            { status: 'available', logicalCpuCount: 4, processes: [collectedProcess(10, 1, 'root', 4.5, 100)] }
        ]);
        const times = [0, 1_000, 2_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 2_000 });

        await sampler.sample();
        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuUnavailableReason: 'a browser CPU counter regressed during the sampling interval'
        });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'available', cpuCores: 0.5 });
    });

    test('refuses a reused registered root PID instead of measuring another process', async () => {
        const collector = new SnapshotCollector([
            { status: 'available', logicalCpuCount: 4, processes: [collectedProcess(10, 1, 'first-root', 1, 100)] },
            { status: 'available', logicalCpuCount: 4, processes: [collectedProcess(10, 1, 'reused-root', 0.1, 200)] }
        ]);
        const times = [0, 1_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 1_000 });

        await sampler.sample();
        expect(await sampler.sample()).toEqual({
            status: 'unavailable',
            rootPid: 10,
            sampledAtMs: 1_000,
            reason: 'registered root process 10 changed identity'
        });
    });

    test('reports collector failures explicitly and resets the CPU baseline', async () => {
        const collector = new SnapshotCollector([
            { status: 'available', logicalCpuCount: 2, processes: [collectedProcess(10, 1, 'root', 1, 100)] },
            { status: 'unavailable', reason: 'permission denied' },
            { status: 'available', logicalCpuCount: 2, processes: [collectedProcess(10, 1, 'root', 3, 100)] }
        ]);
        const times = [0, 1_000, 2_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 2_000 });

        await sampler.sample();
        expect(await sampler.sample()).toEqual({
            status: 'unavailable',
            rootPid: 10,
            sampledAtMs: 1_000,
            reason: 'permission denied'
        });
        expect(await sampler.sample()).toMatchObject({ status: 'available', cpuStatus: 'warming-up' });
    });

    test('keeps CPU available when memory for a live process is unavailable', async () => {
        const collector = new SnapshotCollector([
            {
                status: 'available',
                logicalCpuCount: 4,
                processes: [collectedProcess(10, 1, 'root', 1, null)]
            },
            {
                status: 'available',
                logicalCpuCount: 4,
                processes: [collectedProcess(10, 1, 'root', 1.5, null)]
            }
        ]);
        const times = [0, 1_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 1_000 });

        await sampler.sample();
        const sample = await sampler.sample();
        expect(sample).toMatchObject({
            status: 'available',
            cpuStatus: 'available',
            cpuCores: 0.5,
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableProcessCount: 1
        });
    });

    test('keeps real RAM available when CPU conversion is unavailable', async () => {
        const collector = new SnapshotCollector([{
            status: 'available',
            logicalCpuCount: null,
            cpuUnavailableReason: 'could not determine Linux clock ticks per second',
            processes: [collectedProcess(10, 1, 'root', 1, 512, 'pss')]
        }]);
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => 1_000 });

        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            cpuStatus: 'unavailable',
            cpuCores: null,
            cpuPercent: null,
            cpuUnavailableReason: 'could not determine Linux clock ticks per second',
            memoryBytes: 512,
            memorySource: 'pss',
            memoryUnavailableProcessCount: 0
        });
    });

    test('rejects invalid memory numerics instead of publishing them', async () => {
        const collector = new SnapshotCollector([{
            status: 'available',
            logicalCpuCount: 4,
            processes: [collectedProcess(10, 1, 'root', 1, Number.NaN, 'pss')]
        }]);
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => 1_000 });

        expect(await sampler.sample()).toMatchObject({
            status: 'available',
            memoryBytes: null,
            memorySource: 'unavailable',
            memoryUnavailableProcessCount: 1
        });
    });

    test('serializes concurrent samples before taking timestamps or updating the CPU baseline', async () => {
        let calls = 0;
        let markFirstStarted: () => void = () => {};
        let releaseFirst: () => void = () => {};
        const firstStarted = new Promise<void>(resolve => {
            markFirstStarted = resolve;
        });
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const collector: ProcessCollector = {
            collect: async () => {
                const call = ++calls;
                if (call === 1) {
                    markFirstStarted();
                    await firstGate;
                }
                return {
                    status: 'available',
                    logicalCpuCount: 2,
                    processes: [collectedProcess(10, 1, 'root', call, 100)]
                };
            }
        };
        const times = [1_000, 2_000];
        const sampler = new ProcessResourceSampler({ rootPid: 10, collector, now: () => times.shift() ?? 2_000 });

        const firstPromise = sampler.sample();
        await firstStarted;
        const secondPromise = sampler.sample();
        await Promise.resolve();
        expect(calls).toBe(1);

        releaseFirst();
        const [first, second] = await Promise.all([firstPromise, secondPromise]);
        expect(first).toMatchObject({ sampledAtMs: 1_000, cpuStatus: 'warming-up' });
        expect(second).toMatchObject({ sampledAtMs: 2_000, cpuStatus: 'available', cpuCores: 1 });
        expect(calls).toBe(2);
    });

    test('reports unsupported platforms explicitly', async () => {
        const collector = createPlatformProcessCollector({ platform: 'plan9' });
        await expect(collector.collect(10)).resolves.toEqual({
            status: 'unavailable',
            reason: 'process resource collection is unavailable on plan9'
        });
    });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function procStat(pid: number, parentPid: number, userTicks: number, systemTicks: number, startTicks: number): string {
    const fields = [String(pid), `(process ${pid})`, 'S', String(parentPid), ...Array<string>(9).fill('0'), String(userTicks), String(systemTicks), '0', '0', '0', '0', '1', '0', String(startTicks), '0', '0'];
    return fields.join(' ');
}

async function fakeProcess(procRoot: string, pid: number, parentPid: number, userTicks: number, systemTicks: number, startTicks: number, memory: { pssKilobytes?: number; rssKilobytes?: number }): Promise<void> {
    const path = join(procRoot, String(pid));
    await mkdir(path);
    await writeFile(join(path, 'stat'), procStat(pid, parentPid, userTicks, systemTicks, startTicks));
    if (memory.pssKilobytes !== undefined) {
        await writeFile(join(path, 'smaps_rollup'), `Pss: ${memory.pssKilobytes} kB\n`);
    }
    if (memory.rssKilobytes !== undefined) {
        await writeFile(join(path, 'status'), `Name:\tprocess-${pid}\nVmRSS:\t${memory.rssKilobytes} kB\n`);
    }
}

function readProcFileWithExit(processDir: string): (path: string) => Promise<string> {
    const pssPath = join(processDir, 'smaps_rollup');
    let exitPending = true;
    return async path => {
        if (path === pssPath && exitPending) {
            exitPending = false;
            await rm(processDir, { recursive: true, force: true });
        }
        return readFile(path, 'utf8');
    };
}

describe('LinuxProcCollector', () => {
    test('reads only PSS and excludes processes outside the root tree', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        await fakeProcess(procRoot, 101, 100, 25, 25, 1_100, { pssKilobytes: 200 });
        await fakeProcess(procRoot, 102, 1, 9_999, 9_999, 1_200, { pssKilobytes: 9_999 });

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection.processes.map(process => process.pid).sort()).toEqual([100, 101]);
        expect(collection.processes.find(process => process.pid === 100)).toMatchObject({
            cpuSeconds: 1.5,
            memoryBytes: 100 * 1024,
            memorySource: 'pss'
        });
        expect(collection.processes.find(process => process.pid === 101)).toMatchObject({
            cpuSeconds: 0.5,
            memoryBytes: 200 * 1024,
            memorySource: 'pss'
        });
    });

    test('preserves a live process with unreadable PSS as memory unavailable and never falls back to VmRSS', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-live-unreadable-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        await fakeProcess(procRoot, 101, 100, 25, 25, 1_100, { rssKilobytes: 200 });

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection.processes.map(process => process.pid).sort()).toEqual([100, 101]);
        expect(collection.processes.find(process => process.pid === 101)).toMatchObject({
            cpuSeconds: 0.5,
            memoryBytes: null,
            memorySource: null
        });
    });

    test('still collects PSS when Linux CPU conversion is unavailable', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-no-clktck-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });

        const collector = new LinuxProcCollector({
            procRoot,
            logicalCpuCount: 4,
            commandRunner: async () => {
                throw new Error('getconf failed');
            }
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection).toMatchObject({
            logicalCpuCount: 4,
            cpuUnavailableReason: 'could not determine Linux clock ticks per second'
        });
        expect(collection.processes).toEqual([
            expect.objectContaining({
                pid: 100,
                cpuSeconds: null,
                memoryBytes: 100 * 1024,
                memorySource: 'pss'
            })
        ]);
    });

    test('retains an exited non-root tree node as unknown instead of undercounting RAM', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-exit-race-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        await fakeProcess(procRoot, 101, 100, 25, 25, 1_100, { pssKilobytes: 200 });

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: readProcFileWithExit(join(procRoot, '101'))
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection.processes.map(process => process.pid)).toEqual([100, 101]);
        expect(collection.processes[0]).toMatchObject({ memoryBytes: 100 * 1024, memorySource: 'pss' });
        expect(collection.processes[1]).toMatchObject({ memoryBytes: null, memorySource: null });
    });

    test('retains live descendants when an intermediate process exits during memory reads', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-intermediate-exit-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        await fakeProcess(procRoot, 101, 100, 25, 25, 1_100, { pssKilobytes: 200 });
        await fakeProcess(procRoot, 102, 101, 10, 10, 1_200, { pssKilobytes: 300 });

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: readProcFileWithExit(join(procRoot, '101'))
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection.processes.map(process => process.pid)).toEqual([100, 101, 102]);
        expect(collection.processes[1]).toMatchObject({ memoryBytes: null, memorySource: null });
        expect(collection.processes[2]).toMatchObject({ memoryBytes: 300 * 1024, memorySource: 'pss' });
    });

    test('retains a reused non-root tree node as unknown instead of counting the replacement', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-reuse-race-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        await fakeProcess(procRoot, 101, 100, 25, 25, 1_100, { pssKilobytes: 200 });
        const childStatPath = join(procRoot, '101', 'stat');
        const childPssPath = join(procRoot, '101', 'smaps_rollup');
        let reuseChild = true;

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: async path => {
                if (path === childPssPath && reuseChild) {
                    reuseChild = false;
                    await writeFile(childStatPath, procStat(101, 1, 0, 0, 9_999));
                    await rm(childPssPath);
                }
                return readFile(path, 'utf8');
            }
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('available');
        if (collection.status !== 'available') return;
        expect(collection.processes.map(process => process.pid)).toEqual([100, 101]);
        expect(collection.processes[1]).toMatchObject({ memoryBytes: null, memorySource: null });
    });

    test('makes the collection unavailable when the root disappears during its PSS read', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-root-exit-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: readProcFileWithExit(join(procRoot, '100'))
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('unavailable');
        if (collection.status !== 'unavailable') return;
        expect(collection.reason).toContain('root process 100 disappeared while reading memory');
    });

    test('makes the collection unavailable when the root PID is reused during its PSS read', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-root-reuse-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        const rootStatPath = join(procRoot, '100', 'stat');
        const rootPssPath = join(procRoot, '100', 'smaps_rollup');
        let reuseRoot = true;

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: async path => {
                if (path === rootPssPath && reuseRoot) {
                    reuseRoot = false;
                    await writeFile(rootStatPath, procStat(100, 1, 0, 0, 9_999));
                    await rm(rootPssPath);
                }
                return readFile(path, 'utf8');
            }
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('unavailable');
        if (collection.status !== 'unavailable') return;
        expect(collection.reason).toContain('root process 100 changed identity while reading memory');
    });

    test('rejects root PID reuse even when the PSS read itself succeeds', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-root-reuse-readable-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 100, 50, 1_000, { pssKilobytes: 100 });
        const rootStatPath = join(procRoot, '100', 'stat');
        const rootPssPath = join(procRoot, '100', 'smaps_rollup');
        let reuseRoot = true;

        const collector = new LinuxProcCollector({
            procRoot,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4,
            readProcFile: async path => {
                const contents = await readFile(path, 'utf8');
                if (path === rootPssPath && reuseRoot) {
                    reuseRoot = false;
                    await writeFile(rootStatPath, procStat(100, 1, 0, 0, 9_999));
                }
                return contents;
            }
        });
        const collection = await collector.collect(100);

        expect(collection.status).toBe('unavailable');
        if (collection.status !== 'unavailable') return;
        expect(collection.reason).toContain('root process 100 changed identity while reading memory');
    });

    test('rejects a root owned by a different uid', async () => {
        const procRoot = await mkdtemp(join(tmpdir(), 'rs2b0t-proc-owner-'));
        temporaryDirectories.push(procRoot);
        await fakeProcess(procRoot, 100, 1, 0, 0, 1_000, { pssKilobytes: 1 });
        const currentUid = typeof process.getuid === 'function' ? process.getuid() : 0;
        const collector = new LinuxProcCollector({
            procRoot,
            expectedUid: currentUid + 1,
            clockTicksPerSecond: 100,
            logicalCpuCount: 4
        });

        const collection = await collector.collect(100);
        expect(collection.status).toBe('unavailable');
        if (collection.status !== 'unavailable') return;
        expect(collection.reason).toContain('owned by uid');
    });
});
