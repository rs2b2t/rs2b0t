// docs/reference/nav-pack.md
import { gunzipSync } from 'fflate';

import { PathFinder, type NavRequest, type NavResponse } from './PathFinder.js';
import { loadDefaultNavEdges } from './loadTransportGraph.js';

type WorkerScope = {
    postMessage(message: NavResponse, transfer?: Transferable[]): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<NavRequest>) => void): void;
};

const worker = self as unknown as WorkerScope;

let finder: PathFinder | null = null;

function init(pack: ArrayBufferLike): void {
    // Shared packs arrive already decompressed; a transferred one is still gzip.
    let bytes: Uint8Array = new Uint8Array(pack);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }

    finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    worker.postMessage({ type: 'ready', mapsquares: finder.mapsquares, doorEdges: finder.doorEdges, transportEdges: finder.transportEdges });
}

worker.addEventListener('message', event => {
    const message = event.data;
    try {
        if (message.type === 'init') {
            init(message.pack);
        } else if (message.type === 'path') {
            if (!finder) {
                worker.postMessage({ type: 'path', id: message.id, ok: false, reason: 'worker not initialized', expanded: 0, elapsedMs: 0 });
                return;
            }
            const started = performance.now();
            const avoid = message.avoid ? new Set(message.avoid.map(d => `${d.x}|${d.z}`)) : undefined;
            const outcome = finder.findPath(message.from, message.to, {
                avoidDoors: avoid,
                maxExpansions: message.maxExpansions,
                state: message.state,
                policy: message.policy,
                useTeleportCatalog: message.useTeleportCatalog,
                avoidZones: message.avoidZones
            });
            if (message.useTeleportCatalog) {
                const teleHops = outcome.ok ? outcome.hops.filter(h => h.kind === 'teleport').length : 0;
                console.log(
                    `[nav worker] teleCatalog=${message.useTeleportCatalog} policy=${JSON.stringify(message.policy)} ok=${outcome.ok} cost=${outcome.ok ? outcome.cost : '-'} teleHops=${teleHops} law=${message.state?.items?.['Law rune'] ?? '?'}`
                );
            }
            worker.postMessage({ type: 'path', id: message.id, elapsedMs: performance.now() - started, ...outcome });
        }
    } catch (err) {
        worker.postMessage({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    }
});
