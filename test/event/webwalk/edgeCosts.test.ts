import { describe, expect, test } from 'bun:test';
import {
    BANK_WITHDRAW_COST,
    DEFAULT_EDGE_COST,
    JEWELLERY_TELEPORT_COST,
    RUN_ENERGY_MAX,
    RUN_TILES_PER_TICK,
    SPELL_TELEPORT_COST,
    TILE_STEP_COST,
    TILE_STEP_COST_WALK,
    WALK_TILES_PER_TICK,
    approxRunTilesBeforeEmpty,
    edgeCostForKind,
    runEnergyDrainPerRunTick,
    runEnergyRecoverPerTick,
    teleportEdgeCost,
    ticksToCost
} from '#/bot/event/webwalk/geometry/edgeCosts.js';
import { WITHDRAW_COST } from '#/bot/event/webwalk/bankPlan.js';
import { DEFAULT_DISTANCE_BEFORE_TELEPORT } from '#/bot/event/webwalk/policy.js';

describe('edgeCosts (server run/walk + time costs)', () => {
    test('default tele distance gate is off (A* cost decides)', () => {
        expect(DEFAULT_DISTANCE_BEFORE_TELEPORT).toBe(0);
    });

    test('server movement rates: run 2 tiles/tick, walk 1 tile/tick', () => {
        expect(RUN_TILES_PER_TICK).toBe(2);
        expect(WALK_TILES_PER_TICK).toBe(1);
        expect(TILE_STEP_COST).toBe(1);
        expect(TILE_STEP_COST_WALK).toBe(2);
    });

    test('ticksToCost maps animation time into run-tile units', () => {
        // 1 tick standing = opportunity cost of running 2 tiles
        expect(ticksToCost(1)).toBe(2);
        expect(ticksToCost(5)).toBe(10);
        expect(SPELL_TELEPORT_COST).toBe(ticksToCost(5));
        expect(JEWELLERY_TELEPORT_COST).toBe(ticksToCost(4));
    });

    test('spell tele costs less run-distance than a medium OD, more than a few tiles', () => {
        // ~5 ticks ≈ 10 run-tiles; 30-tile run is still longer in time
        expect(SPELL_TELEPORT_COST).toBe(10);
        expect(SPELL_TELEPORT_COST).toBeLessThan(30);
        expect(JEWELLERY_TELEPORT_COST).toBeLessThan(SPELL_TELEPORT_COST);
    });

    test('server run energy recover/drain (Player.updateEnergy)', () => {
        // agility 1: (1/6)|0 + 8 = 8; agility 99: (99/6)|0 + 8 = 16+8 = 24
        expect(runEnergyRecoverPerTick(1)).toBe(8);
        expect(runEnergyRecoverPerTick(99)).toBe(24);
        // 0 kg: drain 67; 64 kg: drain 67+67 = 134
        expect(runEnergyDrainPerRunTick(0)).toBe(67);
        expect(runEnergyDrainPerRunTick(64)).toBe(134);
        expect(runEnergyDrainPerRunTick(100)).toBe(134); // clamp
        expect(RUN_ENERGY_MAX).toBe(10_000);
        // 0 kg full bar ≈ floor(10000/67)*2 tiles of pure run
        expect(approxRunTilesBeforeEmpty(0)).toBe(Math.floor(10_000 / 67) * 2);
    });

    test('dialogue travel is priced above a plain door', () => {
        expect(DEFAULT_EDGE_COST.ship).toBeGreaterThan(DEFAULT_EDGE_COST.door * 4);
        expect(DEFAULT_EDGE_COST.portal).toBeGreaterThan(DEFAULT_EDGE_COST.door * 2);
        expect(edgeCostForKind('ship')).toBe(DEFAULT_EDGE_COST.ship);
        expect(edgeCostForKind('unknown-kind')).toBe(DEFAULT_EDGE_COST.other);
    });

    test('bank withdraw cost matches bankPlan WITHDRAW_COST', () => {
        expect(WITHDRAW_COST).toBe(BANK_WITHDRAW_COST);
        expect(BANK_WITHDRAW_COST).toBe(ticksToCost(12));
    });

    test('teleportEdgeCost by family', () => {
        expect(teleportEdgeCost('spell')).toBe(SPELL_TELEPORT_COST);
        expect(teleportEdgeCost('jewellery')).toBe(JEWELLERY_TELEPORT_COST);
        expect(teleportEdgeCost('lever')).toBe(ticksToCost(3));
        expect(teleportEdgeCost(undefined)).toBe(SPELL_TELEPORT_COST);
    });
});
