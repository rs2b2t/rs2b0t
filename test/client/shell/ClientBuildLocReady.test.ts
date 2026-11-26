import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { registerSilentAudio } from './fixtures/silentAudio.js';

registerSilentAudio();

const { default: ClientBuild } = await import('#/client/shell/ClientBuild.js');
const { default: LocType } = await import('#/client/config/LocType.js');
const { default: Model } = await import('#/client/dash3d/Model.js');

type Loc = InstanceType<typeof LocType>;

// deltaId, then per position: deltaPos, shape byte; 0 terminates each list.
// loc 5 and loc 9 each sit at tile (1,2) with one model apiece.
const LOC_STREAM = (): Uint8Array => new Uint8Array([6, 67, 0, 0, 4, 67, 0, 0, 0]);

const MODEL_OF: Record<number, number> = { 5: 100, 9: 200 };

describe('checkLocations model readiness', () => {
    let listCalls: number;
    let loaded: Set<number>;
    let requested: number[];
    let origList: typeof LocType.list;
    let origRequest: typeof Model.requestDownload;

    beforeEach(() => {
        listCalls = 0;
        loaded = new Set();
        requested = [];
        origList = LocType.list;
        origRequest = Model.requestDownload;

        LocType.list = (id: number): Loc => {
            listCalls++;
            const loc = Object.create(LocType.prototype) as Loc;
            loc.model = Int32Array.of(MODEL_OF[id]);
            loc.active = false;
            loc.forcedecor = false;
            return loc;
        };

        Model.requestDownload = (id: number): boolean => {
            if (loaded.has(id)) {
                return true;
            }
            requested.push(id);
            return false;
        };
    });

    afterEach(() => {
        LocType.list = origList;
        Model.requestDownload = origRequest;
    });

    test('decodes the loc stream once, then re-checks the cached model set', () => {
        const src = LOC_STREAM();

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);
        expect(requested).toEqual([100, 200]);

        // later ticks answer without walking the stream again
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);

        loaded.add(100);
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);

        loaded.add(200);
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(true);
        expect(listCalls).toBe(2);
    });

    test('re-requests a model evicted after the region was already ready', () => {
        const src = LOC_STREAM();
        loaded.add(100);
        loaded.add(200);

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(true);
        expect(requested).toEqual([]);

        // mapBuild() calls Model.unload() on every scene build under lowMem, and a floor
        // change forces a build -- the region must stop reporting ready and re-fetch
        loaded.delete(200);

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(requested).toEqual([200]);
        expect(listCalls).toBe(2);

        loaded.add(200);
        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(true);
    });

    test('a region whose models are already loaded is ready with nothing requested', () => {
        loaded.add(100);
        loaded.add(200);

        expect(ClientBuild.checkLocations(LOC_STREAM(), 0, 0)).toBe(true);
        expect(requested).toEqual([]);
    });

    test('re-scans when the same region data is placed at new offsets', () => {
        const src = LOC_STREAM();

        expect(ClientBuild.checkLocations(src, 0, 0)).toBe(false);
        expect(listCalls).toBe(2);

        expect(ClientBuild.checkLocations(src, 8, 8)).toBe(false);
        expect(listCalls).toBe(4);
    });
});
