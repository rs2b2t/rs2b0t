import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Reachability } from './geometry/Reachability.js';
import type Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Locs } from '../../api/locs/Locs.js';

/** How far to search for a shut door after a walk segment stalls. */
const ESCAPE_RADIUS = 14;

const TOWARD_SLACK = 4;

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
export async function walkOpening(dest: Tile, radius: number, obstacles: string[], log?: (m: string) => void): Promise<boolean> {
    for (let seg = 0; seg < 8; seg++) {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return true;
        }
        // 90s per segment — 15s was too short for long bank legs (Rimmington→Fally).
        await Traversal.walkTo(dest, { radius, timeoutMs: 90_000, log: m => log?.(`  ${m}`) });
        const after = Game.tile();
        if (after && dest.distanceTo(after) <= radius) {
            return true;
        }

        // Why: barriers that still look toward the destination are preferred, so doors behind the player are not opened.
        // Why: when none match — the Seers Sinclair Large door sits off the toward vector when stuck at the house Door — any openable obstacle in range is used instead, avoiding a soft-lock.
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
