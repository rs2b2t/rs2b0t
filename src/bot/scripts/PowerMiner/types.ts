import type { Loc } from '../../api/model/Loc.js';
import type Tile from '../../geometry/Tile.js';

/** Iron rocks are the only power-mining target: fast rocks, one ore then a respawn. */
export type IronRock = {
    id: number;
    tile: Tile;
    loc: Loc;
};

/** Per-tick snapshot; the controller never reads live game state itself. */
export type Observation = {
    tick: number;
    at: number;
    /** Milliseconds since the previous observation; 600 on the first. */
    gapMs: number;
    anim: number;
    freeSlots: number;
    /** Slots holding iron ore at this tick, oldest first. */
    oreSlots: number[];
    /** Slots to drop: iron ore plus EXTRA_DROP_IDS. */
    dropSlots: number[];
    tile: Tile | null;
    /** Iron rocks currently in scene, filtered to the camp. */
    live: IronRock[];
    /** Keys of depleted rock locs (rocks1/rocks2) in the camp. */
    depleted: ReadonlySet<string>;
};

/** Services the controller needs; it knows nothing about camps, paint or the runner. */
export type PowerMineHost = {
    nowMs(): number;
    /**
     * Drop these inventory slots, then click the rock, in one tick.
     * Returns the tick the batch is dispatched.
     */
    send(drops: readonly number[], rock: IronRock | null): number;
    log(message: string): void;
    setStatus(message: string): void;
};

export type ControllerDebug = {
    current: string | null;
    clicks: number;
    drops: number;
    waits: number;
    recoveries: number;
    triggers: number;
    medianRespawn: number | null;
    ringCapacity: number;
    misses: number;
    cadence: number;
};

export type PowerMinerDebug = {
    status: string;
    location: string;
    anchor: { x: number; z: number; level: number };
    radius: number;
    ores: number;
    controller: ControllerDebug;
    obs: Observation | null;
};
