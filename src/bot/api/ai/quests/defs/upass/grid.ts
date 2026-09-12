import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { GRID_ZONE, UP_LOC, UP_TILE, pastGridTile } from './areas.js';
import { travelTo } from './pass.js';
import { releaseJournal, stalledCrossing } from './stall.js';

// Why: the safe path through the spiked grid is 3 digits in `%ibanmulti` bits 22-31, and `ibanmulti` is `scope=perm` with no `transmit`, so the client can't read it. The journal stall walks over all of it instead.

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

/** West of the grid, on the portcullis side. The crossing is done. */
export function pastGrid(): boolean {
    return pastGridTile(here());
}

/** West of the trapped columns, beside the lever. The walk is over, the lever's script has not run. */
export function atLever(): boolean {
    const t = here();
    return t !== null && t.x < GRID_ZONE.minX && t.z >= GRID_ZONE.minZ && t.z <= GRID_ZONE.maxZ;
}

async function climbOutOfPit(log: (m: string) => void): Promise<boolean> {
// Why: `p_teleport` can leave the old scene visible for two ticks, so wait before querying the rocks.
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
 * Why: the launch tile has to sit outside the trapped rectangle by more than the walk covers before the journal lands, and Koftik's lip is the only tile east of the grid the route reaches.
 */
async function toApproach(log: (m: string) => void): Promise<boolean> {
    if (inPit() && !(await climbOutOfPit(log))) {
        return false;
    }
    // Why: with the grid behind you a `travelTo` at the east side hunts seams across the cavern. The lever counts as behind: the pack calls the portcullis blocked, so the lip is unreachable from there too.
    if (pastGrid() || atLever()) {
        return true;
    }
    const t = here();
    if (t && UP_TILE.GRID_APPROACH.distanceTo(t) <= 1) {
        return true;
    }
    // Why: the rope swing is in travelTo's vocabulary, so the approach is one call and the caller doesn't pick seams.
    return travelTo(UP_TILE.GRID_APPROACH, 1, log);
}

function lever(): Loc | null {
    return Locs.query().where(loc => loc.id === UP_LOC.PORTCULLIS_LEVER).action('Pull').within(40).nearest();
}

/**
 * Close the journal, pull the lever, and wait for its forced movement.
 * Why: `Player.tryInteract` cannot send the lever op while the journal blocks access.
 */
async function pullThrough(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && !pastGrid(); attempt++) {
        await releaseJournal();
        if (await Execution.delayUntilTicks(pastGrid, 20)) {
            return true;
        }
        // Why: `loc_change(upass_lever_down, 15)` swaps the lever for 15 ticks after a pull, so nothing in reach means the pull landed and its forced move is on its way; wait, don't click again.
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
    // Why: the stalled walk owns the trapped columns only and ends beside the lever, because the op that finishes the job can't run until the journal comes down.
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
