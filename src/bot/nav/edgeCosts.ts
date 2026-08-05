/**
 * Nav path costs — tile-equivalents of **time**.
 *
 * Pathfinder A* (and bank planning) pick the **lowest total cost**. Walk edges
 * cost ~1 per Chebyshev step. Non-walk actions are priced as estimated game
 * time converted into the same units so a teleport/glider/ship only wins when
 * it actually saves travel.
 *
 * Design (@lulwut): prefer calibrated action costs over static gates like
 * `distanceBeforeTeleport`. Bank-for-tele is `toBank + BANK_WITHDRAW_COST +
 * bank→dest (with virtual items)` vs pure-walk direct — same currency.
 *
 * Scale: 1 unit ≈ 1 run tile of opportunity cost. Rough tick mapping is for
 * operators tuning numbers, not a strict physics model.
 *
 * @see docs/NAV.md (pathfinding / nav teleports)
 * @see bankPlan.ts
 */

import type { TransportKind } from './types.js';

/** ~1 game tick of wall time expressed in tile-equivalent cost. */
export const TICK_COST = 1;

/**
 * Spell teleport: cast animation + map load (~4–6 ticks).
 * Pure walks shorter than this cost never prefer a tele (A* does the compare).
 */
export const SPELL_TELEPORT_COST = 28;

/** Jewellery Rub + destination dialogue (~3–5 ticks). Slightly cheaper than cast. */
export const JEWELLERY_TELEPORT_COST = 22;

/** Wilderness / Ardougne lever pull + tele (~3 ticks). */
export const LEVER_TELEPORT_COST = 18;

/**
 * Open bank booth/chest, withdraw a short path-scoped list, close.
 * Used by {@link planBankLeg} with walk-to-bank + bank→dest path costs.
 */
export const BANK_WITHDRAW_COST = 40;

/**
 * Default edge costs by transport kind (tile-equivalents).
 * Doors stay cheap (open + step). Dialogue-heavy travel is expensive so pure
 * walk wins on short ODs and multi-hop “chat every pad” routes stay honest.
 */
export const DEFAULT_EDGE_COST: Readonly<Record<TransportKind, number>> = {
    /** Open + step through. */
    door: 4,
    gate: 4,
    /** Climb / trapdoor cycle. */
    stair: 8,
    dungeon: 10,
    /**
     * Ship / cart / glider fare: Talk-to + option + wait for sail/ride.
     * Was 10 (too cheap vs walking the coast).
     */
    ship: 36,
    /** Board after docking. */
    gangplank: 12,
    /** Agility shortcut wait. */
    shortcut: 12,
    /** Spirit tree / hub portal dialogue. */
    portal: 24,
    /** Default for originless spell/jewellery inject when family unknown. */
    teleport: SPELL_TELEPORT_COST,
    other: 12
};

/** Cost for a compiled graph edge of this kind. */
export function edgeCostForKind(kind: string | undefined): number {
    if (kind && kind in DEFAULT_EDGE_COST) {
        return DEFAULT_EDGE_COST[kind as TransportKind];
    }
    return DEFAULT_EDGE_COST.other;
}

/**
 * Cost for a catalogued teleport hop by family.
 * Callers that only know kind==='teleport' use {@link DEFAULT_EDGE_COST.teleport}.
 */
export function teleportEdgeCost(family: 'spell' | 'jewellery' | 'lever' | undefined): number {
    if (family === 'jewellery') {
        return JEWELLERY_TELEPORT_COST;
    }
    if (family === 'lever') {
        return LEVER_TELEPORT_COST;
    }
    return SPELL_TELEPORT_COST;
}
