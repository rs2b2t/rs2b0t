export interface DoorCandidate {
    readonly name: string | null;
    readonly ops: readonly (string | null)[];
    readonly distance: number;
}

export function obstacleList(raw: string): string[] {
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function nameMatches(name: string, obstacle: string): boolean {
    // Why: `includes('door')` matches Trapdoor, which is not a door.
    if (obstacle === 'door') {
        return /(?:^| )door$/.test(name);
    }
    return name.includes(obstacle);
}

export function isShutDoor(name: string | null, ops: readonly (string | null)[], obstacles: string[]): boolean {
    const n = (name ?? '').trim().toLowerCase();
    if (!n || !obstacles.some(k => nameMatches(n, k))) {
        return false;
    }
    return ops.some(o => o !== null && /^open/i.test(o));
}

/** Nearest loc that is still shut (offers Open) and matches the obstacle names. */
export function nearestShutDoor<T extends DoorCandidate>(locs: readonly T[], obstacles: string[]): T | null {
    let best: T | null = null;
    for (const loc of locs) {
        if (!isShutDoor(loc.name, loc.ops, obstacles)) {
            continue;
        }
        if (!best || loc.distance < best.distance) {
            best = loc;
        }
    }
    return best;
}
