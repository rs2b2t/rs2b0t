// Configurable pathfinding exclusions, such as White Wolf Mountain for low-level accounts. Idea: @lolwut.

export interface DangerZoneRect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /** Only this level is forbidden; omit to apply on every level (caves + surface). */
    level?: number;
}

interface KnownDangerZone {
    id: string;
    label: string;
    rects: readonly DangerZoneRect[];
    /** Apply this zone to every walk without requiring an explicit avoidZones id. */
    automatic?: boolean;
    /** Only avoid this zone while the player's combat level is at or below this value. */
    avoidAtOrBelowCombat?: number;
    // Why: endpoint exemptions allow intentional destinations and let players leave a zone.

    /** Skip the zone when either route endpoint is inside it. */
    allowWhenEndpointInside?: boolean;
    /** Operator-facing note (settings help / docs). */
    help?: string;
}

interface DangerZoneEndpoint {
    x: number;
    z: number;
    level: number;
}

interface DangerZoneResolveContext {
    /** Include catalog entries marked automatic. Off by default for backwards compatibility. */
    includeAutomatic?: boolean;
    /** Current player combat level. Unknown levels fail safe and keep conditional zones active. */
    combatLevel?: number;
    start?: DangerZoneEndpoint;
    destination?: DangerZoneEndpoint;
}

/** Curated zones for 2004 geography; bounds are inclusive and a little generous so the main pass is covered. */
export const KNOWN_DANGER_ZONES: readonly KnownDangerZone[] = [
    {
        id: 'white-wolf-mountain',
        label: 'White Wolf Mountain',
        help:
            'Wolf-heavy pass between Taverley and Catherby. Low combat accounts '
            + 'should avoid and take the long coastal route / ship instead.',
        // Surface + caves: Taverley west slope through summit toward Catherby.
        rects: [{ minX: 2828, maxX: 2878, minZ: 3468, maxZ: 3538 }]
    },
    {
        id: 'draynor-jail-guards',
        label: 'Draynor jail guards',
        automatic: true,
        avoidAtOrBelowCombat: 50,
        allowWhenEndpointInside: true,
        help:
            'Four level-26 jail guards aggressively hunt players around the jail compound. '
            + 'Avoid as transit for combat 50 and below, but permit quest destinations inside.',
        // Why: cover each guard's maxrange 12 tether plus the one-tile operation allowance; overlaps are intentional.
        rects: [
            { minX: 3096, maxX: 3122, minZ: 3224, maxZ: 3250, level: 0 },
            { minX: 3107, maxX: 3133, minZ: 3225, maxZ: 3251, level: 0 },
            { minX: 3108, maxX: 3134, minZ: 3236, maxZ: 3262, level: 0 },
            { minX: 3114, maxX: 3140, minZ: 3235, maxZ: 3261, level: 0 }
        ]
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

/** Resolve known zone ids and ad-hoc rects into a flat rect list; unknown ids are skipped. */
export function resolveDangerZones(
    specs: readonly (string | DangerZoneRect)[] | undefined,
    context?: DangerZoneResolveContext
): DangerZoneRect[] {
    const out: DangerZoneRect[] = [];
    const requested = [...(specs ?? [])];
    if (context?.includeAutomatic) {
        requested.push(...KNOWN_DANGER_ZONES.filter(zone => zone.automatic).map(zone => zone.id));
    }

    const resolvedIds = new Set<string>();
    for (const s of requested) {
        if (typeof s === 'string') {
            if (resolvedIds.has(s)) {
                continue;
            }
            resolvedIds.add(s);
            const known = byId.get(s);
            if (known) {
                const combat = context?.combatLevel;
                if (
                    known.avoidAtOrBelowCombat !== undefined
                    && combat !== undefined
                    && combat > known.avoidAtOrBelowCombat
                ) {
                    continue;
                }
                if (
                    known.allowWhenEndpointInside &&
                    (
                        (context?.start
                            && tileInDangerZones(context.start.x, context.start.z, context.start.level, known.rects))
                        || (context?.destination
                            && tileInDangerZones(
                                context.destination.x,
                                context.destination.z,
                                context.destination.level,
                                known.rects
                            ))
                    )
                ) {
                    continue;
                }
                out.push(...known.rects);
            }
            continue;
        }
        out.push(s);
    }
    return out;
}
