/**
 * Transport location matching + trapdoor open (extracted from WalkExecutor).
 */

import type { TransportInfo } from '../PathFinder.js';
import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { Locs, type Loc } from '../../../api/locs/Locs.js';
import { chebyshev } from '../geometry/followMath.js';
import { locRefFromTransport, matchesLocRef } from '../locRef.js';

export function matchesTransportLoc(
    transport: TransportInfo,
    loc: { readonly id: number; tile(): { x: number; z: number } }
): boolean {
    return matchesLocRef(locRefFromTransport(transport), loc);
}

/** How far off a long hop may land. Short hops must be exact — see below. */
const LANDING_TOLERANCE = 3;

export function matchesTransportLanding(
    transport: TransportInfo,
    expectedLevel: number,
    before: WorldTile | null,
    current: WorldTile | null
): boolean {
    if (!current) {
        return false;
    }
    if (transport.toTile && current.level === expectedLevel && chebyshev(current, transport.toTile) <= LANDING_TOLERANCE) {
        if (before === null || current.level !== before.level) {
            return true;
        }
        // Tolerance must not exceed the crossing's own span, or the near side
        // and every frame of the animation read as crossed.
        const span = chebyshev(before, transport.toTile);
        return span <= LANDING_TOLERANCE
            ? chebyshev(current, transport.toTile) === 0
            : chebyshev(current, transport.toTile) < chebyshev(current, before);
    }
    return (
        transport.acceptAnyLanding === true
        && before !== null
        && (current.level !== before.level || chebyshev(current, before) > 64)
    );
}

// Why: after acceptAnyLanding hops (essence exit, random mine entry pads) the live tile can be far from the edge's planned `to`, and continuing would walk a corridor that no longer matches.
// Why: landings within 3 of toTile count as on-plan.

/** True when a multi-landing hop put the player where the published path no longer applies. */
export function multiLandingNeedsRepath(
    transport: TransportInfo,
    plannedLevel: number,
    live: { x: number; z: number; level: number } | null
): boolean {
    if (!live || transport.acceptAnyLanding !== true || !transport.toTile) {
        return false;
    }
    if (live.level !== plannedLevel) {
        return true;
    }
    return chebyshev(live, transport.toTile) > 3;
}

/** Display-name aliases for the same stair family (Burthorpe castle = "Stairs", many inns = "Staircase"). */
function transportNameAliases(locName: string): string[] {
    const base = locName.trim();
    const names = [base];
    if (/^staircase$/i.test(base)) {
        names.push('Stairs');
    } else if (/^stairs$/i.test(base)) {
        names.push('Staircase');
    }
    return names;
}

export function findTransportLoc(transport: TransportInfo): Loc | null {
    const names = transportNameAliases(transport.locName);
    const byMeta = Locs.query()
        .name(...names)
        .action(transport.action)
        .where(loc => matchesTransportLoc(transport, loc))
        .nearest();
    if (byMeta) {
        return byMeta;
    }
    // Fallback: name+action near the recorded placement (scene lag / id drift after
    // ship hops — gangplanks on Brimhaven deck after Barnaby).
    const nearName = Locs.query()
        .name(...names)
        .action(transport.action)
        .where(loc => {
            const t = loc.tile();
            return Math.max(Math.abs(t.x - transport.locX), Math.abs(t.z - transport.locZ)) <= 5;
        })
        .nearest();
    if (nearName) {
        return nearName;
    }
    // Last resort for stairs: any Climb-* loc at the placement tile, regardless of
    // Stairs vs Staircase (content packs differ; edge data may lag).
    if (/climb/i.test(transport.action) && /stair/i.test(transport.locName)) {
        const byTile = Locs.query()
            .action(transport.action)
            .where(loc => {
                const t = loc.tile();
                return (
                    Math.max(Math.abs(t.x - transport.locX), Math.abs(t.z - transport.locZ)) <= 2
                    && /stair/i.test(loc.name ?? '')
                );
            })
            .nearest();
        if (byTile) {
            return byTile;
        }
    }
    // Closed→open transform: doors keep the same name but swap Open↔Close and id.
    // Nearby open leaf ⇒ treat as not-shut so the walker steps through.
    if (/^open$/i.test(transport.action)) {
        const openLeaf = Locs.query()
            .name(transport.locName)
            .where(loc => {
                const t = loc.tile();
                const near = Math.max(Math.abs(t.x - transport.locX), Math.abs(t.z - transport.locZ)) <= 3;
                return near && loc.actions().some(a => a !== null && /^close$/i.test(a));
            })
            .nearest();
        if (openLeaf) {
            return null; // open — caller should walk through, not re-Open
        }
    }
    // Web already slashed: content loc_change → bigweb_slashed ("Slashed web", no Slash).
    // Exact placement only — dual webs share locId one tile apart.
    if (/^slash$/i.test(transport.action) && /web/i.test(transport.locName)) {
        const slashed = Locs.query()
            .name('Slashed web')
            .where(loc => {
                const t = loc.tile();
                return Math.max(Math.abs(t.x - transport.locX), Math.abs(t.z - transport.locZ)) <= 1;
            })
            .nearest();
        if (slashed) {
            return null; // open — walk through after server collision catch-up
        }
    }
    return null;
}

export async function openShutTrapdoor(
    transport: TransportInfo,
    log: (msg: string) => void,
    delayUntil: (pred: () => boolean, ms: number) => Promise<boolean>
): Promise<boolean> {
    const shut = Locs.query()
        .name(transport.locName)
        .where(
            loc =>
                Math.max(Math.abs(loc.tile().x - transport.locX), Math.abs(loc.tile().z - transport.locZ)) <= 3
                && loc.actions().some(a => a !== null && /^open/i.test(a))
        )
        .nearest();
    if (!shut) {
        return false;
    }
    const op = shut.actions().find(a => a !== null && /^open/i.test(a));
    if (!op || !(await shut.interact(op))) {
        return false;
    }
    log(`opened the shut '${transport.locName}' at (${shut.tile().x},${shut.tile().z}) before descending`);
    return delayUntil(() => findTransportLoc(transport) !== null, 4000);
}
