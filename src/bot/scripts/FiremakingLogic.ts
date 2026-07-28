/**
 * Pure / portable firemaking helpers shared by Firemaker and any chop→burn
 * extension. Keep lane geometry and log gates here so scripts stay thin.
 */
import type { WorldTile } from '../adapter/ClientAdapter.js';
import Tile from '../api/Tile.js';

export const TINDERBOX = 'Tinderbox';
export const CANT_LIGHT = /can't light a fire here/i;

// neither of these is a throughput knob. START_MS is "did the click reach the
// server"; LIGHT_MS has to outlast the roll tail, and the roll only becomes a
// certainty at Firemaking 43 — at level 1 it is 65/256 every 4 ticks, so 90s of
// rolls is the difference between a one-in-a-hundred false stall and a
// one-in-a-hundred-thousand one
export const FIRE_START_MS = 2_400;
export const FIRE_LIGHT_MS = 90_000;

/** A burn lane is a west-running strip next to a bank (lighting teleports one west). */
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

/** Map a tree scenery name to the log item Firemaker burns. */
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
    // Generic "logs" product match still works for unknown trees.
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

/**
 * Nearest known fire plot by bank tile (chebyshev). Used when Woodcutter
 * burn mode is Auto rather than a fixed spot.
 */
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

export function tileKey(t: { x: number; z: number }): string {
    return `${t.x},${t.z}`;
}

/** How many fires a west-running lane yields before scenery / wall / cap. */
export function runWest(
    from: WorldTile,
    plot: FirePlot,
    occupied: ReadonlySet<string>,
    walkable: (t: WorldTile) => boolean,
    canStep: (from: WorldTile, to: WorldTile) => boolean,
    cap: number
): number {
    let n = 0;
    let cur: WorldTile = from;
    while (n < cap) {
        if (cur.x < plot.x0 || occupied.has(tileKey(cur)) || !walkable(cur)) {
            break;
        }
        n++;
        const next = { x: cur.x - 1, z: cur.z, level: cur.level };
        if (!canStep(cur, next)) {
            break;
        }
        cur = next;
    }
    return n;
}

export function inFirePlot(t: WorldTile, plot: FirePlot): boolean {
    return t.x >= plot.x0 && t.x <= plot.x1 && t.z >= plot.z0 && t.z <= plot.z1 && t.level === plot.bank.level;
}

/**
 * Shortest walk to a lane that can absorb `want` lights (or the longest
 * available). Pure scan — caller supplies occupancy + reachability.
 */
export function findBurnLane(
    plot: FirePlot,
    here: WorldTile,
    occupied: ReadonlySet<string>,
    want: number,
    walkable: (t: WorldTile) => boolean,
    canStep: (from: WorldTile, to: WorldTile) => boolean
): { start: Tile; run: number } | null {
    let best: { start: Tile; run: number; d: number } | null = null;
    for (let z = plot.z0; z <= plot.z1; z++) {
        for (let x = plot.x0; x <= plot.x1; x++) {
            const start = new Tile(x, z, plot.bank.level);
            const run = runWest(start, plot, occupied, walkable, canStep, want);
            if (run === 0) {
                continue;
            }
            const d = Math.max(Math.abs(x - here.x), Math.abs(z - here.z));
            if (!best || run > best.run || (run === best.run && d < best.d)) {
                best = { start, run, d };
            }
        }
    }
    return best ? { start: best.start, run: best.run } : null;
}

/** Server gates fires 4 ticks apart — human-sized pause inside that window. */
export function fireReactionMs(): number {
    return 180 + Math.random() * 420;
}

export function shouldBurnFullLoad(mode: BurnMode, inventoryFull: boolean, logCount: number, hasTinderbox: boolean): boolean {
    return mode === 'chop-then-burn' && inventoryFull && logCount > 0 && hasTinderbox;
}
