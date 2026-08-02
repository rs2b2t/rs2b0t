import { describe, expect, test } from 'bun:test';

import { SPECIAL_CROSSINGS, meetsSkill, specialCrossingAt } from '#/bot/nav/data/specialCrossings.js';
import transports from '#/bot/nav/data/transports.json';

const WEST = { x: 2598, z: 3477, level: 0 } as const;
const EAST = { x: 2603, z: 3477, level: 0 } as const;

describe('meetsSkill', () => {
    test('no requirement always passes', () => {
        expect(meetsSkill(1)).toBe(true);
    });
    test('at or above the gate passes', () => {
        expect(meetsSkill(20, { name: 'agility', level: 20 })).toBe(true);
        expect(meetsSkill(60, { name: 'agility', level: 20 })).toBe(true);
    });
    test('below the gate fails', () => {
        expect(meetsSkill(19, { name: 'agility', level: 20 })).toBe(false);
        expect(meetsSkill(0, { name: 'agility', level: 20 })).toBe(false);
    });
});

describe('log balance transport edges', () => {
    const edges = transports.filter(t => t.locName === 'Log balance');

    test('exactly one edge each way', () => {
        expect(edges).toHaveLength(2);
    });

    test('the pair is symmetric between the two river stands', () => {
        expect(edges).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ from: WEST, to: EAST, action: 'Walk-across', kind: 'shortcut' }),
                expect.objectContaining({ from: EAST, to: WEST, action: 'Walk-across', kind: 'shortcut' })
            ])
        );
    });
});

describe('log balance special crossings', () => {
    test('each direction is keyed at its own from-stand', () => {
        // PathFinder records transport.locX/locZ as the edge's from tile.
        expect(specialCrossingAt(WEST.x, WEST.z, 0)?.label).toBe('Coal trucks log balance');
        expect(specialCrossingAt(EAST.x, EAST.z, 0)?.label).toBe('Coal trucks log balance');
    });

    test('both are gated on Agility 20', () => {
        for (const tile of [WEST, EAST]) {
            expect(specialCrossingAt(tile.x, tile.z, 0)?.requiresSkill).toEqual({ name: 'agility', level: 20 });
        }
    });

    test('the loc name and op match the content', () => {
        const sc = specialCrossingAt(WEST.x, WEST.z, 0);
        expect(sc?.locName).toBe('Log balance');
        expect(sc?.action).toBe('Walk-across');
    });

    test('every skill-gated crossing has a matching transport edge to prune', () => {
        const gated = SPECIAL_CROSSINGS.filter(sc => sc.requiresSkill);
        expect(gated.length).toBeGreaterThan(0);
        for (const sc of gated) {
            const edge = transports.find(t => t.from.x === sc.x && t.from.z === sc.z && t.from.level === sc.level);
            expect(edge, `no transport edge starts at ${sc.label} (${sc.x},${sc.z})`).toBeDefined();
        }
    });
});
