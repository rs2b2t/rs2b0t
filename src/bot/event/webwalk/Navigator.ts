import { NavWorkerClient, type FindPathOpts, type NavPoolHost, type PathResult } from './NavWorkerClient.js';
import type { NavPoint } from './PathFinder.js';
import { snapshotWorldStateData } from './worldStateLive.js';

export type { PathResult } from './NavWorkerClient.js';

class NavigatorImpl {
    private client?: NavWorkerClient;
    private pool?: NavPoolHost;
    readonly timings: number[] = [];

    get mapsquares(): number { return this.client?.mapsquares ?? 0; }
    get doorEdges(): number { return this.client?.doorEdges ?? 0; }
    get transportEdges(): number { return this.client?.transportEdges ?? 0; }

    useWorkerPool(host: NavPoolHost): void {
        this.pool = host;
    }

    private workerClient(): NavWorkerClient {
        return this.client ??= this.pool?.__rs2b0tAcquireNavigator?.() ?? new NavWorkerClient();
    }

    isReady(): boolean {
        return this.client?.isReady() ?? false;
    }

    start(): void {
        this.workerClient().start();
    }

    async findPath(from: NavPoint, to: NavPoint, opts?: FindPathOpts): Promise<PathResult> {
        const client = this.workerClient();
        const result = await client.findPath(from, to, { ...opts, state: opts?.state ?? snapshotWorldStateData() });
        if (result.elapsedMs !== undefined) this.timings.push(result.elapsedMs);
        return result;
    }
}

export const Navigator = new NavigatorImpl();
