import { reader, type WorldTile } from '../../../../../adapter/ClientAdapter.js';
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import Tile from '../../../../../geometry/Tile.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { inGarden, WH_TILE } from './areas.js';

export const GARDEN_ENTRY = new Tile(2901, 3465, 0);
export const FOUNTAIN_STAND = new Tile(2911, 3469, 0);
const SOUTH_HEDGES = new Set([2903, 2907, 2908, 2909, 2915, 2916, 2917, 2923, 2924, 2925, 2929, 2930, 2931]);
const MOVEMENT_GRACE = 4;
const SNAPSHOT_GRACE = 2;
const NORTH_HEDGES = new Set([2912, 2913, 2914, 2919, 2920, 2921, 2926, 2927, 2928, 2932]);

export function sheltered(tile: WorldTile): boolean {
    return tile.level === 0 && (tile.z >= 3467
        || (tile.x === 2901 && tile.z >= 3460 && tile.z <= 3465)
        || (tile.x === 2933 && tile.z === 3463)
        || (tile.z === 3460 && SOUTH_HEDGES.has(tile.x))
        || (tile.z === 3466 && NORTH_HEDGES.has(tile.x)));
}

const ROUTE: Tile[] = [GARDEN_ENTRY];
for (const [x, z] of [[2901, 3460], [2933, 3460], [2933, 3466], [2912, 3466], [2912, 3467], [2911, 3467], [2911, 3469]]) {
    while (ROUTE.at(-1)!.x !== x || ROUTE.at(-1)!.z !== z) {
        const last = ROUTE.at(-1)!;
        ROUTE.push(new Tile(last.x + Math.sign(x - last.x), last.z + Math.sign(z - last.z), 0));
    }
}

const position = (): WorldTile | null => reader.serverTile() ?? Game.tile();

const same = (a: WorldTile | null, b: WorldTile): boolean => !!a && a.level === b.level && a.x === b.x && a.z === b.z;

export function gardenLegs(from: WorldTile, to: WorldTile): Tile[][] | null {
    let index = ROUTE.findIndex(tile => same(from, tile));
    const end = ROUTE.findIndex(tile => same(to, tile));
    if (index < 0 || end < 0) return null;
    const direction = Math.sign(end - index);
    const legs: Tile[][] = [];
    while (index !== end) {
        const leg = [ROUTE[index]];
        const covered = sheltered(ROUTE[index]) && sheltered(ROUTE[index + direction]);
        do {
            index += direction;
            leg.push(ROUTE[index]);
        } while (index !== end && (covered ? sheltered(ROUTE[index + direction]) : !sheltered(ROUTE[index])));
        legs.push(leg);
    }
    return legs;
}

export type PatrolObservation = { tile: WorldTile; tick: number; direction: number };

export function observeWitch(previous: PatrolObservation | null, tile: WorldTile | null, tick: number): PatrolObservation | null {
    if (!tile || tile.level !== 0 || tile.z !== 3463 || tile.x < 2904 || tile.x > 2930) return null;
    let direction = 0;
    if (previous && tick === previous.tick + 1) {
        const dx = tile.x - previous.tile.x;
        if (Math.abs(dx) === 1) direction = Math.sign(dx);
    }
    return { tile, tick, direction };
}

export function safeCrossing(leg: readonly WorldTile[], witch: PatrolObservation | null): boolean {
    if (leg.every(sheltered)) return true;
    if (!witch?.direction) return false;
    let x = witch.tile.x;
    let direction = witch.direction;
    let low = x;
    let high = x;
    for (let tick = 0; tick < leg.length + MOVEMENT_GRACE + SNAPSHOT_GRACE; tick++) {
        if (x === 2904) direction = 1;
        if (x === 2930) direction = -1;
        x += direction;
        low = Math.min(low, x);
        high = Math.max(high, x);
    }
    return leg.every(tile => sheltered(tile) || tile.x < low - 3 || tile.x > high + 3);
}

export async function walkGarden(destination: Tile, log: (message: string) => void): Promise<boolean> {
    if (!inGarden(position())) {
        if (!(await Traversal.walkResilient(GARDEN_ENTRY, { radius: 0, attempts: 2, timeoutMs: 180_000, log }))) return false;
    }
    let here = position();
    if (!here) return false;
    if (here.z >= 3467 && here.x >= 2908 && here.x <= 2912 && !ROUTE.some(tile => same(here, tile))) {
        if (!(await DirectNavigator.walkTo(FOUNTAIN_STAND, 0, 10_000))) return false;
        here = position();
    }
    const legs = here && gardenLegs(here, destination);
    if (!legs) {
        log('outside the guarded garden corridor');
        return false;
    }
    for (const leg of legs) {
        const end = leg.at(-1)!;
        if (leg.every(sheltered)) {
            if (!(await DirectNavigator.walkTo(end, 0, 10_000))) return false;
            continue;
        }
        let ready = false;
        let observation: PatrolObservation | null = null;
        for (let tick = 0; tick < 120; tick++) {
            if (EventSignal.pending() || !same(position(), leg[0])) return false;
            const witch = Npcs.all().find(npc => npc.id === 896)?.networkTile() ?? null;
            observation = observeWitch(observation, witch, Game.tick());
            if (safeCrossing(leg, observation)) { ready = true; break; }
            if (!sheltered(leg[0])) return false;
            if (tick === 0) log(`waiting behind the hedge at ${leg[0].x},${leg[0].z}`);
            await Execution.delayTicks(1);
        }
        if (!ready) return false;
        if (!(await DirectNavigator.walk(end))) return false;
        let previous = position();
        let stalled = 0;
        const budget = leg.length + MOVEMENT_GRACE;
        for (let tick = 0; tick < budget && !same(position(), end); tick++) {
            await Execution.delayTicks(1);
            const current = position();
            if (!current || !inGarden(current)) return false;
            stalled = previous && same(current, previous) ? stalled + 1 : 0;
            previous = current;
            if (stalled < 2 || (same(current, leg[0]) && tick < 2)) continue;
            const cover = sheltered(current) ? new Tile(current.x, current.z, current.level)
                : leg.filter(sheltered).sort((a, b) => a.distanceTo(current) - b.distanceTo(current))[0];
            if (!cover || !(await DirectNavigator.walk(cover))) return false;
            await Execution.delayUntilTicks(() => same(position(), cover), budget - tick - 1);
            log(`garden crossing stalled at ${current.x},${current.z}; returning to cover at ${cover.x},${cover.z}`);
            return false;
        }
        if (!same(position(), end)) {
            const stopped = position();
            if (stopped && inGarden(stopped)) await DirectNavigator.walk(stopped);
            return false;
        }
    }
    return same(position(), destination);
}

export const GARDEN_SHED = WH_TILE.SHED_DOOR;
