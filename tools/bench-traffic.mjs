import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

registerHooks({
    resolve(id, context, next) {
        if (id.endsWith('/TrafficChannel.js')) {
            return next(id.startsWith('#/') ? '../../client/io/TrafficChannel.ts' : './TrafficChannel.ts', context);
        }
        return next(id, context);
    }
});

async function revision(root) {
    const load = file => import(pathToFileURL(resolve(root, 'src', file)));
    const { TrafficCollector } = await load('bot/adapter/TrafficAdapter.ts');
    const { TrafficMeter, trafficMeter } = await load('client/io/TrafficMeter.ts');
    trafficMeter.close();
    return { TrafficCollector, TrafficMeter, ...await load('client/io/TrafficChannel.ts') };
}

async function sample(api, profiles, instrument) {
    const wall = { documentElement: { dataset: {} } };
    const frames = Array.from({ length: profiles }, () => Object.assign(new EventTarget(), { frameElement: { ownerDocument: wall } }));
    const direct = !!(api.openWorkerTrafficPort || api.openFrameTrafficPort);
    const channelName = direct ? undefined : api.installWallTrafficChannel(wall);
    let time = 0;
    let clockReads = 0;
    const collector = new api.TrafficCollector({ wall, channelName, now: () => { clockReads++; return time; } });
    const timers = new Map();
    const meters = [];
    const ports = [];
    let peers = 0;
    const observePeer = channel => {
        if (instrument) channel.onmessage = () => { peers++; };
        return channel;
    };
    const publishers = profiles * 2;
    const expectedPeers = instrument && !direct ? publishers * (publishers - 1) : 0;
    let cpu = 0;
    try {
        for (let i = 0; i < publishers; i++) {
            const worker = i % 2 === 1;
            const frame = frames[Math.floor(i / 2)];
            globalThis.self = worker ? { name: channelName } : frame;
            globalThis.window = worker ? undefined : frame;
            let transport = {};
            if (direct && (worker || instrument)) {
                let port;
                const publisher = api.openWorkerTrafficPort ? api.openWorkerTrafficPort(() => port.close(), frame) : api.openFrameTrafficPort(frame);
                ports.push(publisher);
                port = worker ? structuredClone(publisher.port, { transfer: [publisher.port] }) : publisher.port;
                transport = { channel: observePeer(port) };
            } else if (!direct && instrument) {
                transport = { channelFactory: name => observePeer(new BroadcastChannel(name)) };
            }
            meters.push(new api.TrafficMeter({
                ...transport,
                setTimeout(callback, delay) {
                    assert.equal(delay, 1000);
                    timers.set(i, callback);
                    return i;
                },
                clearTimeout: () => timers.delete(i)
            }));
        }
        for (let round = 1; round <= 6; round++) {
            time += 1000;
            if (round === 1 || round === 4) {
                for (let i = 0; i < publishers; i += 2) {
                    meters[i].addReceived(100);
                    meters[i + 1].addSent(3);
                }
            }
            const callbacks = [...timers.values()];
            assert.equal(callbacks.length, publishers);
            const reads = clockReads;
            const start = process.cpuUsage();
            for (const heartbeat of callbacks) heartbeat();
            for (let turn = 0; turn < 1000; turn++) {
                await setImmediate();
                if (clockReads - reads >= publishers && peers >= round * expectedPeers) break;
            }
            const elapsed = process.cpuUsage(start);
            cpu += elapsed.user + elapsed.system;
            assert.equal(clockReads - reads, publishers);
            assert.equal(peers, round * expectedPeers);
            const batches = round < 4 ? 1 : 2;
            assert.deepEqual(collector.snapshot(), { status: 'available', receivedBytes: profiles * 100 * batches, sentBytes: profiles * 3 * batches });
        }
        time += 3000;
        assert.deepEqual(collector.snapshot(), { status: 'unavailable', reason: 'browser traffic publisher timed out' });
        return { cpu: cpu / 6000, peers: peers / 6 };
    } finally {
        delete globalThis.self;
        delete globalThis.window;
        for (const meter of meters) meter.close();
        for (const port of ports) port.close();
        collector.close();
        await setImmediate();
    }
}

const revisions = [await revision(process.argv[2]), await revision('.')];
for (const profiles of [30, 61]) {
    const times = [[], []];
    for (let pair = 0; pair < 6; pair++) {
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            const { cpu } = await sample(revisions[i], profiles, false);
            if (pair) times[i].push(cpu);
        }
    }
    const peers = [];
    for (const api of revisions) peers.push((await sample(api, profiles, true)).peers);
    console.log({ profiles, medianCpuMsPerRound: times.map(values => values.sort((a, b) => a - b)[2]),
        collectorDeliveriesPerRound: profiles * 2, peerDeliveriesPerRound: peers, receivedBytes: profiles * 200, sentBytes: profiles * 6 });
}
