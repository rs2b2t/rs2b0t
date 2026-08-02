/**
 * Pathfinder danger / no-go zones.
 *
 * Scripts (or Global settings later) can mark axis-aligned rects the walker
 * must not enter — e.g. White Wolf Mountain for low-level accounts.
 *
 * Idea credit: @lolwut (lolwut) — configurable danger zones for the pathfinder.
 */

export interface DangerZoneRect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /**
     * If set, only this height level is forbidden.
     * If omitted, the rect applies on every level (mountain caves + surface).
     */
    level?: number;
}

export interface KnownDangerZone {
    id: string;
    label: string;
    rects: readonly DangerZoneRect[];
    /** Operator-facing note (settings help / docs). */
    help?: string;
}

/**
 * Curated zones for 2004 geography. Bounds are inclusive and slightly generous
 * so the main pass is fully covered; refine with live traces if needed.
 */
export const KNOWN_DANGER_ZONES: readonly KnownDangerZone[] = [
    {
        id: 'white-wolf-mountain',
        label: 'White Wolf Mountain',
        help:
            'Wolf-heavy pass between Taverley and Catherby. Low combat accounts '
            + 'should avoid and take the long coastal route / ship instead.',
        // Surface + caves: Taverley west slope through summit toward Catherby.
        rects: [{ minX: 2828, maxX: 2878, minZ: 3468, maxZ: 3538 }]
    }
];

const byId = new Map(KNOWN_DANGER_ZONES.map(z => [z.id, z]));

export function knownDangerZone(id: string): KnownDangerZone | undefined {
    return byId.get(id);
}

export function knownDangerZoneIds(): string[] {
    return KNOWN_DANGER_ZONES.map(z => z.id);
}

/** True if (x,z[,level]) sits in any of the rects (inclusive bounds). */
export function tileInDangerZones(
    x: number,
    z: number,
    level: number,
    zones: readonly DangerZoneRect[] | undefined
): boolean {
    if (!zones || zones.length === 0) {
        return false;
    }
    for (const r of zones) {
        if (r.level !== undefined && r.level !== level) {
            continue;
        }
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
            return true;
        }
    }
    return false;
}

/**
 * Resolve a mix of known zone ids and ad-hoc rects into a flat rect list.
 * Unknown ids are skipped (logged by caller if desired).
 */
export function resolveDangerZones(
    specs: readonly (string | DangerZoneRect)[] | undefined
): DangerZoneRect[] {
    if (!specs || specs.length === 0) {
        return [];
    }
    const out: DangerZoneRect[] = [];
    for (const s of specs) {
        if (typeof s === 'string') {
            const known = byId.get(s);
            if (known) {
                out.push(...known.rects);
            }
            continue;
        }
        out.push(s);
    }
    return out;
}
