// Maze random event solver (macro_event_maze.rs2, region 0_45_71): a fixed
// wall/door layout with 4 corner spawns. We match the spawn to its pre-derived
// route (tools/maze-derive.ts) and Open each door in order; the client
// interact-walks to each door and, when opened from the correct side,
// teleports us through. A refused door ("not the right way") is a benign
// branch door from another corner's path — we dismiss it and press on to the
// final door. Then Touch the shrine to finish.

import { actions, reader } from '../../adapter/ClientAdapter.js';
import { chebyshev } from '../../nav/followMath.js';
import { Execution } from '../Execution.js';
import { ChatDialog } from '../hud/ChatDialog.js';
import { Locs } from '../queries/Locs.js';
import { MAZE_ROUTES } from './mazeRoutes.js';
import { selectRoute } from './selectRoute.js';

/** The maze's mapsquare (detection + in-maze checks key off it). */
export const MAZE_SQUARE = { mx: 45, mz: 71 };

const MAZE_SHRINE_LOC = 3634;
const MAZE_DOOR_IDS = new Set([3628, 3629, 3630, 3631, 3632]);
/** The one tile the purple-path finish is reached from: stand here, Open the
 *  door on it, then Touch the 3x3 shrine (proven live — the shrine completes
 *  from this approach only). All 4 spawn routes converge to it. */
const MAZE_FINAL_TILE = { x: 2910, z: 4576 };

export async function solveMaze(log: (msg: string) => void): Promise<boolean> {
    const inMaze = (): boolean => {
        const me = reader.worldTile();
        return me !== null && me.level === 0 && me.x >> 6 === MAZE_SQUARE.mx && me.z >> 6 === MAZE_SQUARE.mz;
    };

    const start = reader.worldTile();
    if (!start) { return true; }
    const route = selectRoute(start, MAZE_ROUTES);
    log(`random event: maze — spawn (${start.x},${start.z}) -> route ${route.spawn.x},${route.spawn.z} (${route.doors.length} doors)`);

    // Each maze corridor has one in-door and one out-door; interacting a door
    // does NOT walk us there (direct-input sends OPLOC from where we stand), so
    // we WALK to each door first (the client's tryMove paths the open corridor),
    // then Open it — a valid open teleports us into the next corridor.
    const walkTowards = async (d: { x: number; z: number }, onto: boolean): Promise<void> => {
        const reached = (t: { x: number; z: number }): boolean => (onto ? t.x === d.x && t.z === d.z : chebyshev(t, d) <= 1);
        for (let w = 0; w < 8 && inMaze(); w++) {
            const now = reader.worldTile();
            if (now && reached(now)) { return; }
            const local = reader.toLocal(d.x, d.z);
            if (!local) { await Execution.delayTicks(1); continue; }
            const before = reader.worldTile();
            actions.walkTo(local.lx, local.lz); // client-side path over the live scene collision
            // The FIRST walk click right after a door Open is swallowed (the
            // player stays put); a SECOND click registers. Detect the swallow
            // — no movement within ~1 tick — and re-issue once, instead of
            // sitting out the full timeout below. A real step lands in ~0.3-0.6s
            // (well under 1s), so a moving walk never triggers the re-kick.
            const moved = await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && before !== null && chebyshev(t, before) >= 1;
            }, 1_000);
            if (!moved && inMaze()) { actions.walkTo(local.lx, local.lz); }
            // Then the normal wait (reached, or a full 2-tile step). Budget is
            // 1s + 3s = the baseline's ~4s, so a genuinely stuck door still
            // burns the same total before the loop gives up — solving behaviour
            // is unchanged; only the swallowed-click waste is removed.
            await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && (reached(t) || (before !== null && chebyshev(t, before) >= 2));
            }, 3_000);
        }
    };
    const walkAdjacent = (d: { x: number; z: number }): Promise<void> => walkTowards(d, false);

    for (let i = 0; i < route.doors.length && inMaze(); i++) {
        const d = route.doors[i];
        await walkAdjacent(d);
        const door = Locs.query()
            .where(l => MAZE_DOOR_IDS.has(l.id) && l.tile().x === d.x && l.tile().z === d.z)
            .nearest();
        if (!door) { log(`random event: maze — door (${d.x},${d.z}) not in scene, skipping`); continue; }
        const pre = reader.worldTile();
        await door.interact('Open');
        // Wait for the through (a full 2-tile displacement) or a "not the right
        // way" dialog, THEN move on. We keep the >=2 threshold (a 1-tile drift
        // must NOT be mistaken for a through — that desyncs the route and wedges
        // us), but a 1-tile through never trips it, so cap the wait at 2s, not
        // 6s: by then the open has fully resolved and we're safely on the far
        // side, so proceeding is correct — we just stop idling for 4 extra sec.
        await Execution.delayUntil(() => {
            const t = reader.worldTile();
            return ChatDialog.canContinue() || (t !== null && pre !== null && chebyshev(t, pre) >= 2);
        }, 2_000);
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue(); // "not the right way" — benign branch door; press on
            log(`random event: maze — door (${d.x},${d.z}) refused (branch), continuing`);
        } else {
            const now = reader.worldTile();
            log(`random event: maze — through (${d.x},${d.z}) -> (${now?.x},${now?.z})`);
        }
    }

    // Fixed purple-path finish (all 4 routes converge here): stand ON the
    // final tile, Open the door on it — that teleports us beside the 3x3 shrine,
    // which only completes from this one approach — then Touch the shrine. The
    // finish plays a cheer emote before the return teleport, so the wait is
    // generous.
    for (let pass = 0; pass < 4 && inMaze(); pass++) {
        await walkTowards(MAZE_FINAL_TILE, true);
        const me = reader.worldTile();
        if (!me || me.x !== MAZE_FINAL_TILE.x || me.z !== MAZE_FINAL_TILE.z) {
            await Execution.delayTicks(2);
            continue; // not on the final tile yet
        }
        const finalDoor = Locs.query()
            .where(l => MAZE_DOOR_IDS.has(l.id) && l.tile().x === MAZE_FINAL_TILE.x && l.tile().z === MAZE_FINAL_TILE.z)
            .nearest();
        if (finalDoor) {
            await finalDoor.interact('Open'); // teleports us beside the shrine
            await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && (t.x !== MAZE_FINAL_TILE.x || t.z !== MAZE_FINAL_TILE.z);
            }, 6_000);
        }
        const shrine = Locs.query()
            .where(l => l.id === MAZE_SHRINE_LOC || (l.name ?? '').toLowerCase() === 'strange shrine')
            .nearest();
        if (!shrine) { await Execution.delayTicks(3); continue; }
        await shrine.interact(shrine.actions().find(a => /touch/i.test(a)) ?? 'Touch');
        await Execution.delayUntil(() => !inMaze(), 20_000);
    }
    log(inMaze() ? 'random event: maze — still inside; will retry' : 'random event: maze solved — returned');
    return true;
}
