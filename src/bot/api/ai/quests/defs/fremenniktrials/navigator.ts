import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { driveDialog } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import { FT_LOC, FT_TILE, MAZE_ROUTE, SWENSEN, inMaze } from './areas.js';
import { walkTo } from './supplies.js';

const NEAR = 3;

/** Swensen's trial: seven portals from one end of his labyrinth to the other. */
export function navigatorStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'navigator-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'navigator-started')) {
        return { kind: 'talk', stop: SWENSEN(['Yes']) };
    }
    return { kind: 'custom', name: "walk Swensen's maze", run: runMaze };
}

// Why: an attempt that ends before its portal fires leaves us on that portal's own stand tile, which is mid-route rather than scattered — reading it as scattered ropes out and throws away every leg already won.

/** Which leg of the route a tile belongs to, or -1 when the maze has scattered us. */
export function mazeLegAt(here: WorldTile | null): number {
    if (!here) {
        return -1;
    }
    if (FT_TILE.MAZE_ENTRY.distanceTo(here) <= NEAR) {
        return 0;
    }
    const landed = MAZE_ROUTE.findIndex(leg => leg.land.distanceTo(here) <= NEAR);
    if (landed >= 0) {
        return landed + 1;
    }
    const standing = MAZE_ROUTE.findIndex(leg => leg.stand.distanceTo(here) <= NEAR);
    return standing < 0 ? -1 : standing;
}

function legAt(): number {
    return mazeLegAt(Game.tile());
}

async function escape(log: (m: string) => void): Promise<boolean> {
    const rope = Locs.query().name('Escape rope').action('Climb-up').within(12).nearest();
    if (!rope) {
        log('scattered in the maze with no escape rope in range');
        return false;
    }
    log('a wrong portal scattered us — taking the escape rope and starting again');
    if (!(await rope.interact('Climb-up'))) {
        return false;
    }
    return true;
}

async function runMaze(log: (m: string) => void): Promise<boolean> {
    if (!inMaze(Game.tile())) {
        const down = await Reach.locOp({
            name: 'Ladder',
            op: 'Climb-down',
            near: FT_TILE.MAZE_LADDER,
            id: FT_LOC.MAZE_LADDER_TOP,
            expect: () => inMaze(Game.tile()),
            log
        });
        if (down !== 'done') {
            return false;
        }
        await settleScene();
    }

    let leg = legAt();
    if (leg < 0) {
        await escape(log);
        return false;
    }

    for (; leg < MAZE_ROUTE.length; leg++) {
        const hop = MAZE_ROUTE[leg]!;
        const status = await Reach.locOp({
            name: 'Portal',
            op: 'Use',
            near: hop.stand,
            id: hop.id,
            expect: () => {
                const t = Game.tile();
                return t !== null && hop.land.distanceTo(t) <= NEAR;
            },
            log
        });
        await settleScene();
        if (status !== 'done') {
            log(`portal ${leg + 1}: ${status}`);
            return false;
        }
        if (legAt() !== leg + 1) {
            log(`portal ${leg + 1} did not land us where the route expects`);
            return false;
        }
        log(`maze: through portal ${leg + 1} of ${MAZE_ROUTE.length}`);
    }

    if (!(await walkTo(FT_TILE.MAZE_EXIT_STAND, 0, log))) {
        return false;
    }
    const out = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near: FT_TILE.MAZE_EXIT_STAND,
        id: FT_LOC.MAZE_EXIT,
        expect: () => !inMaze(Game.tile()),
        log
    });
    if (out !== 'done') {
        return false;
    }
    // Why: the vote is queued by the exit ladder's own conversation with Swensen, so leaving it undriven loses it.
    await driveDialog([], log);
    return true;
}
