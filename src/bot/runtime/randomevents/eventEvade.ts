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

// Why: sweeps inward from `dist` rather than offering a single ring, because indoors the eight tiles at one radius nearly all land inside rock.
// Why: measured from the Waterfall Dungeon safespot, only 2 of 8 at distance 12 are walkable against 6-7 of 8 a few tiles nearer, so a single ring leaves the bot standing there being hit while a good tile sits inside it.
// @see docs/reference/api-events.md

/** Tiles to run to when a random event has to be escaped, farthest from the threat first. */
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
