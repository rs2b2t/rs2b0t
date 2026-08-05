import { describe, expect, test } from 'bun:test';
import {
    BANK_WITHDRAW_COST,
    DEFAULT_EDGE_COST,
    JEWELLERY_TELEPORT_COST,
    SPELL_TELEPORT_COST,
    edgeCostForKind,
    teleportEdgeCost
} from '#/bot/nav/edgeCosts.js';
import { WITHDRAW_COST } from '#/bot/nav/bankPlan.js';
import { DEFAULT_DISTANCE_BEFORE_TELEPORT } from '#/bot/nav/policy.js';

describe('edgeCosts (time-equivalent path costs)', () => {
    test('default tele distance gate is off (A* cost decides)', () => {
        expect(DEFAULT_DISTANCE_BEFORE_TELEPORT).toBe(0);
    });

    test('spell tele costs more than a short city walk (~20 tiles) but less than cross-map', () => {
        // A* compares tele edge + landing walk vs pure walk. Spell alone should beat
        // a 100+ tile walk but lose to a 15-tile stroll without a hard span gate.
        expect(SPELL_TELEPORT_COST).toBeGreaterThan(20);
        expect(SPELL_TELEPORT_COST).toBeLessThan(80);
        expect(JEWELLERY_TELEPORT_COST).toBeLessThan(SPELL_TELEPORT_COST);
    });

    test('dialogue travel is priced above a plain door', () => {
        expect(DEFAULT_EDGE_COST.ship).toBeGreaterThan(DEFAULT_EDGE_COST.door * 4);
        expect(DEFAULT_EDGE_COST.portal).toBeGreaterThan(DEFAULT_EDGE_COST.door * 3);
        expect(edgeCostForKind('ship')).toBe(DEFAULT_EDGE_COST.ship);
        expect(edgeCostForKind('unknown-kind')).toBe(DEFAULT_EDGE_COST.other);
    });

    test('bank withdraw cost matches bankPlan WITHDRAW_COST', () => {
        expect(WITHDRAW_COST).toBe(BANK_WITHDRAW_COST);
        // Bank + tele should only win when pure walk is substantially longer.
        expect(BANK_WITHDRAW_COST + SPELL_TELEPORT_COST).toBeLessThan(200);
        expect(BANK_WITHDRAW_COST + SPELL_TELEPORT_COST).toBeGreaterThan(50);
    });

    test('teleportEdgeCost by family', () => {
        expect(teleportEdgeCost('spell')).toBe(SPELL_TELEPORT_COST);
        expect(teleportEdgeCost('jewellery')).toBe(JEWELLERY_TELEPORT_COST);
        expect(teleportEdgeCost('lever')).toBeLessThan(SPELL_TELEPORT_COST);
        expect(teleportEdgeCost(undefined)).toBe(SPELL_TELEPORT_COST);
    });
});
