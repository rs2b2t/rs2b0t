// Local relay for running the MultiBox wall against LIVE rs2b2t.
//
// The client always talks to whatever origin served its page (its game +
// on-demand WebSockets both open `ws(s)://<window.location.host>` at the root).
// So to play on rs2b2t with a client that is NOT hosted on rs2b2t's site, we
// serve YOUR built client from local disk and forward that root WebSocket to
// the live server. Your client stays 100% local; rs2b2t only ever sees a normal
// client WebSocket from this machine (already the whitelisted IP).
//
// Serves:  / , /multibox.html -> public-bot/multibox.html
//          /bot.html                -> public-bot/bot.html
//          /bot/<file>              -> out/<file>
// Upgrades any WebSocket (subprotocol "binary") to ${UPSTREAM}.
//
// Run: bun tools/rs2b2t-relay.ts     (env: RELAY_PORT, RS2B2T_WS, RELAY_VERBOSE=1)
import { file, serve } from 'bun';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${ROOT}/out`;
const PUBLIC_BOT = `${ROOT}/public-bot`;

const PORT = Number(process.env.RELAY_PORT ?? 8899);
const UPSTREAM = process.env.RS2B2T_WS ?? 'wss://w1.rs2b2t.com';
const UPSTREAM_ORIGIN = new URL(UPSTREAM.replace(/^ws/, 'http')).origin;
const VERBOSE = process.env.RELAY_VERBOSE === '1';

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.gz': 'application/gzip',
    '.sf2': 'application/octet-stream'
};

function localFile(pathname: string): string | null {
    if (pathname === '/' || pathname === '/multibox.html') return `${PUBLIC_BOT}/multibox.html`;
    if (pathname === '/bot.html') return `${PUBLIC_BOT}/bot.html`;
    if (pathname.startsWith('/bot/')) return `${OUT}/${pathname.slice('/bot/'.length)}`;
    return null;
}

interface SocketState {
    up: WebSocket | null;
    pending: (string | ArrayBufferLike | Uint8Array)[];
}

const server = serve<SocketState, undefined>({
    port: PORT,
    async fetch(req, srv) {
        const url = new URL(req.url);

        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            const proto = req.headers.get('sec-websocket-protocol');
            const ok = srv.upgrade(req, {
                data: { up: null, pending: [] },
                headers: proto ? { 'Sec-WebSocket-Protocol': proto.split(',')[0].trim() } : undefined
            });
            if (VERBOSE) console.log(`[ws-upgrade] ${url.pathname} proto=${proto ?? '-'} ok=${ok}`);
            return ok ? undefined : new Response('websocket upgrade failed', { status: 400 });
        }

        const path = localFile(url.pathname);
        if (path) {
            const f = file(path);
            if (await f.exists()) {
                const ext = path.slice(path.lastIndexOf('.'));
                if (VERBOSE) console.log(`[local] ${url.pathname}`);
                return new Response(f, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } });
            }
        }

        // Not one of your local client files -> forward to rs2b2t. The client
        // fetches server-owned endpoints over HTTP too (notably /crc, the cache
        // checksum table at Client.ts:705); those must come from the real
        // server. Your client code stays local; only game-server traffic goes up.
        const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;
        if (VERBOSE) console.log(`[proxy] ${url.pathname} -> rs2b2t`);
        try {
            const upstream = await fetch(upstreamUrl, {
                method: req.method,
                body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
                redirect: 'manual'
            });
            return new Response(await upstream.arrayBuffer(), {
                status: upstream.status,
                headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' }
            });
        } catch (err) {
            console.log(`[proxy] ${url.pathname} failed:`, err);
            return new Response('upstream error', { status: 502 });
        }
    },
    websocket: {
        open(ws) {
            if (VERBOSE) console.log('[ws] client connected -> dialing rs2b2t');
            let up: WebSocket;
            try {
                up = new WebSocket(UPSTREAM, { protocols: ['binary'], headers: { origin: UPSTREAM_ORIGIN } } as unknown as string[]);
            } catch (err) {
                console.log('[ws] upstream dial threw:', err);
                ws.close();
                return;
            }
            up.binaryType = 'arraybuffer';
            ws.data.up = up;

            up.onopen = (): void => {
                if (VERBOSE) console.log('[ws] upstream OPEN');
                for (const m of ws.data.pending) up.send(m);
                ws.data.pending = [];
            };
            up.onmessage = (e: MessageEvent): void => {
                ws.send(e.data as ArrayBuffer); // rs2b2t -> client
            };
            up.onclose = (e: CloseEvent): void => {
                if (VERBOSE) console.log(`[ws] upstream CLOSED code=${e.code} reason="${e.reason}"`);
                try { ws.close(); } catch { /* already gone */ }
            };
            up.onerror = (): void => {
                console.log('[ws] upstream ERROR');
                try { ws.close(); } catch { /* already gone */ }
            };
        },
        message(ws, msg) {
            const up = ws.data.up;
            if (up && up.readyState === WebSocket.OPEN) up.send(msg);
            else ws.data.pending.push(msg);
        },
        close(ws) {
            try { ws.data.up?.close(); } catch { /* already gone */ }
        }
    }
});

console.log(`rs2b2t relay listening: http://localhost:${server.port}  ->  ${UPSTREAM}`);
console.log(`  wall:  http://localhost:${server.port}/multibox.html`);
