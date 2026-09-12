/** A tile as the client reports it, the walker's `Tile` satisfies this too. */
export interface Stand {
    x: number;
    z: number;
    level: number;
}

// Why: Mark the departure stand as spent only after it becomes unreachable; the same cage seam is also the cell's only exit.

/** The stand tiles each seam has already been used from, by seam key. */
export type SpentSides = Map<string, Stand[]>;

/**
 * Whether this seam has been used, and from where.
 * Why: a seam used from this side is finished, while one used from the far side is the way back out of a cul-de-sac, worth having last. As an equal candidate it turns the maze into a pendulum.
 */
export function spentStateHere(sides: SpentSides, key: string, reachable: (tile: Stand) => boolean): 'fresh' | 'here' | 'elsewhere' {
    const used = sides.get(key);
    if (used === undefined || used.length === 0) {
        return 'fresh';
    }
    return used.some(reachable) ? 'here' : 'elsewhere';
}

export function spentHere(sides: SpentSides, key: string, reachable: (tile: Stand) => boolean): boolean {
    return spentStateHere(sides, key, reachable) === 'here';
}

export function spendFrom(sides: SpentSides, key: string, stand: Stand): void {
    const used = sides.get(key) ?? [];
    if (!used.some(tile => tile.x === stand.x && tile.z === stand.z && tile.level === stand.level)) {
        used.push(stand);
    }
    sides.set(key, used);
}

/** What one journey remembers: which side of each seam it has used, and which ground it has already walked. */
export interface Journey {
    sides: SpentSides;
    visited: Set<string>;
}

/** Ground is remembered in 8-tile cells, coarse enough that a wander lands back inside one. */
export function cellOf(tile: Stand): string {
    return `${tile.x >> 3},${tile.z >> 3},${tile.level}`;
}

export function newJourney(): Journey {
    return { sides: new Map(), visited: new Set() };
}
