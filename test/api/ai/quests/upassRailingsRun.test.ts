import { describe, expect, test } from 'bun:test';

import { TO_RAILINGS } from '#/bot/api/ai/quests/defs/upass/railings.js';
import { UP_LOC } from '#/bot/api/ai/quests/defs/upass/areas.js';
import Tile from '#/bot/geometry/Tile.js';

// Why: the run from the mud pocket to the loose railings is four crossings in one order and never varies. Checked against the collision pack: every stand is walkable, every landing is walkable, and each landing reaches the next stand. Live, a search over the same ground offered five ledge locs whose stand is in another pocket and reported a cage thirty tiles away as crossed.

describe('the run from the cage corridor down to the loose railings', () => {
    test('starts in the corridor, because that is where the well drops the character', () => {
        expect(TO_RAILINGS.map(s => `${s.op} ${s.loc}`)).toEqual([
            `Pick-lock ${UP_LOC.RAILINGS_LOCKED}`,
            `Dig ${UP_LOC.MUD_DIG}`,
            `Cross ${UP_LOC.LEDGE}`,
            `Pick-lock ${UP_LOC.RAILINGS_HARD}`,
            `Pick-lock ${UP_LOC.RAILINGS_HARD}`,
            `Squeeze-through ${UP_LOC.PIPE_AREA2}`
        ]);
    });

    test('digs the mud with a spade rather than an op the client cannot send', () => {
        expect(TO_RAILINGS[1]!.item?.name).toBe('Spade');
        expect(TO_RAILINGS[1]!.stand).toEqual(new Tile(2393, 9651, 0));
        expect(TO_RAILINGS[1]!.lands).toEqual(new Tile(2392, 9646, 0));
    });

    test('crosses the ledge from (2375,9644) on the loc at (2374,9644)', () => {
        const ledge = TO_RAILINGS[2]!;
        expect(ledge.stand).toEqual(new Tile(2375, 9644, 0));
        expect(ledge.at).toEqual(new Tile(2374, 9644, 0));
        expect(ledge.lands).toEqual(new Tile(2374, 9638, 0));
    });

    test('names the loc tile for every crossing, so a row of them cannot be picked by nearest', () => {
        for (const step of TO_RAILINGS) {
            expect(step.at.level).toBe(0);
            // Why: a wall railing is used from its OWN tile, so `at` equals the stand there; the ledge and
            // the pipe are used from beside them. Either way the loc is named rather than searched for.
            expect(step.at.distanceTo(step.stand)).toBeLessThanOrEqual(2);
        }
    });

    test('squeezes the pipe at (2417,9605) from (2419,9605) into (2412,9605)', () => {
        const pipe = TO_RAILINGS[5]!;
        expect(pipe.stand).toEqual(new Tile(2419, 9605, 0));
        expect(pipe.at).toEqual(new Tile(2417, 9605, 0));
        expect(pipe.lands).toEqual(new Tile(2412, 9605, 0));
        expect(pipe.via).toEqual([new Tile(2420, 9617, 0)]);
    });

    test('picks the railings from the tiles the map angles them to', () => {
        expect(TO_RAILINGS[3]!.stand).toEqual(new Tile(2380, 9619, 0));
        expect(TO_RAILINGS[3]!.lands).toEqual(new Tile(2381, 9619, 0));
        expect(TO_RAILINGS[4]!.stand).toEqual(new Tile(2403, 9620, 0));
        expect(TO_RAILINGS[4]!.at).toEqual(new Tile(2404, 9620, 0));
    });
});
