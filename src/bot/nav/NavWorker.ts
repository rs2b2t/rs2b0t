import { gunzipSync } from 'fflate';

import doors from './data/doors.json';
import transports from './data/transports.json';
import stairs from './data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavRequest, type NavResponse } from './PathFinder.js';

type WorkerScope = {
    postMessage(message: NavResponse, transfer?: Transferable[]): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<NavRequest>) => void): void;
};

const worker = self as unknown as WorkerScope;

let finder: PathFinder | null = null;

function init(pack: ArrayBuffer): void {
    let bytes: Uint8Array = new Uint8Array(pack);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }

    finder = new PathFinder(bytes);
    finder.addEdges(doors as DoorEdgeData[], transports, stairs);
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
            const outcome = finder.findPath(message.from, message.to, avoid, message.maxExpansions);
            worker.postMessage({ type: 'path', id: message.id, elapsedMs: performance.now() - started, ...outcome });
        }
    } catch (err) {
        worker.postMessage({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    }
});
