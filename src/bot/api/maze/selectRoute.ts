import { MAZE_ROUTES, type MazeRoute } from './mazeRoutes.js';

// The maze teleports the player onto one of 4 fixed corners; pick the route
// whose spawn is nearest (Manhattan) to where we actually landed.
export function selectRoute(me: { x: number; z: number }, routes: MazeRoute[] = MAZE_ROUTES): MazeRoute {
    let best = routes[0];
    let bestD = Infinity;
    for (const r of routes) {
        const d = Math.abs(r.spawn.x - me.x) + Math.abs(r.spawn.z - me.z);
        if (d < bestD) { bestD = d; best = r; }
    }
    return best;
}
