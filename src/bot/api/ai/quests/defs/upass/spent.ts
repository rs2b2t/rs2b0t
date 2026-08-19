/** A tile as the client reports it — the walker's `Tile` satisfies this too. */
export interface Stand {
    x: number;
    z: number;
    level: number;
}

// Why: a crossing spends the seam FROM THE SIDE it was crossed from, not outright. The slave cage that puts a character into a cell is the only thing that takes them out of it again, so a seam struck off the list on the far side seals the pocket behind them — one run stood in the fourteen-tile cell at (2385,9661) for an hour with its own door filtered out of every search. Which side the character is on is a question the loaded scene answers: a stand tile it can still walk to is a stand tile on this side.

/** The stand tiles each seam has already been used from, by seam key. */
export type SpentSides = Map<string, Stand[]>;

/**
 * Whether this seam has been used, and from where.
 * Why: a seam already used FROM THIS SIDE is finished, while one used from the far side is the way back out of a cul-de-sac — worth having, and worth having last. Offered as an equal candidate it turns a maze into a pendulum, and a run crossed the same three stone bridges back and forth for nine minutes.
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

/** Ground is remembered in eight-tile cells, which is coarse enough that a wander lands back inside one. */
export function cellOf(tile: Stand): string {
    return `${tile.x >> 3},${tile.z >> 3},${tile.level}`;
}

export function newJourney(): Journey {
    return { sides: new Map(), visited: new Set() };
}
