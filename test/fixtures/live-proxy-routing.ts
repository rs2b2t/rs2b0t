import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveProxy } from '../../tools/live-proxy.js';

const cleanups: (() => void)[] = [];

function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'rs2b0t-routing-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'out'));
    mkdirSync(join(root, 'public-bot'));
    writeFileSync(join(root, 'out/botclient.js'), 'fixture bundle');
    writeFileSync(join(root, 'out/target.json'), JSON.stringify({ target: 'proxy', worldRouting: 1, botclientSha256: createHash('sha256').update('fixture bundle').digest('hex') }));
    writeFileSync(join(root, 'out/collision.lcnav.gz'), 'fixture collision');
    writeFileSync(join(root, 'public-bot/multibox.html'), 'one local wall');
    writeFileSync(join(root, 'public-bot/bot.html'), 'same-origin bot');
    return root;
}

async function routeTraffic() {
    const requests: string[] = [];
    function upstream(world: number) {
        const server = Bun.serve({
            port: 0,
            fetch(request, server) {
                const path = new URL(request.url).pathname;
                requests.push(`${world}:${path}`);
                if (request.headers.get('upgrade') === 'websocket' && server.upgrade(request)) return;
                return new Response(`${world}:${path}`);
            },
            websocket: {
                message(ws, data) {
                    ws.send(`${world}:${new Uint8Array(data as Buffer)[0]}`);
                }
            }
        });
        cleanups.push(() => server.stop(true));
        return `http://127.0.0.1:${server.port}`;
    }
    const proxy = await startLiveProxy({ port: 0, root: fixtureRoot(), upstreams: { 1: upstream(1), 2: upstream(2) } });
    cleanups.push(() => proxy.stop(true));
    const origin = `http://127.0.0.1:${proxy.port}`;
    assert.equal(await (await fetch(origin + '/multibox.html')).text(), 'one local wall');
    for (const world of [1, 2]) {
        for (const path of ['/crc', '/title-123', '/config456', '/versionlist0', '/loginkey', '/client/client.js']) {
            const response = await fetch(`${origin}/__rs2b0t/world/${world}${path}`);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), `${world}:${path}`);
        }
        for (const opcode of [14, 15]) {
            const reply = await new Promise<string>((resolve, reject) => {
                const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/__rs2b0t/world/${world}`, 'binary');
                ws.onopen = () => ws.send(new Uint8Array([opcode]));
                ws.onmessage = event => {
                    ws.close();
                    resolve(String(event.data));
                };
                ws.onerror = reject;
            });
            assert.equal(reply, `${world}:${opcode}`);
        }
    }
    const forwarded = requests.length;
    for (const path of ['/__rs2b0t/world/3', '/__rs2b0t/world/3/crc', '/__rs2b0t/world/4/crc', '/__rs2b0t/world/02/crc', '/__rs2b0t/world/2/prometheus', '/__rs2b0t/world/2/setup', '/__rs2b0t/world/1/../2/admin', '/prometheus', '/setup', '/anything']) {
        assert.equal((await fetch(origin + path)).status, 404);
    }
    assert.equal((await fetch(origin + '/__rs2b0t/world/2/crc', { method: 'POST', body: 'no' })).status, 405);
    assert.equal(requests.length, forwarded);
}

async function discardClosedFrame() {
    const proxy = await startLiveProxy({ port: 0, root: fixtureRoot() });
    cleanups.push(() => proxy.stop(true));
    const NativeWebSocket = globalThis.WebSocket;
    const attemptedClose = Promise.withResolvers<void>();
    const sent: unknown[] = [];
    const created = Promise.withResolvers<DeferredSocket>();
    class DeferredSocket {
        opened = false;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        binaryType = 'arraybuffer';
        constructor() {
            created.resolve(this);
        }
        send(value: unknown) {
            sent.push(value);
        }
        close() {
            attemptedClose.resolve();
            if (!this.opened) throw new Error('CONNECTING close failed');
        }
    }
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: DeferredSocket });
    try {
        const downstream = new NativeWebSocket(`ws://127.0.0.1:${proxy.port}/__rs2b0t/world/2`);
        await new Promise<void>((resolve, reject) => {
            downstream.onopen = () => {
                downstream.send(new Uint8Array([14]));
                downstream.close();
                resolve();
            };
            downstream.onerror = reject;
        });
        await attemptedClose.promise;
        const pending = await created.promise;
        pending.opened = true;
        pending.onopen?.(new Event('open'));
        assert.equal(sent.length, 0, 'removed frame login bytes reached a late-opening upstream');
    } finally {
        Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: NativeWebSocket });
    }
}

async function rejectStaleBundle() {
    const root = fixtureRoot();
    writeFileSync(join(root, 'out/botclient.js'), 'stale w1.rs2b2t.com');
    await assert.rejects(startLiveProxy({ port: 0, root }), /metadata/);
}

try {
    await routeTraffic();
    await rejectStaleBundle();
    await discardClosedFrame();
    console.log('two-world HTTP/game/cache routing and build metadata passed');
} finally {
    for (const cleanup of cleanups.reverse()) cleanup();
}
