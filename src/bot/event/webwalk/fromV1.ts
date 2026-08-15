/**
 * Adapters that lift doors / stairs / transports JSON into TransportEdge.
 */

import { ensureEdgeId } from './edgeId.js';
import { DEFAULT_EDGE_COST, type NavPoint, type TransportEdge, type TransportKind } from './types.js';

/** Minimal shapes matching PathFinder's v1 JSON (avoid importing PathFinder here). */
interface V1DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
    locName: string;
    dir: 'N' | 'E' | 'S' | 'W';
}

interface V1TransportEdge {
    from: NavPoint;
    to: NavPoint;
    locName: string;
    action: string;
    kind: string;
    locId?: number;
    openLocId?: number;
    locX?: number;
    locZ?: number;
    debugName?: string;
    options?: string[];
    disabledReason?: string;
}

const DOOR_DIR: Record<V1DoorEdge['dir'], [number, number]> = {
    N: [0, 1],
    E: [1, 0],
    S: [0, -1],
    W: [-1, 0]
};

function asKind(raw: string): TransportKind {
    switch (raw) {
        case 'door':
        case 'gate':
        case 'stair':
        case 'dungeon':
        case 'ship':
        case 'gangplank':
        case 'shortcut':
        case 'portal':
        case 'teleport':
            return raw;
        default:
            return 'other';
    }
}

export function doorToTransportEdges(door: V1DoorEdge): TransportEdge[] {
    const [dx, dz] = DOOR_DIR[door.dir];
    const from: NavPoint = { x: door.x, z: door.z, level: door.level };
    const to: NavPoint = { x: door.x + dx, z: door.z + dz, level: door.level };
    const kind: TransportKind = /gate/i.test(door.locName) ? 'gate' : 'door';
    const base = {
        from,
        to,
        kind,
        cost: DEFAULT_EDGE_COST[kind],
        loc: {
            name: door.locName,
            action: 'Open',
            locId: door.locId,
            locX: door.x,
            locZ: door.z
        },
        debug: { source: 'derived-door' }
    };
    // Doors are used bidirectionally in v1 PathFinder addDoorEdges; emit both.
    const forward: TransportEdge = { ...base, id: ensureEdgeId(base) };
    const reverseBase = {
        from: to,
        to: from,
        kind,
        cost: DEFAULT_EDGE_COST[kind],
        loc: base.loc,
        debug: base.debug
    };
    const reverse: TransportEdge = { ...reverseBase, id: ensureEdgeId(reverseBase) };
    return [forward, reverse];
}

export function v1TransportToEdge(raw: V1TransportEdge, source = 'v1-transport'): TransportEdge {
    const kind = asKind(raw.kind);
    const locX = raw.locX ?? raw.from.x;
    const locZ = raw.locZ ?? raw.from.z;
    const partial = {
        from: raw.from,
        to: raw.to,
        kind,
        cost: DEFAULT_EDGE_COST[kind],
        loc: {
            name: raw.locName,
            action: raw.action,
            locId: raw.locId,
            openLocId: raw.openLocId,
            locX,
            locZ
        },
        landing: {
            toLevel: raw.to.level !== raw.from.level ? raw.to.level : undefined,
            // same-plane dungeon hops still need landing awareness for z±6400
            toTile: raw.to
        },
        debug: {
            name: raw.debugName,
            options: raw.options,
            source
        },
        disabledReason: raw.disabledReason
    };
    return { ...partial, id: ensureEdgeId(partial) };
}

export function compileV1Graph(input: {
    doors?: readonly V1DoorEdge[];
    transports?: readonly V1TransportEdge[];
    stairs?: readonly V1TransportEdge[];
}): TransportEdge[] {
    const out: TransportEdge[] = [];
    for (const d of input.doors ?? []) {
        out.push(...doorToTransportEdges(d));
    }
    for (const t of input.transports ?? []) {
        out.push(v1TransportToEdge(t, 'v1-transports'));
    }
    for (const s of input.stairs ?? []) {
        out.push(v1TransportToEdge(s, 'v1-stairs'));
    }
    return out;
}

/** Active (routable) edges only. */
export function activeEdges(edges: readonly TransportEdge[]): TransportEdge[] {
    return edges.filter(e => !e.disabledReason);
}
