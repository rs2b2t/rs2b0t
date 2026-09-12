import { buildMaze, solveRoute, type MazeGraph, type MazeLoc } from './mazeGraph.js';
import { MAZE_LAYOUT, MAZE_LAYOUT_STRIDE } from './mazeLayout.js';

interface MazeRoute {
    spawn: { x: number; z: number };
    doors: { x: number; z: number }[];
}

let cached: MazeGraph | null = null;

/** The map square is static, so the graph is built once and reused. */
function graph(): MazeGraph {
    if (cached) {
        return cached;
    }
    const locs: MazeLoc[] = [];
    for (let i = 0; i < MAZE_LAYOUT.length; i += MAZE_LAYOUT_STRIDE) {
        locs.push({
            lx: MAZE_LAYOUT[i],
            lz: MAZE_LAYOUT[i + 1],
            id: MAZE_LAYOUT[i + 2],
            shape: MAZE_LAYOUT[i + 3],
            angle: MAZE_LAYOUT[i + 4]
        });
    }
    cached = buildMaze(locs);
    return cached;
}

// Why: spawns vary beyond the four corners, so solve from the observed tile or return no route.

/** Solves a door route from wherever the player landed. */
export function selectRoute(me: { x: number; z: number }): MazeRoute | null {
    const doors = solveRoute(graph(), me);
    if (doors.length === 0) {
        return null;
    }
    return { spawn: { x: me.x, z: me.z }, doors };
}
