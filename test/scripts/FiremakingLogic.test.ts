import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import {
    FIRE_SPOTS,
    findBurnLane,
    firemakingLevelForLogs,
    logsForTree,
    nearestFireSpot,
    parseBurnMode,
    runWest,
    shouldBurnFullLoad,
    tileKey
} from '#/bot/scripts/FiremakingLogic.js';

describe('FiremakingLogic', () => {
    test('parseBurnMode', () => {
        expect(parseBurnMode('Off')).toBe('off');
        expect(parseBurnMode('Chop then burn')).toBe('chop-then-burn');
    });

    test('logsForTree maps scenery names', () => {
        expect(logsForTree('Tree')).toBe('Logs');
        expect(logsForTree('Oak')).toBe('Oak logs');
        expect(logsForTree('Willow')).toBe('Willow logs');
        expect(logsForTree('Yew')).toBe('Yew logs');
        expect(logsForTree('Magic tree')).toBe('Magic logs');
    });

    test('firemakingLevelForLogs', () => {
        expect(firemakingLevelForLogs('Logs')).toBe(1);
        expect(firemakingLevelForLogs('Yew logs')).toBe(60);
    });

    test('runWest stops on occupied / cap', () => {
        const plot = FIRE_SPOTS['Varrock East'];
        const from = { x: 3260, z: 3429, level: 0 };
        expect(runWest(from, plot, new Set(), () => true, () => true, 5)).toBe(5);
        const blocked = new Set([tileKey({ x: 3258, z: 3429 })]);
        expect(runWest(from, plot, blocked, () => true, () => true, 10)).toBe(2);
    });

    test('findBurnLane prefers longer runs', () => {
        const plot = { bank: new Tile(0, 0, 0), x0: 10, x1: 14, z0: 5, z1: 5 };
        const here = { x: 12, z: 5, level: 0 };
        const occ = new Set([tileKey({ x: 11, z: 5 })]);
        const found = findBurnLane(plot, here, occ, 10, () => true, () => true);
        expect(found).not.toBeNull();
        expect(found!.run).toBeGreaterThanOrEqual(3);
        expect(found!.start.x).toBe(14);
    });

    test('nearestFireSpot picks closest bank', () => {
        expect(nearestFireSpot({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
    });

    test('shouldBurnFullLoad gates', () => {
        expect(shouldBurnFullLoad('off', true, 28, true)).toBe(false);
        expect(shouldBurnFullLoad('chop-then-burn', true, 28, true)).toBe(true);
        expect(shouldBurnFullLoad('chop-then-burn', true, 28, false)).toBe(false);
    });
});
