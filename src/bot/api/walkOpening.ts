import { Execution } from './Execution.js';
import { Game } from './Game.js';
import type Tile from './Tile.js';
import { Traversal } from './Traversal.js';
import { Locs } from './queries/Locs.js';

/**
 * Walk to within `radius` of `dest`, opening any shut door/gate we stall at. The
 * engine's own interact-walks won't open a closed door to reach a walled-off
 * target, so we drive the approach by hand: walk a segment, and if it didn't get
 * us closer, open the nearest matching obstacle that still offers an "Open" op
 * (an open door offers "Close" instead, so this only ever targets shut ones) and
 * retry. Returns true once we're in range, false when nothing is left to open.
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
        const door = Locs.query()
            .where(l => l.distance() <= 2 && obstacles.some(k => (l.name ?? '').toLowerCase().includes(k)) && l.actions().some(a => /^open/i.test(a)))
            .nearest();
        if (!door) {
            return false; // nothing to open — genuinely stuck
        }
        const op = door.actions().find(a => /^open/i.test(a))!;
        log?.(`opening ${door.name} at ${door.tile()}`);
        await door.interact(op);
        await Execution.delayTicks(2);
    }
    const here = Game.tile();
    return here !== null && dest.distanceTo(here) <= radius;
}
