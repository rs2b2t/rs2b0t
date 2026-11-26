import type { WorldTile } from '../adapter/ClientAdapter.js';

type Origin = { x: number; z: number; level?: number };

export function chebyshev(a: Origin, b: Origin): number {
    if ((a.level ?? 0) !== (b.level ?? 0)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function findCookSurface<T extends WorldTile>(
    catalog: readonly T[],
    origin: WorldTile,
    maxCheb: number,
    priority: (entry: T) => number
): { entry: T; distance: number } | null {
    let best: { entry: T; distance: number } | null = null;
    let bestPriority = Infinity;
    for (const entry of catalog) {
        if (entry.level !== origin.level) continue;
        const distance = chebyshev(origin, entry);
        if (distance > maxCheb) continue;
        const rank = priority(entry);
        if (!best || rank < bestPriority || (rank === bestPriority && distance < best.distance)) {
            best = { entry, distance };
            bestPriority = rank;
        }
    }
    return best;
}
