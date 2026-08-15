import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import { UNSHEARED_SHEEP_ID, gatherWool, type WoolSites } from '#/bot/api/ai/quests/exec/wool.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const SITES: WoolSites = {
    pen: new Tile(3197, 3266, 0),
    wheelStand: new Tile(3209, 3213, 1),
    shearsSpawn: new Tile(3152, 3306, 0),
    spinLabel: 'spin wool at Lumbridge'
};

const snap = (items: [string, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(items),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('gatherWool', () => {
    test('the unsheared sheep npc id is 43', () => {
        expect(UNSHEARED_SHEEP_ID).toBe(43);
    });

    test('no shears -> grab the shears spawn, not the pen', () => {
        const step = gatherWool(snap(), 3, SITES);
        expect(step.kind === 'grabGround' && step.item).toBe('Shears');
        expect(step.kind === 'grabGround' && step.anchor.x).toBe(3152);
    });

    test('shears but not enough wool -> shear', () => {
        const step = gatherWool(snap([['shears', 1]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toContain('shear');
    });

    test('enough wool -> spin, under the caller-supplied label', () => {
        const step = gatherWool(snap([['shears', 1], ['wool', 3]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toBe('spin wool at Lumbridge');
    });
});

describe('sheepshearer keeps its own sites and its own labels', () => {
    test('gatherBalls still returns the same step kinds and the Falador label', async () => {
        const { gatherBalls } = await import('#/bot/api/ai/quests/defs/sheepshearer.js');
        expect(gatherBalls(snap(), 20).kind).toBe('grabGround');
        expect(gatherBalls(snap([['shears', 1]]), 20).kind).toBe('custom');
        const spin = gatherBalls(snap([['shears', 1], ['wool', 20]]), 20);
        expect(spin.kind === 'custom' && spin.name).toBe('spin wool at Falador');
    });

    test('its shears spawn is still the free one at 3152,3306', async () => {
        const { gatherBalls } = await import('#/bot/api/ai/quests/defs/sheepshearer.js');
        const step = gatherBalls(snap(), 20);
        expect(step.kind === 'grabGround' && step.anchor.x).toBe(3152);
        expect(step.kind === 'grabGround' && step.anchor.z).toBe(3306);
    });
});
