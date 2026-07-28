import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import {
    FIRE_SPOTS,
    expandLocalFirePlot,
    findBurnLane,
    firemakingLevelForLogs,
    localFirePlot,
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
        // Single-row strip: west-only so start.x is deterministic (multi-dir can
        // pick an east run of equal length from a closer tile).
        const plot = { bank: new Tile(0, 0, 0), x0: 10, x1: 14, z0: 5, z1: 5 };
        const here = { x: 12, z: 5, level: 0 };
        const occ = new Set([tileKey({ x: 11, z: 5 })]);
        const found = findBurnLane(plot, here, occ, 10, () => true, () => true, [{ dx: -1, dz: 0 }]);
        expect(found).not.toBeNull();
        expect(found!.run).toBeGreaterThanOrEqual(3);
        expect(found!.start.x).toBe(14);
        expect(found!.dir).toEqual({ dx: -1, dz: 0 });
    });

    test('nearestFireSpot picks closest bank', () => {
        expect(nearestFireSpot({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
    });

    test('shouldBurnFullLoad gates', () => {
        expect(shouldBurnFullLoad('off', true, 28, true)).toBe(false);
        expect(shouldBurnFullLoad('chop-then-burn', true, 28, true)).toBe(true);
        expect(shouldBurnFullLoad('chop-then-burn', true, 28, false)).toBe(false);
    });

    test('localFirePlot boxes origin', () => {
        const plot = localFirePlot({ x: 100, z: 200, level: 0 }, 5);
        expect(plot.bank.x).toBe(100);
        expect(plot.bank.z).toBe(200);
        expect(plot.x0).toBe(95);
        expect(plot.x1).toBe(105);
        expect(plot.z0).toBe(195);
        expect(plot.z1).toBe(205);
    });

    test('expandLocalFirePlot grows until max', () => {
        let plot = localFirePlot({ x: 50, z: 50, level: 0 }, 4);
        const next = expandLocalFirePlot(plot, 4, 24);
        expect(next).not.toBeNull();
        expect(next!.x1 - next!.x0).toBeGreaterThan(plot.x1 - plot.x0);
        for (let i = 0; i < 20 && plot; i++) {
            const n = expandLocalFirePlot(plot, 4, 8);
            if (!n) {
                expect(Math.floor((plot.x1 - plot.x0) / 2)).toBeGreaterThanOrEqual(8);
                break;
            }
            plot = n;
        }
    });
});
