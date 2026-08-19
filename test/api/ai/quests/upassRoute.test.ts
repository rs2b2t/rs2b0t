import { describe, expect, test } from 'bun:test';

import { chainFrom } from '#/bot/api/ai/quests/defs/upass/cross.js';
import { UPASS_AREAS, UPASS_CROSSINGS } from '#/bot/api/ai/quests/defs/upass/route.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: the search this replaces picked a seam by how much closer it looked, which in a cavern cut into forty-nine sealed pockets is a straight line across walls. It offered five ledge locs whose stand is in another pocket before the one the character was standing beside, and reported a cage thirty tiles away as crossed. Which pocket the character is in has one answer and it names one action.

/** The mud pocket the spade dig lands in, and the pocket the loose railings sit in. */
const MUD_POCKET = '94725ac';
const RAILINGS = '9592589';
const LEDGE_SOUTH = '9422597';

describe('the route table', () => {
    test('names every area a crossing touches', () => {
        const named = new Set(UPASS_AREAS.map(a => a.area));
        for (const edge of UPASS_CROSSINGS) {
            expect(named.has(edge.from)).toBe(true);
            expect(named.has(edge.to)).toBe(true);
        }
    });

    test('gives every area an anchor tile to identify it by', () => {
        for (const area of UPASS_AREAS) {
            expect(area.anchor.level).toBe(0);
            expect(area.anchor.x).toBeGreaterThan(2300);
        }
    });

    test('never has a crossing that starts and ends in the same area', () => {
        for (const edge of UPASS_CROSSINGS) {
            expect(edge.from).not.toBe(edge.to);
        }
    });
});

describe('leaving the mud pocket', () => {
    test('takes the northernmost ledge, from the tile beside it', () => {
        const first = chainFrom(MUD_POCKET, RAILINGS);
        expect(first?.loc).toBe(3238);
        expect(first?.op).toBe('Cross');
        expect(first?.stand).toEqual(new Tile(2375, 9644, 0));
        expect(first?.lands).toEqual(new Tile(2374, 9638, 0));
    });

    test('and the ledge is the only way out of it', () => {
        expect(UPASS_CROSSINGS.filter(e => e.from === MUD_POCKET)).toHaveLength(1);
    });

    test('offers the other ledge loc only from the pocket that can reach it', () => {
        const ledges = UPASS_CROSSINGS.filter(e => e.loc === 3238);
        expect(ledges.map(e => `${e.from}:${e.stand.z}`).sort())
            .toEqual(['94725a6:9639', '94725ac:9644']);
    });
});

describe('past the ledge', () => {
    test('the way to the railings runs through the pipe, not the cages', () => {
        const first = chainFrom(LEDGE_SOUTH, RAILINGS);
        expect(first).not.toBeNull();
        expect(chainFrom(RAILINGS, RAILINGS)).toBeNull();
    });

    test('the pipe into the railings is used from the tile east of it', () => {
        const pipe = UPASS_CROSSINGS.find(e => e.loc === 3237 && e.to === RAILINGS);
        expect(pipe?.stand).toEqual(new Tile(2419, 9605, 0));
        expect(pipe?.lands).toEqual(new Tile(2412, 9605, 0));
    });
});

describe('the cage corridor', () => {
    test('opens the mud cell from the door tile itself', () => {
        const cage = UPASS_CROSSINGS.find(e => e.loc === 3266 && e.stand.x === 2393 && e.stand.z === 9655);
        expect(cage?.op).toBe('Pick-lock');
        expect(cage?.lands).toEqual(new Tile(2393, 9654, 0));
    });
});
