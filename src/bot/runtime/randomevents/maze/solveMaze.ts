import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { chebyshev } from '../../../event/webwalk/geometry/followMath.js';
import { Execution } from '../../../api/execution/Execution.js';
import { ChatDialog } from '../../../api/ui/dialogue/ChatDialog.js';
import { Locs } from '../../../api/locs/Locs.js';
import { MAZE_SHRINE, MAZE_SHRINE_DOOR } from './mazeGraph.js';
import { selectRoute } from './selectRoute.js';

/** Region 45,71 — content mapzone `0_45_71` / enum macro_maze_teleports. */
export const MAZE_SQUARE = { mx: 45, mz: 71 };

// Why: content pack (loc.pack + all.loc + macro_event_maze.rs2) gives 3628–3632 macro_maze_walllow* op Open, category macro_maze_wall_door.
// Why: the same pack gives 3634 macro_maze_complete, "Strange shrine", 3×3, op Touch, which calls end_macro_maze.
// Why: the finish is not the south tile of the SW corner, which is walled — the last door is the west chamber door at MAZE_SHRINE_DOOR (2910,4576), then Touch from an open face.
const MAZE_DOOR_IDS = new Set([3628, 3629, 3630, 3631, 3632]);
const MAZE_SHRINE_LOC = 3634; // macro_maze_complete
/** Step-backs allowed before giving up on this pass and restarting the route. */
const MAX_RESYNCS = 3;

export async function solveMaze(log: (msg: string) => void): Promise<boolean> {
    const inMaze = (): boolean => {
        const me = reader.worldTile();
        return me !== null && me.level === 0 && me.x >> 6 === MAZE_SQUARE.mx && me.z >> 6 === MAZE_SQUARE.mz;
    };

    const clearMesbox = async (): Promise<void> => {
        // Content wrong-door: ~mesbox("I don't think that's the right way.")
        // start_macro_maze: chatnpc briefing from Mysterious Old Man.
        for (let i = 0; i < 6 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
        }
    };

    const start = reader.worldTile();
    if (!start) {
        return true;
    }
    await clearMesbox();

    const route = selectRoute(start);
    if (!route) {
        // Loudly, and without a route: silently replaying someone else's is what
        // pinned two bots on a walled-off first door for a quarter of an hour.
        log(`random event: maze — no route solvable from (${start.x},${start.z}); the layout does not reach the shrine from here`);
        return true;
    }
    let resyncs = 0;
    log(
        `random event: maze — spawn (${start.x},${start.z}) -> ${route.doors.length} doors, first (${route.doors[0].x},${route.doors[0].z})`
    );

    const walkTowards = async (d: { x: number; z: number }, onto: boolean): Promise<void> => {
        const reached = (t: { x: number; z: number }): boolean =>
            onto ? t.x === d.x && t.z === d.z : chebyshev(t, d) <= 1;
        for (let w = 0; w < 12 && inMaze(); w++) {
            const now = reader.worldTile();
            if (now && reached(now)) {
                return;
            }
            const local = reader.toLocal(d.x, d.z);
            if (!local) {
                await Execution.delayTicks(1);
                continue;
            }
            const before = reader.worldTile();
            actions.walkTo(local.lx, local.lz);
            const moved = await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && before !== null && chebyshev(t, before) >= 1;
            }, 1_500);
            if (!moved && inMaze()) {
                actions.walkTo(local.lx, local.lz);
            }
            await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && (reached(t) || (before !== null && chebyshev(t, before) >= 2));
            }, 4_000);
        }
    };
    /** True when the walk got next to `d`; false means it is walled off. */
    const walkAdjacent = async (d: { x: number; z: number }): Promise<boolean> => {
        await walkTowards(d, false);
        const t = reader.worldTile();
        return t !== null && chebyshev(t, d) <= 1;
    };

    const openDoorAt = async (d: { x: number; z: number }): Promise<void> => {
        await clearMesbox();
        const door = Locs.query()
            .where(l => MAZE_DOOR_IDS.has(l.id) && l.tile().x === d.x && l.tile().z === d.z)
            .nearest();
        if (!door) {
            log(`random event: maze — door (${d.x},${d.z}) not in scene, skipping`);
            return;
        }
        const pre = reader.worldTile();
        await door.interact('Open');
        await Execution.delayUntil(() => {
            const t = reader.worldTile();
            return ChatDialog.canContinue() || (t !== null && pre !== null && chebyshev(t, pre) >= 2);
        }, 3_000);
        if (ChatDialog.canContinue()) {
            await clearMesbox();
            log(`random event: maze — door (${d.x},${d.z}) refused (wrong side), continuing`);
        } else {
            const now = reader.worldTile();
            log(`random event: maze — through (${d.x},${d.z}) -> (${now?.x},${now?.z})`);
        }
    };

    // Why: the door list is a route through cells — each door is reachable only from the cell the previous one opens into, and opens only from that side.
    // Why: anything that leaves the player out of step with it (a relogin inside the maze, or a door step that bounced them back) walls the next door off.
    // Why: stepping back through the previous door re-enters the right cell instead of clicking a door on the far side of a wall for a minute.
    for (let i = 0; i < route.doors.length && inMaze(); ) {
        const door = route.doors[i];
        if (await walkAdjacent(door)) {
            await openDoorAt(door);
            i++;
            resyncs = 0;
            continue;
        }
        const previous = route.doors[i - 1];
        const here = reader.worldTile();
        if (!previous || resyncs >= MAX_RESYNCS) {
            log(
                `random event: maze — door ${i} (${door.x},${door.z}) is walled off from (${here?.x},${here?.z}) `
                + `after ${resyncs} re-sync attempt(s); restarting the route`
            );
            return true;
        }
        resyncs++;
        log(
            `random event: maze — door ${i} (${door.x},${door.z}) is walled off from (${here?.x},${here?.z}) — `
            + `stepping back through (${previous.x},${previous.z}) to re-enter the route (${resyncs}/${MAX_RESYNCS})`
        );
        if (await walkAdjacent(previous)) {
            await openDoorAt(previous);
        }
    }

    // Belt-and-suspenders: if a regenerated route missed the chamber door, open it.
    const last = route.doors[route.doors.length - 1];
    if (
        inMaze() &&
        (!last || last.x !== MAZE_SHRINE_DOOR.x || last.z !== MAZE_SHRINE_DOOR.z)
    ) {
        log(
            `random event: maze — opening chamber door (${MAZE_SHRINE_DOOR.x},${MAZE_SHRINE_DOOR.z})`
        );
        await walkAdjacent(MAZE_SHRINE_DOOR);
        await openDoorAt(MAZE_SHRINE_DOOR);
    }

    // Why: the content finish is [oploc1,macro_maze_complete] if_close; ~end_macro_maze.
    // Why: after the chamber door, Touch lands from the current tile (often 2911,4576 through the door), with the west open face as the fallback stand.
    const touchStands = [
        MAZE_SHRINE_DOOR,
        { x: MAZE_SHRINE.x, z: MAZE_SHRINE.z + 1 }, // (2911,4576) — post-door tile
        { x: MAZE_SHRINE.x - 1, z: MAZE_SHRINE.z + 1 },
        { x: MAZE_SHRINE.x - 1, z: MAZE_SHRINE.z + 2 }
    ];

    for (let pass = 0; pass < 6 && inMaze(); pass++) {
        await clearMesbox();
        const me0 = reader.worldTile();
        // First pass: already at an open face after the chamber door — Touch now.
        const nearShrine =
            me0 !== null &&
            Math.abs(me0.x - MAZE_SHRINE.x) <= 2 &&
            Math.abs(me0.z - MAZE_SHRINE.z) <= 2;
        if (!nearShrine || pass > 0) {
            const stand = touchStands[pass % touchStands.length]!;
            await walkTowards(stand, pass % 2 === 0);
            await clearMesbox();
        }

        const shrine =
            Locs.query()
                .where(l => l.id === MAZE_SHRINE_LOC)
                .within(8)
                .nearest() ??
            Locs.query().name('Strange shrine').within(8).nearest();
        if (!shrine) {
            log(`random event: maze — shrine not in scene (pass ${pass})`);
            await Execution.delayTicks(3);
            continue;
        }

        const ops = shrine.actions();
        const op = ops.find(a => /touch/i.test(a)) ?? ops[0] ?? 'Touch';
        const me = reader.worldTile();
        log(
            `random event: maze — ${op} shrine id=${shrine.id} loc=(${shrine.tile().x},${shrine.tile().z}) me=(${me?.x},${me?.z}) ops=[${ops.join(',')}]`
        );

        // Idle a tick so walk packets settle; OPLOC is rejected while delayed.
        await Execution.delayTicks(1);
        const ok = await shrine.interact(op);
        if (!ok) {
            log(`random event: maze — interact(${op}) rejected`);
        }
        await clearMesbox();

        // end_macro_maze: anim + p_delay(5) + ~macro_return_teleport
        const left = await Execution.delayUntil(() => !inMaze(), 12_000);
        if (left || !inMaze()) {
            break;
        }
        // Re-open chamber door if it closed between attempts.
        if (pass % 2 === 1) {
            await walkAdjacent(MAZE_SHRINE_DOOR);
            await openDoorAt(MAZE_SHRINE_DOOR);
        }
        await Execution.delayTicks(1);
    }

    log(inMaze() ? 'random event: maze — still inside; will retry' : 'random event: maze solved — returned');
    return true;
}
