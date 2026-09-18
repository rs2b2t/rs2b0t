// Navigation cost unit: one tile at continuous run, or half a server tick. Design: @lulwut.
// Why: convert every action to this unit so A* compares elapsed time; ordinary steps assume run.

import type { TransportKind } from '../types.js';

/** Server: run takes up to this many path steps per tick. */
export const RUN_TILES_PER_TICK = 2;

/** Server: walk takes this many path steps per tick. */
export const WALK_TILES_PER_TICK = 1;

/** A* cost of one adjacent map step when running (the planner default); matches the `g + 1` expansion in PathFinder. */
export const TILE_STEP_COST = 1;

/** One adjacent map step when forced to walk (half run speed, twice the cost). */
export const TILE_STEP_COST_WALK = RUN_TILES_PER_TICK / WALK_TILES_PER_TICK; // 2

/** Convert idle/animation game ticks into path cost: 1 still tick costs the same as running {@link RUN_TILES_PER_TICK} tiles. */
export function ticksToCost(ticks: number): number {
    return Math.max(0, Math.round(ticks * RUN_TILES_PER_TICK));
}

// Server Player.updateEnergy formulas.

/** Energy scale on the server (10000 = 100.00% displayed). */
export const RUN_ENERGY_MAX = 10_000;

/** Energy recovered on a tick with `stepsTaken < 2` (walk or stand): `((baseLevels[AGILITY] / 6) | 0) + 8`. */
export function runEnergyRecoverPerTick(agilityLevel: number): number {
    const agi = Math.max(1, Math.min(99, agilityLevel | 0));
    return ((agi / 6) | 0) + 8;
}

// Why: the server takes weight kg as runweight/1000 clamped 0..64, then `loss = (67 + (67 * clampWeight) / 64) | 0`.

/** Energy drained on a tick with `stepsTaken >= 2` (ran). */
export function runEnergyDrainPerRunTick(weightKg: number): number {
    const clampWeight = Math.min(Math.max(weightKg, 0), 64);
    return (67 + (67 * clampWeight) / 64) | 0;
}

/** Continuous-run tiles before energy hits 0 with no recovery; at 0 kg that's 67/tick, ~149 run ticks, ~298 tiles. */
export function approxRunTilesBeforeEmpty(weightKg: number, energy = RUN_ENERGY_MAX): number {
    const drain = runEnergyDrainPerRunTick(weightKg);
    if (drain <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    const runTicks = Math.floor(energy / drain);
    return runTicks * RUN_TILES_PER_TICK;
}

// Action ticks converted to run-tile units.

/** Spell cast anim + scene load (~5 ticks). */
export const SPELL_TELEPORT_COST = ticksToCost(5);

/** Jewellery Rub + destination option (~4 ticks). */
export const JEWELLERY_TELEPORT_COST = ticksToCost(4);

/** Wilderness / Ardougne lever (~3 ticks). */
const LEVER_TELEPORT_COST = ticksToCost(3);

/** Open bank, withdraw a short list, close (~12 ticks); {@link planBankLeg} adds it to the walk-to-bank and bank-to-dest costs. */
export const BANK_WITHDRAW_COST = ticksToCost(12);

// Why: doors stay cheap (open + step) while dialogue-heavy travel is expensive, so short ODs stay pure walk when that is faster.

/** Default edge costs by transport kind (run-tile units). */
export const DEFAULT_EDGE_COST: Readonly<Record<TransportKind, number>> = {
    /** Open + step (~1-2 ticks). */
    door: ticksToCost(2),
    gate: ticksToCost(2),
    /** Climb / trapdoor cycle. */
    stair: ticksToCost(3),
    dungeon: ticksToCost(4),
    /** Ship / cart / glider: Talk-to + option + the ride (~18 ticks; a flat 10 underpriced the coast walk). */
    ship: ticksToCost(18),
    /** Board after docking. */
    gangplank: ticksToCost(4),
    /** Agility shortcut wait. */
    shortcut: ticksToCost(5),
    /** Spirit tree / hub portal dialogue. */
    portal: ticksToCost(10),
    /** Default for originless spell/jewellery inject when family unknown. */
    teleport: SPELL_TELEPORT_COST,
    other: ticksToCost(5)
};

/** Cost for a compiled graph edge of this kind. */
export function edgeCostForKind(kind: string | undefined): number {
    if (kind && kind in DEFAULT_EDGE_COST) {
        return DEFAULT_EDGE_COST[kind as TransportKind];
    }
    return DEFAULT_EDGE_COST.other;
}

/** Cost for a catalogued teleport hop by family; callers that only know kind==='teleport' use {@link DEFAULT_EDGE_COST.teleport}. */
export function teleportEdgeCost(family: 'spell' | 'jewellery' | 'lever' | undefined): number {
    if (family === 'jewellery') {
        return JEWELLERY_TELEPORT_COST;
    }
    if (family === 'lever') {
        return LEVER_TELEPORT_COST;
    }
    return SPELL_TELEPORT_COST;
}
