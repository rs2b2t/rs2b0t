// Pure flee-tile candidates for hostile random events: 8 compass points at
// `dist`, sorted furthest-from-threat first so walking to the first
// REACHABLE one moves directly away.

export interface Pt {
    x: number;
    z: number;
    level: number;
}

const COMPASS: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1]
];

export function fleeCandidates(from: Pt, threat: { x: number; z: number }, dist: number): Pt[] {
    return COMPASS.map(([dx, dz]) => ({ x: from.x + dx * dist, z: from.z + dz * dist, level: from.level })).sort((a, b) => {
        const da = Math.max(Math.abs(a.x - threat.x), Math.abs(a.z - threat.z));
        const db = Math.max(Math.abs(b.x - threat.x), Math.abs(b.z - threat.z));
        return db - da;
    });
}
