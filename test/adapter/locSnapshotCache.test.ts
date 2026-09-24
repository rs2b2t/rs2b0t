import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { attach, detach, invalidateLocSnapshots, reader } = await import('#/bot/adapter/ClientAdapter.js');
const { default: LocType } = await import('#/client/config/LocType.js');

// LocType reads the game config cache, which a unit test has no reason to load.
LocType.list = ((id: number) => ({ name: `loc${id}`, op: ['Mine'], multiloc: [] })) as unknown as typeof LocType.list;

// Why: locs() sweeps 104x104 tiles x 4 typecodes per call (1.4-1.7ms, up to 2289 objects) from predicates that run at frame rate.
let sceneReads = 0;

function fakeClient(overrides: Record<string, unknown> = {}) {
    const world = {
        wallType: (): number => 0,
        sceneType: (_level: number, lx: number, lz: number): number => {
            sceneReads++;
            // one loc at scene tile (1,2)
            return lx === 1 && lz === 2 ? (7 << 14) | 1 : 0;
        },
        gdType: (): number => 0,
        decorType: (): number => 0
    };
    return {
        world,
        localPlayer: { x: 0, z: 0 },
        minusedlevel: 0,
        mapBuildBaseX: 3200,
        mapBuildBaseZ: 3200,
        ...overrides
    };
}

describe('locs() snapshot memo', () => {
    afterEach(() => {
        invalidateLocSnapshots();
    });

    // Why: `raw` is module-global, so a half-populated fake left attached makes unrelated adapter reads dereference undefined.
    afterAll(() => {
        detach();
    });

    test('rebuilds once, then serves repeat calls without re-sweeping the scene', () => {
        attach(fakeClient() as never);
        invalidateLocSnapshots();

        sceneReads = 0;
        const first = reader.locs();
        const sweep = sceneReads;
        expect(sweep).toBeGreaterThan(0);
        expect(first.length).toBeGreaterThan(0);

        for (let i = 0; i < 20; i++) {
            reader.locs();
        }
        // 20 further predicate evaluations must not touch the scene again
        expect(sceneReads).toBe(sweep);
    });

    test('a zone packet drops the memo so scripts never see a stale scene', () => {
        attach(fakeClient() as never);
        invalidateLocSnapshots();

        reader.locs();
        const sweep = sceneReads;
        invalidateLocSnapshots();
        reader.locs();

        expect(sceneReads).toBeGreaterThan(sweep);
    });

    test('walking re-sweeps, because distance is baked into every snapshot', () => {
        const client = fakeClient();
        attach(client as never);
        invalidateLocSnapshots();

        const before = reader.locs()[0].distance;
        const sweep = sceneReads;

        // one tile north: the loc sits at scene (1,2), so moving east would leave the
        // Chebyshev distance at 2 and prove nothing
        client.localPlayer.z = 128;
        const after = reader.locs()[0].distance;

        expect(sceneReads).toBeGreaterThan(sweep);
        expect(after).not.toBe(before);
    });

    test('a scene rebuild at new base coordinates re-sweeps', () => {
        const client = fakeClient();
        attach(client as never);
        invalidateLocSnapshots();

        reader.locs();
        const sweep = sceneReads;

        client.mapBuildBaseX = 3264;
        reader.locs();

        expect(sceneReads).toBeGreaterThan(sweep);
    });

    test('cached snapshots carry the same data as a fresh sweep', () => {
        attach(fakeClient() as never);
        invalidateLocSnapshots();

        const cached = reader.locs();
        invalidateLocSnapshots();
        const fresh = reader.locs();

        expect(cached.length).toBe(fresh.length);
        expect(cached[0].id).toBe(fresh[0].id);
        expect(cached[0].tile).toEqual(fresh[0].tile);
        expect(cached[0].distance).toBe(fresh[0].distance);
    });
});
