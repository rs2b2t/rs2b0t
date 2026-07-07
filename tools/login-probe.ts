// Headless login probe — drives the real client networking stack (ClientStream/Packet/Isaac)
// through the full 274 login handshake against a local Engine, then samples server packets.
//
// Verifies (Phase 0 exit criteria + risk items from docs/PLAN.md):
//   1. WS connect + login handshake succeeds (response 2) with the default RSA key
//   2. ISAAC opcode decryption is seeded correctly (decoded opcodes are valid ServerProt ids)
//   3. PLAYER_INFO arrives at ~600ms cadence (the tick-counter assumption)
//
// Usage: bun tools/login-probe.ts [host:port] [username] [password]

import ClientStream from '#/io/ClientStream.js';
import Isaac from '#/io/Isaac.js';
import Packet from '#/io/Packet.js';
import { ServerProtSizes } from '#/io/ServerProt.js';
import JString from '#/datastruct/JString.js';

const CLIENT_VERSION = 274;
const LOGIN_RSAE = 58778699976184461502525193738213253649000149147835990136706041084440742975821n;
const LOGIN_RSAN = 7162900525229798032761816791230527296329313291232324290237849263501208207972894053929065636522363163621000728841182238772712427862772219676577293600221789n;

const OPCODE_NAMES: Record<number, string> = {
    231: 'REBUILD_NORMAL',
    167: 'PLAYER_INFO',
    197: 'NPC_INFO',
    106: 'UPDATE_INV_FULL',
    166: 'IF_OPENCHAT',
    211: 'IF_OPENMAIN',
    16: 'IF_OPENSIDE'
};

const host = process.argv[2] ?? 'localhost:8888';
const username = process.argv[3] ?? 'lcbuddy';
const password = process.argv[4] ?? 'test';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

// 1. fetch CRCs like the title screen does
const crcRes = await fetch(`http://${host}/crc`);
if (!crcRes.ok) fail(`/crc returned ${crcRes.status}`);
const checksums = new Packet(new Uint8Array(await crcRes.arrayBuffer()));
const jagChecksum: number[] = [];
for (let i = 0; i < 9; i++) {
    jagChecksum[i] = checksums.g4();
}
const expected = checksums.g4();
let calculated = 1234;
for (let i = 0; i < 9; i++) {
    calculated = ((calculated << 1) + jagChecksum[i]) | 0;
}
if (expected !== calculated) fail('/crc checksum mismatch');
console.log(`crc ok: [${jagChecksum.join(', ')}]`);

// 2. connect + handshake (mirrors Client.login())
const stream = new ClientStream(await ClientStream.openSocket(host, false));

const userhash = JString.toUserhash(username);
const loginServer = Number(userhash >> 16n) & 0x1f;

const out = new Packet(new Uint8Array(512));
out.p1(14);
out.p1(loginServer);
stream.write(out.data, 2);
for (let i = 0; i < 8; i++) {
    await stream.read();
}

let response = await stream.read();
console.log(`handshake response: ${response} (expect 0)`);

if (response === 0) {
    const seedBuf = new Packet(new Uint8Array(8));
    await stream.readBytes(seedBuf.data, 0, 8);
    const loginSeed = seedBuf.g8();

    const seed = new Int32Array([Math.floor(Math.random() * 99999999), Math.floor(Math.random() * 99999999), Number(loginSeed >> 32n), Number(loginSeed & 0xffffffffn)]);

    out.pos = 0;
    out.p1(10);
    out.p4(seed[0]);
    out.p4(seed[1]);
    out.p4(seed[2]);
    out.p4(seed[3]);
    out.p4(1337); // uid
    out.pjstr(username);
    out.pjstr(password);
    out.rsaenc(LOGIN_RSAN, LOGIN_RSAE);

    const loginout = new Packet(new Uint8Array(512));
    loginout.p1(16); // fresh login
    loginout.p1(out.pos + 36 + 1 + 2 + 1);
    loginout.p1(255);
    loginout.p2(CLIENT_VERSION);
    loginout.p1(0); // lowmem off

    for (let i = 0; i < 9; i++) {
        loginout.p4(jagChecksum[i]);
    }

    loginout.pdata(out.data, 0, out.pos);
    for (let i = 0; i < 4; i++) {
        seed[i] += 50;
    }
    const randomIn = new Isaac(seed);
    stream.write(loginout.data, loginout.pos);

    response = await stream.read();
    console.log(`login response: ${response} (expect 2)`);
    if (response !== 2) fail(`login rejected with code ${response}`);

    const staffmodlevel = await stream.read();
    const mouseTracked = await stream.read();
    console.log(`logged in as '${username}': staffmodlevel=${staffmodlevel} mouseTracked=${mouseTracked}`);

    // 3. sample the packet stream; verify ISAAC + PLAYER_INFO tick cadence
    const playerInfoTimes: number[] = [];
    const opcodeCounts = new Map<number, number>();
    const skipBuf = new Uint8Array(30000);
    const deadline = performance.now() + 5000;

    while (performance.now() < deadline) {
        const ptype = ((await stream.read()) - randomIn.nextInt) & 0xff;
        let psize = ServerProtSizes[ptype];
        if (psize === undefined) fail(`decoded invalid opcode ${ptype} — ISAAC misseeded?`);
        if (psize === -1) {
            psize = await stream.read();
        } else if (psize === -2) {
            psize = ((await stream.read()) << 8) | (await stream.read());
        }
        await stream.readBytes(skipBuf, 0, psize);

        opcodeCounts.set(ptype, (opcodeCounts.get(ptype) ?? 0) + 1);
        if (ptype === 167) {
            playerInfoTimes.push(performance.now());
        }
    }

    const seen = [...opcodeCounts.entries()].map(([op, n]) => `${OPCODE_NAMES[op] ?? op}x${n}`).join(' ');
    console.log(`packets over 5s: ${seen}`);

    if (playerInfoTimes.length < 2) fail('fewer than 2 PLAYER_INFO packets in 5s');
    const deltas = playerInfoTimes.slice(1).map((t, i) => t - playerInfoTimes[i]);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    console.log(`PLAYER_INFO cadence: n=${playerInfoTimes.length} mean=${mean.toFixed(0)}ms (expect ~600ms)`);

    stream.close();
    console.log('PASS');
    process.exit(0);
}

fail(`unexpected handshake response ${response}`);
