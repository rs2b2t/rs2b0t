import { actions, reader } from '../../adapter/ClientAdapter.js';
import { chebyshev } from '../../nav/followMath.js';
import { Execution } from '../Execution.js';
import { ChatDialog } from '../hud/ChatDialog.js';
import { Locs } from '../queries/Locs.js';
import { MAZE_ROUTES } from './mazeRoutes.js';
import { selectRoute } from './selectRoute.js';

export const MAZE_SQUARE = { mx: 45, mz: 71 };

const MAZE_SHRINE_LOC = 3634;
const MAZE_DOOR_IDS = new Set([3628, 3629, 3630, 3631, 3632]);
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

    const walkTowards = async (d: { x: number; z: number }, onto: boolean): Promise<void> => {
        const reached = (t: { x: number; z: number }): boolean => (onto ? t.x === d.x && t.z === d.z : chebyshev(t, d) <= 1);
        for (let w = 0; w < 8 && inMaze(); w++) {
            const now = reader.worldTile();
            if (now && reached(now)) { return; }
            const local = reader.toLocal(d.x, d.z);
            if (!local) { await Execution.delayTicks(1); continue; }
            const before = reader.worldTile();
            actions.walkTo(local.lx, local.lz);
            const moved = await Execution.delayUntil(() => {
                const t = reader.worldTile();
                return t !== null && before !== null && chebyshev(t, before) >= 1;
            }, 1_000);
            if (!moved && inMaze()) { actions.walkTo(local.lx, local.lz); }
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
        await Execution.delayUntil(() => {
            const t = reader.worldTile();
            return ChatDialog.canContinue() || (t !== null && pre !== null && chebyshev(t, pre) >= 2);
        }, 2_000);
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            log(`random event: maze — door (${d.x},${d.z}) refused (branch), continuing`);
        } else {
            const now = reader.worldTile();
            log(`random event: maze — through (${d.x},${d.z}) -> (${now?.x},${now?.z})`);
        }
    }

    for (let pass = 0; pass < 4 && inMaze(); pass++) {
        await walkTowards(MAZE_FINAL_TILE, true);
        const me = reader.worldTile();
        if (!me || me.x !== MAZE_FINAL_TILE.x || me.z !== MAZE_FINAL_TILE.z) {
            await Execution.delayTicks(2);
            continue;
        }
        const finalDoor = Locs.query()
            .where(l => MAZE_DOOR_IDS.has(l.id) && l.tile().x === MAZE_FINAL_TILE.x && l.tile().z === MAZE_FINAL_TILE.z)
            .nearest();
        if (finalDoor) {
            await finalDoor.interact('Open');
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
