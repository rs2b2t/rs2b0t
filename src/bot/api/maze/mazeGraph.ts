// Pure, engine-free solver for the Maze random event (region 0_45_71). Parses
// the static map source (m45_71.jm2), reconstructs the walkable edge graph the
// way the engine's CollisionEngine does for wall_straight/wall_L, and runs a
// directed, door-gated BFS from each fixed spawn to the shrine. Dev-time only
// (feeds tools/maze-derive.ts); no runtime/client dependency.

export interface MazeLoc {
    lx: number;
    lz: number;
    id: number;
    shape: number; // LocShape: 0 wall_straight, 2 wall_L, 3 square_corner
    angle: number; // LocAngle: 0 W, 1 N, 2 E, 3 S
}

export const MAZE_ORIGIN = { x: 45 * 64, z: 71 * 64 } as const; // (2880, 4544)
export const MAZE_SHRINE = { x: 2911, z: 4575 } as const;       // local (31,31)
export const MAZE_SPAWNS = [
    { x: 2891, z: 4597 }, // NW  local (11,53)
    { x: 2933, z: 4597 }, // NE  local (53,53)
    { x: 2933, z: 4555 }, // SE  local (53,11)
    { x: 2891, z: 4555 }  // SW  local (11,11)
] as const;

export const WALL_ID = 3626;
// door id -> approach_direction: 0 both sides, 1 axis-aligned side, 2 off-axis side
export const DOOR_DIRS: Record<number, number> = { 3628: 0, 3629: 1, 3630: 2, 3631: 2, 3632: 1 };

const LOC_LINE = /^(\d+)\s+(\d+)\s+(\d+):\s+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?$/;

export function parseJm2Locs(text: string): MazeLoc[] {
    const out: MazeLoc[] = [];
    let inLoc = false;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('==== LOC')) { inLoc = true; continue; }
        if (line.startsWith('====')) { inLoc = false; continue; }
        if (!inLoc || line.length === 0) { continue; }
        const m = LOC_LINE.exec(line);
        if (!m || Number(m[1]) !== 0) { continue; }
        out.push({
            lx: Number(m[2]),
            lz: Number(m[3]),
            id: Number(m[4]),
            shape: m[5] !== undefined ? Number(m[5]) : 10,
            angle: m[6] !== undefined ? Number(m[6]) : 0
        });
    }
    return out;
}
