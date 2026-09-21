import { existsSync } from 'fs';
import { createHash } from 'node:crypto';
import type { WorldNumber } from '../src/client/config/worlds.js';
import { join } from 'path';
import { homedir } from 'os';
import { CgroupResourceSampler, resolveDedicatedCgroupDir } from './lib/CgroupResourceSampler.js';
import { ProcessResourceSampler } from './lib/ProcessResourceSampler.js';
import { payloadByteLength, ProxyTrafficCounter } from './lib/ProxyTrafficCounter.js';
import { processResourcePayload, unavailableResourcePayload } from './lib/ResourcePayload.js';

export interface LiveProxyOptions {
    port?: number;
    root?: string;
    defaultWorld?: WorldNumber;
    upstreams?: Record<WorldNumber, string>;
}

export async function startLiveProxy(options: LiveProxyOptions = {}) {
    const PORT = options.port ?? Number(process.env.PORT ?? 8081);
    const liveHost = process.env.LIVE_HOST ?? 'w1.rs2b2t.com';
    if (!['w1.rs2b2t.com', 'w2.rs2b2t.com'].includes(liveHost)) throw new Error('LIVE_HOST must be an official W1 or W2 host');
    const defaultWorld = options.defaultWorld ?? (liveHost === 'w2.rs2b2t.com' ? 2 : 1);
    const upstreams = options.upstreams ?? { 1: 'https://w1.rs2b2t.com', 2: 'https://w2.rs2b2t.com' };
    const REPO = options.root ?? join(import.meta.dir, '..');
    const OUT = join(REPO, 'out');
    const BOT_HTML = join(REPO, 'public-bot', 'bot.html');
    const MULTIBOX_HTML = join(REPO, 'public-bot', 'multibox.html');
    const SOUNDFONT = process.env.SOUNDFONT ?? join(homedir(), 'code/rs2b2t-engine/public/bot/SCC1_Florestan.sf2');
    const RESOURCE_PID_FILE = process.env.B0T_RESOURCE_PID_FILE ?? '';
    const RESOURCE_PID = process.env.B0T_RESOURCE_PID ?? '';

    let resourceRootPid: number | null = null;
    let resourceSampler: CgroupResourceSampler | ProcessResourceSampler | null = null;
    const trafficCounter = new ProxyTrafficCounter();

    const metadataFile = Bun.file(join(OUT, 'target.json'));
    if (!(await metadataFile.exists()) || !existsSync(join(OUT, 'botclient.js'))) {
        throw new Error('Missing proxy build metadata. Build with TARGET=proxy LIVE_RSAN=<modulus> bun run build:bot');
    }
    const metadata = await metadataFile.json();
    const bundleHash = createHash('sha256')
        .update(new Uint8Array(await Bun.file(join(OUT, 'botclient.js')).arrayBuffer()))
        .digest('hex');
    if (metadata.target !== 'proxy' || metadata.worldRouting !== 1 || metadata.botclientSha256 !== bundleHash) {
        throw new Error('Stale proxy build metadata. Rebuild with TARGET=proxy LIVE_RSAN=<modulus> bun run build:bot');
    }
    if (!existsSync(join(OUT, 'collision.lcnav.gz'))) {
        throw new Error("No out/collision.lcnav.gz — the nav worker's collision pack is missing (a fresh checkout/worktree won't have it). Build it: bun tools/nav/build-collision.ts --engine ~/code/rs2b2t-engine");
    }

    function localBotAsset(pathname: string): string | null {
        const name = pathname.slice('/bot/'.length);
        if (name === 'SCC1_Florestan.sf2') return existsSync(SOUNDFONT) ? SOUNDFONT : null;
        const p = join(OUT, name);
        return existsSync(p) ? p : null;
    }

    // Cross-origin isolation lets every bot's nav worker share one copy of the collision pack instead of decompressing its own 12 MB.
    const ISOLATION_HEADERS: Record<string, string> = {
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp'
    };

    function localFile(path: string, noStore = false): Response {
        const headers = { ...ISOLATION_HEADERS };
        if (noStore) {
            headers['cache-control'] = 'no-store';
        }
        return new Response(Bun.file(path), { headers });
    }

    function json(body: unknown, status = 200): Response {
        return Response.json(body, {
            status,
            headers: { 'cache-control': 'no-store' }
        });
    }

    async function configuredResourcePid(): Promise<number | null> {
        let raw: string;
        if (RESOURCE_PID_FILE !== '') {
            try {
                raw = await Bun.file(RESOURCE_PID_FILE).text();
            } catch {
                return null;
            }
        } else {
            raw = RESOURCE_PID;
        }
        const pid = Number(raw.trim());
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }

    async function resourceResponse(): Promise<Response> {
        const pid = await configuredResourcePid();
        if (pid === null) {
            // Forget the sampler when the viewer goes away, so a reused PID starts a fresh CPU window.
            resourceRootPid = null;
            resourceSampler = null;
            return json(unavailableResourcePayload('no dedicated bot browser is registered', trafficCounter.snapshot()));
        }
        if (pid !== resourceRootPid || resourceSampler === null) {
            if (process.platform === 'linux') {
                const cgroup = await resolveDedicatedCgroupDir(pid);
                if (cgroup.status === 'unavailable') {
                    resourceRootPid = null;
                    resourceSampler = null;
                    return json(unavailableResourcePayload(cgroup.reason, trafficCounter.snapshot()));
                }
                resourceSampler = new CgroupResourceSampler({ rootPid: pid, cgroupDir: cgroup.cgroupDir });
            } else {
                resourceSampler = new ProcessResourceSampler({ rootPid: pid });
            }
            resourceRootPid = pid;
        }

        return json(processResourcePayload(await resourceSampler.sample(), trafficCounter.snapshot()));
    }

    interface WsData {
        upstream: string;
        live: WebSocket | null;
        buf: (string | ArrayBufferView)[];
        ready: boolean;
        closed: boolean;
    }

    const server = Bun.serve<WsData, Record<string, never>>({
        hostname: '127.0.0.1',
        port: PORT,
        idleTimeout: 0,
        async fetch(req, srv) {
            const url = new URL(req.url);

            const prefixed = /^\/__rs2b0t\/world\/([12])(?:(\/.*)|$)/.exec(url.pathname);
            const world = prefixed ? (Number(prefixed[1]) as WorldNumber) : defaultWorld;
            const gamePath = prefixed ? prefixed[2] || '/' : url.pathname;
            const reserved = url.pathname.startsWith('/__rs2b0t/world');
            if (reserved && !prefixed) return new Response('not found', { status: 404 });
            if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
                if (gamePath !== '/') return new Response('not found', { status: 404 });
                const data: WsData = { live: null, buf: [], ready: false, closed: false, upstream: upstreams[world].replace(/^http/, 'ws') + '/' };
                if (srv.upgrade(req, { data })) return undefined;
                return new Response('ws upgrade failed', { status: 400 });
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });

            const path = url.pathname === '/' ? '/multibox.html' : url.pathname;

            if (path === '/__rs2b0t/resources') return resourceResponse();
            if (path === '/multibox.html') return localFile(MULTIBOX_HTML, true);
            if (path === '/bot.html') return localFile(BOT_HTML, true);
            if (path.startsWith('/bot/')) {
                const f = localBotAsset(path);
                const executableAsset = /\.(?:js|wasm)(?:\.map)?$/.test(path);
                return f ? localFile(f, executableAsset) : new Response('not found', { status: 404 });
            }

            if (!/^\/(?:crc(?:-?\d+)?|(?:title|config|interface|media|versionlist|textures|wordenc|sounds)-?\d+|loginkey|client\/client\.js)$/.test(gamePath)) {
                return new Response('not found', { status: 404 });
            }
            let upstream: Response;
            try {
                upstream = await fetch(upstreams[world] + gamePath + url.search, {
                    method: req.method,
                    headers: { accept: req.headers.get('accept') ?? '*/*' },
                    redirect: 'manual'
                });
            } catch {
                return new Response('world unavailable', { status: 502 });
            }
            const responseBody = upstream.body === null ? null : trafficCounter.countStream(upstream.body, 'received');
            return new Response(responseBody, {
                status: upstream.status,
                headers: { ...ISOLATION_HEADERS, 'cache-control': 'no-store', 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' }
            });
        },
        websocket: {
            open(ws) {
                const d = ws.data;
                const live = new WebSocket(d.upstream);
                live.binaryType = 'arraybuffer';
                d.live = live;
                live.onopen = () => {
                    if (d.closed) {
                        live.close();
                        return;
                    }
                    d.ready = true;
                    for (const m of d.buf) {
                        live.send(m);
                        trafficCounter.addSent(payloadByteLength(m));
                    }
                    d.buf = [];
                };
                live.onmessage = e => {
                    if (d.closed) return;
                    const message = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : (e.data as string);
                    trafficCounter.addReceived(payloadByteLength(message));
                    ws.send(message);
                };
                live.onclose = () => {
                    d.closed = true;
                    d.buf = [];
                    try {
                        ws.close();
                    } catch {
                        /* already closed */
                    }
                };
                live.onerror = () => {
                    d.closed = true;
                    d.buf = [];
                    try {
                        ws.close();
                    } catch {
                        /* already closed */
                    }
                };
            },
            message(ws, message) {
                const d = ws.data;
                if (d.closed) return;
                if (d.ready && d.live) {
                    d.live.send(message);
                    trafficCounter.addSent(payloadByteLength(message));
                } else {
                    d.buf.push(message);
                }
            },
            close(ws) {
                const d = ws.data;
                d.closed = true;
                d.ready = false;
                d.buf = [];
                try {
                    d.live?.close();
                } catch {
                    /* already closed */
                }
            }
        }
    });

    return server;
}

if (import.meta.main) {
    const server = await startLiveProxy();
    console.log(`live-proxy: http://localhost:${server.port}/multibox.html -> worlds 1 and 2`);
    console.log('Log in with a REGISTERED rs2b2t account.');
}
