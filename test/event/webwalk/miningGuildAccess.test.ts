import fs from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import transports from '#/bot/event/webwalk/data/transports.json';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { specialRequiresAt } from '#/bot/event/webwalk/specialRequires.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const PACK = 'out/collision.lcnav.gz';
const BANK = { x: 2945, z: 3368, level: 0 };
const GUILD = { x: 3019, z: 9741, level: 0 };
const state = (mining: number) => ({ ...emptyWorldStateData(), skills: { mining } });

test('every actual guild ladder entrance and the underground door require Mining 60', () => {
    const entrances = transports.filter(edge => edge.locId === 2113);
    expect(entrances).toHaveLength(4);
    for (const { from } of entrances) {
        expect(specialRequiresAt(from.x, from.z, from.level)?.skills).toEqual([{ name: 'mining', level: 60 }]);
    }
    expect(specialRequiresAt(3046, 9756, 0)?.skills).toEqual([{ name: 'mining', level: 60 }]);
});

describe.skipIf(!fs.existsSync(PACK))('Mining Guild routing', () => {
    const finder = fs.existsSync(PACK) ? new PathFinder(gunzipSync(fs.readFileSync(PACK))) : null;
    if (finder) loadDefaultNavEdges(finder);

    test.each([40, 60])('guild entry respects Mining %i from the surface and Dwarven Mine', mining => {
        for (const from of [BANK, { x: 3046, z: 9757, level: 0 }]) {
            const route = finder!.findPath(from, GUILD, { state: state(mining) });
            expect(route.ok).toBe(mining >= 60);
        }
    });

    test.each([{ x: 3040, z: 9773, level: 0 }, { x: 3042, z: 9760, level: 0 }])('ordinary ore remains accessible at Mining 40 and 60', target => {
        for (const mining of [40, 60]) {
            const route = finder!.findPath(BANK, target, { state: state(mining) });
            expect(route.ok).toBe(true);
            if (!route.ok) continue;
            if (mining < 60) expect(route.hops.some(hop => hop.locId === 2112 || hop.locId === 2113)).toBe(false);
            expect(route.hops.some(hop => hop.kind === 'dungeon')).toBe(true);
        }
    });

    test('Mining 40 can leave the ore seam, smelt, smith, and bank without using the guild', () => {
        const stops = [
            { x: 3042, z: 9760, level: 0 },
            { x: 2974, z: 3369, level: 0 },
            { x: 3012, z: 9812, level: 0 },
            BANK
        ];
        for (let i = 1; i < stops.length; i++) {
            const route = finder!.findPath(stops[i - 1]!, stops[i]!, { state: state(40) });
            expect(route.ok).toBe(true);
            if (!route.ok) continue;
            expect(route.hops.some(hop => hop.locId === 2112 || hop.locId === 2113)).toBe(false);
        }
    });

    test('a miner below level 60 can still climb out of the guild', () => {
        const route = finder!.findPath(GUILD, BANK, { state: state(40) });
        expect(route.ok).toBe(true);
        if (!route.ok) return;
        expect(route.hops.some(hop => hop.locId === 1755 && hop.to.z < 9000)).toBe(true);
        expect(route.hops.some(hop => hop.locId === 2112)).toBe(false);
    });
});
