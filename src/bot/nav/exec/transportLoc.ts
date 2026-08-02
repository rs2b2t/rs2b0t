/**
 * Transport location matching + trapdoor open (extracted from WalkExecutor).
 */

import type { TransportInfo } from '../PathFinder.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Locs, type Loc } from '../../api/queries/Locs.js';
import { chebyshev } from '../followMath.js';

export function matchesTransportLoc(
    transport: TransportInfo,
    loc: { readonly id: number; tile(): { x: number; z: number } }
): boolean {
    const tile = loc.tile();
    const near = Math.max(Math.abs(tile.x - transport.locX), Math.abs(tile.z - transport.locZ)) <= 3;
    if (transport.locId === undefined && transport.openLocId === undefined) {
        return near;
    }
    const idOk =
        (transport.locId !== undefined && loc.id === transport.locId)
        || (transport.openLocId !== undefined && loc.id === transport.openLocId);
    if (!idOk) {
        return false;
    }
    if (loc.id === transport.locId) {
        return tile.x === transport.locX && tile.z === transport.locZ;
    }
    return near;
}

export function matchesTransportLanding(
    transport: TransportInfo,
    expectedLevel: number,
    before: WorldTile | null,
    current: WorldTile | null
): boolean {
    if (!current) {
        return false;
    }
    if (transport.toTile && current.level === expectedLevel && chebyshev(current, transport.toTile) <= 3) {
        return true;
    }
    return (
        transport.acceptAnyLanding === true
        && before !== null
        && (current.level !== before.level || chebyshev(current, before) > 64)
    );
}

export function findTransportLoc(transport: TransportInfo): Loc | null {
    return Locs.query()
        .name(transport.locName)
        .action(transport.action)
        .where(loc => matchesTransportLoc(transport, loc))
        .nearest();
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
