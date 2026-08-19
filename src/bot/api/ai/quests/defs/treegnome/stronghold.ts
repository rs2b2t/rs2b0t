import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import Tile from '../../../../../geometry/Tile.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs, type Loc } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { TG_ITEM, TG_LOC, TG_TILE, inChestFloor, inKhazardHall, inLadderRoom, inStronghold } from './areas.js';
import { clearCommander } from './combat.js';

const CHEST_FLOOR_LADDER = new Tile(2503, 3253, 1);

const WALK = { radius: 0, attempts: 3, timeoutMs: 180_000 };

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

// Why: `tracker_gnome.rs2` records nothing the trackers say, so the ballista's own check is the only gate and these three answers are the leg.
const COORDINATE: readonly [string, string][] = [
    ['height-coordinate', '0004'],
    ['x-coordinate', '0003'],
    ['y-coordinate', '0005']
];

function normalize(lines: readonly string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

export function coordinateChoice(texts: readonly string[], options: readonly string[]): string | null {
    const said = normalize(texts);
    const hit = COORDINATE.find(([header]) => said.includes(header));
    return hit ? options.find(option => option.includes(hit[1])) ?? null : null;
}

const QUIET_TICKS = 8;
const FIRE_TICKS = 200;

async function answerCoordinates(log: (m: string) => void): Promise<boolean> {
    let answered = 0;
    let quiet = 0;
    for (let i = 0; i < FIRE_TICKS; i++) {
        const options = ChatDialog.options();
        if (options.length > 0) {
            const pick = coordinateChoice(ChatDialog.texts(), options);
            if (!pick) {
                log(`ballista: no coordinate header above [${options.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            answered++;
            quiet = 0;
            await Execution.delayTicks(2);
            continue;
        }
        if (ChatDialog.canContinue()) {
            quiet = 0;
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        quiet++;
        if (answered >= COORDINATE.length && quiet >= QUIET_TICKS) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return answered >= COORDINATE.length;
}

export async function fireBallista(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TG_TILE.BALLISTA_STAND, { ...WALK, radius: 2, log }))) {
        return false;
    }
    await settleScene();
    const ballista = locById(TG_LOC.BALLISTA, 8);
    if (!ballista) {
        log(`no Ballista at (${TG_TILE.BALLISTA_STAND.x},${TG_TILE.BALLISTA_STAND.z})`);
        return false;
    }
    if (!(await ballista.interact('Fire'))) {
        return false;
    }
    log('ballista: firing at height 4, x 3, y 5');
    return answerCoordinates(log);
}

async function climbCrumbledWall(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TG_TILE.WALL_STAND, { ...WALK, radius: 1, log }))) {
        return false;
    }
    await settleScene();
    const wall = locById(TG_LOC.CRUMBLED_WALL, 4);
    if (!wall) {
        log(`no Crumbled wall at (${TG_TILE.WALL_STAND.x},${TG_TILE.WALL_STAND.z + 1})`);
        return false;
    }
    if (!(await wall.interact('Climb-over'))) {
        return false;
    }
    // Why: the op raises "The wall has been reduced to rubble." and pauses on its continue, so a wait that only watches the tile holds the tick the button needs.
    const landed = await driveUntil(() => inStronghold(Game.tile()), [], log, 45_000);
    if (!landed) {
        const here = Game.tile();
        log(`the crumbled wall did not let us over from (${here?.x},${here?.z}) — is the ballista shot in?`);
        return false;
    }
    await settleScene();
    return clearCommander(log);
}

// Why: the diagonal door is not a baked edge, so the last tile is a scene step the pathfinder never sees.
async function crossInnerDoor(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TG_TILE.INNER_DOOR_STAND, { ...WALK, log }))) {
        return false;
    }
    const door = locById(TG_LOC.INNER_DOOR, 4);
    if (door && !(await door.interact('Open'))) {
        return false;
    }
    await Execution.delayTicks(2);
    await DirectNavigator.walkTo(TG_TILE.LADDER_STAND, 0, 15_000);
    if (!inLadderRoom(Game.tile())) {
        log('the stronghold inner door did not let us through');
        return false;
    }
    await settleScene();
    return true;
}

async function climbLadder(stand: Tile, id: number, op: string, arrived: () => boolean, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(stand, { ...WALK, radius: 1, log }))) {
        return false;
    }
    const ladder = locById(id, 4);
    if (!ladder) {
        log(`no Ladder offering ${op} at (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await ladder.interact(op))) {
        return false;
    }
    if (!(await driveUntil(arrived, [], log, 12_000))) {
        return false;
    }
    await settleScene();
    return true;
}

async function reachChestFloor(log: (m: string) => void): Promise<boolean> {
    if (inChestFloor(Game.tile())) {
        return true;
    }
    if (!inLadderRoom(Game.tile()) && !inKhazardHall(Game.tile()) && !(await climbCrumbledWall(log))) {
        return false;
    }
    if (inKhazardHall(Game.tile()) && !(await crossInnerDoor(log))) {
        return false;
    }
    return climbLadder(TG_TILE.LADDER_STAND, TG_LOC.LADDER_UP, 'Climb-up', () => inChestFloor(Game.tile()), log);
}

/** Breach to orb: the leg reports the orb, and the next pass walks it out. */
export async function takeTheOrb(log: (m: string) => void): Promise<boolean> {
    if (heldId(TG_ITEM.ORB.id) > 0) {
        return true;
    }
    if (!(await reachChestFloor(log)) || !(await clearCommander(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(TG_TILE.CHEST_STAND, { ...WALK, log }))) {
        return false;
    }
    await settleScene();
    let chest = locById(TG_LOC.CHEST_OPEN, 4);
    if (!chest) {
        const shut = locById(TG_LOC.CHEST_SHUT, 4);
        if (!shut) {
            log(`no chest at (${TG_TILE.CHEST_STAND.x},${TG_TILE.CHEST_STAND.z + 1},1)`);
            return false;
        }
        if (!(await shut.interact('Open'))) {
            return false;
        }
        // Why: a loc that transforms keeps its old id for a tick, so the open chest has to be polled for.
        await Execution.delayUntil(() => locById(TG_LOC.CHEST_OPEN, 4) !== null, 6000);
        chest = locById(TG_LOC.CHEST_OPEN, 4);
        if (!chest) {
            log('the Khazard chest never opened');
            return false;
        }
    }
    if (!(await chest.interact('Search'))) {
        return false;
    }
    return driveUntil(() => heldId(TG_ITEM.ORB.id) > 0, [], log, 12_000);
}

/** The front door opens from the inside only, and it is the one way out. */
export async function leaveStronghold(log: (m: string) => void): Promise<boolean> {
    if (!inStronghold(Game.tile())) {
        return true;
    }
    if (inChestFloor(Game.tile())
        && !(await climbLadder(CHEST_FLOOR_LADDER, TG_LOC.LADDER_DOWN, 'Climb-down', () => inLadderRoom(Game.tile()), log))) {
        return false;
    }
    if (inKhazardHall(Game.tile()) && !(await crossInnerDoor(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(TG_TILE.FRONT_DOOR_STAND, { ...WALK, log }))) {
        return false;
    }
    const door = locById(TG_LOC.FRONT_DOOR, 4);
    if (!door) {
        log(`no stronghold door at (${TG_TILE.OUTSIDE_FRONT_DOOR.x},${TG_TILE.OUTSIDE_FRONT_DOOR.z})`);
        return false;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return driveUntil(() => !inStronghold(Game.tile()), [], log, 10_000);
}
