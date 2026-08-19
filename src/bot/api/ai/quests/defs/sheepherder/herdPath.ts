// docs/QUESTS.md

/** What the herder needs to know about the ground, so the search is testable without a scene. */
export interface HerdGrid {
    walkable(x: number, z: number): boolean;
    /** Whether a size-1 entity standing on (x,z) may take one cardinal step. */
    canStep(x: number, z: number, dx: number, dz: number): boolean;
}

export interface HerdBox {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

export interface HerdDir {
    dx: number;
    dz: number;
}

/** North, east, south, west — `coord_direction` returns nothing else. */
export const HERD_DIRS: readonly HerdDir[] = [
    { dx: 0, dz: 1 },
    { dx: 1, dz: 0 },
    { dx: 0, dz: -1 },
    { dx: -1, dz: 0 }
];

/** How far outside the sheep/goal bounding box the search may wander. */
const MARGIN = 24;

const key = (x: number, z: number): number => x * 100_000 + z;

// Why: `prod_sheep` walks the sheep one tile along `coord_direction(player, sheep)`, which is cardinal and points away from the player — so a push is legal only where the opposite tile is standable.
// Why: that tile also has to be able to step onto the sheep, or the Prod op cannot reach it from there; the fence east of the second sheep's field is walkable on both sides and passable on neither.

/** Whether a sheep on (x,z) can be pushed one tile in `dir`. */
export function pushable(grid: HerdGrid, x: number, z: number, dir: HerdDir): boolean {
    return grid.canStep(x, z, dir.dx, dir.dz)
        && grid.walkable(x + dir.dx, z + dir.dz)
        && grid.walkable(x - dir.dx, z - dir.dz)
        && grid.canStep(x - dir.dx, z - dir.dz, dir.dx, dir.dz);
}

export function inBox(box: HerdBox, x: number, z: number): boolean {
    return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
}

// Why: a walkable tile with no standable side is a trap — a wandering sheep can walk in and no prod can move it out again, and the engine frees it only by teleporting it home 500 ticks later.

/** Whether no push at all can be issued at (x,z). */
export function pinned(grid: HerdGrid, x: number, z: number): boolean {
    return grid.walkable(x, z) && !HERD_DIRS.some(dir => pushable(grid, x, z, dir));
}

/** Whether (x,z) touches a trap, and so is one wander step from losing the sheep. */
export function risky(grid: HerdGrid, x: number, z: number, isPinned = (px: number, pz: number): boolean => pinned(grid, px, pz)): boolean {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (isPinned(x + dx, z + dz)) {
                return true;
            }
        }
    }
    return false;
}

function bounds(sheep: { x: number; z: number }, goal: HerdBox): HerdBox {
    return {
        x0: Math.min(sheep.x, goal.x0) - MARGIN,
        x1: Math.max(sheep.x, goal.x1) + MARGIN,
        z0: Math.min(sheep.z, goal.z0) - MARGIN,
        z1: Math.max(sheep.z, goal.z1) + MARGIN
    };
}

function search(grid: HerdGrid, box: HerdBox, goal: HerdBox, skip?: (x: number, z: number) => boolean): Map<number, number> {
    const dist = new Map<number, number>();
    const queue: { x: number; z: number }[] = [];
    for (let x = goal.x0; x <= goal.x1; x++) {
        for (let z = goal.z0; z <= goal.z1; z++) {
            if (!grid.walkable(x, z) || skip?.(x, z) === true) {
                continue;
            }
            // Why: the jump prod needs a stand of its own, or a sheep parked in the gate zone can never be sent over.
            if (!HERD_DIRS.some(d => grid.walkable(x - d.dx, z - d.dz))) {
                continue;
            }
            dist.set(key(x, z), 0);
            queue.push({ x, z });
        }
    }
    for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        const next = dist.get(key(cur.x, cur.z))! + 1;
        for (const dir of HERD_DIRS) {
            const px = cur.x - dir.dx;
            const pz = cur.z - dir.dz;
            if (!inBox(box, px, pz) || dist.has(key(px, pz)) || skip?.(px, pz) === true) {
                continue;
            }
            if (!grid.walkable(px, pz) || !pushable(grid, px, pz, dir)) {
                continue;
            }
            dist.set(key(px, pz), next);
            queue.push({ x: px, z: pz });
        }
    }
    return dist;
}

/**
 * Prod distances to `goal`, measured in pushes.
 * Why: searching backwards from the pen gives every tile its own next push, so a sheep that wanders mid-herd is re-routed rather than walked back to the plan.
 */
export function herdDistances(grid: HerdGrid, sheep: { x: number; z: number }, goal: HerdBox): Map<number, number> {
    return search(grid, bounds(sheep, goal), goal);
}

export interface HerdPlan {
    /** Routes that never touch a trap's neighbourhood; empty where none exists. */
    clear: Map<number, number>;
    /** Routes over every tile a push can drive. */
    any: Map<number, number>;
}

// Why: two plain searches rather than one weighted one, because a per-step penalty is not a consistent potential and the greedy follow oscillated between two tiles forever.

/** Both route maps, sharing one trap lookup. */
export function herdPlan(grid: HerdGrid, sheep: { x: number; z: number }, goal: HerdBox): HerdPlan {
    const box = bounds(sheep, goal);
    const memo = new Map<number, boolean>();
    const isPinned = (x: number, z: number): boolean => {
        const k = key(x, z);
        const hit = memo.get(k);
        if (hit !== undefined) {
            return hit;
        }
        const value = pinned(grid, x, z);
        memo.set(k, value);
        return value;
    };
    return {
        clear: search(grid, box, goal, (x, z) => risky(grid, x, z, isPinned)),
        any: search(grid, box, goal)
    };
}

// Why: the two maps have to be read as one number, because picking whichever map holds the sheep's own tile swaps potentials as it wanders on and off the clear network — and two potentials pushed a sheep eleven tiles east and back for 250 pushes.

/** How much worse any route off the clear network is, in pushes. */
const OFF_NETWORK = 1000;

/** Pushes from (x,z) to the pen, counting a route that touches a trap as far worse than one that does not. */
export function herdCost(plan: HerdPlan, x: number, z: number): number | undefined {
    const clear = plan.clear.get(key(x, z));
    if (clear !== undefined) {
        return clear;
    }
    const any = plan.any.get(key(x, z));
    return any === undefined ? undefined : any + OFF_NETWORK;
}

/** Every legal push from the sheep's tile, closest-to-the-pen first. */
export function herdDirections(
    grid: HerdGrid,
    sheep: { x: number; z: number },
    goal: HerdBox,
    plan?: HerdPlan
): HerdDir[] {
    const routes = plan ?? herdPlan(grid, sheep, goal);
    const scored: { dir: HerdDir; cost: number }[] = [];
    for (const dir of HERD_DIRS) {
        if (!pushable(grid, sheep.x, sheep.z, dir)) {
            continue;
        }
        const cost = herdCost(routes, sheep.x + dir.dx, sheep.z + dir.dz);
        if (cost === undefined) {
            continue;
        }
        scored.push({ dir, cost });
    }
    scored.sort((a, b) => a.cost - b.cost);
    return scored.map(s => s.dir);
}

export function herdDistance(dist: Map<number, number>, x: number, z: number): number | undefined {
    return dist.get(key(x, z));
}
