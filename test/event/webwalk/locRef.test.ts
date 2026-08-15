import { describe, expect, test } from 'bun:test';

import {
    locPlacementKey,
    locRefFromDoor,
    locRefFromTransport,
    locRefStale,
    locRefValid,
    matchesLocRef,
    probeLocRef,
    type LocSceneSnap
} from '#/bot/event/webwalk/locRef.js';
import type { TransportInfo } from '#/bot/event/webwalk/PathFinder.js';

const gate: TransportInfo = {
    locName: 'Gate',
    action: 'Open',
    locX: 3312,
    locZ: 3235,
    locId: 3198
};

const loc = (id: number, x: number, z: number) => ({
    id,
    tile: () => ({ x, z })
});

const snap = (
    id: number,
    x: number,
    z: number,
    name: string | null = 'Gate',
    actions: string[] = ['Open']
): LocSceneSnap => ({ id, x, z, name, actions });

describe('LocRef placement identity', () => {
    test('locRefFromTransport captures placement + ids', () => {
        const ref = locRefFromTransport(gate, 0);
        expect(ref.placement).toEqual({ level: 0, x: 3312, z: 3235 });
        expect(ref.locId).toBe(3198);
        expect(ref.name).toBe('Gate');
        expect(locPlacementKey(ref.placement)).toBe('0|3312|3235');
    });

    test('matchesLocRef requires id and placement (closed form exact or near)', () => {
        const ref = locRefFromTransport(gate);
        expect(matchesLocRef(ref, loc(3198, 3312, 3235))).toBe(true);
        expect(matchesLocRef(ref, loc(3197, 3312, 3235))).toBe(false);
        // 1 tile off is still near (slack 3) for closed id — pack stands drift.
        expect(matchesLocRef(ref, loc(3198, 3312, 3234))).toBe(true);
        expect(matchesLocRef(ref, loc(3198, 3312, 3240))).toBe(false);
    });

    test('openLocId matches open transform near placement', () => {
        const trap: TransportInfo = {
            locName: 'Trapdoor',
            action: 'Climb-down',
            locX: 3097,
            locZ: 3468,
            locId: 1568,
            openLocId: 1570
        };
        const ref = locRefFromTransport(trap);
        expect(matchesLocRef(ref, loc(1568, 3097, 3468))).toBe(true);
        expect(matchesLocRef(ref, loc(1570, 3096, 3468))).toBe(true);
        expect(matchesLocRef(ref, loc(1571, 3097, 3468))).toBe(false);
    });

    test('name-only ref matches by proximity', () => {
        const ref = locRefFromTransport({
            locName: 'Portal',
            action: 'Use',
            locX: 2932,
            locZ: 4854
        });
        expect(matchesLocRef(ref, loc(2492, 2933, 4854))).toBe(true);
        expect(matchesLocRef(ref, loc(2492, 2940, 4854))).toBe(false);
    });

    test('slashable webs use exact placement (dual Yanille webs share locId)', () => {
        const west: TransportInfo = {
            locName: 'Web',
            action: 'Slash',
            locX: 2569,
            locZ: 3118,
            locId: 733
        };
        const ref = locRefFromTransport(west);
        expect(ref.slack).toBe(0);
        // Exact tile only — neighbour at 2570 must not match (was double-slash).
        expect(matchesLocRef(ref, loc(733, 2569, 3118))).toBe(true);
        expect(matchesLocRef(ref, loc(733, 2570, 3118))).toBe(false);
    });

    test('probeLocRef treats Slashed web as openLeaf for Slash hops', () => {
        const web: TransportInfo = {
            locName: 'Web',
            action: 'Slash',
            locX: 2570,
            locZ: 3118,
            locId: 733
        };
        const ref = locRefFromTransport(web);
        // No slashable form — only slashed leaf at placement.
        expect(
            probeLocRef(ref, [snap(734, 2570, 3118, 'Slashed web', [])])
        ).toEqual({ status: 'openLeaf' });
        expect(
            probeLocRef(ref, [snap(733, 2570, 3118, 'Web', ['Slash'])])
        ).toEqual({ status: 'matching' });
    });
});

describe('locRef valid / stale (scene probe)', () => {
    test('matching closed id is valid', () => {
        const ref = locRefFromTransport(gate);
        const scene = [snap(3198, 3312, 3235)];
        expect(probeLocRef(ref, scene)).toEqual({ status: 'matching' });
        expect(locRefValid(ref, scene)).toBe(true);
        expect(locRefStale(ref, scene)).toBe(false);
    });

    test('open leaf for Open action is valid (not stale)', () => {
        const ref = locRefFromTransport(gate);
        const scene = [snap(3200, 3312, 3235, 'Gate', ['Close'])];
        expect(probeLocRef(ref, scene)).toEqual({ status: 'openLeaf' });
        expect(locRefValid(ref, scene)).toBe(true);
        expect(locRefStale(ref, scene)).toBe(false);
    });

    test('missing id at placement is stale when locId known', () => {
        const ref = locRefFromTransport(gate);
        const scene = [snap(9999, 3312, 3235, 'Other', ['Open'])];
        expect(probeLocRef(ref, scene)).toEqual({ status: 'missing' });
        expect(locRefValid(ref, scene)).toBe(false);
        expect(locRefStale(ref, scene)).toBe(true);
    });

    test('empty scene is missing/stale for id-backed ref', () => {
        const ref = locRefFromTransport(gate);
        expect(locRefValid(ref, [])).toBe(false);
        expect(locRefStale(ref, [])).toBe(true);
    });

    test('name-only ref is never stale (ambiguous)', () => {
        const ref = locRefFromTransport({
            locName: 'Portal',
            action: 'Use',
            locX: 0,
            locZ: 0
        });
        expect(locRefStale(ref, [])).toBe(false);
    });

    test('locRefFromDoor places skill-gate doors', () => {
        const ref = locRefFromDoor({
            x: 2611,
            z: 3394,
            level: 0,
            locId: 2025,
            locName: 'Door'
        });
        expect(ref.placement).toEqual({ level: 0, x: 2611, z: 3394 });
        expect(ref.locId).toBe(2025);
        expect(matchesLocRef(ref, loc(2025, 2611, 3394))).toBe(true);
    });
});
