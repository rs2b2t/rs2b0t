import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import {
    BURN_WEST,
    FIRE_SPOTS,
    burnLaneWant,
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
} from '#/bot/api/firemaking/Firemaking.js';

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

    test('burnLaneWant caps at 27', () => {
        expect(burnLaneWant(0)).toBe(1);
        expect(burnLaneWant(5)).toBe(5);
        expect(burnLaneWant(27)).toBe(27);
        expect(burnLaneWant(28)).toBe(27);
        expect(burnLaneWant(99)).toBe(27);
    });

    test('runWest stops on occupied / cap', () => {
        const plot = FIRE_SPOTS['Varrock East'];
        const from = { x: 3260, z: 3429, level: 0 };
        expect(runWest(from, plot, new Set(), () => true, () => true, 5)).toBe(5);
        const blocked = new Set([tileKey({ x: 3258, z: 3429 })]);
        expect(runWest(from, plot, blocked, () => true, () => true, 10)).toBe(2);
    });

    test('findBurnLane prefers longer west runs', () => {
        // Single-row strip: west-only so start.x is deterministic.
        const plot = { bank: new Tile(0, 0, 0), x0: 10, x1: 14, z0: 5, z1: 5 };
        const here = { x: 12, z: 5, level: 0 };
        const occ = new Set([tileKey({ x: 11, z: 5 })]);
        const found = findBurnLane(plot, here, occ, 10, () => true, () => true, [BURN_WEST]);
        expect(found).not.toBeNull();
        expect(found!.run).toBeGreaterThanOrEqual(3);
        expect(found!.start.x).toBe(14);
        expect(found!.dir).toEqual(BURN_WEST);
    });

    test('findBurnLane prefers a full-load west lane over a longer partial elsewhere', () => {
        // z=5: free x=11..14 → max west run 4 (partial for want=5), closer to the player.
        // z=6: free x=11..15 → max west run 5 (full load), farther.
        const plot = { bank: new Tile(0, 0, 0), x0: 10, x1: 15, z0: 5, z1: 6 };
        const here = { x: 14, z: 5, level: 0 };
        const occ = new Set([
            tileKey({ x: 10, z: 5 }),
            tileKey({ x: 15, z: 5 }), // blocks z=5 from reaching 5 tiles
            tileKey({ x: 10, z: 6 })
        ]);
        const found = findBurnLane(plot, here, occ, 5, () => true, () => true);
        expect(found).not.toBeNull();
        expect(found!.dir).toEqual(BURN_WEST);
        expect(found!.run).toBe(5);
        expect(found!.start.z).toBe(6);
        expect(found!.start.x).toBe(15);
    });

    test('findBurnLane falls back to a single free tile when no west lane exists', () => {
        // Only one free tile; west neighbor is occupied so multi-light west fails.
        const plot = { bank: new Tile(0, 0, 0), x0: 10, x1: 12, z0: 5, z1: 5 };
        const here = { x: 11, z: 5, level: 0 };
        const occ = new Set([tileKey({ x: 10, z: 5 }), tileKey({ x: 12, z: 5 })]);
        const found = findBurnLane(plot, here, occ, 10, () => true, () => true);
        expect(found).not.toBeNull();
        expect(found!.start.x).toBe(11);
        expect(found!.run).toBe(1);
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
