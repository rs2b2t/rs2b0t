import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { talkThrough, type NpcStop } from '../../exec/primitives.js';
import { TILE } from './areas.js';

// Why: Burthorpe floor plan, Eohric is castle L1 via "Stairs" at about (2897,3566), Harold is Toad & Chicken L1 via "Staircase" at about (2914,3539), and Tostig, Denulth and Dunstan are on the ground.
// Why: castle L1 and inn L1 are unconnected, so any L1-to-L1 hop between them has to Climb-down, walk the ground, then Climb-up the other building.
// Why: walkResilient can plan that multi-hop only while the stair loc names match the scene.

/** Inn is south of z=3552; castle courtyard and stairs are north. */
export function inInnBand(tile: { z: number }): boolean {
    return tile.z < 3552;
}

function stairsBottomFor(dest: { z: number }): Tile {
    return inInnBand(dest) ? TILE.INN_STAIRS_BOTTOM : TILE.CASTLE_STAIRS_BOTTOM;
}

function stairsTopFor(dest: { z: number }): Tile {
    return inInnBand(dest) ? TILE.INN_STAIRS_TOP : TILE.CASTLE_STAIRS_TOP;
}

async function climbOneFlight(
    op: 'Climb-up' | 'Climb-down',
    stand: Tile,
    targetLevel: number,
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.level === targetLevel) {
        return true;
    }
    // Approach stand on the current level.
    if (stand.distanceTo(here) > 2 || here.level !== stand.level) {
        const approach = new Tile(stand.x, stand.z, here.level);
        if (!(await Traversal.walkResilient(approach, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            log(`could not approach stairs stand (${stand.x},${stand.z},L${here.level})`);
        }
    }
    // Castle = "Stairs"; inn = "Staircase". Never grab wall Ladders.
    const stair = Locs.query().name('Stairs', 'Staircase').action(op).within(8).nearest()
        ?? Locs.query()
            .action(op)
            .where(l => /^stairs?$/i.test(l.name ?? ''))
            .within(8)
            .nearest();
    if (!stair) {
        log(`no Stairs/Staircase to ${op} near (${Game.tile()?.x},${Game.tile()?.z},L${Game.tile()?.level})`);
        return false;
    }
    log(`${op} ${stair.name ?? 'stairs'} at ${stair.tile()}`);
    if (!(await stair.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === targetLevel;
    }, 8000);
}

/** Drop to ground in the building we currently occupy. */
export async function descendToGround(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const here = Game.tile();
        if (!here || here.level === 0) {
            return true;
        }
        const stand = stairsTopFor(here);
        if (await climbOneFlight('Climb-down', stand, 0, log)) {
            return true;
        }
    }
    return (Game.tile()?.level ?? -1) === 0;
}

/** Climb from ground into the building that contains `dest` (level >= 1). */
async function ascendToDestFloor(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.level === dest.level) {
        return true;
    }
    if (here.level > 0) {
        // Wrong building upstairs, go down first.
        if (!(await descendToGround(log))) {
            return false;
        }
    }
    const bottom = stairsBottomFor(dest);
    if (!(await Traversal.walkResilient(bottom, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        log(`could not reach stairs bottom (${bottom.x},${bottom.z})`);
        return false;
    }
    return climbOneFlight('Climb-up', bottom, dest.level, log);
}

export async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here0 = Game.tile();
    if (here0 && here0.level === dest.level && dest.distanceTo(here0) <= radius) {
        return true;
    }

    // Elevated long hops or castle L1 to inn L1: force ground transfer.
    const here1 = Game.tile();
    if (here1 && here1.level > 0) {
        const crossBuildings = dest.level > 0 && inInnBand(here1) !== inInnBand(dest);
        const longOrGround = dest.level === 0 || dest.distanceTo(here1) > 10 || crossBuildings;
        if (longOrGround && !(await descendToGround(log))) {
            return false;
        }
    }

    // Need upper floor of dest building.
    const here2 = Game.tile();
    if (here2 && dest.level > 0 && here2.level !== dest.level) {
        if (!(await ascendToDestFloor(dest, log))) {
            return false;
        }
    }

    const now = Game.tile();
    if (now && now.level === dest.level && dest.distanceTo(now) <= radius) {
        return true;
    }
    // Same-level finish (or walkResilient multi-hop if still elevated).
    return Traversal.walkResilient(dest, { radius, attempts: 4, timeoutMs: 180_000, log });
}

export async function talkAt(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stop.anchor, 2, log))) {
        return false;
    }
    const here = Game.tile();
    if (here && here.level !== stop.anchor.level) {
        if (!(await ascendToDestFloor(stop.anchor, log))) {
            return false;
        }
        if (!(await walkTo(stop.anchor, 2, log))) {
            return false;
        }
    }
    return talkThrough(stop.npc, stop.prefer, log);
}
