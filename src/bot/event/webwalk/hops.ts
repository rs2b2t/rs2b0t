import type { PathHop, TransportKind } from './types.js';
import type { TransportInfo, Waypoint } from './PathFinder.js';

function kindOf(t: TransportInfo): TransportKind | 'walk' {
    if (t.teleportId || t.kind === 'teleport') {
        return 'teleport';
    }
    if (t.kind === 'door' || t.kind === 'gate' || t.kind === 'stair' || t.kind === 'dungeon'
        || t.kind === 'ship' || t.kind === 'gangplank' || t.kind === 'shortcut' || t.kind === 'portal'
        || t.kind === 'other') {
        return t.kind;
    }
    if (t.toLevel !== undefined || t.toTile !== undefined) {
        return 'dungeon';
    }
    return 'door';
}

// Why: PathFinder's reconstruct attaches transport metadata to the arrival waypoint, so a hop's from is the previous waypoint (approach) and its to is the current waypoint (landing).
// Why: `t.toTile` / `t.toLevel` win for the landing coords when present, and `t.edgeCost` wins when reconstruction preserved the graph cost (#337).

/** Collapse waypoints into first-class transport hops for explain tooling. */
export function hopsFromWaypoints(waypoints: Waypoint[]): PathHop[] {
    const hops: PathHop[] = [];
    for (let i = 0; i < waypoints.length; i++) {
        const w = waypoints[i]!;
        if (!w.transport) {
            continue;
        }
        const t = w.transport;
        const prev = i > 0 ? waypoints[i - 1]! : w;
        const from = { x: prev.x, z: prev.z, level: prev.level };
        const to = t.toTile
            ? { x: t.toTile.x, z: t.toTile.z, level: t.toLevel ?? w.level }
            : { x: w.x, z: w.z, level: w.level };
        const cost =
            t.edgeCost
            ?? (t.kind === 'teleport' || t.teleportId
                ? 40
                : t.toLevel !== undefined || t.toTile
                    ? 10
                    : 4);
        hops.push({
            kind: kindOf(t),
            cost,
            from,
            to,
            locId: t.locId,
            locName: t.locName,
            action: t.action
        });
    }
    return hops;
}

export function formatHops(hops: PathHop[]): string {
    if (hops.length === 0) {
        return '(no transport hops — pure walk)';
    }
    return hops
        .map((h, i) => {
            const dest = `${h.to.x},${h.to.z},L${h.to.level}`;
            const name = h.locName ?? h.kind;
            const act = h.action ? ` ${h.action}` : '';
            const id = h.locId !== undefined ? ` loc=${h.locId}` : '';
            return `${i + 1}. [${h.kind}]${act} ${name}${id} → ${dest} (cost ${h.cost})`;
        })
        .join('\n');
}
