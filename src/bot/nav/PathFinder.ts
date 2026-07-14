// World-scale A* over the baked collision pack. Pure module — no
// worker glue, no client imports — so the same code runs inside NavWorker in
// the browser and under Bun for offline benches (tools/nav/bench-path.ts).
//
// Pack format: see tools/nav/build-collision.ts (LCNV v1). Per mapsquare and
// present level: 4096-byte exit-mask array (index x*64+z, bit 0=N,1=E,2=S,
// 3=W,4=NE,5=SE,6=SW,7=NW = step legal) + 512-byte walkable bitset.

export interface NavPoint {
    x: number;
    z: number;
    level: number;
}

/** How to cross a non-grid edge: interact `action` on the loc named
 *  `locName` found at/near (locX,locZ). */
export interface TransportInfo {
    locName: string;
    action: string;
    locX: number;
    locZ: number;
    /** Present when the crossing changes level (stairs/ladders). */
    toLevel?: number;
    /** Present when the crossing teleports across the map on the SAME level
     *  (kind 'dungeon': trapdoor/ladder z±6400 jumps). The walker interacts and
     *  waits to land near this tile — door/stair checks can't see the jump. */
    toTile?: { x: number; z: number };
}

/** Tile path compressed to direction-change points; transport crossings are
 *  explicit annotated entries (the tile you occupy after crossing). */
export interface Waypoint extends NavPoint {
    transport?: TransportInfo;
}

export type PathOutcome = { ok: true; waypoints: Waypoint[]; cost: number; expanded: number } | { ok: false; reason: string; expanded: number };

export interface DoorEdgeData {
    x: number;
    z: number;
    level: number;
    locId: number;
    locName: string;
    dir: 'N' | 'E' | 'S' | 'W';
}

export interface TransportEdgeData {
    from: NavPoint;
    to: NavPoint;
    locName: string;
    action: string;
    kind: string;
}

// ---- worker protocol (NavWorker.ts <-> Navigator.ts) ----

export type NavRequest = { type: 'init'; pack: ArrayBuffer } | { type: 'path'; id: number; from: NavPoint; to: NavPoint; avoid?: { x: number; z: number }[]; maxExpansions?: number };

export type NavResponse =
    | { type: 'ready'; mapsquares: number; doorEdges: number; transportEdges: number }
    | { type: 'error'; message: string }
    | ({ type: 'path'; id: number; elapsedMs: number } & PathOutcome);

// ---- costs / limits ----

const DOOR_COST = 4;
const TRANSPORT_COST = 10;
const MAX_EXPANSIONS = 300_000;

// direction bit order must match tools/nav/build-collision.ts DIRS
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

const DOOR_DIR: Record<DoorEdgeData['dir'], [number, number]> = {
    N: [0, 1],
    E: [1, 0],
    S: [0, -1],
    W: [-1, 0]
};

// node id: (level<<28)|(x<<14)|z — world x<3648, z<10368 both fit 14 bits
function nodeId(x: number, z: number, level: number): number {
    return (level << 28) | (x << 14) | z;
}

function nodeX(id: number): number {
    return (id >> 14) & 0x3fff;
}

function nodeZ(id: number): number {
    return id & 0x3fff;
}

function nodeLevel(id: number): number {
    return (id >> 28) & 0x3;
}

interface CompiledEdge {
    to: number;
    cost: number;
    transport: TransportInfo;
}

/** Binary min-heap of (key, nodeId); key = f*2^20 - g so equal-f ties pop the
 *  deepest node first (classic A* speedup on open plains). */
class MinHeap {
    private keys: number[] = [];
    private ids: number[] = [];

    get size(): number {
        return this.ids.length;
    }

    push(key: number, id: number): void {
        const keys = this.keys;
        const ids = this.ids;
        let i = ids.length;
        keys.push(key);
        ids.push(id);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (keys[parent] <= keys[i]) {
                break;
            }
            [keys[parent], keys[i]] = [keys[i], keys[parent]];
            [ids[parent], ids[i]] = [ids[i], ids[parent]];
            i = parent;
        }
    }

    pop(): number {
        const keys = this.keys;
        const ids = this.ids;
        const top = ids[0];
        const lastKey = keys.pop()!;
        const lastId = ids.pop()!;
        if (ids.length > 0) {
            keys[0] = lastKey;
            ids[0] = lastId;
            let i = 0;
            while (true) {
                const left = 2 * i + 1;
                const right = left + 1;
                let smallest = i;
                if (left < ids.length && keys[left] < keys[smallest]) {
                    smallest = left;
                }
                if (right < ids.length && keys[right] < keys[smallest]) {
                    smallest = right;
                }
                if (smallest === i) {
                    break;
                }
                [keys[smallest], keys[i]] = [keys[i], keys[smallest]];
                [ids[smallest], ids[i]] = [ids[i], ids[smallest]];
                i = smallest;
            }
        }
        return top;
    }
}

interface LevelSlot {
    exit: Uint8Array;
    walk: Uint8Array;
    /** v2 packs: packed 4-bit wall-edge nibbles (bit 0=N,1=E,2=S,3=W), two
     *  tiles per byte. null on v1 packs — wall queries read as "no wall". */
    wall: Uint8Array | null;
}

export class PathFinder {
    /** slot index = (level<<16)|(mx<<8)|mz */
    private readonly slots: (LevelSlot | null)[] = new Array(4 << 16).fill(null);
    readonly mapsquares: number;
    readonly members: boolean;

    /** non-grid edges by source node id */
    private readonly edges = new Map<number, CompiledEdge[]>();
    doorEdges = 0;
    transportEdges = 0;

    constructor(pack: Uint8Array) {
        if (pack.length < 10 || pack[0] !== 0x4c || pack[1] !== 0x43 || pack[2] !== 0x4e || pack[3] !== 0x56) {
            throw new Error('not an LCNV pack');
        }
        const version = pack[4];
        if (version !== 1 && version !== 2) {
            throw new Error(`unsupported LCNV version ${version}`);
        }
        this.members = pack[5] === 1;

        const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
        const count = view.getUint16(8, true);
        let pos = 10;
        for (let i = 0; i < count; i++) {
            const mx = pack[pos++];
            const mz = pack[pos++];
            const levelMask = pack[pos++];
            for (let level = 0; level < 4; level++) {
                if ((levelMask & (1 << level)) === 0) {
                    continue;
                }
                const exit = pack.subarray(pos, pos + 4096);
                pos += 4096;
                const walk = pack.subarray(pos, pos + 512);
                pos += 512;
                let wall: Uint8Array | null = null;
                if (version >= 2) {
                    wall = pack.subarray(pos, pos + 2048);
                    pos += 2048;
                }
                this.slots[(level << 16) | (mx << 8) | mz] = { exit, walk, wall };
            }
        }
        if (pos !== pack.length) {
            throw new Error(`LCNV pack truncated or trailing bytes (read ${pos} of ${pack.length})`);
        }
        this.mapsquares = count;
    }

    private slotAt(x: number, z: number, level: number): LevelSlot | null {
        return this.slots[(level << 16) | ((x >> 6) << 8) | (z >> 6)];
    }

    walkable(x: number, z: number, level: number): boolean {
        const slot = this.slotAt(x, z, level);
        if (!slot) {
            return false;
        }
        const index = (x & 0x3f) * 64 + (z & 0x3f);
        return (slot.walk[index >> 3] & (1 << (index & 0x7))) !== 0;
    }

    exitMask(x: number, z: number, level: number): number {
        const slot = this.slotAt(x, z, level);
        return slot ? slot.exit[(x & 0x3f) * 64 + (z & 0x3f)] : 0;
    }

    /** Wall-edge nibble of a tile (bit 0=N,1=E,2=S,3=W). 0 on v1 packs. */
    wallMask(x: number, z: number, level: number): number {
        const slot = this.slotAt(x, z, level);
        if (!slot || !slot.wall) {
            return 0;
        }
        const index = (x & 0x3f) * 64 + (z & 0x3f);
        return (index & 1 ? slot.wall[index >> 1] >> 4 : slot.wall[index >> 1]) & 0xf;
    }

    /** Compile door + transport + stair edges into the search graph. Edges
     *  whose endpoints are not walkable in the pack are dropped. `stairs` are
     *  TransportEdgeData too (baked cross-level hops from derive-stairs.ts) and
     *  are processed by the same loop as `transports`. */
    addEdges(doors: DoorEdgeData[], transports: TransportEdgeData[], stairs: TransportEdgeData[] = []): void {
        for (const door of doors) {
            const [dx, dz] = DOOR_DIR[door.dir];
            const ax = door.x;
            const az = door.z;
            const bx = door.x + dx;
            const bz = door.z + dz;
            if (!this.walkable(ax, az, door.level) || !this.walkable(bx, bz, door.level)) {
                continue;
            }
            const transport: TransportInfo = { locName: door.locName, action: 'Open', locX: door.x, locZ: door.z };
            this.addEdge(nodeId(ax, az, door.level), nodeId(bx, bz, door.level), DOOR_COST, transport);
            this.addEdge(nodeId(bx, bz, door.level), nodeId(ax, az, door.level), DOOR_COST, transport);
            this.doorEdges++;
        }

        for (const edge of [...transports, ...stairs]) {
            if (!this.walkable(edge.from.x, edge.from.z, edge.from.level) || !this.walkable(edge.to.x, edge.to.z, edge.to.level)) {
                continue;
            }
            const transport: TransportInfo = {
                locName: edge.locName,
                action: edge.action,
                locX: edge.from.x,
                locZ: edge.from.z,
                toLevel: edge.to.level !== edge.from.level ? edge.to.level : undefined,
                toTile: edge.kind === 'dungeon' ? { x: edge.to.x, z: edge.to.z } : undefined
            };
            this.addEdge(nodeId(edge.from.x, edge.from.z, edge.from.level), nodeId(edge.to.x, edge.to.z, edge.to.level), TRANSPORT_COST, transport);
            this.transportEdges++;
        }
    }

    private addEdge(from: number, to: number, cost: number, transport: TransportInfo): void {
        let list = this.edges.get(from);
        if (!list) {
            list = [];
            this.edges.set(from, list);
        }
        list.push({ to, cost, transport });
    }

    /** Nearest walkable tile within `radius` (Chebyshev rings), or null. */
    snapWalkable(p: NavPoint, radius: number): NavPoint | null {
        if (this.walkable(p.x, p.z, p.level)) {
            return p;
        }
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) {
                        continue;
                    }
                    if (this.walkable(p.x + dx, p.z + dz, p.level)) {
                        return { x: p.x + dx, z: p.z + dz, level: p.level };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Goal candidates for an unwalkable target: every walkable tile within
     * `radius`. Searching to the whole set (first one popped wins) is what
     * makes enclaves harmless — e.g. (3213,3428) is inside the Varrock
     * fountain and its nearest walkable tile is the fountain's enclosed
     * centre, which no flood can reach; some other ring tile is.
     */
    private goalCandidates(p: NavPoint, radius: number): Set<number> {
        const goals = new Set<number>();
        if (this.walkable(p.x, p.z, p.level)) {
            goals.add(nodeId(p.x, p.z, p.level));
            return goals;
        }
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (this.walkable(p.x + dx, p.z + dz, p.level)) {
                    goals.add(nodeId(p.x + dx, p.z + dz, p.level));
                }
            }
        }
        return goals;
    }

    /** Walkable tiles CARDINALLY adjacent to an unwalkable target — the only
     *  tiles a server interact (search a box, open a booth) can be issued from.
     *  A candidate with a wall on its edge toward the target is excluded: it is
     *  interact-ILLEGAL (the Seers drawers house — the tile west of the drawers
     *  is walkable and adjacent but outside the wall, so Search no-ops there).
     *  Empty when the target itself is walkable. */
    private cardinalGoals(p: NavPoint): Set<number> {
        const goals = new Set<number>();
        if (this.walkable(p.x, p.z, p.level)) {
            return goals;
        }
        // candidate offset from target → wall bit on the candidate's edge FACING
        // the target (nibble bits 0=N,1=E,2=S,3=W)
        const sides: [number, number, number][] = [
            [0, 1, 1 << 2], // candidate north of target, its S edge
            [1, 0, 1 << 3], // east, its W edge
            [0, -1, 1 << 0], // south, its N edge
            [-1, 0, 1 << 1] // west, its E edge
        ];
        for (const [dx, dz, facingBit] of sides) {
            const cx = p.x + dx;
            const cz = p.z + dz;
            if (this.walkable(cx, cz, p.level) && (this.wallMask(cx, cz, p.level) & facingBit) === 0) {
                goals.add(nodeId(cx, cz, p.level));
            }
        }
        return goals;
    }

    findPath(fromRaw: NavPoint, toRaw: NavPoint, avoidDoors?: Set<string>, maxExpansions: number = MAX_EXPANSIONS): PathOutcome {
        const from = this.snapWalkable(fromRaw, 2);
        if (!from) {
            return { ok: false, reason: `start (${fromRaw.x},${fromRaw.z},${fromRaw.level}) not walkable`, expanded: 0 };
        }

        // Interact-first: for an unwalkable target, search the cardinal-adjacent
        // goals before the ring — the ring happily terminates within 5 tiles on
        // the WRONG SIDE of a wall (the Varrock diagonal-door clue house), where
        // no interact can ever succeed. Fall back to the ring when no cardinal
        // tile exists or none is reachable (Varrock-fountain enclave: the ring
        // is what keeps those harmless).
        const cardinal = this.cardinalGoals(toRaw);
        if (cardinal.size > 0) {
            const direct = this.search(from, toRaw, cardinal, 1, avoidDoors, maxExpansions);
            if (direct.ok) {
                return direct;
            }
        }

        const goals = this.goalCandidates(toRaw, 5);
        if (goals.size === 0) {
            return { ok: false, reason: `target (${toRaw.x},${toRaw.z},${toRaw.level}) not walkable within 5 tiles`, expanded: 0 };
        }
        const goalSlack = goals.size === 1 && goals.has(nodeId(toRaw.x, toRaw.z, toRaw.level)) ? 0 : 5;
        return this.search(from, toRaw, goals, goalSlack, avoidDoors, maxExpansions);
    }

    /** One A* run to whichever of `goals` pops first. `goalSlack` keeps the
     *  heuristic admissible for every candidate: distance to the requested
     *  centre minus the candidate ring radius. */
    private search(from: NavPoint, toRaw: NavPoint, goals: Set<number>, goalSlack: number, avoidDoors: Set<string> | undefined, maxExpansions: number): PathOutcome {
        const start = nodeId(from.x, from.z, from.level);
        const goalX = toRaw.x;
        const goalZ = toRaw.z;

        const gScore = new Map<number, number>();
        const cameFrom = new Map<number, number>();
        const viaEdge = new Map<number, TransportInfo>();
        const closed = new Set<number>();
        const open = new MinHeap();
        const heuristic = (x: number, z: number): number => Math.max(0, Math.max(Math.abs(x - goalX), Math.abs(z - goalZ)) - goalSlack);

        gScore.set(start, 0);
        open.push(heuristic(from.x, from.z) * 1048576, start);

        let expanded = 0;
        while (open.size > 0) {
            const current = open.pop();
            if (closed.has(current)) {
                continue;
            }
            closed.add(current);

            if (goals.has(current)) {
                return this.reconstruct(start, current, gScore.get(current)!, expanded, cameFrom, viaEdge);
            }

            if (++expanded > maxExpansions) {
                return { ok: false, reason: `expansion budget exceeded (${maxExpansions})`, expanded };
            }

            const x = nodeX(current);
            const z = nodeZ(current);
            const level = nodeLevel(current);
            const g = gScore.get(current)!;

            const mask = this.exitMask(x, z, level);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) {
                    continue;
                }
                const nx = x + DX[dir];
                const nz = z + DZ[dir];
                const neighbor = nodeId(nx, nz, level);
                if (closed.has(neighbor)) {
                    continue;
                }
                const tentative = g + 1;
                const known = gScore.get(neighbor);
                if (known !== undefined && known <= tentative) {
                    continue;
                }
                gScore.set(neighbor, tentative);
                cameFrom.set(neighbor, current);
                viaEdge.delete(neighbor);
                open.push((tentative + heuristic(nx, nz)) * 1048576 - tentative, neighbor);
            }

            const extra = this.edges.get(current);
            if (extra) {
                for (const edge of extra) {
                    if (closed.has(edge.to)) {
                        continue;
                    }
                    if (avoidDoors && edge.transport.toLevel === undefined && avoidDoors.has(`${edge.transport.locX}|${edge.transport.locZ}`)) {
                        continue;
                    }
                    const tentative = g + edge.cost;
                    const known = gScore.get(edge.to);
                    if (known !== undefined && known <= tentative) {
                        continue;
                    }
                    gScore.set(edge.to, tentative);
                    cameFrom.set(edge.to, current);
                    viaEdge.set(edge.to, edge.transport);
                    open.push((tentative + heuristic(nodeX(edge.to), nodeZ(edge.to))) * 1048576 - tentative, edge.to);
                }
            }
        }

        return { ok: false, reason: 'unreachable', expanded };
    }

    private reconstruct(start: number, goal: number, cost: number, expanded: number, cameFrom: Map<number, number>, viaEdge: Map<number, TransportInfo>): PathOutcome {
        const chain: number[] = [];
        for (let node = goal; ; ) {
            chain.push(node);
            if (node === start) {
                break;
            }
            const prev = cameFrom.get(node);
            if (prev === undefined) {
                return { ok: false, reason: 'reconstruction broke (bug)', expanded };
            }
            node = prev;
        }
        chain.reverse();

        // compress to direction-change points; transport crossings stay as
        // annotated entries and their approach tile is always kept
        const waypoints: Waypoint[] = [];
        const point = (id: number): NavPoint => ({ x: nodeX(id), z: nodeZ(id), level: nodeLevel(id) });
        const stepDir = (a: number, b: number): number => {
            const dx = Math.sign(nodeX(b) - nodeX(a));
            const dz = Math.sign(nodeZ(b) - nodeZ(a));
            return (dx + 1) * 3 + (dz + 1);
        };

        waypoints.push(point(chain[0]));
        for (let i = 1; i < chain.length; i++) {
            const via = viaEdge.get(chain[i]);
            const viaNext = i + 1 < chain.length ? viaEdge.get(chain[i + 1]) : undefined;
            const last = i === chain.length - 1;
            const turn = !last && !via && !viaNext && stepDir(chain[i - 1], chain[i]) !== stepDir(chain[i], chain[i + 1]);
            if (via || viaNext || turn || last) {
                const wp: Waypoint = point(chain[i]);
                if (via) {
                    wp.transport = via;
                }
                waypoints.push(wp);
            }
        }

        return { ok: true, waypoints, cost, expanded };
    }
}
