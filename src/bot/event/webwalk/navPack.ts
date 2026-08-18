import { gunzipSync } from 'fflate';

const HOST_KEY = '__rs2b0tNavPack';

type PackHost = { [HOST_KEY]?: Promise<SharedArrayBuffer | null> };

let host: PackHost | null = null;

/** Passed in by the entrypoint so this layer keeps no DOM globals and still runs headless. */
export function setNavPackHost(page: object): void {
    host = page as PackHost;
}

/** Workers only read the 12 MB pack, and a private copy each costs ~600 MB at 50 bots. */
export async function navPackForWorker(packUrl: URL): Promise<{ pack: ArrayBufferLike; transfer: Transferable[] }> {
    const shared = await sharedPack(packUrl);
    if (shared) {
        return { pack: shared, transfer: [] };
    }
    const pack = await fetchPack(packUrl);
    return { pack, transfer: [pack] };
}

function sharedPack(packUrl: URL): Promise<SharedArrayBuffer | null> {
    if (!host) {
        console.warn('[rs2b0t] nav pack NOT shared: no page registered, so every bot holds its own 12 MB copy. The entrypoint must call setNavPackHost.');
        return Promise.resolve(null);
    }
    return (host[HOST_KEY] ??= decompressShared(packUrl));
}

async function decompressShared(packUrl: URL): Promise<SharedArrayBuffer | null> {
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        console.warn(
            '[rs2b0t] nav pack NOT shared: this page is not cross-origin isolated, so every bot holds its own 12 MB copy. ' +
                'Serve it with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.'
        );
        return null;
    }
    const bytes = gunzipSync(new Uint8Array(await fetchPack(packUrl)));
    const shared = new SharedArrayBuffer(bytes.byteLength);
    new Uint8Array(shared).set(bytes);
    console.log(`[rs2b0t] nav pack shared across bots: ${(shared.byteLength / 1048576).toFixed(1)} MB, decompressed once`);
    return shared;
}

async function fetchPack(packUrl: URL): Promise<ArrayBuffer> {
    const res = await fetch(packUrl);
    if (!res.ok) {
        throw new Error(`collision pack fetch failed: HTTP ${res.status}`);
    }
    return res.arrayBuffer();
}
