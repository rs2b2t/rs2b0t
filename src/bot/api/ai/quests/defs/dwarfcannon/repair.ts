import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { isUnderground, talkThrough, walkWithHops } from '../../exec/primitives.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { CANNON_PARTS, CAVE_HOPS, DWARF_CHILD, MC_LOC, MC_OBJ, MC_TILE, RAILINGS } from './areas.js';

const WALK = { attempts: 3, timeoutMs: 180_000 } as const;

export async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { ...WALK, radius, log });
}

// Why: nothing in the scene tells a fixed railing from a broken one — the content sets a `%mcannonmulti` bit and leaves the loc alone — so the message is the only oracle.

const RAILING_DONE = /already fixed this railing|replace the railing with no problems/i;
// Why: `stat_random` can refuse below max Crafting, and the refusal costs a few hitpoints rather than the railing, so the attempt is worth repeating.
const RAILING_FAILED = /fail and cut yourself trying/i;

/** Repair one railing; true when it is fixed or was already. */
async function fixOne(entry: { id: number; at: Tile }, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(entry.at, 2, log))) {
        return false;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
        await settleScene();
        const railing = Locs.query().where(l => l.id === entry.id).nearest();
        if (!railing) {
            log(`no railing loc ${entry.id} at (${entry.at.x},${entry.at.z})`);
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await railing.interact('Inspect'))) {
            return false;
        }
        await driveUntil(
            () => GameMessages.sawSince(mark, RAILING_DONE) || GameMessages.sawSince(mark, RAILING_FAILED),
            ['Try to replace the railing.'],
            log,
            20_000
        );
        if (GameMessages.sawSince(mark, RAILING_DONE)) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return false;
}

/**
 * Walk the six broken railings in order and replace each.
 * @see Server content railings.rs2
 */
export async function fixRailings(log: (m: string) => void): Promise<boolean> {
    for (const entry of RAILINGS) {
        if (!(await fixOne(entry, log))) {
            log(`railing ${entry.id} did not take — moving on and letting the journal decide`);
        }
        await Execution.delayTicks(1);
    }
    return true;
}

// Why: the tower is not an underground crossing, so `crossHops` never fires for it — `needsHop` is a z >= 5000 test.
// Why: the landing is the player's own tile one level up, as `~climb_ladder` passes `movecoord(coord(), 0, 1, 0)`, and the tile directly above each ladder loc is blocked by the ladder.

/** Climb one ladder from a stand beside it and wait for the level to change. */
async function climb(stand: Tile, op: string, toLevel: number, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    await settleScene();
    const ladder = Locs.query().name('Ladder').action(op).within(4).nearest();
    if (!ladder) {
        log(`no Ladder offering '${op}' at (${stand.x},${stand.z},${stand.level})`);
        return false;
    }
    if (!(await ladder.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => Game.tile()?.level === toLevel, 8000);
}

// Why: neither tower ladder carries a usable transports edge in either direction, so a step that climbs up and stops leaves the walker on a floor it can never route off.

/** Climb back down to ground level from wherever in the tower we are. */
async function leaveTower(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.level ?? 0) === 2 && !(await climb(MC_TILE.TOWER_L2_DOWN, 'Climb-down', 1, log))) {
        return false;
    }
    if ((Game.tile()?.level ?? 0) === 1 && !(await climb(MC_TILE.TOWER_L1_DOWN, 'Climb-down', 0, log))) {
        return false;
    }
    return (Game.tile()?.level ?? 0) === 0;
}

/**
 * Climb the Black Guard watchtower, take the dwarf remains, and come back down.
 * @see Server content mcannon_ladders.rs2
 */
export async function fetchRemains(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(MC_OBJ.REMAINS.name)) {
        return leaveTower(log);
    }
    if ((Game.tile()?.level ?? 0) === 0 && !(await climb(MC_TILE.TOWER_LADDER, 'Climb-up', 1, log))) {
        return false;
    }
    if ((Game.tile()?.level ?? 0) === 1 && !(await climb(MC_TILE.TOWER_L1_LADDER, 'Climb-up', 2, log))) {
        return false;
    }
    if (!(await walkTo(MC_TILE.REMAINS, 2, log))) {
        return false;
    }
    await settleScene();
    const drop = GroundItems.query().name(MC_OBJ.REMAINS.name).within(8).nearest();
    if (!drop) {
        log('no Dwarf remains on the tower floor');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Inventory.contains(MC_OBJ.REMAINS.name), 8000))) {
        return false;
    }
    return leaveTower(log);
}

export function inCave(tile: { z: number } | null | undefined): boolean {
    return tile ? isUnderground(tile) : false;
}

// Why: no transports edge carries either telejump, so findPath reports the cave unreachable from outside and the mainland unreachable from inside — the module's own hops are the only crossing.

/**
 * Enter the goblin cave, free Gilob's son from the crate, and leave by the mud pile.
 * @see Server content mcannon_crate.rs2, mcannon_cave.rs2
 */
export async function rescueChild(rescued: boolean, log: (m: string) => void): Promise<boolean> {
    if (rescued) {
        return walkWithHops(MC_TILE.COMMANDER, 4, [...CAVE_HOPS], log);
    }
    if (!inCave(Game.tile()) && !(await walkWithHops(MC_TILE.CAVE_ARRIVE, 6, [...CAVE_HOPS], log))) {
        return false;
    }
    if (!(await walkTo(MC_TILE.CRATE, 2, log))) {
        return false;
    }
    await settleScene();
    const crate = Locs.query().where(l => l.id === MC_LOC.CRATE).nearest();
    if (!crate) {
        log(`no crate loc ${MC_LOC.CRATE} at (${MC_TILE.CRATE.x},${MC_TILE.CRATE.z})`);
        return false;
    }
    if (!(await crate.interact('Search'))) {
        return false;
    }
    // The crate spawns the youngster and opens his dialogue in one script, and the
    // stage is set by its last line — leaving it undrained loses the rescue.
    await Execution.delayTicks(2);
    await talkThrough(DWARF_CHILD.npc, DWARF_CHILD.prefer, log);
    return true;
}

// Why: only `mes` lines reach GameMessages, and the "working order" line that ends this leg is a `~chatplayer` dialogue — so the stage reaching 8 is the terminal oracle, read by the next decide() rather than watched for here.

// Why: `oploc1` falls to its else branch, and this line, only when %mcannon is neither 6 nor 7 — so it is the one client-visible proof that the repair leg is over.
const CANNON_DONE = /strange dwarf contraption/i;
const CANNON_FIXED = /manage to fix it/i;
const CANNON_ALREADY = /already fixed this part/i;
/** One Inspect resolves at most one component, and each of these ends that cycle. */
export const CANNON_CYCLE = /manage to fix it|already fixed this part|too hard you fail to fix|can't quite find the problem|strange dwarf contraption/i;

export type PartOutcome = 'fixed' | 'already' | 'done' | 'retry';

const OUTCOMES: readonly (readonly [RegExp, PartOutcome])[] = [
    [CANNON_DONE, 'done'],
    [CANNON_FIXED, 'fixed'],
    [CANNON_ALREADY, 'already']
];

/** Classify one Inspect's message; anything else is worth another Inspect. */
export function cannonOutcome(text: string): PartOutcome {
    return OUTCOMES.find(([pattern]) => pattern.test(text))?.[1] ?? 'retry';
}

// Why: the repair menu offers all five components on every Inspect, whatever is already done, so a preference list re-picks its first entry forever — the Pipe is fixed once and every later pass answers "You've already fixed this part of the cannon."

/** Inspect once and answer for one named component; `null` drives no menu. */
async function inspectFor(part: string | null, log: (m: string) => void): Promise<PartOutcome> {
    await settleScene();
    const cannon = Locs.query().where(l => l.id === MC_LOC.BROKEN_CANNON).nearest();
    if (!cannon) {
        log(`no broken cannon loc ${MC_LOC.BROKEN_CANNON} in the shed`);
        return 'retry';
    }
    const mark = GameMessages.mark();
    if (!(await cannon.interact('Inspect'))) {
        return 'retry';
    }
    await driveUntil(() => GameMessages.sawSince(mark, CANNON_CYCLE), part === null ? ['None'] : [part], log, 8000);
    return OUTCOMES.find(([pattern]) => GameMessages.sawSince(mark, pattern))?.[1] ?? 'retry';
}

/**
 * Repair all four damaged components, then Inspect once more to close the stage.
 * @see Server content mcannon_broken_cannon.rs2
 */
export async function repairCannon(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(MC_TILE.CANNON, 2, log))) {
        return false;
    }
    for (const part of CANNON_PARTS) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const outcome = await inspectFor(part, log);
            if (outcome === 'done') {
                log('the cannon is repaired and the stage has moved on — leaving the loop');
                return true;
            }
            if (outcome !== 'retry') {
                log(`${part.toLowerCase()}: ${outcome}`);
                break;
            }
            await Execution.delayTicks(1);
        }
    }
    // Why: the fourth component leaves the stage at 7, and it is the Inspect after it, finding all four bits set, that flips it to 8.
    await inspectFor(null, log);
    return true;
}
