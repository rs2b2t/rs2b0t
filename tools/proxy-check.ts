// Verify tools/live-proxy is bridging to live: /crc (HTTP) + the WebSocket
// handshake must reach w1.rs2b2t.com and come back, with no RSA/login/account.
// Usage: bun tools/proxy-check.ts [host:port]   (default localhost:8081)
import ClientStream from '#/io/ClientStream.js';
import Packet from '#/io/Packet.js';

const host = process.argv[2] ?? 'localhost:8081';

// 1. /crc through the proxy (HTTP -> live)
const crc = await fetch(`http://${host}/crc`);
const bytes = (await crc.arrayBuffer()).byteLength;
console.log(`/crc via proxy: HTTP ${crc.status}, ${bytes} bytes`);

// 2. static bundle through the proxy (local live build)
const html = await fetch(`http://${host}/bot.html`);
const js = await fetch(`http://${host}/bot/botclient.js`);
console.log(`/bot.html: HTTP ${html.status}; /bot/botclient.js: HTTP ${js.status}`);

// 3. WebSocket handshake through the proxy (WS -> live)
const stream = new ClientStream(await ClientStream.openSocket(host, false));
const out = new Packet(new Uint8Array(512));
out.p1(14);
out.p1(0);
stream.write(out.data, 2);
for (let i = 0; i < 8; i++) await stream.read();
const resp = await stream.read();
console.log(`handshake response via proxy: ${resp} (expect 0 = reached live and back)`);
stream.close();

const ok = crc.status === 200 && bytes >= 30 && html.status === 200 && js.status === 200 && resp === 0;
console.log(ok ? 'PROXY OK: /crc + static + WS handshake all bridge to live' : 'PROXY INCOMPLETE (see above)');
process.exit(ok ? 0 : 1);
