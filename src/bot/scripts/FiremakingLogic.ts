import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';

export { TINDERBOX } from '../api/Tools.js';
export const CANT_LIGHT = /can't light a fire here/i;

/** How long to wait for the light attempt to start (log leaves pack / anim / blocked). */
export const FIRE_START_MS = 8_000;
/** How long to wait for FM XP after a light attempt has started. */
export const FIRE_LIGHT_MS = 90_000;

export interface FirePlot {
    bank: Tile;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

export const FIRE_SPOTS: Record<string, FirePlot> = {
    'Varrock East': { bank: new Tile(3253, 3420, 0), x0: 3232, x1: 3284, z0: 3428, z1: 3430 },
    'Varrock West': { bank: new Tile(3185, 3440, 0), x0: 3168, x1: 3209, z0: 3428, z1: 3431 },
    Draynor: { bank: new Tile(3093, 3243, 0), x0: 3072, x1: 3097, z0: 3247, z1: 3249 },
    Seers: { bank: new Tile(2725, 3491, 0), x0: 2695, x1: 2733, z0: 3484, z1: 3485 }
};

export const FIRE_SPOT_OPTIONS = Object.keys(FIRE_SPOTS);

export const LOG_LEVELS: Record<string, number> = {
    Logs: 1,
    'Oak logs': 15,
    'Willow logs': 30,
    'Maple logs': 45,
    'Yew logs': 60,
    'Magic logs': 75
};

export const LOG_TYPE_OPTIONS = Object.keys(LOG_LEVELS);

export const BURN_MODE_OPTIONS = ['Off', 'Chop then burn'] as const;
export type BurnModeLabel = (typeof BURN_MODE_OPTIONS)[number];
export type BurnMode = 'off' | 'chop-then-burn';

export function parseBurnMode(label: string): BurnMode {
    return label.trim().toLowerCase() === 'chop then burn' ? 'chop-then-burn' : 'off';
}

export function logsForTree(treeName: string): string {
    const t = treeName.trim().toLowerCase();
    if (t === 'tree' || t === 'dead tree' || t === 'evergreen') {
        return 'Logs';
    }
    if (t.includes('oak')) {
        return 'Oak logs';
    }
    if (t.includes('willow')) {
        return 'Willow logs';
    }
    if (t.includes('maple')) {
        return 'Maple logs';
    }
    if (t.includes('yew')) {
        return 'Yew logs';
    }
    if (t.includes('magic')) {
        return 'Magic logs';
    }
    return 'Logs';
}

export function firemakingLevelForLogs(logName: string): number | undefined {
    return LOG_LEVELS[logName];
}

export function resolveFireSpot(name: string): { name: string; plot: FirePlot } | null {
    const key = FIRE_SPOT_OPTIONS.find(k => k.toLowerCase() === name.trim().toLowerCase());
    if (!key) {
        return null;
    }
    return { name: key, plot: FIRE_SPOTS[key] };
}

export function nearestFireSpot(from: WorldTile): { name: string; plot: FirePlot } | null {
    let best: { name: string; plot: FirePlot; d: number } | null = null;
    for (const [name, plot] of Object.entries(FIRE_SPOTS)) {
        const d = Math.max(Math.abs(from.x - plot.bank.x), Math.abs(from.z - plot.bank.z));
        if (!best || d < best.d) {
            best = { name, plot, d };
        }
    }
    return best ? { name: best.name, plot: best.plot } : null;
}

/**
 * Local burn plot around a start/anchor tile for Woodcutter Auto.
 * Chop-then-burn lights near where the script started until the area fills,
 * then repaths within this box (and can expand — see expandLocalFirePlot).
 */
export const LOCAL_FIRE_HALF = 8;

export function localFirePlot(origin: WorldTile, half = LOCAL_FIRE_HALF): FirePlot {
    const h = Math.max(2, Math.floor(half));
    return {
        bank: new Tile(origin.x, origin.z, origin.level),
        x0: origin.x - h,
        x1: origin.x + h,
        z0: origin.z - h,
        z1: origin.z + h
    };
}

/** Grow a local plot outward when the current box has no clear lane left. */
export function expandLocalFirePlot(plot: FirePlot, growBy = 4, maxHalf = 24): FirePlot | null {
    const cx = Math.floor((plot.x0 + plot.x1) / 2);
    const cz = Math.floor((plot.z0 + plot.z1) / 2);
    const halfX = Math.floor((plot.x1 - plot.x0) / 2);
    const halfZ = Math.floor((plot.z1 - plot.z0) / 2);
    const next = Math.max(halfX, halfZ) + Math.max(1, growBy);
    if (next > maxHalf) {
        return null;
    }
    return localFirePlot({ x: cx, z: cz, level: plot.bank.level }, next);
}

export function tileKey(t: { x: number; z: number }): string {
    return `${t.x},${t.z}`;
}

export type BurnDir = { dx: number; dz: number };

/**
 * After a successful light the client always steps the player **one tile west**.
 * Multi-log lanes only chain cleanly west; other cardinals are single-tile fallbacks
 * for cramped Auto plots.
 */
export const BURN_WEST: BurnDir = { dx: -1, dz: 0 };

/** West first (real lanes), then other cardinals for light-wherever fallbacks. */
export const BURN_DIRS: readonly BurnDir[] = [
    BURN_WEST,
    { dx: 1, dz: 0 },
    { dx: 0, dz: -1 },
    { dx: 0, dz: 1 }
];

/** Pack holds at most 27 logs once a tinderbox (and usually an axe) is reserved. */
export const MAX_BURN_LANE = 27;

/** How many consecutive lights we want from one lane start (1..27). */
export function burnLaneWant(logCount: number): number {
    return Math.max(1, Math.min(MAX_BURN_LANE, Math.floor(logCount) || 1));
}

export function isBurnWest(dir: BurnDir): boolean {
    return dir.dx === BURN_WEST.dx && dir.dz === BURN_WEST.dz;
}

export function runInDir(
    from: WorldTile,
    plot: FirePlot,
    dir: BurnDir,
    occupied: ReadonlySet<string>,
    walkable: (t: WorldTile) => boolean,
    canStep: (from: WorldTile, to: WorldTile) => boolean,
    cap: number
): number {
    let n = 0;
    let cur: WorldTile = from;
    while (n < cap) {
        if (!inFirePlot(cur, plot) || occupied.has(tileKey(cur)) || !walkable(cur)) {
            break;
        }
        n++;
        const next = { x: cur.x + dir.dx, z: cur.z + dir.dz, level: cur.level };
        if (!canStep(cur, next)) {
            break;
        }
        cur = next;
    }
    return n;
}

/** @deprecated prefer runInDir — kept for bank-strip callers that always run west. */
export function runWest(
    from: WorldTile,
    plot: FirePlot,
    occupied: ReadonlySet<string>,
    walkable: (t: WorldTile) => boolean,
    canStep: (from: WorldTile, to: WorldTile) => boolean,
    cap: number
): number {
    return runInDir(from, plot, BURN_WEST, occupied, walkable, canStep, cap);
}

export function inFirePlot(t: WorldTile, plot: FirePlot): boolean {
    return t.x >= plot.x0 && t.x <= plot.x1 && t.z >= plot.z0 && t.z <= plot.z1 && t.level === plot.bank.level;
}

/**
 * Pick a lane start inside `plot`.
 *
 * Preference (successful lights always shove the player west):
 * 1. West-running lane that fits the full load (`run >= want`, want capped at 27)
 * 2. Longest west-running partial lane
 * 3. Any other free tile (run ≥ 1) as light-wherever fallback — closest wins
 */
export function findBurnLane(
    plot: FirePlot,
    here: WorldTile,
    occupied: ReadonlySet<string>,
    want: number,
    walkable: (t: WorldTile) => boolean,
    canStep: (from: WorldTile, to: WorldTile) => boolean,
    dirs: readonly BurnDir[] = BURN_DIRS
): { start: Tile; run: number; dir: BurnDir } | null {
    const need = burnLaneWant(want);
    let best: { start: Tile; run: number; d: number; dir: BurnDir } | null = null;

    const better = (
        run: number,
        d: number,
        dir: BurnDir,
        cur: { run: number; d: number; dir: BurnDir }
    ): boolean => {
        const full = run >= need;
        const curFull = cur.run >= need;
        const west = isBurnWest(dir);
        const curWest = isBurnWest(cur.dir);

        // Full west lane beats everything.
        if (full && west && !(curFull && curWest)) {
            return true;
        }
        if (curFull && curWest && !(full && west)) {
            return false;
        }
        // Other full lanes (rare / test dirs) beat partials.
        if (full !== curFull) {
            return full;
        }
        // Prefer west so multi-light chains match the client shove.
        if (west !== curWest) {
            return west;
        }
        if (run !== cur.run) {
            return run > cur.run;
        }
        return d < cur.d;
    };

    for (const dir of dirs) {
        for (let z = plot.z0; z <= plot.z1; z++) {
            for (let x = plot.x0; x <= plot.x1; x++) {
                const start = new Tile(x, z, plot.bank.level);
                // Non-west dirs only work as single-tile lights (client shoves west).
                const cap = isBurnWest(dir) ? need : 1;
                const run = runInDir(start, plot, dir, occupied, walkable, canStep, cap);
                if (run === 0) {
                    continue;
                }
                const d = Math.max(Math.abs(x - here.x), Math.abs(z - here.z));
                if (!best || better(run, d, dir, best)) {
                    best = { start, run, d, dir };
                }
            }
        }
    }
    return best ? { start: best.start, run: best.run, dir: best.dir } : null;
}

export function fireReactionMs(): number {
    return 180 + Math.random() * 420;
}

export function shouldBurnFullLoad(mode: BurnMode, inventoryFull: boolean, logCount: number, hasTinderbox: boolean): boolean {
    return mode === 'chop-then-burn' && inventoryFull && logCount > 0 && hasTinderbox;
}
