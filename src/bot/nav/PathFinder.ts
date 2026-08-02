// docs/NAV.md#pathfinding
// nav-v2: docs/nav-v2/README.md
import type { PathHop, PathPolicy, TransportRequires } from './v2/types.js';
import type { WorldStateData } from './v2/worldStateData.js';
import { worldStateFromData } from './v2/worldStateData.js';
import { meetsRequires } from './v2/requires.js';
import { kindAllowedByPolicy, routeSpanChebyshev, teleportAllowedByPolicy } from './v2/policy.js';
import { hopsFromWaypoints } from './v2/hops.js';
import { SPELL_TELEPORTS, inventoryNameMatchesJewellery, JEWELLERY_TELEPORTS } from './v2/teleportCatalog.js';
import { specialRequiresAt } from './v2/specialRequires.js';
import { activateTransportRows } from './v2/activateStateAware.js';

export interface NavPoint {
    x: number;
    z: number;
    level: number;
}

export interface TransportInfo {
    locName: string;
    action: string;
    locX: number;
    locZ: number;
    /** Map placement / closed-state loc identity (for lookup). */
    locId?: number;
    /**
     * Action-bearing open-state loc id when the map placement is a closed
     * trapdoor (or similar) that transforms after Open. Executor matches either.
     */
    openLocId?: number;
    toLevel?: number;
    toTile?: { x: number; z: number };
    /** Portal multi-exit landings (e.g. essence mine). */
    acceptAnyLanding?: boolean;
    /** nav-v2: edge kind for hops / tele executor. */
    kind?: string;
    /** nav-v2: spell/jewellery teleport id (varrock, dueling_arena, …). */
    teleportId?: string;
}

export interface Waypoint extends NavPoint {
    transport?: TransportInfo;
}

export type PathOutcome =
    | { ok: true; waypoints: Waypoint[]; cost: number; expanded: number; hops: PathHop[] }
    | { ok: false; reason: string; expanded: number };

/** Options object for findPath (preferred over positional avoid/max). */
export interface FindPathCallOptions {
    avoidDoors?: Set<string>;
    maxExpansions?: number;
    /** Serialized world snapshot — worker-safe. */
    state?: WorldStateData;
    policy?: PathPolicy;
    /**
     * When true, inject catalogued originless teleports from the start tile.
     * Default false when policy.useTeleports is false; else true if policy set with useTeleports!==false.
     */
    useTeleportCatalog?: boolean;
}

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
    /** Map placement / closed-state loc identity, when the edge is loc-backed. */
    locId?: number;
    /** Action-bearing open-state loc id (closed trapdoor → trapdoor_open). */
    openLocId?: number;
    locX?: number;
    locZ?: number;
    /** Content-pack source metadata retained for auditing and regeneration. */
    debugName?: string;
    options?: string[];
    /** Keep a known-invalid derived row documented without making it routable. */
    disabledReason?: string;
}

export type NavRequest =
    | { type: 'init'; pack: ArrayBuffer }
    | {
        type: 'path';
        id: number;
        from: NavPoint;
        to: NavPoint;
        avoid?: { x: number; z: number }[];
        maxExpansions?: number;
        state?: WorldStateData;
        policy?: PathPolicy;
        useTeleportCatalog?: boolean;
    };

export type NavResponse =
    | { type: 'ready'; mapsquares: number; doorEdges: number; transportEdges: number }
    | { type: 'error'; message: string }
    | ({ type: 'path'; id: number; elapsedMs: number } & PathOutcome);

const DOOR_COST = 4;
const TRANSPORT_COST = 10;
const MAX_EXPANSIONS = 300_000;

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

const DOOR_DIR: Record<DoorEdgeData['dir'], [number, number]> = {
    N: [0, 1],
    E: [1, 0],
    S: [0, -1],
    W: [-1, 0]
};

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
    requires?: TransportRequires;
    kind?: string;
    teleportId?: string;
}

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
    wall: Uint8Array | null;
}

export class PathFinder {
    private readonly slots: (LevelSlot | null)[] = new Array(4 << 16).fill(null);
    readonly mapsquares: number;
    readonly members: boolean;

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

    wallMask(x: number, z: number, level: number): number {
        const slot = this.slotAt(x, z, level);
        if (!slot || !slot.wall) {
            return 0;
        }
        const index = (x & 0x3f) * 64 + (z & 0x3f);
        return (index & 1 ? slot.wall[index >> 1] >> 4 : slot.wall[index >> 1]) & 0xf;
    }

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
            const transport: TransportInfo = {
                locName: door.locName,
                action: 'Open',
                locX: door.x,
                locZ: door.z,
                locId: door.locId,
                kind: 'door'
            };
            this.addEdge(nodeId(ax, az, door.level), nodeId(bx, bz, door.level), DOOR_COST, transport, undefined, 'door');
            this.addEdge(nodeId(bx, bz, door.level), nodeId(ax, az, door.level), DOOR_COST, transport, undefined, 'door');
            this.doorEdges++;
        }

        const activated = activateTransportRows([...transports, ...stairs]);
        for (const edge of activated) {
            if (edge.disabledReason) {
                continue;
            }
            if (!this.walkable(edge.from.x, edge.from.z, edge.from.level) || !this.walkable(edge.to.x, edge.to.z, edge.to.level)) {
                continue;
            }
            const dx = edge.to.x - edge.from.x;
            const dz = edge.to.z - edge.from.z;
            const hasMidpointDoor = edge.kind === 'door' && (Math.abs(dx) === 2 || Math.abs(dz) === 2) && dx % 2 === 0 && dz % 2 === 0;
            const transport: TransportInfo = {
                locName: edge.locName,
                action: edge.action,
                // Diagonal wall doors occupy the otherwise-unwalkable midpoint
                // between their two stand tiles. Recording a stand tile here
                // makes the executor confuse nearby doors and avoidance strikes.
                locX: edge.locX ?? (hasMidpointDoor ? edge.from.x + dx / 2 : edge.from.x),
                locZ: edge.locZ ?? (hasMidpointDoor ? edge.from.z + dz / 2 : edge.from.z),
                locId: edge.locId,
                openLocId: edge.openLocId,
                kind: edge.kind,
                toLevel: edge.to.level !== edge.from.level ? edge.to.level : undefined,
                // Portals land on a fixed tile (or any tile for multi-exit) — executor waits on toTile.
                toTile:
                    edge.kind === 'dungeon' || edge.kind === 'portal' || edge.kind === 'ship' || edge.kind === 'gangplank'
                        ? { x: edge.to.x, z: edge.to.z }
                        : undefined,
                acceptAnyLanding: edge.kind === 'portal' ? true : undefined
            };
            const requires = edge.requires ?? specialRequiresAt(edge.from.x, edge.from.z, edge.from.level);
            this.addEdge(
                nodeId(edge.from.x, edge.from.z, edge.from.level),
                nodeId(edge.to.x, edge.to.z, edge.to.level),
                TRANSPORT_COST,
                transport,
                requires,
                edge.kind
            );
            this.transportEdges++;
        }
    }

    private addEdge(
        from: number,
        to: number,
        cost: number,
        transport: TransportInfo,
        requires?: TransportRequires,
        kind?: string,
        teleportId?: string
    ): void {
        let list = this.edges.get(from);
        if (!list) {
            list = [];
            this.edges.set(from, list);
        }
        list.push({ to, cost, transport, requires, kind, teleportId });
    }

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

    private goalCandidates(p: NavPoint, radius: number): Set<number> {
        const goals = new Set<number>();
        if (this.walkable(p.x, p.z, p.level)) {
            goals.add(nodeId(p.x, p.z, p.level));
            return goals;
        }
        const queue: NavPoint[] = [];
        const seen = new Set<number>();
        for (const id of this.cardinalGoals(p)) {
            queue.push({ x: nodeX(id), z: nodeZ(id), level: nodeLevel(id) });
            seen.add(id);
        }
        while (queue.length > 0) {
            const cur = queue.shift()!;
            goals.add(nodeId(cur.x, cur.z, cur.level));
            const mask = this.exitMask(cur.x, cur.z, cur.level);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) {
                    continue;
                }
                const nx = cur.x + DX[dir];
                const nz = cur.z + DZ[dir];
                if (Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) > radius) {
                    continue;
                }
                const id = nodeId(nx, nz, cur.level);
                if (seen.has(id) || !this.walkable(nx, nz, cur.level)) {
                    continue;
                }
                seen.add(id);
                queue.push({ x: nx, z: nz, level: cur.level });
            }
        }
        if (goals.size > 0) {
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

    private cardinalGoals(p: NavPoint): Set<number> {
        const goals = new Set<number>();
        if (this.walkable(p.x, p.z, p.level)) {
            return goals;
        }
        const sides: [number, number, number][] = [
            [0, 1, 1 << 2],
            [1, 0, 1 << 3],
            [0, -1, 1 << 0],
            [-1, 0, 1 << 1]
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

    findPath(
        fromRaw: NavPoint,
        toRaw: NavPoint,
        avoidDoorsOrOpts?: Set<string> | FindPathCallOptions,
        maxExpansionsArg: number = MAX_EXPANSIONS
    ): PathOutcome {
        const opts: FindPathCallOptions =
            avoidDoorsOrOpts instanceof Set || avoidDoorsOrOpts === undefined
                ? { avoidDoors: avoidDoorsOrOpts, maxExpansions: maxExpansionsArg }
                : avoidDoorsOrOpts;
        const avoidDoors = opts.avoidDoors;
        const maxExpansions = opts.maxExpansions ?? MAX_EXPANSIONS;

        const from = this.snapWalkable(fromRaw, 2);
        if (!from) {
            return { ok: false, reason: `start (${fromRaw.x},${fromRaw.z},${fromRaw.level}) not walkable`, expanded: 0 };
        }

        const ctx = this.buildSearchContext(from, toRaw, opts);

        const cardinal = this.cardinalGoals(toRaw);
        if (cardinal.size > 0) {
            const direct = this.search(from, toRaw, cardinal, 1, avoidDoors, maxExpansions, ctx);
            if (direct.ok) {
                return direct;
            }
        }

        const goals = this.goalCandidates(toRaw, 5);
        if (goals.size === 0) {
            return { ok: false, reason: `target (${toRaw.x},${toRaw.z},${toRaw.level}) not walkable within 5 tiles`, expanded: 0 };
        }
        const goalSlack = goals.size === 1 && goals.has(nodeId(toRaw.x, toRaw.z, toRaw.level)) ? 0 : 5;
        return this.search(from, toRaw, goals, goalSlack, avoidDoors, maxExpansions, ctx);
    }

    private buildSearchContext(from: NavPoint, to: NavPoint, opts: FindPathCallOptions): SearchContext {
        const state = opts.state ? worldStateFromData(opts.state) : undefined;
        const policy = opts.policy;
        const routeSpan = routeSpanChebyshev(from, to);
        const injectTele =
            opts.useTeleportCatalog === true
            || (opts.useTeleportCatalog !== false && policy !== undefined && policy.useTeleports !== false);

        const teleEdges: CompiledEdge[] = [];
        if (injectTele && policy?.useTeleports !== false) {
            for (const dest of [...SPELL_TELEPORTS, ...JEWELLERY_TELEPORTS]) {
                if (!this.walkable(dest.to.x, dest.to.z, dest.to.level)) {
                    continue;
                }
                const edgeProbe = {
                    id: dest.teleportId,
                    from,
                    to: dest.to,
                    kind: 'teleport' as const,
                    cost: dest.cost ?? 40,
                    teleportId: dest.teleportId,
                    requires: dest.requires
                };
                if (!teleportAllowedByPolicy(edgeProbe, policy, routeSpan).ok) {
                    continue;
                }
                // Fail closed: spell/jewellery requires (magic level, runes, quests, …)
                // need a WorldState. Without one, do not inject the edge.
                if (dest.requires) {
                    if (!state || !meetsRequires(dest.requires, state).ok) {
                        continue;
                    }
                }
                if (dest.family === 'jewellery') {
                    if (opts.useTeleportCatalog !== true) {
                        continue;
                    }
                    // Jewellery also needs a matching inventory item name (charge stages).
                    if (!opts.state) {
                        continue;
                    }
                    const has = Object.keys(opts.state.items).some(name => inventoryNameMatchesJewellery(name, dest));
                    if (!has) {
                        continue;
                    }
                }
                const transport: TransportInfo = {
                    locName: dest.label,
                    action: dest.family === 'spell' ? 'Cast' : 'Rub',
                    locX: from.x,
                    locZ: from.z,
                    kind: 'teleport',
                    teleportId: dest.teleportId,
                    toTile: { x: dest.to.x, z: dest.to.z },
                    toLevel: dest.to.level !== from.level ? dest.to.level : undefined,
                    acceptAnyLanding: true
                };
                teleEdges.push({
                    to: nodeId(dest.to.x, dest.to.z, dest.to.level),
                    cost: dest.cost ?? 40,
                    transport,
                    requires: dest.requires,
                    kind: 'teleport',
                    teleportId: dest.teleportId
                });
            }
        }

        return { state, policy, teleFromStart: teleEdges, startId: nodeId(from.x, from.z, from.level) };
    }

    private search(
        from: NavPoint,
        toRaw: NavPoint,
        goals: Set<number>,
        goalSlack: number,
        avoidDoors: Set<string> | undefined,
        maxExpansions: number,
        ctx: SearchContext
    ): PathOutcome {
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

            const extras: CompiledEdge[] = [...(this.edges.get(current) ?? [])];
            if (current === ctx.startId) {
                extras.push(...ctx.teleFromStart);
            }
            for (const edge of extras) {
                if (closed.has(edge.to)) {
                    continue;
                }
                if (avoidDoors && avoidDoors.has(`${edge.transport.locX}|${edge.transport.locZ}`)) {
                    continue;
                }
                if (edge.kind && !kindAllowedByPolicy(edge.kind as never, ctx.policy)) {
                    continue;
                }
                // Requires-gated edges (skill/quest/state) need a WorldState snapshot.
                // Classic walks omit state → skip these edges (safe default).
                if (edge.requires && !ctx.state) {
                    continue;
                }
                if (ctx.state && edge.requires && !meetsRequires(edge.requires, ctx.state).ok) {
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

        return { ok: true, waypoints, cost, expanded, hops: hopsFromWaypoints(waypoints) };
    }
}

interface SearchContext {
    state: ReturnType<typeof worldStateFromData> | undefined;
    policy: PathPolicy | undefined;
    teleFromStart: CompiledEdge[];
    startId: number;
}
