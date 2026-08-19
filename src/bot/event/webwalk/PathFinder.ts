// docs/reference/nav-pathfinding.md
import type { PathHop, PathPolicy, TransportRequires, WorldState } from './types.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';
import { meetsRequires } from './requires.js';
import { kindAllowedByPolicy, routeSpanChebyshev, teleportAllowedByPolicy } from './policy.js';
import { hopsFromWaypoints } from './hops.js';
import {
    SPELL_TELEPORTS,
    inventoryNameMatchesJewellery,
    JEWELLERY_TELEPORTS,
    teleportAllowedFromOrigin
} from './teleportCatalog.js';
import { wildernessLevelAt } from './wilderness.js';
import { specialRequiresAt } from './specialRequires.js';
import { activateTransportRows } from './activateStateAware.js';
import { tileInDangerZones, type DangerZoneRect } from './data/dangerZones.js';
import { essenceReturnIdFromStateIndex, essenceReturnStateIndex } from './essenceExit.js';
import { DEFAULT_EDGE_COST, edgeCostForKind, teleportEdgeCost } from './geometry/edgeCosts.js';

// Why: the A* search key is tileId * 16 + essenceReturnIdx (0..15).
// Why: `idx << 30` must not be used — JS bitwise ops are 32-bit, so idx≥4 wraps to 0 and wipes path-state (the brimstail/cromperty wormhole regression).
// Why: return idx 0 means unknown, where exit edges fail open; 1..n is a known session return.
const TILE_KEY_MASK = 0x3fffffff;
const ESSENCE_STATE_SLOTS = 16;
function packSearchKey(tileId: number, essenceReturnIdx: number): number {
    return (tileId & TILE_KEY_MASK) * ESSENCE_STATE_SLOTS + (essenceReturnIdx & 0xf);
}
function searchTileId(key: number): number {
    return (key / ESSENCE_STATE_SLOTS) | 0;
}
function searchEssenceIdx(key: number): number {
    return key % ESSENCE_STATE_SLOTS;
}

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
    /** Edge kind for hops / tele executor. */
    kind?: string;
    /** Spell/jewellery teleport id (varrock, dueling_arena, …). */
    teleportId?: string;
    /**
     * Graph edge cost when known (set during A* reconstruction). Used by
     * hopsFromWaypoints so explain/corpus costs match the live edge (#337).
     */
    edgeCost?: number;
}

export interface Waypoint extends NavPoint {
    transport?: TransportInfo;
}

export type PathOutcome =
    | { ok: true; waypoints: Waypoint[]; cost: number; expanded: number; hops: PathHop[] }
    | { ok: false; reason: string; expanded: number };

/** Options object for findPath (preferred over positional avoid/max). */
interface FindPathCallOptions {
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
    // Why: the start tile may sit inside one — the bot can path out of a zone, never into one.
    // Why: known ids must be resolved via `resolveDangerZones` before calling (idea @lolwut).

    /** Tiles inside these rects are never expanded into, by walk step or transport landing. */
    avoidZones?: readonly DangerZoneRect[];
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
    // Why: set for transports whose destination is not a static function of the loc placement (RNG, session varps, multi-exit without one plan-time dest) — scripts own those hops and nav plans around them.
    // Why: separate from `disabledReason`, which keeps broken or invalid derived rows for audit.

    /** When true, the edge never enters the path graph. */
    blacklist?: boolean;
    /** Why the edge is blacklisted (docs / audits). */
    blacklistReason?: string;
    /** Optional plan-time gates (curated travel / state-aware activations). */
    requires?: TransportRequires;
}

export type NavRequest =
    | { type: 'init'; pack: ArrayBufferLike }
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
          avoidZones?: readonly DangerZoneRect[];
      };

export type NavResponse =
    | { type: 'ready'; mapsquares: number; doorEdges: number; transportEdges: number }
    | { type: 'error'; message: string }
    | ({ type: 'path'; id: number; elapsedMs: number } & PathOutcome);

const DOOR_COST = DEFAULT_EDGE_COST.door;
// Why: long-range edges force Dijkstra (h = 0), so this first-try budget scales with total path cost rather than distance, and the time-based edge costs raised those costs by 10–25 %.
// Why: at 500 000 the longest clue routes out of Edgeville sat at 96–99 % of budget and Varrock → deep Wilderness needed 502 246, so ordinary destinations failed first-try and survived only on `walkResilient`'s bigger-budget retry — one wasted ladder pass each time.
// Why: matched to that retry budget; unreachable destinations empty the open set long before this and return in well under a second.
const MAX_EXPANSIONS = 1_200_000;

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
    // Why: Chebyshev is then inadmissible without a transport-aware lower bound (#335).

    /** True when any compiled edge spans more tiles than its cost (dungeon z±6400, ships, portals). */
    private hasLongRangeEdges = false;
    doorEdges = 0;
    transportEdges = 0;

    constructor(pack: Uint8Array<ArrayBufferLike>) {
        if (pack.length < 10 || pack[0] !== 0x4c || pack[1] !== 0x43 || pack[2] !== 0x4e || pack[3] !== 0x56) {
            throw new Error('not an LCNV pack');
        }
        const version = pack[4];
        if (version !== 1 && version !== 2) {
            throw new Error(`unsupported LCNV version ${version}`);
        }
        this.members = pack[5] === 1;

        // Read the count off the bytes directly: a DataView over a shared pack
        // would have forced a 12 MB copy per worker to reach two bytes.
        const count = pack[8] | (pack[9] << 8);
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

    /** Every (level, mapsquare) the pack carries, for full-map sweeps. */
    populatedSquares(): { mx: number; mz: number; level: number }[] {
        const out: { mx: number; mz: number; level: number }[] = [];
        for (let key = 0; key < this.slots.length; key++) {
            if (this.slots[key]) {
                out.push({ level: key >> 16, mx: (key >> 8) & 0xff, mz: key & 0xff });
            }
        }
        return out;
    }

    /** Transport/door/stair hops leaving a tile, for connectivity analysis. */
    edgesFrom(x: number, z: number, level: number): { x: number; z: number; level: number }[] {
        const compiled = this.edges.get(nodeId(x, z, level)) ?? [];
        return compiled.map(e => ({ x: nodeX(e.to), z: nodeZ(e.to), level: nodeLevel(e.to) }));
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
            // Guild skill doors etc. via specialCrossings keyed at door tile.
            const doorReq = specialRequiresAt(door.x, door.z, door.level);
            this.addEdge(nodeId(ax, az, door.level), nodeId(bx, bz, door.level), DOOR_COST, transport, doorReq, 'door');
            this.addEdge(nodeId(bx, bz, door.level), nodeId(ax, az, door.level), DOOR_COST, transport, doorReq, 'door');
            this.doorEdges++;
        }

        const activated = activateTransportRows([...transports, ...stairs]);
        for (const edge of activated) {
            // disabledReason: permanently invalid or still state-deferred after activate.
            // blacklist: intentionally excluded — destination not statically modelable (#388).
            if (edge.disabledReason || edge.blacklist === true) {
                continue;
            }
            if (
                !this.walkable(edge.from.x, edge.from.z, edge.from.level) ||
                !this.walkable(edge.to.x, edge.to.z, edge.to.level)
            ) {
                continue;
            }
            const dx = edge.to.x - edge.from.x;
            const dz = edge.to.z - edge.from.z;
            const hasMidpointDoor =
                edge.kind === 'door' && (Math.abs(dx) === 2 || Math.abs(dz) === 2) && dx % 2 === 0 && dz % 2 === 0;
            const transport: TransportInfo = {
                locName: edge.locName,
                action: edge.action,
                // Why: diagonal wall doors occupy the otherwise-unwalkable midpoint between their two stand tiles, and recording a stand tile here makes the executor confuse nearby doors and avoidance strikes.
                locX: edge.locX ?? (hasMidpointDoor ? edge.from.x + dx / 2 : edge.from.x),
                locZ: edge.locZ ?? (hasMidpointDoor ? edge.from.z + dz / 2 : edge.from.z),
                locId: edge.locId,
                openLocId: edge.openLocId,
                kind: edge.kind,
                toLevel: edge.to.level !== edge.from.level ? edge.to.level : undefined,
                // Portals / dungeon / agility shortcuts land on a fixed tile —
                // executor waits on toTile (balancing ledge, log balance, …).
                toTile:
                    edge.kind === 'dungeon' ||
                    edge.kind === 'portal' ||
                    edge.kind === 'ship' ||
                    edge.kind === 'gangplank' ||
                    edge.kind === 'teleport' ||
                    edge.kind === 'shortcut'
                        ? { x: edge.to.x, z: edge.to.z }
                        : undefined,
                // Portals and hub teles may land a few tiles off exact stand.
                acceptAnyLanding: edge.kind === 'portal' || edge.kind === 'teleport' ? true : undefined
            };
            const baseReq = edge.requires ?? specialRequiresAt(edge.from.x, edge.from.z, edge.from.level);
            // Content web.rs2: Slash webs need Knife or a slash-capable blade.
            const requires =
                /^slash$/i.test(edge.action) && /web/i.test(edge.locName)
                    ? { ...(baseReq ?? {}), slashTool: true as const }
                    : baseReq;
            this.addEdge(
                nodeId(edge.from.x, edge.from.z, edge.from.level),
                nodeId(edge.to.x, edge.to.z, edge.to.level),
                edgeCostForKind(edge.kind),
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
        const span = Math.max(Math.abs(nodeX(to) - nodeX(from)), Math.abs(nodeZ(to) - nodeZ(from)));
        if (span > cost) {
            this.hasLongRangeEdges = true;
        }
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
            return {
                ok: false,
                reason: `start (${fromRaw.x},${fromRaw.z},${fromRaw.level}) not walkable`,
                expanded: 0
            };
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
            return {
                ok: false,
                reason: `target (${toRaw.x},${toRaw.z},${toRaw.level}) not walkable within 5 tiles`,
                expanded: 0
            };
        }
        const goalSlack = goals.size === 1 && goals.has(nodeId(toRaw.x, toRaw.z, toRaw.level)) ? 0 : 5;
        return this.search(from, toRaw, goals, goalSlack, avoidDoors, maxExpansions, ctx);
    }

    private buildSearchContext(from: NavPoint, to: NavPoint, opts: FindPathCallOptions): SearchContext {
        const state = opts.state ? worldStateFromData(opts.state) : undefined;
        const policy = opts.policy;
        const avoidZones = opts.avoidZones && opts.avoidZones.length > 0 ? opts.avoidZones : undefined;
        const routeSpan = routeSpanChebyshev(from, to);
        const injectTele =
            opts.useTeleportCatalog === true ||
            (opts.useTeleportCatalog !== false && policy !== undefined && policy.useTeleports !== false);

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
                    cost: dest.cost ?? teleportEdgeCost(dest.family),
                    teleportId: dest.teleportId,
                    requires: dest.requires
                };
                if (!teleportAllowedByPolicy(edgeProbe, policy, routeSpan).ok) {
                    continue;
                }
                // Why: origin gates (wildy thresholds) are evaluated at the path start tile — preferring live `state.wildernessLevel` would poison bank→dest plans that reuse a deep-wildy snapshot while `from` is a bank stand (#339).
                const wildy = wildernessLevelAt(from);
                if (!teleportAllowedFromOrigin(dest, from, wildy).ok) {
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
                    cost: dest.cost ?? teleportEdgeCost(dest.family),
                    transport,
                    requires: dest.requires,
                    kind: 'teleport',
                    teleportId: dest.teleportId
                });
            }
        }

        return {
            state,
            policy,
            teleFromStart: teleEdges,
            startId: nodeId(from.x, from.z, from.level),
            startEssenceIdx: essenceReturnStateIndex(state?.essenceExitReturn),
            avoidZones
        };
    }

    /**
     * Requires check with path-local essence return (may differ from snapshot after an entry hop).
     */
    private edgeAllowedOnPath(
        requires: TransportRequires | undefined,
        baseState: WorldState | undefined,
        pathEssenceIdx: number
    ): boolean {
        if (!requires) {
            return true;
        }
        const pathReturn = essenceReturnIdFromStateIndex(pathEssenceIdx);
        // Essence exit: path return (from entry hop or start session) gates the edge.
        if (requires.essenceExitReturn !== undefined) {
            if (pathReturn !== undefined && pathReturn !== requires.essenceExitReturn) {
                return false;
            }
            // pathReturn undefined (idx 0) → fail open for exit dest
        }
        // Other gates still need WorldState; fail open offline when no state.
        const other: TransportRequires = { ...requires };
        delete other.essenceExitReturn;
        delete other.essenceEntrySetsReturn;
        if (!hasOtherGates(other)) {
            return true;
        }
        if (!baseState) {
            return true; // fail open without WorldState (pre-v2 pack parity)
        }
        // Snapshot may still list a stale essenceExitReturn — use path return for honesty.
        const stateForMeets: WorldState =
            pathReturn !== undefined ? { ...baseState, essenceExitReturn: pathReturn } : baseState;
        return meetsRequires(other, stateForMeets).ok;
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
        const startTile = nodeId(from.x, from.z, from.level);
        const start = packSearchKey(startTile, ctx.startEssenceIdx);
        const goalX = toRaw.x;
        const goalZ = toRaw.z;

        const gScore = new Map<number, number>();
        const cameFrom = new Map<number, number>();
        /** Arrival search-key → transport metadata + edge cost for hop reconstruct. */
        const viaEdge = new Map<number, { transport: TransportInfo; cost: number; kind?: string }>();
        const closed = new Set<number>();
        const open = new MinHeap();
        // Why: unit-cost walk makes Chebyshev an admissible lower bound (#335).
        // Why: originless spell teles injected at the start give min over teleCost + Chebyshev(landing, goal), admissible from any node since the cast works anywhere.
        // Why: long-range graph edges (dungeons z±6400, ships, portals) make pure Chebyshev inadmissible, so without a tele floor the search falls back to Dijkstra (h=0).
        // Why: classic and v2 share this graph and both need correct transport preference (#335 test); the tele inject uses teleFloor to keep HARD long OD under budget.
        const chebAt = (x: number, z: number): number =>
            Math.max(0, Math.max(Math.abs(x - goalX), Math.abs(z - goalZ)) - goalSlack);
        let teleFloor = Infinity;
        for (const e of ctx.teleFromStart) {
            teleFloor = Math.min(teleFloor, e.cost + chebAt(nodeX(e.to), nodeZ(e.to)));
        }
        const heuristic = (x: number, z: number): number => {
            const walk = chebAt(x, z);
            if (teleFloor !== Infinity) {
                return Math.min(walk, teleFloor);
            }
            if (this.hasLongRangeEdges) {
                return 0;
            }
            return walk;
        };

        gScore.set(start, 0);
        open.push(heuristic(from.x, from.z) * 1048576, start);

        let expanded = 0;
        while (open.size > 0) {
            const current = open.pop();
            if (closed.has(current)) {
                continue;
            }
            closed.add(current);

            const curTile = searchTileId(current);
            const curEssence = searchEssenceIdx(current);

            if (goals.has(curTile)) {
                return this.reconstruct(start, current, gScore.get(current)!, expanded, cameFrom, viaEdge);
            }

            if (++expanded > maxExpansions) {
                return {
                    ok: false,
                    reason: `expansion budget exceeded (${maxExpansions})`,
                    expanded
                };
            }

            const x = nodeX(curTile);
            const z = nodeZ(curTile);
            const level = nodeLevel(curTile);
            const g = gScore.get(current)!;
            const escapingDangerZone = ctx.avoidZones ? tileInDangerZones(x, z, level, ctx.avoidZones) : false;

            const mask = this.exitMask(x, z, level);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) {
                    continue;
                }
                const nx = x + DX[dir];
                const nz = z + DZ[dir];
                // Never enter a danger zone from outside. While escaping one, keep
                // its connected tiles searchable until the route reaches safety.
                if (ctx.avoidZones && !escapingDangerZone && tileInDangerZones(nx, nz, level, ctx.avoidZones)) {
                    continue;
                }
                const neighborTile = nodeId(nx, nz, level);
                const neighbor = packSearchKey(neighborTile, curEssence);
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

            const extras: CompiledEdge[] = [...(this.edges.get(curTile) ?? [])];
            if (curTile === ctx.startId) {
                extras.push(...ctx.teleFromStart);
            }
            // Why: a staircase with two ground-floor stand tiles is baked as one edge per combination, so up-then-straight-back-down composes into a same-level teleport across whatever wall separates them.
            // Why: the server lands you on one tile only, so the walker climbs down on the wrong side and bounces — hence refusing a stair hop that returns to the level it came from without moving on the landing.
            // Why: a multi-storey climb keeps going the same way and is unaffected.
            const arrivedBy = viaEdge.get(current);
            const cameFromLevel = arrivedBy?.kind === 'stair'
                ? nodeLevel(searchTileId(cameFrom.get(current) ?? current))
                : null;
            for (const edge of extras) {
                if (cameFromLevel !== null && edge.kind === 'stair' && nodeLevel(edge.to) === cameFromLevel) {
                    continue;
                }
                if (avoidDoors && avoidDoors.has(`${edge.transport.locX}|${edge.transport.locZ}`)) {
                    continue;
                }
                if (edge.kind && !kindAllowedByPolicy(edge.kind as never, ctx.policy)) {
                    continue;
                }
                if (!this.edgeAllowedOnPath(edge.requires, ctx.state, curEssence)) {
                    continue;
                }
                // Apply the same outside-in rule to transport landings and hops.
                if (
                    ctx.avoidZones &&
                    !escapingDangerZone &&
                    tileInDangerZones(nodeX(edge.to), nodeZ(edge.to), nodeLevel(edge.to), ctx.avoidZones)
                ) {
                    continue;
                }
                // Entry hop updates path session return (content sets exit_essence_mine_coord).
                const sets = edge.requires?.essenceEntrySetsReturn;
                const nextEssence = sets !== undefined ? essenceReturnStateIndex(sets) : curEssence;
                const neighbor = packSearchKey(edge.to, nextEssence);
                if (closed.has(neighbor)) {
                    continue;
                }
                const tentative = g + edge.cost;
                const known = gScore.get(neighbor);
                if (known !== undefined && known <= tentative) {
                    continue;
                }
                gScore.set(neighbor, tentative);
                cameFrom.set(neighbor, current);
                viaEdge.set(neighbor, { transport: edge.transport, cost: edge.cost, kind: edge.kind });
                open.push((tentative + heuristic(nodeX(edge.to), nodeZ(edge.to))) * 1048576 - tentative, neighbor);
            }
        }

        return { ok: false, reason: 'unreachable', expanded };
    }

    private reconstruct(
        start: number,
        goal: number,
        cost: number,
        expanded: number,
        cameFrom: Map<number, number>,
        viaEdge: Map<number, { transport: TransportInfo; cost: number }>
    ): PathOutcome {
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
        const point = (searchKey: number): NavPoint => {
            const id = searchTileId(searchKey);
            return { x: nodeX(id), z: nodeZ(id), level: nodeLevel(id) };
        };
        const stepDir = (a: number, b: number): number => {
            const ta = searchTileId(a);
            const tb = searchTileId(b);
            const dx = Math.sign(nodeX(tb) - nodeX(ta));
            const dz = Math.sign(nodeZ(tb) - nodeZ(ta));
            return (dx + 1) * 3 + (dz + 1);
        };

        waypoints.push(point(chain[0]!));
        for (let i = 1; i < chain.length; i++) {
            const via = viaEdge.get(chain[i]!);
            const viaNext = i + 1 < chain.length ? viaEdge.get(chain[i + 1]!) : undefined;
            const last = i === chain.length - 1;
            const turn =
                !last && !via && !viaNext && stepDir(chain[i - 1]!, chain[i]!) !== stepDir(chain[i]!, chain[i + 1]!);
            if (via || viaNext || turn || last) {
                const wp: Waypoint = point(chain[i]!);
                if (via) {
                    // Preserve graph cost on the arrival waypoint's transport.
                    wp.transport = { ...via.transport, edgeCost: via.cost };
                }
                waypoints.push(wp);
            }
        }

        return { ok: true, waypoints, cost, expanded, hops: hopsFromWaypoints(waypoints) };
    }
}

/** Non-essence gates present (for path-local requires without full WorldState). */
function hasOtherGates(requires: TransportRequires): boolean {
    return (
        requires.members === true ||
        requires.freeSlots !== undefined ||
        (requires.skills !== undefined && requires.skills.length > 0) ||
        (requires.items !== undefined && requires.items.length > 0) ||
        (requires.worn !== undefined && requires.worn.length > 0) ||
        requires.currency !== undefined ||
        (requires.quests !== undefined && requires.quests.length > 0) ||
        requires.forbidEntranaRestricted === true ||
        requires.slashTool === true
    );
}

interface SearchContext {
    state: ReturnType<typeof worldStateFromData> | undefined;
    policy: PathPolicy | undefined;
    teleFromStart: CompiledEdge[];
    startId: number;
    /** Path-state essence return at search start (0 = unknown). */
    startEssenceIdx: number;
    avoidZones: readonly DangerZoneRect[] | undefined;
}
