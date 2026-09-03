import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Reachability } from './geometry/Reachability.js';
import { isArrived } from './geometry/arrival.js';
import type Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Locs } from '../../api/locs/Locs.js';
import { BotHost } from '../../runtime/BotHost.js';
import { DirectNavigator } from './DirectNavigator.js';
import { chebyshev } from './geometry/followMath.js';

/** How far to search for a shut door after a walk segment stalls. */
const ESCAPE_RADIUS = 14;

const TOWARD_SLACK = 4;
const OPEN_WAIT_MS = 4000;
const STEP_WAIT_MS = 2000;

/** West, north, east, south: the four faces a wall door can sit on. */
const FACES = [{ dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 1, dz: 0 }, { dx: 0, dz: -1 }] as const;

export interface WalkOpeningOptions {
    /** Server ticks between a door showing open and the step through it; omitted leaves the crossing to the next walk segment. */
    doorStepTicks?: number;
}

function faceTile(door: WorldTile, face: number): WorldTile {
    return { x: door.x + FACES[face]!.dx, z: door.z + FACES[face]!.dz, level: door.level };
}

/** Which of a door tile's four faces can be stepped across right now. */
export function faceSteps(door: WorldTile, canStep: (from: WorldTile, to: WorldTile) => boolean): boolean[] {
    return FACES.map((_, face) => canStep(door, faceTile(door, face)));
}

/** The neighbour across the face an open swung free, or null while none has. */
export function openedNeighbour(door: WorldTile, before: readonly boolean[], after: readonly boolean[]): WorldTile | null {
    const face = after.findIndex((open, i) => open && !before[i]);
    return face === -1 ? null : faceTile(door, face);
}

/** Of the two tiles a passage joins, the one the player is not on. */
export function farSide(door: WorldTile, across: WorldTile, here: WorldTile): WorldTile {
    if (here.x === door.x && here.z === door.z) {
        return across;
    }
    if (here.x === across.x && here.z === across.z) {
        return door;
    }
    return chebyshev(here, across) >= chebyshev(here, door) ? across : door;
}

// Why: the loc carries no angle, so the passage is read off the client's collision, the one face that became steppable when the leaf swung.
async function stepThrough(door: WorldTile, before: readonly boolean[], stepTicks: number, log?: (m: string) => void): Promise<void> {
    const seen = BotHost.tickCount;
    let across: WorldTile | null = null;
    await Execution.delayUntil(() => {
        across = openedNeighbour(door, before, faceSteps(door, (a, b) => Reachability.canStep(a, b)));
        return across !== null || BotHost.tickCount > seen;
    }, STEP_WAIT_MS);
    const here = Game.tile();
    if (!across || !here) {
        return;
    }
    if (stepTicks > 0) {
        await Execution.delayTicks(stepTicks);
    }
    const far = farSide(door, across, here);
    const stepped = BotHost.tickCount;
    DirectNavigator.walk(far);
    const crossed = await Execution.delayUntil(() => {
        const me = reader.serverTile();
        return me !== null && me.x === far.x && me.z === far.z;
    }, STEP_WAIT_MS);
    log?.(`stepped through to ${far.x},${far.z} (stepped tick ${stepped}, ${crossed ? `crossed +${BotHost.tickCount - stepped}` : 'not crossed'})`);
}

export function isOpenableObstacle(name: string | null, actions: string[], obstacles: string[]): boolean {
    const n = (name ?? '').toLowerCase();
    return obstacles.some(k => n.includes(k)) && actions.some(a => /^open/i.test(a));
}

export function openOp(actions: string[]): string | null {
    return actions.find(a => /^open/i.test(a)) ?? null;
}

export function towardDest(door: WorldTile, here: WorldTile, dest: WorldTile): boolean {
    const cheb = (a: WorldTile, b: WorldTile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    return cheb(door, dest) <= cheb(here, dest) + TOWARD_SLACK;
}

/**
 * Walk toward a destination, opening obstacles that block the way.
 * @see docs/reference/nav-doors.md
 */
export async function walkOpening(dest: Tile, radius: number, obstacles: string[], log?: (m: string) => void, opts?: WalkOpeningOptions): Promise<boolean> {
    const stepTicks = opts?.doorStepTicks;
    const pathFollow = stepTicks === undefined ? undefined : { doorStepTicks: stepTicks };
    for (let seg = 0; seg < 8; seg++) {
        const here = Game.tile();
        if (here && isArrived(here, dest, radius, Reachability.arrivalProbe())) {
            return true;
        }
        // 90s per segment, 15s was too short for long bank legs (Rimmington→Fally).
        await Traversal.walkTo(dest, { radius, timeoutMs: 90_000, pathFollow, log: m => log?.(`  ${m}`) });
        const after = Game.tile();
        if (after && isArrived(after, dest, radius, Reachability.arrivalProbe())) {
            return true;
        }

        // Why: barriers that still look toward the destination are preferred, so doors behind the player are not opened.
        // Why: when none match, the Seers Sinclair Large door sits off the toward vector when stuck at the house Door, any openable obstacle in range is used instead, avoiding a soft-lock.
        // Why: `EntityQuery.where` mutates, so two independent chains are built.
        const openableInRange = (l: { name: string | null; actions: () => string[]; distance: () => number; tile: () => WorldTile }) =>
            isOpenableObstacle(l.name, l.actions(), obstacles)
            && l.distance() <= ESCAPE_RADIUS
            && Reachability.canReach(l.tile(), { adjacentOk: true });
        const door =
            Locs.query()
                .where(l => openableInRange(l))
                .where(l => after === null || towardDest(l.tile(), after, dest))
                .nearest()
            ?? Locs.query().where(l => openableInRange(l)).nearest();
        if (!door) {
            return false;
        }

        const dt = door.tile();
        const cur = Game.tile();
        if (cur && dt.distanceTo(cur) > 1) {
            log?.(`walking to ${door.name} at ${dt.x},${dt.z} to open it`);
            await Traversal.walkTo(dt, { radius: 1, timeoutMs: 45_000, log: m => log?.(`  ${m}`) });
        }

        const shut = Locs.query().where(l => l.tile().x === dt.x && l.tile().z === dt.z && isOpenableObstacle(l.name, l.actions(), obstacles)).nearest();
        if (!shut) {
            continue;
        }
        const op = openOp(shut.actions())!;
        log?.(`opening ${shut.name} at ${dt.x},${dt.z}`);
        const before = faceSteps(dt, (a, b) => Reachability.canStep(a, b));
        if (!(await shut.interact(op))) {
            await Execution.delayTicks(2);
            continue;
        }
        const swung = await Execution.delayUntil(() => {
            const still = Locs.query().where(l => l.tile().x === dt.x && l.tile().z === dt.z && isOpenableObstacle(l.name, l.actions(), obstacles)).nearest();
            return still === null;
        }, OPEN_WAIT_MS);
        if (swung && stepTicks !== undefined) {
            await stepThrough(dt, before, stepTicks, log);
        }
    }
    const here = Game.tile();
    return here !== null && isArrived(here, dest, radius, Reachability.arrivalProbe());
}
