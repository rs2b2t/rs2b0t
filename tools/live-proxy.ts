import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CgroupResourceSampler, resolveDedicatedCgroupDir } from './lib/CgroupResourceSampler.js';
import { ProcessResourceSampler } from './lib/ProcessResourceSampler.js';
import { payloadByteLength, ProxyTrafficCounter } from './lib/ProxyTrafficCounter.js';
import { processResourcePayload, unavailableResourcePayload } from './lib/ResourcePayload.js';

const PORT = Number(process.env.PORT ?? 8081);
const LIVE_HOST = process.env.LIVE_HOST ?? 'w1.rs2b2t.com';
const LIVE_HTTP = `https://${LIVE_HOST}`;
const LIVE_WS = `wss://${LIVE_HOST}/`;

const REPO = join(import.meta.dir, '..');
const OUT = join(REPO, 'out');
const BOT_HTML = join(REPO, 'public-bot', 'bot.html');
const MULTIBOX_HTML = join(REPO, 'public-bot', 'multibox.html');
const SOUNDFONT = process.env.SOUNDFONT ?? join(homedir(), 'code/rs2b2t-engine/public/bot/SCC1_Florestan.sf2');
const RESOURCE_PID_FILE = process.env.B0T_RESOURCE_PID_FILE ?? '';
const RESOURCE_PID = process.env.B0T_RESOURCE_PID ?? '';

let resourceRootPid: number | null = null;
let resourceSampler: CgroupResourceSampler | ProcessResourceSampler | null = null;
const trafficCounter = new ProxyTrafficCounter();

if (!existsSync(join(OUT, 'botclient.js'))) {
    console.error('No out/botclient.js. Build first: TARGET=live LIVE_RSAN=<modulus> bun run build:bot');
    process.exit(1);
}
const bundleSrc = await Bun.file(join(OUT, 'botclient.js')).text();
if (!bundleSrc.includes(LIVE_HOST)) {
    console.error(`out/botclient.js does not target ${LIVE_HOST} — did you build with TARGET=live? Aborting.`);
    process.exit(1);
}
if (!existsSync(join(OUT, 'collision.lcnav.gz'))) {
    console.error('No out/collision.lcnav.gz — the nav worker\'s collision pack is missing (a fresh checkout/worktree won\'t have it). Build it: bun tools/nav/build-collision.ts --engine ~/code/rs2b2t-engine');
    process.exit(1);
}

function localBotAsset(pathname: string): string | null {
    const name = pathname.slice('/bot/'.length);
    if (name === 'SCC1_Florestan.sf2') return existsSync(SOUNDFONT) ? SOUNDFONT : null;
    const p = join(OUT, name);
    return existsSync(p) ? p : null;
}

// Cross-origin isolation is what lets every bot's nav worker map one shared
// copy of the collision pack instead of decompressing its own 12 MB.
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
        // Registration is authoritative. Forget the sampler as soon as the
        // viewer disappears so reusing the same PID starts a fresh CPU window.
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
    live: WebSocket | null;
    buf: (string | ArrayBufferView)[];
    ready: boolean;
}

const server = Bun.serve({
    port: PORT,
    idleTimeout: 0,
    async fetch(req, srv) {
        const url = new URL(req.url);

        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const data: WsData = { live: null, buf: [], ready: false };
            if (srv.upgrade(req, { data })) return undefined;
            return new Response('ws upgrade failed', { status: 400 });
        }

        const path = url.pathname === '/' ? '/multibox.html' : url.pathname;

        if (path === '/__rs2b0t/resources') return resourceResponse();
        if (path === '/multibox.html') return localFile(MULTIBOX_HTML, true);
        if (path === '/bot.html') return localFile(BOT_HTML, true);
        if (path.startsWith('/bot/')) {
            const f = localBotAsset(path);
            const executableAsset = /\.(?:js|wasm)(?:\.map)?$/.test(path);
            return f ? localFile(f, executableAsset) : new Response('not found', { status: 404 });
        }

        const requestBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
        const upstream = await fetch(LIVE_HTTP + url.pathname + url.search, {
            method: req.method,
            headers: { accept: req.headers.get('accept') ?? '*/*' },
            body: requestBody
        });
        if (requestBody !== undefined) {
            trafficCounter.addSent(requestBody.byteLength);
        }
        const responseBody = upstream.body === null ? null : trafficCounter.countStream(upstream.body, 'received');
        return new Response(responseBody, {
            status: upstream.status,
            headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' }
        });
    },
    websocket: {
        open(ws) {
            const d = ws.data as unknown as WsData;
            const live = new WebSocket(LIVE_WS);
            live.binaryType = 'arraybuffer';
            d.live = live;
            live.onopen = () => {
                d.ready = true;
                for (const m of d.buf) {
                    live.send(m);
                    trafficCounter.addSent(payloadByteLength(m));
                }
                d.buf = [];
            };
            live.onmessage = e => {
                const message = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data as string;
                trafficCounter.addReceived(payloadByteLength(message));
                ws.send(message);
            };
            live.onclose = () => { try { ws.close(); } catch { /* already closed */ } };
            live.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
        },
        message(ws, message) {
            const d = ws.data as unknown as WsData;
            if (d.ready && d.live) {
                d.live.send(message);
                trafficCounter.addSent(payloadByteLength(message));
            } else {
                d.buf.push(message);
            }
        },
        close(ws) {
            const d = ws.data as unknown as WsData;
            try { d.live?.close(); } catch { /* already closed */ }
        }
    }
});

console.log(`live-proxy: http://localhost:${server.port}/  ->  ${LIVE_HOST}`);
console.log(`(serving local live build from out/; forwarding /crc + cache WS to ${LIVE_HOST})`);
console.log('Log in with a REGISTERED rs2b2t account.');
