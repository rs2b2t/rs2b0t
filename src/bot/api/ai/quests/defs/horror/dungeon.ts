import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { HD_ID, HD_ITEM, HD_LOC, HD_TILE } from './areas.js';
import { inBasement } from './lighthouse.js';

/** The six slots of the strange wall, in the order they are loaded. */
const SLOTS: readonly { id: number; item: string }[] = [
    { id: HD_ID.AIR_RUNE, item: HD_ITEM.AIR_RUNE },
    { id: HD_ID.WATER_RUNE, item: HD_ITEM.WATER_RUNE },
    { id: HD_ID.EARTH_RUNE, item: HD_ITEM.EARTH_RUNE },
    { id: HD_ID.FIRE_RUNE, item: HD_ITEM.FIRE_RUNE },
    { id: HD_ID.DAGGER, item: HD_ITEM.DAGGER },
    { id: HD_ID.ARROW, item: HD_ITEM.ARROW }
];

const PLACED = /you place (a|an) .* into the slot in the wall/i;
const NO_SPACE = /there is no space to put/i;

export function inCavern(tile: { x: number; z: number; level: number } | null): boolean {
    return tile !== null && tile.level === 0 && tile.x >= 2496 && tile.x <= 2559 && tile.z >= 4608 && tile.z <= 4671;
}

/** Two "Iron ladder" locs share the basement; only the tile tells them apart. */
function ladderAt(where: Tile) {
    return Locs.query().name(HD_LOC.LADDER).where(l => l.tile().distanceTo(where) <= 1).nearest();
}

// Why: the load is one of each elemental rune, a stab or slash weapon and an arrow, all consumed.
// Why: only the south face has slots — from the north the wall answers "You cannot see anything unusual about the wall from this side."

/** Load the strange wall; returns the slots it could not fill. */
async function loadWall(log: (m: string) => void): Promise<string[] | null> {
    if (!(await Traversal.walkResilient(HD_TILE.WALL_SOUTH, { radius: 1, attempts: 4, timeoutMs: 120_000, log }))) {
        log('could not reach the south face of the strange wall');
        return null;
    }
    await settleScene();
    const missing: string[] = [];
    for (const slot of SLOTS) {
        const wall = Locs.query().name(HD_LOC.WALL).action('Study').within(6).nearest();
        if (!wall) {
            log('no studiable section of the strange wall in reach');
            return null;
        }
        const held = Inventory.first(slot.item);
        if (!held) {
            // Why: every slot consumes its item, so an item that is gone is almost always one already in the wall.
            // Why: treating that as fatal wedges the quest — the dagger is spent, the pass stops at its slot, and the arrow behind it is never placed, so it is noted and the door judges.
            missing.push(slot.item);
            continue;
        }
        const mark = GameMessages.mark();
        if (!(await held.useOn(wall))) {
            continue;
        }
        // Why: "I don't think I'll get that back if I put it in there." lands a tick after the use-on, and the Yes/No header a tick after that.
        // Why: answering once and then waiting for the message leaves the choice on screen unanswered, so `driveUntil` keeps answering until the goal lands.
        // Why: an already-filled slot skips both boxes and says so straight away.
        const answered = await driveUntil(
            () => GameMessages.sawSince(mark, PLACED) || GameMessages.sawSince(mark, NO_SPACE),
            ['Yes'],
            log,
            15_000
        );
        if (!answered) {
            // One slow answer is not a reason to abandon the wall: the next pass
            // re-reads it, and an already-filled slot says so immediately.
            log(`the wall did not answer the ${slot.item} — moving on`);
            continue;
        }
        log(GameMessages.sawSince(mark, PLACED) ? `placed the ${slot.item}` : `${slot.item} slot was already filled`);
    }
    if (missing.length > 0) {
        log(`nothing left in the pack for: ${missing.join(', ')} — assuming already placed`);
    }
    return missing;
}

const CANNOT_MOVE = /cannot see any way to move/i;

/**
 * Open the far-right section and drop into the cavern. It only answers from the
 * south, and only once all six slots are filled.
 */
export async function openWallAndDescend(log: (m: string) => void): Promise<boolean> {
    if (inCavern(Game.tile())) {
        return true;
    }
    if (!inBasement(Game.tile())) {
        log('not in the lighthouse basement');
        return false;
    }
    const startZ = Game.tile()?.z ?? 0;
    if (startZ < 4627) {
        const missing = await loadWall(log);
        if (missing === null) {
            return false;
        }
        const door = Locs.query()
            .name(HD_LOC.WALL)
            .action('Open')
            .where(l => l.tile().z >= 4627 && l.tile().x >= 2516)
            .nearest();
        if (!door) {
            log('no openable section of the strange wall in reach');
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await door.interact('Open'))) {
            return false;
        }
        const through = await Execution.delayUntil(() => (Game.tile()?.z ?? 0) >= 4627, 8000);
        if (!through) {
            if (!GameMessages.sawSince(mark, CANNOT_MOVE)) {
                log('the wall did not open');
            } else if (missing.length > 0) {
                // Why: the slots it could not fill are the ones whose item is gone, and the door is the only thing that can tell them apart from the ones already filled.
                log(`the wall still has empty slots — ${missing.join(', ')} must be re-sourced`);
            } else {
                log('the wall still has empty slots');
            }
            return false;
        }
        await settleScene();
    }
    if (!(await Traversal.walkResilient(HD_TILE.BASEMENT_DOWN, { radius: 2, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const ladder = ladderAt(HD_TILE.BASEMENT_DOWN);
    if (!ladder) {
        log('no iron ladder down to the cavern');
        return false;
    }
    if (!(await ladder.interact('Climb'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => inCavern(Game.tile()), 10_000))) {
        log('the ladder did not land in the cavern');
        return false;
    }
    await settleScene();
    return true;
}

// Why: completing teleports the player into the post-quest dagannoth cavern under the live lighthouse, a level-1 pocket of mapsquare 39_156 that nothing walks out of.
// Why: its own iron ladder climbs to the lighthouse's ground floor, and from there the causeway is an ordinary walk.
// Why: retaliation stays off, as the level-100 dagannoths on the floor below are not a fight worth having on the way home.

/** Walk out of the finished quest's cavern. */
export async function exitAfterQuest(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.z < 9984) {
        return true;
    }
    Game.setAutoRetaliate(false);
    try {
        if (!(await Traversal.walkResilient(HD_TILE.POSTQUEST_LADDER, { radius: 2, attempts: 4, timeoutMs: 120_000, log }))) {
            log('could not reach the ladder out of the post-quest cavern');
            return false;
        }
        await settleScene();
        const ladder = ladderAt(HD_TILE.POSTQUEST_LADDER);
        if (!ladder || !(await ladder.interact('Climb'))) {
            log('no iron ladder out of the post-quest cavern');
            return false;
        }
        return Execution.delayUntil(() => (Game.tile()?.z ?? 0) < 9984, 10_000);
    } finally {
        Game.setAutoRetaliate(true);
    }
}
