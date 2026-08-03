/**
 * Classic / pre-v2 parity guards.
 * Baseline: bce3c6e (before nav-v2 dual-run). Classic must not lose ships/skill
 * doors when WorldState is omitted (pack tools, snapshot failure).
 */
import { describe, expect, test } from 'bun:test';
import { meetsRequires, isEdgeAllowed, hasGatingRequires } from '#/bot/nav/v2/requires.js';
import { specialRequiresAt } from '#/bot/nav/v2/specialRequires.js';
import { resolveNavEngine, isNavV2, NAV_ENGINE_CLASSIC } from '#/bot/nav/navEngine.js';

describe('classic engine default', () => {
    test('resolveNavEngine defaults to classic', () => {
        expect(resolveNavEngine(undefined)).toBe(NAV_ENGINE_CLASSIC);
        expect(resolveNavEngine(null)).toBe(NAV_ENGINE_CLASSIC);
        expect(isNavV2(undefined)).toBe(false);
        expect(isNavV2('classic')).toBe(false);
        expect(isNavV2('v2')).toBe(true);
    });
});

describe('requires without WorldState (pre-v2 pack parity)', () => {
    test('isEdgeAllowed fail-open only when no gates; gated without state is closed at helper', () => {
        // Helper stays fail-closed for explicit "is this edge allowed right now?"
        // PathFinder search is the fail-open path when state is omitted (see classicParity search).
        expect(isEdgeAllowed(undefined, undefined)).toBe(true);
        expect(hasGatingRequires({ currency: { name: 'Coins', amount: 30 } })).toBe(true);
        expect(isEdgeAllowed({ currency: { name: 'Coins', amount: 30 } }, undefined)).toBe(false);
    });

    test('ship pier and guild doors still carry requires for live state filtering', () => {
        // Plan-time metadata exists so live WorldState can filter — not removed for classic.
        expect(specialRequiresAt(3027, 3218, 0)?.currency?.amount).toBe(30);
        expect(specialRequiresAt(2611, 3394, 0)?.skills?.[0]?.level).toBe(68);
    });

    test('meetsRequires still fails closed when state is present and short', () => {
        const state = {
            members: true,
            skills: {},
            freeSlots: 28,
            entranaRestrictedGear: false,
            questStatus: () => 'unknown' as const,
            itemCount: () => 0,
            wornCount: () => 0
        };
        expect(meetsRequires({ currency: { name: 'Coins', amount: 30 } }, state).ok).toBe(false);
        expect(
            meetsRequires(
                { currency: { name: 'Coins', amount: 30 } },
                { ...state, itemCount: () => 30 }
            ).ok
        ).toBe(true);
    });
});
