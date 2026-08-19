import { describe, expect, test } from 'bun:test';

import { awaitTransportLoc } from '#/bot/event/webwalk/exec/transportLoc.js';
import type { Loc } from '#/bot/api/locs/Locs.js';
import type { TransportInfo } from '#/bot/event/webwalk/PathFinder.js';

/** Brimhaven disembark plank — absent from the scene for the first ticks after the ship telejump. */
const PLANK: TransportInfo = {
    locName: 'Gangplank',
    action: 'Cross',
    locX: 2774,
    locZ: 3234,
    locId: 2088,
    toTile: { x: 2772, z: 3234 }
};

const plankLoc = { id: 2088, tile: () => ({ x: 2774, z: 3234 }) } as unknown as Loc;

/** Polls like Execution.delayUntil: re-check the predicate up to `ticks` times. */
function pollingDelayUntil(ticks: number): (pred: () => boolean, ms: number) => Promise<boolean> {
    return async (pred: () => boolean) => {
        for (let i = 0; i < ticks; i++) {
            if (pred()) {
                return true;
            }
        }
        return pred();
    };
}

/** Scene that has nothing until the `after`-th lookup, then holds the plank. */
function sceneReadyAfter(after: number): { find: () => Loc | null; calls: () => number } {
    let calls = 0;
    return {
        find: (): Loc | null => {
            calls++;
            return calls >= after ? plankLoc : null;
        },
        calls: () => calls
    };
}

describe('awaitTransportLoc', () => {
    test('returns the loc once the rebuilt scene holds it', async () => {
        const scene = sceneReadyAfter(3);
        const found = await awaitTransportLoc(PLANK, 3000, pollingDelayUntil(10), scene.find);
        expect(found).toBe(plankLoc);
    });

    test('returns the loc already in the scene without waiting', async () => {
        const scene = sceneReadyAfter(1);
        let waited = false;
        const found = await awaitTransportLoc(PLANK, 3000, async () => {
            waited = true;
            return true;
        }, scene.find);
        expect(found).toBe(plankLoc);
        expect(waited).toBe(false);
    });

    test('gives up and returns null when the loc never appears', async () => {
        const found = await awaitTransportLoc(PLANK, 3000, pollingDelayUntil(10), () => null);
        expect(found).toBeNull();
    });
});
