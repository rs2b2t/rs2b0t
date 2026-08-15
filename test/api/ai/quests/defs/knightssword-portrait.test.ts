import { describe, expect, test } from 'bun:test';

import { bestApproach, shouldWaitOut, vyvinTooClose } from '#/bot/api/ai/quests/defs/knightssword/portrait.js';
import { VYVIN_APPROACHES } from '#/bot/api/ai/quests/defs/knightssword/areas.js';

const CUPBOARD_STAND = { x: 2985, z: 3335, level: 2 };
const VYVIN_SPAWN = { x: 2983, z: 3335, level: 2 };

describe('Sir Vyvin proximity guard', () => {
    test('catches you from one tile away, in any direction', () => {
        for (const [dx, dz] of [[0, 1], [1, 0], [1, 1], [-1, -1], [0, -1], [-1, 0]]) {
            const beside = { x: CUPBOARD_STAND.x + dx, z: CUPBOARD_STAND.z + dz, level: 2 };
            expect(vyvinTooClose(CUPBOARD_STAND, beside)).toBe(true);
        }
    });

    test('standing on the same tile counts as too close', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, CUPBOARD_STAND)).toBe(true);
    });

    test('two tiles away is clear', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, { x: 2986, z: 3337, level: 2 })).toBe(false);
        expect(vyvinTooClose(CUPBOARD_STAND, { x: 2984, z: 3339, level: 2 })).toBe(false);
    });

    test('the guard is a square, not a circle', () => {
        // Why: npc_find takes a square radius, so a diagonal neighbour is as close as an orthogonal one and Euclidean distance would let (1,1) through.
        const diagonal = { x: CUPBOARD_STAND.x + 1, z: CUPBOARD_STAND.z + 1, level: 2 };
        expect(vyvinTooClose(CUPBOARD_STAND, diagonal)).toBe(true);
    });

    test('his spawn tile is already clear of the stand', () => {
        // The stand is picked so an unmoved Vyvin does not block the first try.
        expect(vyvinTooClose(CUPBOARD_STAND, VYVIN_SPAWN)).toBe(false);
    });

    test('an absent Vyvin never blocks', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, null)).toBe(false);
        expect(vyvinTooClose(null, VYVIN_SPAWN)).toBe(false);
    });
});

describe('the guard is a hint, not a gate', () => {
    const adjacent = { x: CUPBOARD_STAND.x, z: CUPBOARD_STAND.z + 1, level: 2 };

    test('waits out an adjacent Vyvin for a few passes', () => {
        expect(shouldWaitOut(0, CUPBOARD_STAND, adjacent)).toBe(true);
    });

    test('but searches anyway once the skips run out', () => {
        // Why: Sir Vyvin has wanderrange=8 in a room barely wider than that, so treating proximity as a hard blocker never clicks at all.
        const forced = Array.from({ length: 40 }, (_, i) => shouldWaitOut(i, CUPBOARD_STAND, adjacent));
        expect(forced.some(wait => !wait)).toBe(true);
    });

    test('never waits when he is already clear', () => {
        expect(shouldWaitOut(0, CUPBOARD_STAND, VYVIN_SPAWN)).toBe(false);
    });
});

describe('picking the approach tile', () => {
    const at = (x: number, z: number) => ({ x, z, level: 2 });

    test('both legal approaches are south of the cupboard', () => {
        // The cupboard spans (2984,3336)-(2985,3336) and only its south side is
        // legal, so these two tiles are the approach.
        expect(VYVIN_APPROACHES.map(t => `${t.x},${t.z},${t.level}`))
            .toEqual(['2985,3335,2', '2984,3335,2']);
    });

    test('stands on the tile further from Sir Vyvin', () => {
        // He is west, so the east approach is 3 away and the west one is 1.
        expect(bestApproach(VYVIN_APPROACHES, at(2982, 3335))).toMatchObject({ x: 2985, z: 3335 });
        // Mirrored: he is east, so the west approach wins.
        expect(bestApproach(VYVIN_APPROACHES, at(2987, 3335))).toMatchObject({ x: 2984, z: 3335 });
    });

    test('picking the far tile actually clears the guard when he is off to one side', () => {
        const vyvin = at(2982, 3335);
        const chosen = bestApproach(VYVIN_APPROACHES, vyvin);
        expect(vyvinTooClose(chosen, vyvin)).toBe(false);
    });

    test('directly south blocks both, which is what the retreat is for', () => {
        const vyvin = at(2984, 3334);
        for (const tile of VYVIN_APPROACHES) {
            expect(vyvinTooClose(tile, vyvin)).toBe(true);
        }
    });

    test('falls back to a stable tile when he is not in the scene', () => {
        expect(bestApproach(VYVIN_APPROACHES, null)).toMatchObject({ x: 2985, z: 3335 });
    });
});
