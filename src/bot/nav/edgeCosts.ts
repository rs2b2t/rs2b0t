/**
 * Nav path costs — **time**, in run-tile units.
 *
 * Pathfinder A* (and bank planning) pick the **lowest total cost**. Adjacent
 * walk graph steps cost {@link TILE_STEP_COST} each. Non-walk actions are
 * priced with {@link ticksToCost} so a teleport/glider/ship only wins when it
 * saves real travel time.
 *
 * ## Server movement (Lost City engine / Player + PathingEntity)
 *
 * - **Walk** (`MoveSpeed.WALK`): 1 path step per game tick.
 * - **Run** (`MoveSpeed.RUN`): up to 2 path steps per game tick
 *   (`processMovement` takes walkDir then runDir).
 *
 * Run energy (`Player.updateEnergy`, energy 0…10000):
 * - `stepsTaken < 2` (idle or walk): recover `((agility/6)|0) + 8`
 * - `stepsTaken >= 2` (ran this tick): drain `(67 + 67*clamp(weightKg,0,64)/64)|0`
 * - energy 0 → run toggled off; energy &lt; 100 → tempRun cleared
 *
 * Cost **unit** = one map tile at continuous **run** (2 tiles / tick).
 * So wall-time ticks ≈ cost / {@link RUN_TILES_PER_TICK} while running.
 * Pure walk is half speed → twice the cost per tile ({@link TILE_STEP_COST_WALK}).
 *
 * Default A* assumes run for step costs (bots enable run). Full energy
 * simulation (drain/recover along the route) is future work; constants below
 * use the server formulas for recover/drain helpers and tick→cost conversion.
 *
 * Design (@lulwut): calibrate action time; prefer cost over static span gates.
 *
 * @see Server engine `Player.updateEnergy`, `PathingEntity.processMovement`
 * @see bankPlan.ts
 */

import type { TransportKind } from './types.js';

/** Server: run takes up to this many path steps per tick. */
export const RUN_TILES_PER_TICK = 2;

/** Server: walk takes this many path steps per tick. */
export const WALK_TILES_PER_TICK = 1;

/**
 * A* cost of one adjacent map step when **running** (default planner assumption).
 * Matches `g + 1` walk expansion in PathFinder.
 */
export const TILE_STEP_COST = 1;

/** One adjacent map step when forced to walk (half run speed → 2× cost). */
export const TILE_STEP_COST_WALK = RUN_TILES_PER_TICK / WALK_TILES_PER_TICK; // 2

/**
 * Convert idle/animation **game ticks** into path cost (run-tile units).
 * 1 tick of standing still costs the same as running {@link RUN_TILES_PER_TICK} tiles.
 */
export function ticksToCost(ticks: number): number {
    return Math.max(0, Math.round(ticks * RUN_TILES_PER_TICK));
}

// ── Run energy (server Player.updateEnergy) ─────────────────────────────────

/** Energy scale on the server (10000 = 100.00% displayed). */
export const RUN_ENERGY_MAX = 10_000;

/**
 * Energy recovered on a tick with `stepsTaken < 2` (walk or stand).
 * Server: `((baseLevels[AGILITY] / 6) | 0) + 8`
 */
export function runEnergyRecoverPerTick(agilityLevel: number): number {
    const agi = Math.max(1, Math.min(99, agilityLevel | 0));
    return ((agi / 6) | 0) + 8;
}

/**
 * Energy drained on a tick with `stepsTaken >= 2` (ran).
 * Server: weight kg = runweight/1000, clamp 0…64;
 * `loss = (67 + (67 * clampWeight) / 64) | 0`
 */
export function runEnergyDrainPerRunTick(weightKg: number): number {
    const clampWeight = Math.min(Math.max(weightKg, 0), 64);
    return (67 + (67 * clampWeight) / 64) | 0;
}

/**
 * Approx. continuous-run tiles before energy hits 0 from full (no recover).
 * At 0 kg: drain 67/tick → ~149 run-ticks → ~298 tiles.
 */
export function approxRunTilesBeforeEmpty(weightKg: number, energy = RUN_ENERGY_MAX): number {
    const drain = runEnergyDrainPerRunTick(weightKg);
    if (drain <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    const runTicks = Math.floor(energy / drain);
    return runTicks * RUN_TILES_PER_TICK;
}

// ── Action costs (ticks → run-tile units via ticksToCost) ────────────────────

/** Spell cast anim + scene load (~5 ticks). */
export const SPELL_TELEPORT_COST = ticksToCost(5);

/** Jewellery Rub + destination option (~4 ticks). */
export const JEWELLERY_TELEPORT_COST = ticksToCost(4);

/** Wilderness / Ardougne lever (~3 ticks). */
export const LEVER_TELEPORT_COST = ticksToCost(3);

/**
 * Open bank, withdraw a short path-scoped list, close (~12 ticks).
 * Used by {@link planBankLeg} with walk-to-bank + bank→dest path costs.
 */
export const BANK_WITHDRAW_COST = ticksToCost(12);

/**
 * Default edge costs by transport kind (run-tile units).
 * Doors stay cheap (open + step). Dialogue-heavy travel is expensive so short
 * ODs stay pure walk when that is faster.
 */
export const DEFAULT_EDGE_COST: Readonly<Record<TransportKind, number>> = {
    /** Open + step (~1–2 ticks). */
    door: ticksToCost(2),
    gate: ticksToCost(2),
    /** Climb / trapdoor cycle. */
    stair: ticksToCost(3),
    dungeon: ticksToCost(4),
    /**
     * Ship / cart / glider: Talk-to + option + wait for sail/ride.
     * (~18 ticks — was flat 10 and underpriced the coast walk).
     */
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
