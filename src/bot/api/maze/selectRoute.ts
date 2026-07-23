import { MAZE_ROUTES, type MazeRoute } from './mazeRoutes.js';

export function selectRoute(me: { x: number; z: number }, routes: MazeRoute[] = MAZE_ROUTES): MazeRoute {
    let best = routes[0];
    let bestD = Infinity;
    for (const r of routes) {
        const d = Math.abs(r.spawn.x - me.x) + Math.abs(r.spawn.z - me.z);
        if (d < bestD) { bestD = d; best = r; }
    }
    return best;
}
