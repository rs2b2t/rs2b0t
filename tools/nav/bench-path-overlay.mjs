import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { attach, reader } from '../../src/bot/adapter/ClientAdapter.ts';
import { paintNavPath } from '../../src/bot/event/webwalk/pathOverlay.ts';
import { PathPublish } from '../../src/bot/event/webwalk/pathPublish.ts';
import { SettingsBag, SettingsStore } from '../../src/bot/runtime/Settings.ts';
import { Client } from '../../src/client/shell/Client.ts';

const { paintNavPath: before } = await import(pathToFileURL(resolve(process.argv[2])).href);
const settings = { showNavPath: true, navPathShowText: true };
SettingsStore.globalBag = () => new SettingsBag(settings);
attach(Object.assign(Object.create(Client.prototype), {
    mapBuildBaseX: 0, mapBuildBaseZ: 0, minusedlevel: 0, localPlayer: { x: 40 << 7, z: 40 << 7 },
    camX: 43 << 7, camY: -520, camZ: 29 << 7, camPitch: 128, camYaw: 0, var: [],
    groundh: [Array.from({ length: 105 }, (_, x) => Int32Array.from({ length: 105 }, (_, z) => x + z))]
}));

function path(length) {
    return Array.from({ length }, (_, i) => ({ x: 40 + i % 8, z: 40 + (i >> 3), level: 0 }));
}
function hop(label) {
    return { label, kind: 'teleport', transport: true };
}
const tiles = path(64);
Object.assign(tiles[3], hop('Exit'));
Object.assign(tiles[44], hop('Enter'));
PathPublish.set(tiles, 4);

const project = reader.overlayPosWorld;
function trace(paint, labelsOnly) {
    const events = [];
    const ctx = new Proxy({}, {
        get: (_, key) => (...args) => events.push([key, ...args]),
        set: (_, key, value) => { events.push([key, value]); return true; }
    });
    let projections = 0;
    reader.overlayPosWorld = (...args) => {
        projections++;
        return project(...args);
    };
    try {
        paint(ctx, { labelsOnly });
    } finally {
        reader.overlayPosWorld = project;
    }
    return { projections, events };
}
function compare(labelsOnly) {
    const base = trace(before, labelsOnly);
    const patch = trace(paintNavPath, labelsOnly);
    assert.deepEqual(patch.events, base.events);
    console.log('projections', base.projections, '->', patch.projections, 'matching canvas events', patch.events.length);
}
compare(true);
settings.navPathShowText = false;
compare(true);

const mixed = path(220);
Object.assign(mixed[1], hop('Before trail'));
Object.assign(mixed[5], hop('Oldest visible'));
Object.assign(mixed[6], hop('  '));
Object.assign(mixed[7], hop('Upstairs'), { level: 1 });
Object.assign(mixed[8], hop('Off scene'), { x: -1 });
Object.assign(mixed[9], { transport: true, locName: 'Gate', locId: 1 });
Object.assign(mixed[190], hop('Far'));
reader.locs = () => [{ name: 'Gate', id: 1, typecode: 1, tile: mixed[9], distance: 1, ops: [] }];
reader.locBox = () => Array.from({ length: 8 }, (_, i) => ({ x: 90 + i % 4, y: 40 + (i >> 2) }));
PathPublish.set(mixed, 9, 10);
PathPublish.setClientSegment(mixed.slice(10, 13));
compare(true);
settings.navPathShowText = true;
compare(true);
compare(false);

PathPublish.clear();
PathPublish.set(tiles, 4);
const ctx = { save() {}, beginPath() {}, rect() {}, clip() {}, fillText() {}, restore() {} };
function sweeps(paint, count, repeats) {
    for (let sweep = 0; sweep < repeats; sweep++) {
        for (let i = 0; i < count; i++) paint(ctx, { labelsOnly: true });
    }
}
for (const count of [30, 61]) {
    const samples = [[], []];
    const versions = [before, paintNavPath];
    for (const paint of versions) sweeps(paint, count, 24);
    for (let sample = 0; sample < 31; sample++) {
        for (const i of sample % 2 ? [1, 0] : [0, 1]) {
            const start = performance.now();
            sweeps(versions[i], count, 8);
            samples[i].push((performance.now() - start) / 8);
        }
    }
    console.log(count, 'draws/sweep, median ms', samples.map(s => s.sort((a, b) => a - b)[15].toFixed(3)));
}
process.exit(0);
