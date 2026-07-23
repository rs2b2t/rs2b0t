export interface MazeLoc {
    lx: number;
    lz: number;
    id: number;
    shape: number;
    angle: number;
}

export const MAZE_ORIGIN = { x: 45 * 64, z: 71 * 64 } as const;
export const MAZE_SHRINE = { x: 2911, z: 4575 } as const;
export const MAZE_SPAWNS = [
    { x: 2891, z: 4597 },
    { x: 2933, z: 4597 },
    { x: 2933, z: 4555 },
    { x: 2891, z: 4555 }
] as const;

const WALL_ID = 3626;
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

export interface DoorInfo {
    tile: { x: number; z: number };
    id: number;
    angle: number;
}

export interface MazeGraph {
    wallEdge: Set<string>;
    door: Map<string, DoorInfo>;
    minx: number;
    maxx: number;
    minz: number;
    maxz: number;
}

export function edgeKey(ax: number, az: number, bx: number, bz: number): string {
    return ax < bx || az < bz ? `${ax},${az}|${bx},${bz}` : `${bx},${bz}|${ax},${az}`;
}

function straightEdge(wx: number, wz: number, angle: number): [number, number, number, number] {
    switch (angle) {
        case 0: return [wx, wz, wx - 1, wz];
        case 1: return [wx, wz, wx, wz + 1];
        case 2: return [wx, wz, wx + 1, wz];
        default: return [wx, wz, wx, wz - 1];
    }
}

const WALL_L_ANGLES: Record<number, number[]> = { 0: [1, 0], 1: [1, 2], 2: [3, 2], 3: [3, 0] };

export function buildMaze(locs: MazeLoc[]): MazeGraph {
    const wallEdge = new Set<string>();
    const door = new Map<string, DoorInfo>();
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;

    for (const l of locs) {
        const wx = MAZE_ORIGIN.x + l.lx;
        const wz = MAZE_ORIGIN.z + l.lz;
        if (l.id === WALL_ID) {
            minx = Math.min(minx, wx); maxx = Math.max(maxx, wx);
            minz = Math.min(minz, wz); maxz = Math.max(maxz, wz);
            if (l.shape === 0) {
                wallEdge.add(edgeKey(...straightEdge(wx, wz, l.angle)));
            } else if (l.shape === 2) {
                for (const a of WALL_L_ANGLES[l.angle]) {
                    wallEdge.add(edgeKey(...straightEdge(wx, wz, a)));
                }
            }
        } else if (l.id in DOOR_DIRS) {
            door.set(edgeKey(...straightEdge(wx, wz, l.angle)), { tile: { x: wx, z: wz }, id: l.id, angle: l.angle });
        }
    }
    return { wallEdge, door, minx, maxx, minz, maxz };
}

export function doorPassable(door: DoorInfo, fromX: number, fromZ: number): boolean {
    const dir = DOOR_DIRS[door.id];
    if (dir === 0) { return true; }
    const axisTrue = door.angle === 1 || door.angle === 3 ? fromZ === door.tile.z : fromX === door.tile.x;
    return dir === 1 ? axisTrue : !axisTrue;
}

const CARDINAL: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function solveRoute(g: MazeGraph, spawn: { x: number; z: number }, shrine: { x: number; z: number } = MAZE_SHRINE): { x: number; z: number }[] {
    const finite = Number.isFinite(g.minx);
    const lo = {
        x: (finite ? g.minx : Math.min(spawn.x, shrine.x)) - 2,
        z: (finite ? g.minz : Math.min(spawn.z, shrine.z)) - 2
    };
    const hi = {
        x: (finite ? g.maxx : Math.max(spawn.x, shrine.x)) + 2,
        z: (finite ? g.maxz : Math.max(spawn.z, shrine.z)) + 2
    };
    const key = (x: number, z: number): string => `${x},${z}`;
    const prev = new Map<string, { px: number; pz: number; door: DoorInfo | null } | null>();
    prev.set(key(spawn.x, spawn.z), null);
    const queue: { x: number; z: number }[] = [{ x: spawn.x, z: spawn.z }];
    const adjacent = (x: number, z: number): boolean => Math.abs(x - shrine.x) + Math.abs(z - shrine.z) === 1;

    for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        if (adjacent(cur.x, cur.z)) {
            const doors: { x: number; z: number }[] = [];
            let node = prev.get(key(cur.x, cur.z));
            let px = cur.x, pz = cur.z;
            while (node) {
                if (node.door) { doors.unshift({ x: node.door.tile.x, z: node.door.tile.z }); }
                px = node.px; pz = node.pz;
                node = prev.get(key(px, pz)) ?? null;
            }
            return doors;
        }
        for (const [dx, dz] of CARDINAL) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            if (nx < lo.x || nx > hi.x || nz < lo.z || nz > hi.z) { continue; }
            const nk = key(nx, nz);
            if (prev.has(nk)) { continue; }
            const ek = edgeKey(cur.x, cur.z, nx, nz);
            const door = g.door.get(ek);
            if (door) {
                if (!doorPassable(door, cur.x, cur.z)) { continue; }
            } else if (g.wallEdge.has(ek)) {
                continue;
            }
            prev.set(nk, { px: cur.x, pz: cur.z, door: door ?? null });
            queue.push({ x: nx, z: nz });
        }
    }
    return [];
}
