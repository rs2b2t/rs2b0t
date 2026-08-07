import { actions, reader } from '../../adapter/ClientAdapter.js';
import { chebyshev } from '../../nav/followMath.js';
import { Execution, type ExecutionApi } from '../Execution.js';
import { ChatDialog } from '../hud/ChatDialog.js';
import { Locs } from '../queries/Locs.js';
import { MAZE_SHRINE, MAZE_SHRINE_DOOR } from './mazeGraph.js';
import { MAZE_ROUTES } from './mazeRoutes.js';
import { selectRoute } from './selectRoute.js';

/** Region 45,71 — content mapzone `0_45_71` / enum macro_maze_teleports. */
export const MAZE_SQUARE = { mx: 45, mz: 71 };

/**
 * Content pack (loc.pack + all.loc + macro_event_maze.rs2):
 *   3628–3632  macro_maze_walllow*  op Open  (category macro_maze_wall_door)
 *   3634        macro_maze_complete  "Strange shrine" 3×3 op Touch → end_macro_maze
 *
 * Finish is NOT the south tile of the SW corner (walled). Last door is the west
 * chamber door at MAZE_SHRINE_DOOR (2910,4576); then Touch from an open face.
 */
const MAZE_DOOR_IDS = new Set([3628, 3629, 3630, 3631, 3632]);
const MAZE_SHRINE_LOC = 3634; // macro_maze_complete

export async function solveMaze(log: (msg: string) => void, execution: ExecutionApi = Execution): Promise<boolean> {
    const inMaze = (): boolean => {
        const me = reader.worldTile();
        return me !== null && me.level === 0 && me.x >> 6 === MAZE_SQUARE.mx && me.z >> 6 === MAZE_SQUARE.mz;
    };

    const clearMesbox = async (): Promise<void> => {
        // Content wrong-door: ~mesbox("I don't think that's the right way.")
        // start_macro_maze: chatnpc briefing from Mysterious Old Man.
        for (let i = 0; i < 6 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
            await execution.delayTicks(1);
        }
    };

    const start = reader.worldTile();
    if (!start) {
        return true;
    }
    await clearMesbox();

    const route = selectRoute(start, MAZE_ROUTES);
    log(
        `random event: maze — spawn (${start.x},${start.z}) -> route ${route.spawn.x},${route.spawn.z} (${route.doors.length} doors)`
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
                await execution.delayTicks(1);
                continue;
            }
            const before = reader.worldTile();
            actions.walkTo(local.lx, local.lz);
            const moved = await execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && before !== null && chebyshev(t, before) >= 1;
            }, 1_500);
            if (!moved && inMaze()) {
                actions.walkTo(local.lx, local.lz);
            }
            await execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && (reached(t) || (before !== null && chebyshev(t, before) >= 2));
            }, 4_000);
        }
    };
    const walkAdjacent = (d: { x: number; z: number }): Promise<void> => walkTowards(d, false);

    const openDoorAt = async (d: { x: number; z: number }): Promise<void> => {
        await walkAdjacent(d);
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
        await execution.delayUntil(() => {
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

    for (let i = 0; i < route.doors.length && inMaze(); i++) {
        await openDoorAt(route.doors[i]);
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
        await openDoorAt(MAZE_SHRINE_DOOR);
    }

    // Content finish: [oploc1,macro_maze_complete] if_close; ~end_macro_maze;
    // After the chamber door, prefer Touch immediately from current tile (often
    // 2911,4576 through the door). Fallback stands are the west open face.
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
            await execution.delayTicks(3);
            continue;
        }

        const ops = shrine.actions();
        const op = ops.find(a => /touch/i.test(a)) ?? ops[0] ?? 'Touch';
        const me = reader.worldTile();
        log(
            `random event: maze — ${op} shrine id=${shrine.id} loc=(${shrine.tile().x},${shrine.tile().z}) me=(${me?.x},${me?.z}) ops=[${ops.join(',')}]`
        );

        // Idle a tick so walk packets settle; OPLOC is rejected while delayed.
        await execution.delayTicks(1);
        const ok = await shrine.interact(op);
        if (!ok) {
            log(`random event: maze — interact(${op}) rejected`);
        }
        await clearMesbox();

        // end_macro_maze: anim + p_delay(5) + ~macro_return_teleport
        const left = await execution.delayUntil(() => !inMaze(), 12_000);
        if (left || !inMaze()) {
            break;
        }
        // Re-open chamber door if it closed between attempts.
        if (pass % 2 === 1) {
            await openDoorAt(MAZE_SHRINE_DOOR);
        }
        await execution.delayTicks(1);
    }

    log(inMaze() ? 'random event: maze — still inside; will retry' : 'random event: maze solved — returned');
    return true;
}
