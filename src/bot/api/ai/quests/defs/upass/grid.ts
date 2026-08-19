import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { GRID_ZONE, UP_LOC, UP_TILE, pastGridTile } from './areas.js';
import { travelTo } from './pass.js';
import { releaseJournal, stalledCrossing } from './stall.js';

// Why: the safe path through the spiked grid is three digits in `%ibanmulti` bits 22-31, and `ibanmulti` is `scope=perm` with no `transmit` — the client cannot read it. The journal stall walks over all of it instead, so the combination never has to be guessed.

/** Where a fall lands, and where `upass_grilltrap_hand_holds` climbs back to. */
const PIT = { minZ: 9536, maxZ: 9599 } as const;
const HANDHOLD_RETURN = UP_TILE.GRID_EAST;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

export function inGrid(): boolean {
    const t = here();
    return t !== null && t.x >= GRID_ZONE.minX && t.x <= GRID_ZONE.maxX && t.z >= GRID_ZONE.minZ && t.z <= GRID_ZONE.maxZ;
}

export function inPit(): boolean {
    const t = here();
    return t !== null && t.z >= PIT.minZ && t.z <= PIT.maxZ;
}

/** West of the grid, on the portcullis side — the crossing is done. */
export function pastGrid(): boolean {
    return pastGridTile(here());
}

/** West of the trapped columns, beside the lever — the walk is over, the lever's script has not run. */
export function atLever(): boolean {
    const t = here();
    return t !== null && t.x < GRID_ZONE.minX && t.z >= GRID_ZONE.minZ && t.z <= GRID_ZONE.maxZ;
}

async function climbOutOfPit(log: (m: string) => void): Promise<boolean> {
    // Why: the fall is a `p_teleport`, so the scene is still the old one for a tick or two and the rocks
    // read as absent — the query is retried rather than trusted on the first look.
    for (let attempt = 0; attempt < 8 && inPit(); attempt++) {
        const rocks = Locs.query().where(loc => loc.id === UP_LOC.GRID_HANDHOLDS).action('Climb').within(12).nearest();
        if (rocks && (await rocks.interact('Climb')) && (await Execution.delayUntil(() => !inPit(), 8_000))) {
            return true;
        }
        await Execution.delayTicks(2);
    }
    if (inPit()) {
        log('grid: no protruding rocks in the pit to climb');
        return false;
    }
    return true;
}

/**
 * Back to the staging tile the stall is launched from.
 * Why: the launch tile has to sit outside the trapped rectangle by more than the walk covers in the tick before the journal lands, and Koftik's lip is the only tile east of the grid the route reaches.
 */
async function toApproach(log: (m: string) => void): Promise<boolean> {
    if (inPit() && !(await climbOutOfPit(log))) {
        return false;
    }
    // Why: there is nothing to approach once the grid is behind the character, and a `travelTo` aimed at the east side from the west side hunts seams across the cavern rather than reporting it is done. Standing at the lever counts as behind it: the collision pack calls the portcullis blocked, so the lip is unreachable from there too.
    if (pastGrid() || atLever()) {
        return true;
    }
    const t = here();
    if (t && UP_TILE.GRID_APPROACH.distanceTo(t) <= 1) {
        return true;
    }
    // Why: the rope swing is part of travelTo's vocabulary now, so the approach is one call — a caller
    // second-guessing which seam comes next is what drifted the route before.
    return travelTo(UP_TILE.GRID_APPROACH, 1, log);
}

function lever(): Loc | null {
    return Locs.query().where(loc => loc.id === UP_LOC.PORTCULLIS_LEVER).action('Pull').within(40).nearest();
}

/**
 * Pull the lever now the journal is down, and let its forced move carry the player through.
 * Why: `Player.tryInteract` returns early on `!canAccess()`, so the lever's `oploc1` cannot run while the journal is up — the op-click's walk arrives and the script waits. Releasing the journal is what fires it, and its `~forcemove` chain is the crossing, so nothing here walks: it waits for the move it is owed.
 */
async function pullThrough(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && !pastGrid(); attempt++) {
        await releaseJournal();
        if (await Execution.delayUntilTicks(pastGrid, 20)) {
            return true;
        }
        // Why: `loc_change(upass_lever_down, 15)` swaps the lever for fifteen ticks after a pull, so nothing in reach means the pull already landed and its forced move is still on its way — the next wait is the answer, not a second click.
        const target = lever();
        if (target) {
            await target.interact('Pull');
        }
    }
    if (!pastGrid()) {
        const t = here();
        log(`grid: the lever would not carry us through — standing at (${t?.x},${t?.z})`);
    }
    return pastGrid();
}

/** East to west over the spiked grid, ending west of the portcullis. */
export async function crossGrid(log: (m: string) => void): Promise<boolean> {
    if (pastGrid()) {
        return true;
    }
    if (atLever()) {
        return pullThrough(log);
    }
    if (!(await toApproach(log))) {
        return false;
    }
    // Why: the stalled walk owns the trapped columns and nothing else. It ends where the traps do — west of them, beside the lever — because the op that finishes the job cannot run until the journal comes down.
    const carried = await stalledCrossing({
        find: lever,
        op: 'Pull',
        arrived: () => pastGrid() || atLever(),
        abort: inPit,
        recover: () => toApproach(log),
        log
    });
    if (!carried) {
        return false;
    }
    return pullThrough(log);
}

export { HANDHOLD_RETURN };
