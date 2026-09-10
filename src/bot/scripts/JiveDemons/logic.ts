import { gapTo, type Spot } from '../JiveDragons/logic.js';

export interface Body {
    tile: Spot;
    size: number;
}

/** How close a demon may stand to a drop before the walk to it is a walk into its hunt range. */
export const LOOT_GUARD = 4;

// Why: a black demon hunts within three tiles with line of sight, so a drop at its feet is a walk into melee, and the drop outlasts its wander.

/** Whether a demon stands close enough to `drop` that fetching it means fighting on foot. */
export function guarded(drop: Spot, bodies: readonly Body[], radius = LOOT_GUARD): boolean {
    return bodies.some(b => gapTo(drop, b.tile, b.size) <= radius);
}
