import type { WorldTile } from '../adapter/ClientAdapter.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import { Reachability } from './Reachability.js';
import type Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { Locs } from './queries/Locs.js';

// How far to look for the exit door when we stall. The old code only checked 2
// tiles from where we stood, so a bot stranded deep inside a shop (the knight
// wandered out and the door shut behind it) never found the exit and got stuck.
const ESCAPE_RADIUS = 10;

// How much farther from dest than we already are a door may sit and still be
// worth opening. The exit of a room we're shut inside is sometimes a couple of
// tiles "backward" relative to dest, but a door well beyond that is some other
// building's — opening it is at best noise (Seers: the neighbour house at
// (2713,3483) getting opened instead of the spinning-house door at (2716,3472)).
const TOWARD_SLACK = 4;

/**
 * A shut door/gate we can open: its name matches one of `obstacles`
 * (case-insensitive substring) and it offers an "Open"-style op. An OPEN door
 * offers "Close" instead, so this only ever matches shut ones. Pure.
 */
export function isOpenableObstacle(name: string | null, actions: string[], obstacles: string[]): boolean {
    const n = (name ?? '').toLowerCase();
    return obstacles.some(k => n.includes(k)) && actions.some(a => /^open/i.test(a));
}

/** The first "Open"-style op on a loc, or null. Pure. */
export function openOp(actions: string[]): string | null {
    return actions.find(a => /^open/i.test(a)) ?? null;
}

/**
 * Is `door` plausibly on the way from `here` to `dest` — i.e. no more than
 * TOWARD_SLACK farther from dest than we already are? Chebyshev (the game
 * movement metric). Keeps the stall-recovery hunt from wandering off to open
 * an unrelated building's door that merely sits within ESCAPE_RADIUS. Pure.
 */
export function towardDest(door: WorldTile, here: WorldTile, dest: WorldTile): boolean {
    const cheb = (a: WorldTile, b: WorldTile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    return cheb(door, dest) <= cheb(here, dest) + TOWARD_SLACK;
}

/**
 * Walk to within `radius` of `dest`, opening any shut door/gate that blocks us.
 * The engine's own interact-walks won't open a closed door to reach a walled-off
 * target, so we drive the approach by hand: push toward `dest`, and if that made
 * no progress, find the nearest openable obstacle we can actually reach on our
 * side of the wall, walk up to THAT (a fixed tile — never the moving target),
 * open it, wait for it to swing, and try again. Returns true once we're in
 * range, false when nothing openable is left within reach (genuinely stuck).
 * (Extracted from ThievingBot/ArdyThiever's clearPathTo.)
 */
export async function walkOpening(dest: Tile, radius: number, obstacles: string[], log?: (m: string) => void): Promise<boolean> {
    for (let seg = 0; seg < 8; seg++) {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return true;
        }
        await Traversal.walkTo(dest, { radius, timeoutMs: 15000, log: m => log?.(`  ${m}`) });
        const after = Game.tile();
        if (after && dest.distanceTo(after) <= radius) {
            return true;
        }

        // Stalled. Find the nearest openable obstacle we can reach on our side of
        // the wall — searched across ESCAPE_RADIUS, not just the 2 tiles the old
        // code used, so a bot stranded deep inside a shop still finds the exit.
        // Only doors that keep us headed toward dest count: nearest-to-player
        // alone used to walk off and open a neighbouring house's door.
        const door = Locs.query()
            .where(l => isOpenableObstacle(l.name, l.actions(), obstacles))
            .where(l => l.distance() <= ESCAPE_RADIUS && Reachability.canReach(l.tile(), { adjacentOk: true }))
            .where(l => after === null || towardDest(l.tile(), after, dest))
            .nearest();
        if (!door) {
            return false; // nothing openable within reach — genuinely stuck
        }

        // Walk to the door itself (a stable tile, unlike the moving target) so we
        // can open it even when it's across the room.
        const dt = door.tile();
        const cur = Game.tile();
        if (cur && dt.distanceTo(cur) > 1) {
            log?.(`walking to ${door.name} at ${dt.x},${dt.z} to open it`);
            await Traversal.walkTo(dt, { radius: 1, timeoutMs: 15000, log: m => log?.(`  ${m}`) });
        }

        // Re-resolve at the tile (we moved) and open it, then wait for it to swing
        // before the next push toward dest.
        const shut = Locs.query().where(l => l.tile().x === dt.x && l.tile().z === dt.z && isOpenableObstacle(l.name, l.actions(), obstacles)).nearest();
        if (!shut) {
            continue; // already open — push on
        }
        const op = openOp(shut.actions())!;
        log?.(`opening ${shut.name} at ${dt.x},${dt.z}`);
        if (!(await shut.interact(op))) {
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayUntil(() => {
            const still = Locs.query().where(l => l.tile().x === dt.x && l.tile().z === dt.z && isOpenableObstacle(l.name, l.actions(), obstacles)).nearest();
            return still === null;
        }, 4000);
    }
    const here = Game.tile();
    return here !== null && dest.distanceTo(here) <= radius;
}
