interface Pt {
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

const MIN_FLEE_DIST = 4;
const RING_STEP = 2;

// Why: sweep inward because a single outer ring is often blocked indoors.
// @see docs/reference/api-events.md

/** Adjacent step-off candidates, farthest from `awayFrom` first. */
export function stepOffCandidates(from: Pt, awayFrom: { x: number; z: number }): Pt[] {
    return COMPASS.map(([dx, dz]) => ({ x: from.x + dx, z: from.z + dz, level: from.level })).sort((a, b) => {
        const da = Math.max(Math.abs(a.x - awayFrom.x), Math.abs(a.z - awayFrom.z));
        const db = Math.max(Math.abs(b.x - awayFrom.x), Math.abs(b.z - awayFrom.z));
        return db - da;
    });
}

/** Escape candidates, farthest from the threat first. */
export function fleeCandidates(from: Pt, threat: { x: number; z: number }, dist: number): Pt[] {
    const seen = new Set<string>();
    const out: Pt[] = [];
    for (let d = dist; d >= MIN_FLEE_DIST; d -= RING_STEP) {
        for (const [dx, dz] of COMPASS) {
            const p = { x: from.x + dx * d, z: from.z + dz * d, level: from.level };
            const key = `${p.x},${p.z}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(p);
        }
    }
    return out.sort((a, b) => {
        const da = Math.max(Math.abs(a.x - threat.x), Math.abs(a.z - threat.z));
        const db = Math.max(Math.abs(b.x - threat.x), Math.abs(b.z - threat.z));
        return db - da;
    });
}
