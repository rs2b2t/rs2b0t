import assert from 'node:assert/strict';
import { argv } from 'node:process';
import { setImmediate } from 'node:timers/promises';
import { MultiBoxController, normalizeUsername } from '../src/bot/multibox/MultiBoxController.ts';
import { RosterActions } from '../src/bot/multibox/RosterActions.ts';

const { RosterActions: Baseline } = await import(argv[2]);

async function sample(Actions, count, mixed = false) {
    const saved = Array.from({ length: count }, (_, i) => ({ username: 'slot' + i, tab: 'Main', world: 1 }));
    const gates = [];
    const events = [];
    const stops = [];
    let now = 0;
    let reads = 0;
    let rebuilds = 0;
    const controller = new MultiBoxController({
        spawn({ username }) {
            const id = gates.length + 1;
            const gate = Promise.withResolvers();
            gates.push(gate);
            const client = { travelTo: () => gate.promise, stopScript: () => stops.push([now, id]) };
            return {
                setLoginCoordination() {}, setCredentials() {}, setRenderMode() {}, destroy() {},
                roster: () => client,
                status() {
                    reads++;
                    return { ready: true, ingame: true, world: 1, player: username, loopCycle: 0, drawn: 0, scriptState: 'idle', scriptName: null };
                }
            };
        }
    });
    controller.addGroup(saved);
    const actions = new Actions({
        profiles() {
            rebuilds++;
            const profiles = new Map(saved.map(p => [normalizeUsername(p.username), { ...p }]));
            for (const slot of controller.snapshot()) {
                profiles.set(normalizeUsername(slot.username), { username: slot.username, tab: slot.tab, world: slot.targetWorld, slot });
            }
            return [...profiles.values()];
        },
        client: p => controller.rosterClient(p.slot.id)
    });

    const timers = new Set();
    const { setInterval, clearInterval, setTimeout, clearTimeout } = globalThis;
    const realNow = Date.now;
    const realPerformanceNow = performance.now;
    performance.now = Date.now = () => now;
    globalThis.setInterval = (callback, delay) => {
        assert.equal(delay, 100);
        timers.add(callback);
        return callback;
    };
    globalThis.setTimeout = (callback, delay) => {
        const once = () => {
            timers.delete(once);
            callback();
        };
        return globalThis.setInterval(once, delay);
    };
    globalThis.clearTimeout = globalThis.clearInterval = callback => timers.delete(callback);
    try {
        const running = actions.run(saved.map(p => p.username), { kind: 'travel', destination: 'Varrock' }, r => events.push([now, r]));
        let ms = 0;
        reads = rebuilds = 0;
        for (let tick = 1; tick <= (mixed ? 110 : 10); tick++) {
            now = 100 * tick;
            if (mixed && tick === 3) {
                controller.remove(1);
                controller.remove(2);
                controller.add(saved[1]);
            }
            const due = [...timers];
            const start = realPerformanceNow.call(performance);
            for (const poll of due) poll();
            ms += realPerformanceNow.call(performance) - start;
            if (mixed) {
                if (tick === 10) gates.slice(3, count).forEach(gate => gate.resolve());
                await setImmediate();
            }
        }
        const metrics = { ms, rebuilds, reads };
        gates.forEach(gate => gate.resolve());
        const results = await running;
        assert.equal(timers.size, 0);
        assert.equal(events.length, 2 * count);
        assert.deepEqual(results.map(r => r.state), saved.map((_, i) => mixed && i < 3 ? 'failed' : 'done'));
        assert.deepEqual(stops, mixed ? [[300, 1], [300, 2], [11000, 3]] : []);
        return { metrics, output: { events, results, stops } };
    } finally {
        Object.assign(globalThis, { setInterval, clearInterval, setTimeout, clearTimeout });
        Date.now = realNow;
        performance.now = realPerformanceNow;
    }
}

for (const count of [30, 61]) {
    const samples = [[], []];
    for (let pair = 0; pair < 9; pair++) {
        const runs = [];
        for (const i of pair % 2 ? [1, 0] : [0, 1]) {
            runs[i] = await sample([Baseline, RosterActions][i], count);
            if (pair >= 2) samples[i].push(runs[i].metrics);
        }
        assert.deepEqual(runs[0].output, runs[1].output);
    }
    const before = await sample(Baseline, count, true);
    const after = await sample(RosterActions, count, true);
    assert.deepEqual(before.output, after.output);
    const medians = samples.map(runs => runs.sort((a, b) => a.ms - b.ms)[3]);
    console.log({ count, baseline: medians[0], patched: medians[1], mixedEvents: after.output.events.length, stops: after.output.stops });
}
