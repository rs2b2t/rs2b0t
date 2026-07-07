// live-proxy — run the rs2b0t LIVE client from your dev machine against
// w1.rs2b2t.com without a prod deploy.
//
// Why this exists: the client fetches /crc over HTTP and streams its cache
// over a WebSocket, both from the page's serving ORIGIN (window.location).
// Live sends no CORS header on /crc, so a plain localhost page can't fetch it
// cross-origin. This proxy serves the local live build AND forwards /crc (and
// any other non-static path) + the cache WebSocket to live, so the browser
// only talks to localhost — no CORS. The GAME socket is baked to
// wss://w1.rs2b2t.com/ by TARGET=live and connects directly (WebSockets need
// no CORS and the engine has no WS origin check).
//
// Usage:
//   1. TARGET=live LIVE_RSAN=<prod-modulus> bun run build:bot
//   2. bun tools/live-proxy.ts            # then open http://localhost:8081/
//   Log in with a REGISTERED rs2b2t account (prod has registration on).
//
// Env: PORT (default 8081), LIVE_HOST (default w1.rs2b2t.com),
//      SOUNDFONT (path to SCC1_Florestan.sf2; default = local rs2b2t-engine).

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PORT = Number(process.env.PORT ?? 8081);
const LIVE_HOST = process.env.LIVE_HOST ?? 'w1.rs2b2t.com';
const LIVE_HTTP = `https://${LIVE_HOST}`;
const LIVE_WS = `wss://${LIVE_HOST}/`;

const REPO = join(import.meta.dir, '..');
const OUT = join(REPO, 'out');
const BOT_HTML = join(REPO, 'public-bot', 'bot.html');
const MULTIBOX_HTML = join(REPO, 'public-bot', 'multibox.html');
const SOUNDFONT = process.env.SOUNDFONT ?? join(homedir(), 'code/rs2b2t-engine/public/bot/SCC1_Florestan.sf2');

// Startup sanity: confirm out/botclient.js is a LIVE build (has the live host baked in).
if (!existsSync(join(OUT, 'botclient.js'))) {
    console.error(`No out/botclient.js. Build first: TARGET=live LIVE_RSAN=<modulus> bun run build:bot`);
    process.exit(1);
}
const bundleSrc = await Bun.file(join(OUT, 'botclient.js')).text();
if (!bundleSrc.includes(LIVE_HOST)) {
    console.error(`out/botclient.js does not target ${LIVE_HOST} — did you build with TARGET=live? Aborting.`);
    process.exit(1);
}

// Resolve a /bot/<file> request to a local file (our built bundle + soundfont).
function localBotAsset(pathname: string): string | null {
    const name = pathname.slice('/bot/'.length);
    if (name === 'SCC1_Florestan.sf2') return existsSync(SOUNDFONT) ? SOUNDFONT : null;
    const p = join(OUT, name);
    return existsSync(p) ? p : null;
}

// Per-connection state for a bridged WebSocket (the browser's cache socket → live).
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

        // Cache/ondemand WebSocket (client connects to window.location.host) -> bridge to live.
        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const data: WsData = { live: null, buf: [], ready: false };
            if (srv.upgrade(req, { data })) return undefined;
            return new Response('ws upgrade failed', { status: 400 });
        }

        // The wall is primary: `/` and /multibox.html serve the wall; /bot.html is a cell.
        const path = url.pathname === '/' ? '/multibox.html' : url.pathname;

        // Serve our local live build (never forward these to live's own client).
        if (path === '/multibox.html') return new Response(Bun.file(MULTIBOX_HTML));
        if (path === '/bot.html') return new Response(Bun.file(BOT_HTML));
        if (path.startsWith('/bot/')) {
            const f = localBotAsset(path);
            return f ? new Response(Bun.file(f)) : new Response('not found', { status: 404 });
        }

        // Everything else (/crc, config archives, etc.) -> forward to live (server-side, no CORS).
        const upstream = await fetch(LIVE_HTTP + url.pathname + url.search, {
            method: req.method,
            headers: { accept: req.headers.get('accept') ?? '*/*' },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
        });
        return new Response(upstream.body, {
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
                for (const m of d.buf) live.send(m);
                d.buf = [];
            };
            live.onmessage = (e) => ws.send(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data);
            live.onclose = () => { try { ws.close(); } catch { /* already closed */ } };
            live.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
        },
        message(ws, message) {
            const d = ws.data as unknown as WsData;
            if (d.ready && d.live) d.live.send(message);
            else d.buf.push(message);
        },
        close(ws) {
            const d = ws.data as unknown as WsData;
            try { d.live?.close(); } catch { /* already closed */ }
        }
    }
});

console.log(`live-proxy: http://localhost:${server.port}/  ->  ${LIVE_HOST}`);
console.log(`(serving local live build from out/; forwarding /crc + cache WS to ${LIVE_HOST})`);
console.log(`Log in with a REGISTERED rs2b2t account.`);
